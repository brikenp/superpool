import { BadgeCheck, FileDown, Stamp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { FISCAL_INVOICE_TYPES, FISCAL_PAYMENT_METHODS, defaultFiscalOptions } from '@shared/fiscal.js';
import { CAPS } from '@shared/roles.js';

import { useAuth } from '../lib/auth.jsx';
import { useData } from '../lib/data.jsx';
import { call } from '../lib/firebase.js';
import { money } from '../lib/format.js';
import { invoicePdf } from '../lib/printDocs.js';
import { Field, Modal, useAction, useUi } from './ui.jsx';

/** A mund ta fiskalizojë përdoruesi këtë faturë (POS.AL aktiv, fatura pa kode fiskale). */
export function useCanFiscalize(invoice) {
  const { company } = useData();
  const { can, uid } = useAuth();
  if (!company.fiscalEnabled || !invoice || invoice.fiscal?.fic || invoice.status === 'cancelled' || invoice.fiscalNumber) return false;
  return can(CAPS.FINANCE) || (Boolean(invoice.saleId) && can(CAPS.CHEM_SALES) && invoice.createdBy === uid);
}

/** Butoni "Fiskalizo": zgjedh llojin (cash / jo-cash / e-faturë) dhe e dërgon te POS.AL. */
export function FiscalizeButton({ invoice, sale = null, small = true, onDone }) {
  const allowed = useCanFiscalize(invoice);
  const [open, setOpen] = useState(false);
  if (!allowed) return null;
  return (
    <>
      <button type="button" className={`btn ${small ? 'small' : ''} ok`} title="Fiskalizo te POS.AL" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        <Stamp size={14} /> Fiskalizo
      </button>
      {/* Ngjarjet e React kalojnë edhe nëpër portal: mos e lër klikimin të hapë rreshtin e tabelës poshtë. */}
      {open && createPortal(<div onClick={(e) => e.stopPropagation()}><FiscalizeModal invoice={invoice} sale={sale} onClose={() => setOpen(false)} onDone={onDone} /></div>, document.body)}
    </>
  );
}

function FiscalizeModal({ invoice, sale, onClose, onDone }) {
  const { clientsById, company } = useData();
  const client = clientsById[invoice.clientId] || { name: invoice.clientName };
  const [v, setV] = useState(() => defaultFiscalOptions({ client, sale, invoice }));
  const [run, busy] = useAction();
  const needsNipt = v.invoiceType === 'EINVOICE' && !client.nipt;

  const submit = () => run(async () => {
    const res = await call('fiscalizeInvoice', { invoiceId: invoice.id, ...v });
    onClose();
    onDone?.(res);
    // Printimi menjëherë, me NIVF/NSLF dhe kodin QR.
    await invoicePdf({ ...invoice, fiscalNumber: res.fiscalNumber, status: 'issued', fiscal: res.fiscal }, { company, clientsById }).catch(() => {});
    return res;
  }, (r) => `Fatura u fiskalizua: ${r.fiscalNumber || r.fic}.`);

  return (
    <Modal title={`Fiskalizo faturën ${invoice.internalNumber || ''}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Anulo</button><button type="button" className="btn ok" disabled={busy || needsNipt} onClick={submit}><Stamp size={16} /> Fiskalizo tani</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>
        Fatura dërgohet te programi fiskal POS.AL dhe regjistrohet në sistemin e tatimeve. Pas fiskalizimit nuk mund të ndryshohet — anulohet vetëm me faturë korrigjuese.
      </p>
      <dl className="props">
        <dt>Klienti</dt><dd>{client.name}{client.nipt ? ` · NIPT ${client.nipt}` : ''}</dd>
        <dt>Vlera</dt><dd><b>{money(invoice.amount)}</b>{invoice.deductions?.length ? ` (pas zbritjes së ${invoice.deductions.length} paradhënieve)` : ''}</dd>
        {company.fiscalEnv === 'test' && <><dt>Mjedisi</dt><dd className="text-warn">TEST — fatura nuk ka vlerë tatimore</dd></>}
      </dl>
      <div className="form-grid">
        <Field label="Lloji i faturës">
          <select value={v.invoiceType} onChange={(e) => setV({ ...v, invoiceType: e.target.value, paymentMethod: e.target.value === 'CASH' ? 'BANKNOTE' : 'ACCOUNT' })}>
            {Object.entries(FISCAL_INVOICE_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Mënyra e pagesës">
          <select value={v.paymentMethod} onChange={(e) => setV({ ...v, paymentMethod: e.target.value })}>
            {Object.entries(FISCAL_PAYMENT_METHODS)
              .filter(([k]) => (v.invoiceType === 'CASH' ? ['BANKNOTE', 'CARD', 'OTHER'].includes(k) : k !== 'BANKNOTE'))
              .map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
      </div>
      {needsNipt && <div className="alert warn" style={{ marginTop: 12 }}>E-fatura kërkon NIPT-in e klientit. Plotësojeni te kartela e klientit ose zgjidhni "Jo-cash".</div>}
    </Modal>
  );
}

/** Shkarkon PDF-në zyrtare të e-faturës nga sistemi i tatimeve. */
export function EinvoicePdfButton({ invoice }) {
  const [run, busy] = useAction();
  if (!invoice?.fiscal?.eic) return null;
  const download = () => run(async () => {
    const { pdf, docNumber } = await call('fiscalInvoicePdf', { invoiceId: invoice.id });
    const bytes = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `E-fatura_${String(docNumber || invoice.fiscalNumber).replace(/[\\/:*?"<>|]/g, '-')}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  });
  return <button type="button" className="btn" disabled={busy} onClick={download}><FileDown size={16} /> E-fatura (tatimet)</button>;
}

/** Anulim i faturës së fiskalizuar me faturë korrigjuese. */
export function CorrectInvoiceButton({ invoice, onDone }) {
  const { can } = useAuth();
  const { ask } = useUi();
  const [run, busy] = useAction();
  if (!invoice?.fiscal?.iic || invoice.correction?.fic || !can(CAPS.FINANCE, CAPS.CHEM_SALES_ALL)) return null;
  const correct = async () => {
    const reason = await ask({
      title: 'Faturë korrigjuese',
      message: `Fatura ${invoice.fiscalNumber} do të anulohet në sistemin e tatimeve me një faturë korrigjuese (vlera negative). Veprimi nuk kthehet mbrapsht.`,
      input: 'Arsyeja e anulimit', confirmLabel: 'Lësho faturën korrigjuese', danger: true,
    });
    if (reason) run(async () => { const r = await call('correctFiscalInvoice', { invoiceId: invoice.id, reason }); onDone?.(r); return r; }, (r) => `U lëshua fatura korrigjuese ${r.fiscalNumber}.`);
  };
  return <button type="button" className="btn danger" disabled={busy} onClick={correct}>Anulo me faturë korrigjuese</button>;
}

/** Shenja e vogël "e fiskalizuar" për tabelat. */
export function FiscalBadge({ invoice }) {
  if (!invoice?.fiscal?.fic) return null;
  return <span title={`NIVF ${invoice.fiscal.iic}\nNSLF ${invoice.fiscal.fic}`} className="text-ok" style={{ display: 'inline-flex', marginLeft: 4, verticalAlign: '-3px' }}><BadgeCheck size={15} /></span>;
}

/** Plotëson emrin, NIPT-in dhe adresën e klientit nga regjistri i tatimeve (POS.AL). */
export function TaxpayerLookupButton({ client, onApply }) {
  const { company } = useData();
  const { ask } = useUi();
  const [run, busy] = useAction();
  if (!company.fiscalEnabled) return null;
  const lookup = async () => {
    const value = await ask({ title: 'Kërko në regjistrin e tatimeve', input: 'NIPT ose emri i biznesit', defaultValue: client?.nipt || client?.name || '', confirmLabel: 'Kërko' });
    if (!value) return;
    run(async () => {
      const isNipt = /^[A-Z]\d{8}[A-Z]$/i.test(value.trim());
      const { taxpayers } = await call('lookupTaxpayer', isNipt ? { nipt: value.trim().toUpperCase() } : { name: value.trim() });
      if (!taxpayers.length) throw new Error('Nuk u gjet asnjë tatimpagues.');
      const t = taxpayers[0];
      const ok = await ask({
        title: 'Përditëso klientin',
        message: `${t.name}\nNIPT: ${t.nipt}\n${t.address}${taxpayers.length > 1 ? `\n\n(${taxpayers.length} rezultate — u zgjodh i pari; kërkoni me NIPT për saktësi)` : ''}`,
        confirmLabel: 'Përdor këto të dhëna',
      });
      if (ok) await onApply({ name: t.name, nipt: t.nipt, address: t.address, ...(t.town ? { city: t.town } : {}), type: 'business' });
    }, 'Të dhënat e klientit u përditësuan nga tatimet.');
  };
  return <button type="button" className="btn" disabled={busy} onClick={lookup}><BadgeCheck size={16} /> Nga tatimet (NIPT)</button>;
}

const NIPT_RE = /^[A-Z]\d{8}[A-Z]$/i;

/**
 * Pjesë e formularit të klientit: kërkon NIPT-in (ose emrin) te POS.AL dhe plotëson emrin, adresën dhe qytetin.
 * Kur shkruhet një NIPT i plotë, kërkimi bëhet vetë. Paralajmëron edhe nëse klienti ekziston tashmë.
 */
export function NiptLookup({ values, record, patch }) {
  const { company, clients } = useData();
  const [state, setState] = useState({ busy: false, results: null, error: '', lastNipt: '' });
  const nipt = String(values.nipt || '').trim().toUpperCase();
  const duplicate = nipt && clients.find((c) => c.nipt === nipt && c.id !== record?.id);

  const apply = (t) => {
    patch({ name: t.name, nipt: t.nipt, address: t.address, ...(t.town ? { city: t.town } : {}), type: 'business' });
    setState((s) => ({ ...s, results: null }));
  };
  const search = async (query) => {
    setState((s) => ({ ...s, busy: true, error: '', results: null, lastNipt: NIPT_RE.test(query) ? query : s.lastNipt }));
    try {
      const { taxpayers } = await call('lookupTaxpayer', NIPT_RE.test(query) ? { nipt: query } : { name: query });
      if (!taxpayers.length) setState((s) => ({ ...s, busy: false, error: 'Nuk u gjet në regjistrin e tatimeve.' }));
      else if (taxpayers.length === 1 && NIPT_RE.test(query)) { apply(taxpayers[0]); setState((s) => ({ ...s, busy: false })); }
      else setState((s) => ({ ...s, busy: false, results: taxpayers }));
    } catch (err) {
      setState((s) => ({ ...s, busy: false, error: err.message }));
    }
  };

  // Kërkim automatik sapo NIPT-i ka formën e plotë (p.sh. L12345678A), vetëm një herë për çdo NIPT.
  useEffect(() => {
    if (!company.fiscalEnabled || !NIPT_RE.test(nipt) || nipt === state.lastNipt || nipt === record?.nipt) return;
    const t = setTimeout(() => search(nipt), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nipt, company.fiscalEnabled]);

  if (!company.fiscalEnabled) return duplicate ? <small className="text-warn">Ky NIPT është i regjistruar te klienti «{duplicate.name}».</small> : null;
  const query = nipt || String(values.name || '').trim();
  return (
    <div style={{ marginTop: 6 }}>
      <button type="button" className="btn small" disabled={state.busy || query.length < 3} onClick={() => search(query)}>
        <BadgeCheck size={14} /> {state.busy ? 'Po kërkohet…' : nipt ? 'Kërko NIPT-in te tatimet' : 'Kërko emrin te tatimet'}
      </button>
      {duplicate && <div><small className="text-warn">Ky NIPT është i regjistruar te klienti «{duplicate.name}».</small></div>}
      {state.error && <div><small className="text-danger">{state.error}</small></div>}
      {state.results && (
        <ul className="list-plain" style={{ marginTop: 6, maxHeight: 220, overflow: 'auto' }}>
          {state.results.map((t) => (
            <li key={t.nipt} style={{ cursor: 'pointer' }} onClick={() => apply(t)}>
              <span style={{ flex: 1 }}><b>{t.name}</b> · {t.nipt}<br /><small className="muted">{t.address}</small></span>
              <span className="btn small">Zgjidh</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
