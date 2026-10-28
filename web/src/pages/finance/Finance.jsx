import { addDoc, collection, doc, getDocs, orderBy, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, UNITS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';
import { salePriceIn } from '@shared/prices.js';

import { DataTable } from '../../components/DataTable.jsx';
import { PrintInvoiceButton, PrintPaymentButton, printColumn } from '../../components/PrintButton.jsx';
import { CorrectInvoiceButton, EinvoicePdfButton, FiscalBadge, FiscalizeButton } from '../../components/Fiscal.jsx';
import { invoicePdf } from '../../lib/printDocs.js';
import { Field, Modal, PageHeader, SearchSelect, StatusBadge, useAction } from '../../components/ui.jsx';
import { CurrencyFields, currencyData } from '../../components/Currency.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useData, useQuery } from '../../lib/data.jsx';
import { call, db } from '../../lib/firebase.js';
import { addDays, date, inAll, money, moneyWithAll, round2, todayISO, toNumber } from '../../lib/format.js';
import { clientOption } from '../../lib/clients.js';
import { OpeningBalanceForm } from './OpeningBalance.jsx';
import { ClientLedgerPage } from './ClientLedger.jsx';
import { prettySegment } from '../../lib/prettyUrl.jsx';
import { ImportButton } from '../../components/ImportExcel.jsx';

export const INVOICE_STATUS = { pending_fiscal: 'Pa numër fiskal', issued: 'E lëshuar', cancelled: 'Anuluar' };
// Lloji i faturës manuale (fusha "type"); faturat e shitjeve krijohen nga moduli i shitjeve.
export const INVOICE_TYPES = {
  advance: 'Paradhënie',
  partial: 'Situacion / faturë e pjesshme',
  final: 'Faturë përfundimtare',
  other: 'Tjetër',
};
/** Fatura përfundimtare aktive e projektit (pas saj projekti nuk faturohet më), ose null. */
export const activeFinalInvoice = (invoices) => invoices.find((i) => i.type === 'final' && i.status !== 'cancelled') || null;

export async function findActiveFinalInvoice(projectId) {
  if (!projectId) return null;
  const snap = await getDocs(query(collection(db, 'invoices'), where('projectId', '==', projectId)));
  return activeFinalInvoice(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
}

export const invoiceTypeLabel = (i) => (i.type === 'opening' ? 'Gjendje fillestare' : i.saleId ? 'Shitje' : INVOICE_TYPES[i.type] || (i.projectId ? 'Projekt' : 'Tjetër'));

export function InvoiceForm({ record, onClose }) {
  // Gjendja fillestare ka formën e vet (nuk ka rreshta, nuk fiskalizohet).
  if (record?.type === 'opening') return <OpeningBalanceForm record={record} onClose={onClose} />;
  return <ManualInvoiceForm record={record} onClose={onClose} />;
}

function ManualInvoiceForm({ record, onClose }) {
  const { clients, clientsById, company } = useData();
  const { uid } = useAuth();
  const projects = useQuery(() => query(collection(db, 'projects')), []);
  const isNew = !record.id;
  const [v, setV] = useState(() => {
    const base = {
      fiscalNumber: '', date: todayISO(), dueDate: addDays(todayISO(), 15), amount: '', projectId: '', notes: '',
      type: record.projectId ? 'advance' : 'other', currency: 'ALL', ...record,
    };
    return { ...base, exchangeRate: base.exchangeRate ?? (base.currency === 'EUR' ? company.eurRate || '' : 1) };
  });
  // Faturat e shitjeve, të fiskalizuarat dhe ato përfundimtare (me zbritje) nuk ndryshojnë vlerë.
  const lockedMoney = Boolean(record.saleId || record.fiscal || record.deductions?.length);
  const [lines, setLines] = useState(() => {
    const vat = Number(company.vatPct ?? 20);
    if (record.lines?.length) {
      return record.lines.map((l) => {
        const lv = Number(l.vatPct ?? record.vatPct ?? vat);
        return { ...l, vatPct: lv, priceGross: l.unitPriceGross ?? round2(Number(l.unitPrice) * (1 + lv / 100)) };
      });
    }
    if (record.saleId || !isNew) return null; // faturat e vjetra pa rreshta: vetëm vlera totale
    return [{ productId: '', code: '', description: record.notes || '', unit: 'cope', qty: 1, priceGross: record.amount || '', vatPct: vat }];
  });
  const linesTotal = lines ? round2(lines.reduce((sum, l) => sum + round2(toNumber(l.qty) * toNumber(l.priceGross)), 0)) : null;
  const amountValue = lines ? linesTotal : v.amount;
  const [run, busy] = useAction();
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));
  // Pa klient të zgjedhur shfaqen të gjitha projektet; zgjedhja e projektit plotëson klientin.
  const clientProjects = projects.data.filter((p) => !v.clientId || p.clientId === v.clientId);
  const pickProject = (id) => {
    const p = projects.data.find((x) => x.id === id);
    setV((s) => ({ ...s, projectId: id, ...(p?.clientId && isNew ? { clientId: p.clientId } : {}) }));
  };
  const pickClient = (id) => setV((s) => ({
    ...s, clientId: id, projectId: projects.data.find((p) => p.id === s.projectId)?.clientId === id ? s.projectId : '',
  }));

  const save = () => run(async () => {
    if (!v.clientId) throw new Error('Zgjidhni klientin.');
    if (lines) {
      if (!lines.length) throw new Error('Shtoni të paktën një artikull ose shërbim.');
      lines.forEach((l, i) => {
        if (!String(l.description || '').trim()) throw new Error(`Rreshti ${i + 1}: shkruani emrin e artikullit / shërbimit.`);
        if (!(toNumber(l.qty) > 0) || !(toNumber(l.priceGross) > 0)) throw new Error(`Rreshti ${i + 1}: sasia dhe çmimi duhet të jenë më të mëdha se zero.`);
      });
    }
    if (!(toNumber(amountValue) > 0)) throw new Error('Shkruani vlerën e faturës.');
    // Pas faturës përfundimtare projekti është i mbyllur për faturim.
    if (isNew && v.projectId) {
      const fin = await findActiveFinalInvoice(v.projectId);
      if (fin) throw new Error(`Projekti ka faturë përfundimtare (${fin.fiscalNumber || fin.internalNumber}). Nuk lëshohen fatura të tjera për të; nëse duhet ndryshuar, anulojeni atë me faturë korrigjuese.`);
    }
    const data = {
      fiscalNumber: v.fiscalNumber.trim(),
      status: v.status === 'cancelled' ? 'cancelled' : v.fiscalNumber.trim() ? 'issued' : 'pending_fiscal',
      date: v.date,
      dueDate: v.dueDate,
      clientId: v.clientId,
      clientName: clientsById[v.clientId]?.name || v.clientName || '',
      amount: toNumber(amountValue),
      ...currencyData(v.currency, v.exchangeRate, lockedMoney ? record.amount : amountValue),
      projectId: v.projectId || null,
      notes: v.notes || '',
      updatedAt: serverTimestamp(),
    };
    if (lockedMoney) { delete data.currency; delete data.exchangeRate; if (record.currency) delete data.amountAll; }
    if (!record.saleId) data.type = INVOICE_TYPES[v.type] ? v.type : 'other';
    // Rreshtat ruhen me çmim pa TVSH (për tatimet) dhe me TVSH (siç u shkrua).
    if (lines && !lockedMoney) {
      data.lines = lines.map((l) => {
        const vat = toNumber(l.vatPct);
        const gross = toNumber(l.priceGross);
        return {
          productId: l.productId || null, code: l.code || '', description: String(l.description).trim(), unit: l.unit || 'cope',
          qty: toNumber(l.qty), unitPriceGross: gross, unitPrice: Math.round((gross / (1 + vat / 100)) * 1e8) / 1e8, vatPct: vat,
        };
      });
      data.gross = linesTotal;
      data.net = round2(data.lines.reduce((sum, l) => sum + round2(l.qty * l.unitPriceGross) / (1 + l.vatPct / 100), 0));
      data.vat = round2(data.gross - data.net);
      data.vatPct = data.lines[0].vatPct;
    }
    if (isNew && record.contractId) Object.assign(data, { contractId: record.contractId, contractNumber: record.contractNumber || '', installmentKey: record.installmentKey || null });
    if (isNew) {
      const { number: internalNumber } = await call('allocateNumber', { prefix: 'FAT' });
      const ref = await addDoc(collection(db, 'invoices'), { ...data, internalNumber, kind: v.projectId ? 'project' : 'other', source: 'superpool', createdBy: uid, createdAt: serverTimestamp() });
      if (v.paidNow) {
        const { number } = await call('allocateNumber', { prefix: 'MA' });
        await addDoc(collection(db, 'payments'), {
          number,
          date: v.date, clientId: v.clientId, clientName: data.clientName, invoiceId: ref.id, projectId: data.projectId,
          amount: data.amount, currency: data.currency, exchangeRate: data.exchangeRate, amountAll: data.amountAll, method: v.paidMethod || 'bank', reference: data.fiscalNumber || internalNumber,
          status: 'active', source: 'superpool', createdBy: uid, createdAt: serverTimestamp(),
        });
      }
    } else {
      if (lockedMoney) delete data.amount; // vlera vjen nga shitja / fiskalizimi / fatura përfundimtare
      if (record.fiscal) { delete data.fiscalNumber; delete data.status; } // kodet fiskale nuk ndryshohen me dorë
      await setDoc(doc(db, 'invoices', record.id), data, { merge: true });
    }
    onClose();
  }, 'Fatura u ruajt.');

  return (
    <Modal title={isNew ? 'Shto faturë manuale' : `Fatura ${record.fiscalNumber || record.internalNumber || ''}`} onClose={onClose} wide
      footer={(
        <>
          {!isNew && (
            <span className="row" style={{ marginRight: 'auto', gap: 6 }}>
              <button type="button" className="btn" disabled={busy} onClick={() => run(() => invoicePdf(record, { company, clientsById }))}>PDF / Printo</button>
              <EinvoicePdfButton invoice={record} />
              <FiscalizeButton invoice={record} small={false} onDone={onClose} />
              <CorrectInvoiceButton invoice={record} onDone={onClose} />
            </span>
          )}
          <button type="button" className="btn" onClick={onClose}>Anulo</button>
          <button type="button" className="btn primary" disabled={busy} onClick={save}>Ruaj</button>
        </>
      )}>
      {record.contractNumber && <div className="alert info">Kësti i kontratës {record.contractNumber} — fatura lidhet me kontratën.</div>}
      {!record.fiscal?.fic && record.fiscalError && (
        <div className="alert error" style={{ display: 'block' }}>
          <b>Fiskalizimi i fundit dështoi:</b> {record.fiscalError}
          {record.fiscalDebug?.response && (
            <details style={{ marginTop: 6 }}>
              <summary>Përgjigja e plotë e POS.AL (për ta dërguar te mbështetja)</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', maxHeight: 220, overflow: 'auto' }}>{record.fiscalDebug.response}{'\n\n— Kërkesa —\n'}{JSON.stringify(record.fiscalDebug.request, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
      {record.fiscal?.fic
        ? <div className="alert ok">E fiskalizuar: {record.fiscal.invNum} · NIVF {record.fiscal.iic}{record.correction?.invNum ? ` · anuluar me faturën korrigjuese ${record.correction.invNum}` : ''}</div>
        : <p className="muted" style={{ marginTop: 0 }}>{company.fiscalEnabled ? 'Pas ruajtjes, fiskalizojeni me butonin «Fiskalizo» (POS.AL).' : 'Fatura fiskale lëshohet në programin e faturimit; këtu regjistrohet numri dhe vlera për ndjekjen e detyrimeve.'}</p>}
      <div className="form-grid">
        <Field label="Klienti" required className="span-2">
          <SearchSelect options={clients.map((c) => clientOption(c))} value={v.clientId || ''} onChange={pickClient} disabled={!isNew} />
        </Field>
        {!record.saleId && (
          <Field label="Lloji">
            <select value={v.type} onChange={(e) => set('type', e.target.value)}>
              {Object.entries(INVOICE_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        )}
        <Field label="Nr. fiskal i faturës"><input value={v.fiscalNumber} disabled={Boolean(record.fiscal?.fic)} onChange={(e) => set('fiscalNumber', e.target.value)} /></Field>
        {!lines && <Field label={`Vlera me TVSH (${v.currency === 'EUR' ? '€' : 'L'})`} required><input className="num" type="number" step="any" value={v.amount} disabled={lockedMoney} onChange={(e) => set('amount', e.target.value)} /></Field>}
        <CurrencyFields currency={v.currency} rate={v.exchangeRate} amount={amountValue} disabled={lockedMoney} onChange={(patch) => setV((s) => ({ ...s, ...patch }))} />
        <Field label="Data"><input type="date" value={v.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="Afati i pagesës"><input type="date" value={v.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></Field>
        {!record.saleId && (
          <Field label="Projekti" className="span-2" hint={v.type === 'advance' ? 'Paradhënia regjistrohet te faturuara e projektit.' : undefined}>
            <SearchSelect
              options={[{ value: '', label: '— pa projekt —' }, ...clientProjects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}`, sub: p.clientName }))]}
              value={v.projectId || ''}
              onChange={pickProject}
            />
          </Field>
        )}
        {lines && (
          <div className="span-all">
            <InvoiceLinesEditor lines={lines} onChange={setLines} currency={v.currency} rate={v.exchangeRate} disabled={lockedMoney} />
          </div>
        )}
        {!lines && !lockedMoney && (
          <div className="span-all"><button type="button" className="btn small" onClick={() => setLines([{ productId: '', code: '', description: v.notes || '', unit: 'cope', qty: 1, priceGross: v.amount, vatPct: Number(company.vatPct ?? 20) }])}>+ Shto rreshta artikujsh</button></div>
        )}
        <Field label="Shënime" className="span-all"><input value={v.notes || ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        {isNew && (
          <label className="checkbox span-all">
            <input type="checkbox" checked={Boolean(v.paidNow)} onChange={(e) => set('paidNow', e.target.checked)} /> Është paguar tani (regjistro edhe pagesën me të njëjtën vlerë)
          </label>
        )}
        {isNew && v.paidNow && (
          <Field label="Mënyra e pagesës">
            <select value={v.paidMethod || 'bank'} onChange={(e) => set('paidMethod', e.target.value)}>
              {Object.entries(PAYMENT_METHODS).filter(([k]) => k !== 'credit').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        )}
        {!isNew && !record.saleId && (
          <label className="checkbox span-all"><input type="checkbox" checked={v.status === 'cancelled'} onChange={(e) => set('status', e.target.checked ? 'cancelled' : '')} /> Fatura është anuluar</label>
        )}
      </div>
    </Modal>
  );
}

export function PaymentForm({ record, invoices = [], onClose }) {
  const { clients, clientsById } = useData();
  const { uid } = useAuth();
  const { company } = useData();
  const [v, setV] = useState(() => {
    const inv = invoices.find((i) => i.id === record.invoiceId);
    const currency = record.currency || inv?.currency || 'ALL';
    return { date: todayISO(), amount: '', method: 'bank', reference: '', invoiceId: '', currency, exchangeRate: currency === 'EUR' ? inv?.exchangeRate || company.eurRate || '' : 1, ...record };
  });
  const [run, busy] = useAction();
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));
  const clientInvoices = invoices.filter((i) => i.clientId === v.clientId);
  // Pagesa merr monedhën e faturës që zgjidhet.
  const pickInvoice = (id) => {
    const inv = invoices.find((i) => i.id === id);
    setV((s) => ({ ...s, invoiceId: id, ...(inv ? { currency: inv.currency || 'ALL', exchangeRate: inv.currency === 'EUR' ? inv.exchangeRate || company.eurRate || '' : 1 } : {}) }));
  };

  const save = () => run(async () => {
    if (!v.clientId) throw new Error('Zgjidhni klientin.');
    if (!(toNumber(v.amount) > 0)) throw new Error('Shkruani shumën.');
    const { number } = await call('allocateNumber', { prefix: 'MA' });
    await addDoc(collection(db, 'payments'), {
      number,
      date: v.date, clientId: v.clientId, clientName: clientsById[v.clientId]?.name || '', invoiceId: v.invoiceId || null,
      amount: toNumber(v.amount), ...currencyData(v.currency, v.exchangeRate, v.amount), method: v.method, reference: v.reference || '', status: 'active', source: 'superpool',
      createdBy: uid, createdAt: serverTimestamp(),
    });
    onClose();
  }, 'Pagesa u regjistrua.');

  return (
    <Modal title="Regjistro pagesë" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Anulo</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Ruaj</button></>}>
      <div className="form-grid">
        <Field label="Klienti" required className="span-2">
          <SearchSelect options={clients.map((c) => clientOption(c))} value={v.clientId || ''} onChange={(val) => set('clientId', val)} />
        </Field>
        <Field label={`Shuma (${v.currency === 'EUR' ? '€' : 'L'})`} required><input className="num" type="number" step="any" value={v.amount} onChange={(e) => set('amount', e.target.value)} /></Field>
        <Field label="Data"><input type="date" value={v.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="Mënyra">
          <select value={v.method} onChange={(e) => set('method', e.target.value)}>
            {Object.entries(PAYMENT_METHODS).filter(([k]) => k !== 'credit').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Fatura">
          <select value={v.invoiceId || ''} onChange={(e) => pickInvoice(e.target.value)}>
            <option value="">—</option>
            {clientInvoices.map((i) => <option key={i.id} value={i.id}>{i.fiscalNumber || i.internalNumber} · {money(i.amount, i.currency)}</option>)}
          </select>
        </Field>
        <CurrencyFields currency={v.currency} rate={v.exchangeRate} amount={v.amount} onChange={(patch) => setV((s) => ({ ...s, ...patch }))} />
        <Field label="Referenca (nr. transferte, kupon…)" className="span-2"><input value={v.reference} onChange={(e) => set('reference', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

const FINANCE_SECTIONS = {
  kartela: { tab: 'ledger', title: 'Kartela e klientit', subtitle: 'Gjendja fillestare, faturat dhe likujdimet e klientit me gjendjen pas çdo veprimi.' },
  detyrimet: { tab: 'debts', title: 'Detyrimet e klientëve', subtitle: 'Klientët me fatura të papaguara, sipas detyrimit dhe afatit.' },
  faturat: { tab: 'invoices', title: 'Faturat', subtitle: 'Faturat e klientëve: fiskalizimi (POS.AL), numrat fiskalë, vlerat dhe afatet.' },
  pagesat: { tab: 'payments', title: 'Pagesat', subtitle: 'Pagesat e arkëtuara nga klientët (cash, bankë, kartë).' },
};

export default function Finance() {
  const { section: key = 'detyrimet' } = useParams();
  const section = FINANCE_SECTIONS[key] || FINANCE_SECTIONS.detyrimet;
  if (section.tab === 'ledger') return <ClientLedgerPage section={section} />;
  return <FinanceSection key={section.tab} section={section} />;
}

function FinanceSection({ section }) {
  const { can } = useAuth();
  const tab = section.tab;
  const [from, setFrom] = useState(addDays(todayISO(), -90));
  const [invoiceForm, setInvoiceForm] = useState(null);
  const [paymentForm, setPaymentForm] = useState(null);
  const [openingForm, setOpeningForm] = useState(false);
  const { clients, clientsById } = useData();
  const invoices = useQuery(() => query(collection(db, 'invoices'), where('date', '>=', tab === 'debts' ? '2000-01-01' : from), orderBy('date', 'desc')), [from, tab]);
  const payments = useQuery(() => query(collection(db, 'payments'), where('date', '>=', tab === 'debts' ? '2000-01-01' : from), orderBy('date', 'desc')), [from, tab]);
  const canEdit = can(CAPS.FINANCE);

  const debts = {};
  for (const i of invoices.data) {
    if (i.status === 'cancelled') continue;
    const d = (debts[i.clientId] ||= { id: i.clientId, clientName: i.clientName, invoiced: 0, paid: 0, overdue: 0, lastDate: '' });
    d.invoiced += inAll(i);
    if (i.dueDate && i.dueDate < todayISO()) d.overdue += inAll(i);
    if (i.date > d.lastDate) d.lastDate = i.date;
  }
  for (const p of payments.data) {
    if (p.status === 'cancelled') continue;
    const d = (debts[p.clientId] ||= { id: p.clientId, clientName: p.clientName, invoiced: 0, paid: 0, overdue: 0, lastDate: '' });
    d.paid += inAll(p);
  }
  const debtRows = Object.values(debts)
    .map((d) => ({ ...d, balance: d.invoiced - d.paid, overdueBalance: Math.max(0, d.overdue - d.paid) }))
    .filter((d) => Math.abs(d.balance) > 0.01);

  return (
    <>
      <PageHeader
        title={section.title}
        subtitle={section.subtitle}
        actions={canEdit && (
          <>
            {tab !== 'payments' && <button type="button" className={`btn ${tab === 'invoices' ? 'primary' : ''}`} onClick={() => setInvoiceForm({})}><Plus size={16} /> Faturë</button>}
            {tab !== 'invoices' && <button type="button" className="btn primary" onClick={() => setPaymentForm({})}><Plus size={16} /> Pagesë</button>}
            {tab === 'debts' && <button type="button" className="btn" onClick={() => setOpeningForm(true)}><Plus size={16} /> Gjendje fillestare</button>}
            <ImportButton type={{ debts: 'clientBalances', invoices: 'invoices', payments: 'payments' }[tab]} label={tab === 'debts' ? 'Import gjendjesh' : 'Import nga Excel'} />
          </>
        )}
      />
      {tab !== 'debts' && (
        <Field label="Nga data"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 200, marginBottom: 12 }} /></Field>
      )}
      {tab === 'debts' && (
        <DataTable
          title="Detyrimet e papaguara të klientëve"
          rows={debtRows}
          initialSort={{ key: 'balance', dir: 'desc' }}
          columns={[
            { key: 'clientName', label: 'Klienti', render: (d) => <Link to={`/klientet/${d.id}`}>{d.clientName}</Link> },
            { key: 'invoiced', label: 'Faturuar', type: 'money', total: true },
            { key: 'paid', label: 'Paguar', type: 'money', total: true },
            { key: 'balance', label: 'Detyrimi', type: 'money', total: true },
            { key: 'overdueBalance', label: 'Me afat të kaluar', type: 'money', total: true },
            { key: 'lastDate', label: 'Fatura e fundit', render: (d) => date(d.lastDate) },
            { key: 'ledger', label: '', export: false, sortable: false, render: (d) => <Link className="btn small" to={`/financa/kartela?klienti=${prettySegment('clients', clientsById[d.id] || { id: d.id }, { clients })}`}>Kartela</Link> },
          ]}
        />
      )}
      {tab === 'invoices' && (
        <DataTable
          title="Faturat"
          rows={invoices.data}
          onRowClick={canEdit ? setInvoiceForm : undefined}
          filtersText={[`Nga ${date(from)}`]}
          columns={[
            { key: 'date', label: 'Data', render: (i) => date(i.date) },
            { key: 'type', label: 'Lloji', value: invoiceTypeLabel },
            { key: 'fiscalNumber', label: 'Nr. fiskal', render: (i) => <>{i.fiscalNumber}<FiscalBadge invoice={i} /></> },
            { key: 'internalNumber', label: 'Nr. i brendshëm', value: (i) => i.internalNumber || i.saleNumber || '' },
            { key: 'clientName', label: 'Klienti' },
            { key: 'dueDate', label: 'Afati', render: (i) => date(i.dueDate) },
            { key: 'amount', label: 'Vlera', type: 'money', total: true, value: (i) => (i.status === 'cancelled' ? 0 : inAll(i)), render: (i) => (i.status === 'cancelled' ? money(0) : moneyWithAll(i)) },
            { key: 'status', label: 'Statusi', value: (i) => INVOICE_STATUS[i.status], render: (i) => <StatusBadge status={i.status} labels={INVOICE_STATUS} /> },
            printColumn((i) => <span className="row" style={{ gap: 4, flexWrap: 'nowrap', justifyContent: 'flex-end' }}><FiscalizeButton invoice={i} /><PrintInvoiceButton invoice={i} /></span>),
          ]}
        />
      )}
      {tab === 'payments' && (
        <DataTable
          title="Pagesat"
          rows={payments.data}
          filtersText={[`Nga ${date(from)}`]}
          columns={[
            { key: 'date', label: 'Data', render: (p) => date(p.date) },
            { key: 'number', label: 'Nr. mandati' },
            { key: 'clientName', label: 'Klienti' },
            { key: 'method', label: 'Mënyra', value: (p) => PAYMENT_METHOD_LABELS[p.method] || p.method },
            { key: 'reference', label: 'Referenca' },
            { key: 'amount', label: 'Shuma', type: 'money', total: true, value: (p) => (p.status === 'cancelled' ? 0 : inAll(p)), render: (p) => (p.status === 'cancelled' ? money(0) : moneyWithAll(p)) },
            printColumn((p) => <PrintPaymentButton payment={p} />),
          ]}
        />
      )}
      {invoiceForm && <InvoiceForm record={invoiceForm} onClose={() => setInvoiceForm(null)} />}
      {paymentForm && <PaymentForm record={paymentForm} invoices={invoices.data.filter((i) => i.status !== 'cancelled')} onClose={() => setPaymentForm(null)} />}
      {openingForm && <OpeningBalanceForm onClose={() => setOpeningForm(false)} />}
    </>
  );
}

/** Rreshtat e faturës: artikull nga magazina ose shërbim me tekst, sasia, çmimi me TVSH dhe norma e TVSH-së. */
function InvoiceLinesEditor({ lines, onChange, currency, rate, disabled }) {
  const { products, company } = useData();
  // Çmimi i artikullit në monedhën e faturës (çmimet në euro përdoren direkt; të tjerat kthehen me kursin).
  const priceOf = (p) => salePriceIn(p, currency === 'EUR' ? 'EUR' : 'ALL', currency === 'EUR' ? toNumber(rate) : toNumber(company.eurRate));
  const sym = currency === 'EUR' ? '€' : 'L';
  const options = products.filter((p) => p.active !== false).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}`, sub: p.salePriceCurrency === 'EUR' && p.salePriceEur ? money(p.salePriceEur, 'EUR') : p.salePrice ? money(p.salePrice) : '' }));
  const setLine = (i, patch) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const pick = (i, id) => {
    const p = products.find((x) => x.id === id);
    if (!p) { setLine(i, { productId: '', code: '' }); return; }
    setLine(i, { productId: p.id, code: p.code || '', description: p.name, unit: p.unit || 'cope', ...(priceOf(p) ? { priceGross: priceOf(p) } : {}) });
  };
  const total = lines.reduce((s, l) => s + toNumber(l.qty) * toNumber(l.priceGross), 0);
  return (
    <>
      <b style={{ display: 'block', margin: '6px 0' }}>Artikujt / shërbimet</b>
      <div className="table-wrap">
        <table className="table lines">
          <thead>
            <tr>
              <th style={{ minWidth: 230 }}>Artikulli (nga magazina) ose përshkrimi</th><th style={{ width: 110 }}>Njësia</th><th className="r" style={{ width: 80 }}>Sasia</th>
              <th className="r" style={{ width: 120 }}>Çmimi me TVSH ({sym})</th><th style={{ width: 92 }}>TVSH</th><th className="r" style={{ width: 120 }}>Vlera</th><th style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <SearchSelect options={options} value={l.productId || ''} onChange={(id) => pick(i, id)} disabled={disabled} placeholder="Kërko artikullin…" />
                  <input style={{ marginTop: 4 }} value={l.description} disabled={disabled} placeholder="Emri në faturë (p.sh. Montim pishine)" onChange={(e) => setLine(i, { description: e.target.value })} />
                </td>
                <td>
                  <select value={l.unit} disabled={disabled} onChange={(e) => setLine(i, { unit: e.target.value })}>
                    {Object.entries(UNITS).map(([k, u]) => <option key={k} value={k}>{u}</option>)}
                  </select>
                </td>
                <td><input className="num" type="number" step="any" value={l.qty} disabled={disabled} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                <td>
                  <input className="num" type="number" step="any" value={l.priceGross} disabled={disabled} onChange={(e) => setLine(i, { priceGross: e.target.value })} />
                  {toNumber(l.priceGross) > 0 && <small className="muted">pa TVSH: {money(toNumber(l.priceGross) / (1 + toNumber(l.vatPct) / 100), currency)}</small>}
                </td>
                <td>
                  <select value={l.vatPct} disabled={disabled} onChange={(e) => setLine(i, { vatPct: Number(e.target.value) })}>
                    {[20, 10, 6, 0].map((v) => <option key={v} value={v}>{v}%</option>)}
                  </select>
                </td>
                <td className="r">{money(toNumber(l.qty) * toNumber(l.priceGross), currency)}</td>
                <td>{!disabled && lines.length > 1 && <button type="button" className="btn ghost small" aria-label="Hiq" onClick={() => onChange(lines.filter((_, k) => k !== i))}>×</button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={5}>Totali me TVSH</td><td className="r">{money(total, currency)}</td><td /></tr></tfoot>
        </table>
      </div>
      {!disabled && <button type="button" className="btn small" style={{ marginTop: 6 }} onClick={() => onChange([...lines, { productId: '', code: '', description: '', unit: 'cope', qty: 1, priceGross: '', vatPct: lines.at(-1)?.vatPct ?? 20 }])}>+ Rresht</button>}
    </>
  );
}
