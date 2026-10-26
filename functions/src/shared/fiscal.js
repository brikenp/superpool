// Ndërtimi i kërkesës për fiskalizim te POS.AL (POST /integrations/invoice) nga një faturë e SuperPool.
// Logjikë e pastër (pa rrjet), që testohet më vete.

// Njësitë sipas kodeve UN/ECE që pranon sistemi fiskal.
export const UNIT_CODES = {
  cope: 'XPP', m: 'MTR', m2: 'MTK', m3: 'MTQ', kg: 'KGM', l: 'LTR', pako: 'XPK', set: 'SET', rrotull: 'XRO', ore: 'HUR',
};

export const FISCAL_INVOICE_TYPES = { CASH: 'Cash (me para në dorë / kartë)', NONCASH: 'Jo-cash (bankë)', EINVOICE: 'E-faturë (biznes me NIPT)' };
export const FISCAL_PAYMENT_METHODS = { BANKNOTE: 'Para në dorë', CARD: 'Kartë', ACCOUNT: 'Transfertë bankare', ORDER: 'Urdhër pagese', OTHER: 'Tjetër' };

// Lloji i e-faturës sipas llojit të faturës në SuperPool.
const EINVOICE_TYPE = { advance: 'ADVANCE_PAYMENT', partial: 'PARTIAL', final: 'COMMERCIAL', other: 'COMMERCIAL' };

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const r8 = (n) => Math.round(Number(n || 0) * 1e8) / 1e8;

/** Zgjedhja e paracaktuar: biznes me NIPT → e-faturë; individ → cash/kartë ose jo-cash sipas pagesës. */
export function defaultFiscalOptions({ client = {}, sale = null, invoice = {} }) {
  const method = sale?.paymentMethod || invoice.paymentMethod || 'bank';
  if (client.nipt && /^[A-Z]\d{8}[A-Z]$/i.test(client.nipt)) return { invoiceType: 'EINVOICE', paymentMethod: 'ACCOUNT' };
  if (method === 'cash') return { invoiceType: 'CASH', paymentMethod: 'BANKNOTE' };
  if (method === 'card') return { invoiceType: 'CASH', paymentMethod: 'CARD' };
  return { invoiceType: 'NONCASH', paymentMethod: 'ACCOUNT' };
}

/**
 * Rreshtat fiskalë: çmimi pa TVSH dhe totali me TVSH për çdo artikull.
 *  - shitjet: çmimi në SuperPool është me TVSH
 *  - fatura përfundimtare: rreshtat janë pa TVSH
 *  - fatura manuale: rreshtat e artikujve (çmim me TVSH, TVSH për rresht), ose një rresht me vlerën
 */
export function fiscalItems({ invoice, sale, vatPayer = true, vatPct = 20 }) {
  const defaultRate = vatPayer ? Number(invoice.vatPct ?? vatPct) : 0;
  const item = ({ name, code, unit, quantity, withTax, withoutTax, rate = defaultRate }) => {
    const r = vatPayer ? Number(rate) : 0;
    const net = withoutTax ?? withTax / (1 + r / 100);
    const totalWithTax = withTax !== undefined ? r2(quantity * withTax) : r2(quantity * net * (1 + r / 100));
    return {
      quantity: Number(quantity),
      priceWithoutTax: r8(net),
      tax: vatPayer,
      taxRate: r,
      taxType: vatPayer ? String(r) : 'TAX_FREE',
      totalWithTax,
      name: String(name || 'Artikull').slice(0, 200),
      unit: UNIT_CODES[unit] || 'XPP',
      discount: 0,
      ...(code ? { code: String(code).slice(0, 50) } : {}),
    };
  };
  if (Array.isArray(invoice.lines) && invoice.lines.length) {
    // Rreshtat me çmim me TVSH (faturat manuale) ruajnë totalin e saktë; ato pa TVSH (përfundimtare) llogariten.
    return invoice.lines.map((l) => item({
      name: l.description, code: l.code, unit: l.unit, quantity: l.qty, rate: l.vatPct ?? defaultRate,
      ...(l.unitPriceGross != null ? { withTax: Number(l.unitPriceGross) } : { withoutTax: Number(l.unitPrice) }),
    }));
  }
  if (sale?.lines?.length) {
    return sale.lines.map((l) => item({ name: l.name, code: l.code, unit: l.unit, quantity: l.qty, withTax: Number(l.unitPrice) }));
  }
  const label = { advance: 'Paradhënie', partial: 'Situacion punimesh', final: 'Faturë përfundimtare' }[invoice.type] || 'Shërbim';
  return [item({ name: invoice.notes || label, unit: 'set', quantity: 1, withTax: Number(invoice.amount) })];
}

/** Trupi i plotë i kërkesës për POS.AL. */
export function buildFiscalRequest({ config, invoice, sale = null, client = {}, options = {} }) {
  const invoiceType = FISCAL_INVOICE_TYPES[options.invoiceType] ? options.invoiceType : 'CASH';
  const paymentMethod = FISCAL_PAYMENT_METHODS[options.paymentMethod] ? options.paymentMethod : 'BANKNOTE';
  const items = fiscalItems({ invoice, sale, vatPayer: config.vatPayer !== false, vatPct: config.vatPct ?? 20 });
  const prepaid = r2((invoice.deductions || []).reduce((s, d) => s + Number(d.amount || 0), 0));
  const isEinvoice = invoiceType === 'EINVOICE';
  // Pa e-faturë, paradhëniet e faturuara më parë zbriten si rreshta negativë.
  if (prepaid > 0 && !isEinvoice) {
    const rate = config.vatPayer !== false ? Number(invoice.vatPct ?? config.vatPct ?? 20) : 0;
    for (const d of invoice.deductions) {
      items.push({
        quantity: -1, priceWithoutTax: r8(Number(d.amount) / (1 + rate / 100)), tax: config.vatPayer !== false, taxRate: rate,
        taxType: config.vatPayer !== false ? String(rate) : 'TAX_FREE', totalWithTax: -r2(d.amount),
        name: `Zbritje: ${d.label || 'paradhënie'}`.slice(0, 200), unit: 'XPP', discount: 0,
      });
    }
  }
  const nipt = String(client.nipt || '').trim().toUpperCase();
  const customer = {
    name: client.name || invoice.clientName || 'Klient',
    country: 'ALB',
    ...(nipt ? { id: nipt, typeOfId: 'NUIS' } : client.idNumber ? { id: client.idNumber, typeOfId: 'ID' } : {}),
    ...(client.address ? { address: String(client.address).slice(0, 200) } : {}),
    ...(client.city ? { town: client.city } : {}),
  };
  const body = {
    shopId: config.shopId,
    orderId: String(invoice.internalNumber || invoice.saleNumber || invoice.id),
    order: {
      items,
      // Faturat në euro: çmimet janë në EUR dhe kursi (L për 1 €) dërgohet si exchangeRate.
      currency: invoice.currency === 'EUR' ? 'EUR' : 'ALL',
      exchangeRate: invoice.currency === 'EUR' ? Number(invoice.exchangeRate) || 1 : 1,
      options: {
        invoiceType,
        paymentMethod,
        isEinvoice,
        invoiceOption: 'NONE',
        customer,
        ...(Array.isArray(config.bankAccounts) && config.bankAccounts.length && invoiceType !== 'CASH' ? { bankAccounts: config.bankAccounts } : {}),
        ...(isEinvoice ? {
          eInvoiceOptions: {
            prepaidAmount: prepaid,
            payDeadline: invoice.dueDate || invoice.date,
            profileID: 'P1',
            type: EINVOICE_TYPE[invoice.type] || 'COMMERCIAL',
          },
        } : {}),
      },
      ...(invoice.notes && !invoice.lines ? { notes: String(invoice.notes).slice(0, 500) } : {}),
    },
  };
  return body;
}

/** Fatura korrigjuese (anulim): të njëjtat rreshta me sasi negative dhe referenca e faturës origjinale. */
export function buildCorrectionRequest({ config, invoice, original }) {
  const items = (original.order?.items || []).map((i) => ({ ...i, quantity: -Number(i.quantity), totalWithTax: -Number(i.totalWithTax) }));
  return {
    shopId: config.shopId,
    orderId: `${invoice.internalNumber || invoice.id}-K`,
    order: {
      items,
      currency: original.order.currency || 'ALL',
      exchangeRate: original.order.exchangeRate || 1,
      options: {
        ...original.order.options,
        ...(original.order.options?.isEinvoice ? { eInvoiceOptions: { ...original.order.options.eInvoiceOptions, prepaidAmount: 0, type: 'CORRECTIVE' } } : {}),
        correction: { iic: invoice.fiscal.iic, issueDateTime: invoice.fiscal.issueDateTime },
      },
    },
  };
}
