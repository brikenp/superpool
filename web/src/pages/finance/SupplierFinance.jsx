// Financa e furnitorëve: faturat e blerjes, pagesat te furnitorët, gjendjet fillestare,
// kartela e furnitorit dhe detyrimet ndaj furnitorëve.
import { addDoc, collection, doc, getDocs, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '@shared/constants.js';
import { agingOf, buildLedger } from '@shared/ledger.js';
import { CAPS } from '@shared/roles.js';

import { AccountField, accountFields } from '../../components/AccountField.jsx';
import { CurrencyFields, currencyData } from '../../components/Currency.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { ImportButton } from '../../components/ImportExcel.jsx';
import { LedgerView } from '../../components/LedgerView.jsx';
import { Card, Field, Modal, PageHeader, SearchSelect, StatusBadge, useAction } from '../../components/ui.jsx';
import { defaultAccountId } from '../../lib/accounts.js';
import { useAuth } from '../../lib/auth.jsx';
import { useData, useQuery } from '../../lib/data.jsx';
import { call, db } from '../../lib/firebase.js';
import { addDays, date, firstOfYear, inAll, money, moneyWithAll, round2, todayISO, toNumber } from '../../lib/format.js';
import { prettySegment } from '../../lib/prettyUrl.jsx';

export const SUPPLIER_INVOICE_STATUS = { active: 'Aktive', cancelled: 'Anuluar' };
const OPENING = 'Gjendje fillestare';
const seconds = (x) => x?.createdAt?.seconds || 0;
const supplierOption = (s) => ({ value: s.id, label: s.name, sub: [s.nipt, s.phone].filter(Boolean).join(' · '), search: s.nipt || '' });
const invoiceLabel = (i) => (i.type === 'opening' ? OPENING : 'Faturë blerjeje');

/** Vlera pa TVSH e një fletëhyrjeje (sasia × kosto e blerjes). */
const receiptNet = (m) => round2((m.lines || []).reduce((s, l) => s + Number(l.qty || 0) * Number(l.unitCost || 0), 0));

// ---------------------------------------------------------------- Forma: faturë blerjeje

export function SupplierInvoiceForm({ record = {}, onClose }) {
  const { suppliers, suppliersById, company } = useData();
  const { uid } = useAuth();
  const isNew = !record.id;
  const vatDefault = Number(company.vatPct ?? 20);
  const [v, setV] = useState(() => ({
    supplierId: '', number: '', date: todayISO(), dueDate: addDays(todayISO(), 30), net: '', vatPct: vatDefault, amount: '',
    currency: 'ALL', exchangeRate: 1, notes: '', movementIds: [], ...record,
  }));
  const [run, busy] = useAction();
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));
  // Fletëhyrjet e furnitorit dhe ato që janë faturuar tashmë (nga faturat e tjera).
  const receipts = useQuery(() => (v.supplierId ? query(collection(db, 'movements'), where('supplierId', '==', v.supplierId)) : null), [v.supplierId]);
  const others = useQuery(() => (v.supplierId ? query(collection(db, 'supplierInvoices'), where('supplierId', '==', v.supplierId)) : null), [v.supplierId]);
  const invoicedElsewhere = new Set(others.data.filter((i) => i.id !== record.id && i.status !== 'cancelled').flatMap((i) => i.movementIds || []));
  const available = receipts.data
    .filter((m) => m.kind === 'purchase' && m.status === 'confirmed' && !invoicedElsewhere.has(m.id))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const gross = (net, vat) => round2(toNumber(net) * (1 + toNumber(vat) / 100));
  const toggleReceipt = (m) => setV((s) => {
    const ids = s.movementIds.includes(m.id) ? s.movementIds.filter((x) => x !== m.id) : [...s.movementIds, m.id];
    const net = round2(receipts.data.filter((r) => ids.includes(r.id)).reduce((sum, r) => sum + receiptNet(r), 0));
    return { ...s, movementIds: ids, number: s.number || m.fiscalRef || '', ...(ids.length ? { net, amount: gross(net, s.vatPct), currency: 'ALL', exchangeRate: 1 } : {}) };
  });

  const save = () => run(async () => {
    if (!v.supplierId) throw new Error('Zgjidhni furnitorin.');
    if (!(toNumber(v.amount) > 0)) throw new Error('Shkruani vlerën e faturës (me TVSH).');
    const data = {
      supplierId: v.supplierId, supplierName: suppliersById[v.supplierId]?.name || v.supplierName || '',
      number: String(v.number || '').trim(), date: v.date, dueDate: v.dueDate || v.date,
      net: toNumber(v.net) || round2(toNumber(v.amount) / (1 + toNumber(v.vatPct) / 100)), vatPct: toNumber(v.vatPct),
      amount: toNumber(v.amount), ...currencyData(v.currency, v.exchangeRate, v.amount),
      movementIds: v.movementIds || [], notes: v.notes || '', updatedAt: serverTimestamp(),
    };
    if (isNew) {
      if (data.number) {
        const dup = (await getDocs(query(collection(db, 'supplierInvoices'), where('supplierId', '==', v.supplierId), where('number', '==', data.number)))).docs
          .find((d) => d.get('status') !== 'cancelled');
        if (dup) throw new Error(`Fatura ${data.number} e këtij furnitori është regjistruar më parë (${dup.get('internalNumber')}).`);
      }
      const { number: internalNumber } = await call('allocateNumber', { prefix: 'FB' });
      await addDoc(collection(db, 'supplierInvoices'), { ...data, internalNumber, type: 'purchase', status: 'active', source: 'superpool', createdBy: uid, createdAt: serverTimestamp() });
    } else {
      await updateDoc(doc(db, 'supplierInvoices', record.id), data);
    }
    onClose();
  }, 'Fatura e blerjes u ruajt.');
  const cancel = () => run(async () => {
    if (!window.confirm('Të anulohet kjo faturë blerjeje?')) return;
    await updateDoc(doc(db, 'supplierInvoices', record.id), { status: 'cancelled', updatedAt: serverTimestamp() });
    onClose();
  }, 'Fatura u anulua.');

  return (
    <Modal title={isNew ? 'Faturë blerjeje (nga furnitori)' : `Fatura e blerjes ${record.internalNumber || ''}`} onClose={onClose} wide
      footer={(
        <>
          {!isNew && record.status !== 'cancelled' && <button type="button" className="btn danger" disabled={busy} onClick={cancel} style={{ marginRight: 'auto' }}>Anulo faturën</button>}
          <button type="button" className="btn" onClick={onClose}>Mbyll</button>
          {record.status !== 'cancelled' && <button type="button" className="btn primary" disabled={busy} onClick={save}>Ruaj</button>}
        </>
      )}>
      <div className="form-grid">
        <Field label="Furnitori" required className="span-2">
          <SearchSelect options={suppliers.map(supplierOption)} value={v.supplierId} onChange={(id) => setV((s) => ({ ...s, supplierId: id, movementIds: [] }))} disabled={!isNew} />
        </Field>
        <Field label="Nr. i faturës së furnitorit"><input value={v.number} onChange={(e) => set('number', e.target.value)} placeholder="p.sh. 245/2026" /></Field>
        <Field label="Data"><input type="date" value={v.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="Afati i pagesës"><input type="date" value={v.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></Field>
        <Field label={`Vlera pa TVSH (${v.currency === 'EUR' ? '€' : 'L'})`}>
          <input className="num" type="number" step="any" value={v.net} onChange={(e) => setV((s) => ({ ...s, net: e.target.value, amount: gross(e.target.value, s.vatPct) }))} />
        </Field>
        <Field label="TVSH %"><input className="num" type="number" step="any" value={v.vatPct} onChange={(e) => setV((s) => ({ ...s, vatPct: e.target.value, amount: s.net !== '' ? gross(s.net, e.target.value) : s.amount }))} /></Field>
        <Field label={`Vlera me TVSH (${v.currency === 'EUR' ? '€' : 'L'})`} required>
          <input className="num" type="number" step="any" value={v.amount} onChange={(e) => set('amount', e.target.value)} />
        </Field>
        <CurrencyFields currency={v.currency} rate={v.exchangeRate} amount={v.amount} onChange={(patch) => setV((s) => ({ ...s, ...patch }))} />
        <Field label="Shënime" className="span-all"><input value={v.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
      {v.supplierId && (available.length > 0 || v.movementIds.length > 0) && (
        <div style={{ marginTop: 12 }}>
          <strong>Fletëhyrjet që mbulon kjo faturë</strong>
          <p className="muted" style={{ margin: '2px 0 6px', fontSize: '0.85rem' }}>Zgjidhni fletëhyrjet: vlera pa TVSH plotësohet nga kostot e tyre.</p>
          <div className="table-wrap" style={{ maxHeight: 220 }}>
            <table className="table">
              <tbody>
                {[...available, ...receipts.data.filter((m) => v.movementIds.includes(m.id) && !available.includes(m))].map((m) => (
                  <tr key={m.id}>
                    <td style={{ width: 30 }}><input type="checkbox" checked={v.movementIds.includes(m.id)} onChange={() => toggleReceipt(m)} /></td>
                    <td>{m.number}</td>
                    <td>{date(m.date)}</td>
                    <td>{(m.lines || []).length} artikuj</td>
                    <td className="r">{money(receiptNet(m))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Te fletëhyrja: faturën e blerjes që e mbulon, ose butoni për ta regjistruar. */
export function PurchaseInvoiceButton({ movement: m }) {
  const { company } = useData();
  const [open, setOpen] = useState(false);
  const linked = useQuery(() => query(collection(db, 'supplierInvoices'), where('movementIds', 'array-contains', m.id)), [m.id]);
  const inv = linked.data.find((i) => i.status !== 'cancelled');
  if (inv) return <Link className="btn" to={`/financa/faturat-blerje`} title="Fatura e blerjes që mbulon këtë fletëhyrje">Faturuar: {inv.number || inv.internalNumber}</Link>;
  const net = receiptNet(m);
  const vat = Number(company.vatPct ?? 20);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>Regjistro faturën e blerjes</button>
      {open && <SupplierInvoiceForm record={{ supplierId: m.supplierId, number: m.fiscalRef || '', date: m.date, movementIds: [m.id], net, vatPct: vat, amount: round2(net * (1 + vat / 100)) }} onClose={() => setOpen(false)} />}
    </>
  );
}

// ---------------------------------------------------------------- Forma: pagesë te furnitori

export function SupplierPaymentForm({ record = {}, onClose }) {
  const { suppliers, suppliersById, accounts, accountsById, company } = useData();
  const { uid } = useAuth();
  const [v, setV] = useState(() => ({ supplierId: '', date: todayISO(), amount: '', method: 'bank', reference: '', supplierInvoiceId: '', currency: 'ALL', exchangeRate: 1, ...record }));
  const [run, busy] = useAction();
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));
  const invoices = useQuery(() => (v.supplierId ? query(collection(db, 'supplierInvoices'), where('supplierId', '==', v.supplierId)) : null), [v.supplierId]);
  const openInvoices = invoices.data.filter((i) => i.status !== 'cancelled').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const pickInvoice = (id) => {
    const inv = openInvoices.find((i) => i.id === id);
    setV((s) => ({ ...s, supplierInvoiceId: id, ...(inv ? { currency: inv.currency || 'ALL', exchangeRate: inv.currency === 'EUR' ? inv.exchangeRate || company.eurRate || '' : 1, amount: s.amount || inv.amount } : {}) }));
  };
  const save = () => run(async () => {
    if (!v.supplierId) throw new Error('Zgjidhni furnitorin.');
    if (!(toNumber(v.amount) > 0)) throw new Error('Shkruani shumën.');
    const { number } = await call('allocateNumber', { prefix: 'MP' });
    await addDoc(collection(db, 'supplierPayments'), {
      number, date: v.date, supplierId: v.supplierId, supplierName: suppliersById[v.supplierId]?.name || '', supplierInvoiceId: v.supplierInvoiceId || null,
      amount: toNumber(v.amount), ...currencyData(v.currency, v.exchangeRate, v.amount), method: v.method, reference: v.reference || '',
      ...accountFields(v.accountId ?? defaultAccountId(v.method, accounts, v.currency), accountsById),
      ...(v.bankTxId ? { bankTxId: v.bankTxId } : {}),
      status: 'active', source: 'superpool', createdBy: uid, createdAt: serverTimestamp(),
    });
    onClose();
  }, 'Pagesa te furnitori u regjistrua.');

  return (
    <Modal title="Pagesë te furnitori" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Anulo</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Ruaj</button></>}>
      <div className="form-grid">
        <Field label="Furnitori" required className="span-2">
          <SearchSelect options={suppliers.map(supplierOption)} value={v.supplierId} onChange={(id) => setV((s) => ({ ...s, supplierId: id, supplierInvoiceId: '' }))} />
        </Field>
        <Field label={`Shuma (${v.currency === 'EUR' ? '€' : 'L'})`} required><input className="num" type="number" step="any" value={v.amount} onChange={(e) => set('amount', e.target.value)} /></Field>
        <Field label="Data"><input type="date" value={v.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="Mënyra">
          <select value={v.method} onChange={(e) => setV((s) => ({ ...s, method: e.target.value, accountId: undefined }))}>
            {Object.entries(PAYMENT_METHODS).filter(([k]) => k !== 'credit').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <AccountField value={v.accountId ?? defaultAccountId(v.method, accounts, v.currency)} onChange={(id) => set('accountId', id)} />
        <Field label="Fatura e blerjes" className="span-2">
          <select value={v.supplierInvoiceId || ''} onChange={(e) => pickInvoice(e.target.value)}>
            <option value="">— pa lidhje (shlyen faturat më të vjetra) —</option>
            {openInvoices.map((i) => <option key={i.id} value={i.id}>{i.number || i.internalNumber} · {date(i.date)} · {money(i.amount, i.currency)}</option>)}
          </select>
        </Field>
        <CurrencyFields currency={v.currency} rate={v.exchangeRate} amount={v.amount} onChange={(patch) => setV((s) => ({ ...s, ...patch }))} />
        <Field label="Referenca (nr. urdhërpagese…)" className="span-2"><input value={v.reference} onChange={(e) => set('reference', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Forma: gjendje fillestare e furnitorit

export function SupplierOpeningForm({ record = {}, onClose }) {
  const { suppliers, suppliersById } = useData();
  const { uid } = useAuth();
  const isNew = !record.id;
  const col = record._col || (record.method ? 'supplierPayments' : 'supplierInvoices');
  const [v, setV] = useState(() => ({
    supplierId: record.supplierId || '', date: record.date || firstOfYear(), direction: isNew ? 'debt' : col === 'supplierPayments' ? 'prepaid' : 'debt',
    amount: record.amount ?? '', currency: record.currency || 'ALL', exchangeRate: record.exchangeRate ?? 1, notes: record.notes || '',
  }));
  const [run, busy] = useAction();
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));
  const save = () => run(async () => {
    if (!v.supplierId) throw new Error('Zgjidhni furnitorin.');
    if (!(toNumber(v.amount) > 0)) throw new Error('Shkruani shumën.');
    const amounts = { amount: toNumber(v.amount), ...currencyData(v.currency, v.exchangeRate, v.amount) };
    if (!isNew) {
      await updateDoc(doc(db, col, record.id), { date: v.date, ...amounts, notes: v.notes || '', ...(col === 'supplierInvoices' ? { dueDate: v.date } : {}), updatedAt: serverTimestamp() });
      onClose();
      return;
    }
    const [inv, pay] = await Promise.all(['supplierInvoices', 'supplierPayments'].map((c) => getDocs(query(collection(db, c), where('supplierId', '==', v.supplierId), where('type', '==', 'opening')))));
    const existing = [...inv.docs, ...pay.docs].find((d) => d.get('status') !== 'cancelled');
    if (existing) throw new Error(`Furnitori ka tashmë gjendje fillestare (${existing.get('internalNumber') || existing.get('number')}). Hapeni atë për ta ndryshuar.`);
    const { number } = await call('allocateNumber', { prefix: 'GJF' });
    const base = { type: 'opening', date: v.date, supplierId: v.supplierId, supplierName: suppliersById[v.supplierId]?.name || '', ...amounts, notes: v.notes || '', status: 'active', source: 'superpool', createdBy: uid, createdAt: serverTimestamp() };
    if (v.direction === 'debt') await addDoc(collection(db, 'supplierInvoices'), { ...base, internalNumber: number, number: '', dueDate: v.date, movementIds: [] });
    else await addDoc(collection(db, 'supplierPayments'), { ...base, number, supplierInvoiceId: null, method: 'opening', reference: OPENING, accountId: null, accountName: '' });
    onClose();
  }, 'Gjendja fillestare u ruajt.');
  const cancel = () => run(async () => {
    if (!window.confirm('Të anulohet kjo gjendje fillestare?')) return;
    await updateDoc(doc(db, col, record.id), { status: 'cancelled', updatedAt: serverTimestamp() });
    onClose();
  }, 'Gjendja fillestare u anulua.');
  return (
    <Modal title={isNew ? 'Gjendje fillestare e furnitorit' : `${OPENING} ${record.internalNumber || record.number || ''}`} onClose={onClose}
      footer={(
        <>
          {!isNew && record.status !== 'cancelled' && <button type="button" className="btn danger" disabled={busy} onClick={cancel} style={{ marginRight: 'auto' }}>Anulo gjendjen</button>}
          <button type="button" className="btn" onClick={onClose}>Mbyll</button>
          {record.status !== 'cancelled' && <button type="button" className="btn primary" disabled={busy} onClick={save}>Ruaj</button>}
        </>
      )}>
      <div className="form-grid">
        <Field label="Furnitori" required className="span-2">
          <SearchSelect options={suppliers.map(supplierOption)} value={v.supplierId} onChange={(id) => set('supplierId', id)} disabled={!isNew} />
        </Field>
        <Field label="Gjendja" className="span-2">
          <select value={v.direction} onChange={(e) => set('direction', e.target.value)} disabled={!isNew}>
            <option value="debt">Ne i detyrohemi furnitorit</option>
            <option value="prepaid">I kemi paguar më shumë / parapagim te furnitori</option>
          </select>
        </Field>
        <Field label={`Shuma (${v.currency === 'EUR' ? '€' : 'L'})`} required><input className="num" type="number" step="any" value={v.amount} onChange={(e) => set('amount', e.target.value)} /></Field>
        <Field label="Data e gjendjes"><input type="date" value={v.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <CurrencyFields currency={v.currency} rate={v.exchangeRate} amount={v.amount} onChange={(patch) => setV((s) => ({ ...s, ...patch }))} />
        <Field label="Shënime" className="span-all"><input value={v.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Kartela e furnitorit

/** Rreshtat e kartelës së furnitorit: debi = faturat e blerjes (detyrimi ynë), kredi = pagesat. */
export function supplierLedgerRows(invoices, payments, from, to) {
  const debits = invoices.filter((i) => i.status !== 'cancelled').map((i) => ({
    id: `i${i.id}`, record: i, col: 'supplierInvoices', date: i.date, createdAt: seconds(i),
    doc: [i.number, i.internalNumber].filter(Boolean).join(' / '),
    description: [invoiceLabel(i), i.notes].filter(Boolean).join(' · '),
    dueDate: i.type === 'opening' ? '' : i.dueDate, amount: inAll(i), original: i,
  }));
  const credits = payments.filter((p) => p.status !== 'cancelled').map((p) => ({
    id: `p${p.id}`, record: p, col: 'supplierPayments', date: p.date, createdAt: seconds(p), doc: p.number || '',
    description: p.type === 'opening' ? [`${OPENING} (parapagim)`, p.notes].filter(Boolean).join(' · ')
      : [`Pagesë · ${PAYMENT_METHOD_LABELS[p.method] || p.method}`, p.accountName, p.reference].filter(Boolean).join(' · '),
    dueDate: '', amount: inAll(p), linkId: p.supplierInvoiceId ? `i${p.supplierInvoiceId}` : null, original: p,
  }));
  return buildLedger(debits, credits, from, to);
}

export function SupplierLedger({ supplierId }) {
  const { suppliersById } = useData();
  const { can } = useAuth();
  const canEdit = can(CAPS.FINANCE);
  const supplier = suppliersById[supplierId];
  const [from, setFrom] = useState(firstOfYear());
  const [to, setTo] = useState(todayISO());
  const [form, setForm] = useState(null);
  const invoices = useQuery(() => query(collection(db, 'supplierInvoices'), where('supplierId', '==', supplierId)), [supplierId]);
  const payments = useQuery(() => query(collection(db, 'supplierPayments'), where('supplierId', '==', supplierId)), [supplierId]);
  const ledger = useMemo(() => supplierLedgerRows(invoices.data, payments.data, from, to), [invoices.data, payments.data, from, to]);
  const aging = useMemo(() => {
    const all = supplierLedgerRows(invoices.data, payments.data);
    return agingOf(all.rows.filter((r) => r.debit), all.rows.filter((r) => r.credit), to);
  }, [invoices.data, payments.data, to]);
  const openRecord = (r) => {
    if (r.record.type === 'opening') setForm({ kind: 'opening', record: { ...r.record, _col: r.col } });
    else if (r.col === 'supplierInvoices') setForm({ kind: 'invoice', record: r.record });
  };
  return (
    <>
      <LedgerView
        title={`Kartela · ${supplier?.name || ''}`}
        exportTitle={`Kartela e furnitorit · ${supplier?.name || ''}${supplier?.nipt ? ` (NIPT ${supplier.nipt})` : ''}`}
        ledger={ledger}
        aging={aging}
        from={from} to={to} setFrom={setFrom} setTo={setTo} today={todayISO()}
        labels={{ debit: 'Debi (faturat e blerjes)', credit: 'Kredi (paguar)', owes: 'Gjendja (i detyrohemi furnitorit)', prepaid: 'Gjendja (parapaguar te furnitori)', openTitle: 'Faturat e papaguara' }}
        onRowClick={canEdit ? openRecord : undefined}
        actions={canEdit && (
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn small" onClick={() => setForm({ kind: 'opening', record: { supplierId } })}><Plus size={15} /> Gjendje fillestare</button>
            <button type="button" className="btn small" onClick={() => setForm({ kind: 'invoice', record: { supplierId } })}><Plus size={15} /> Faturë blerjeje</button>
            <button type="button" className="btn small primary" onClick={() => setForm({ kind: 'payment', record: { supplierId } })}><Plus size={15} /> Pagesë</button>
          </div>
        )}
      />
      {form?.kind === 'opening' && <SupplierOpeningForm record={form.record} onClose={() => setForm(null)} />}
      {form?.kind === 'invoice' && <SupplierInvoiceForm record={form.record} onClose={() => setForm(null)} />}
      {form?.kind === 'payment' && <SupplierPaymentForm record={form.record} onClose={() => setForm(null)} />}
    </>
  );
}

// ---------------------------------------------------------------- Faqet e Financës

function useSupplierParam() {
  const { suppliers } = useData();
  const [params, setParams] = useSearchParams();
  const slug = params.get('furnitori') || '';
  const supplier = suppliers.find((s) => prettySegment('suppliers', s, { suppliers }) === slug || s.id === slug);
  const pick = (id) => {
    const s = suppliers.find((x) => x.id === id);
    setParams(s ? { furnitori: prettySegment('suppliers', s, { suppliers }) } : {});
  };
  return [supplier, pick];
}

function SupplierActions({ setForm }) {
  const { can } = useAuth();
  if (!can(CAPS.FINANCE)) return null;
  return (
    <>
      <ImportButton type="supplierBalances" label="Import gjendjesh" />
      <button type="button" className="btn" onClick={() => setForm({ kind: 'opening', record: {} })}><Plus size={16} /> Gjendje fillestare</button>
      <button type="button" className="btn" onClick={() => setForm({ kind: 'invoice', record: {} })}><Plus size={16} /> Faturë blerjeje</button>
      <button type="button" className="btn primary" onClick={() => setForm({ kind: 'payment', record: {} })}><Plus size={16} /> Pagesë</button>
    </>
  );
}

function Forms({ form, setForm }) {
  const close = () => setForm(null);
  return (
    <>
      {form?.kind === 'opening' && <SupplierOpeningForm record={form.record} onClose={close} />}
      {form?.kind === 'invoice' && <SupplierInvoiceForm record={form.record} onClose={close} />}
      {form?.kind === 'payment' && <SupplierPaymentForm record={form.record} onClose={close} />}
    </>
  );
}

export function SupplierLedgerPage({ section }) {
  const { suppliers } = useData();
  const [supplier, pick] = useSupplierParam();
  const [form, setForm] = useState(null);
  return (
    <>
      <PageHeader title={section.title} subtitle={section.subtitle} actions={<SupplierActions setForm={setForm} />} />
      <Card>
        <Field label="Furnitori">
          <SearchSelect options={suppliers.map(supplierOption)} value={supplier?.id || ''} onChange={pick} placeholder="Kërko furnitorin me emër ose NIPT…" />
        </Field>
        {supplier && <p className="muted" style={{ margin: '6px 0 0' }}><Link to={`/furnitoret/${prettySegment('suppliers', supplier, { suppliers })}`}>Hap faqen e furnitorit →</Link></p>}
      </Card>
      {supplier && <SupplierLedger key={supplier.id} supplierId={supplier.id} />}
      <Forms form={form} setForm={setForm} />
    </>
  );
}

/** Detyrimet ndaj furnitorëve, faturat e blerjes ose pagesat (sipas seksionit). */
export function SupplierFinancePage({ section }) {
  const { suppliers, suppliersById } = useData();
  const { can } = useAuth();
  const canEdit = can(CAPS.FINANCE);
  const [form, setForm] = useState(null);
  const [from, setFrom] = useState(addDays(todayISO(), -90));
  const all = section.tab === 'supplierDebts';
  const invoices = useQuery(() => query(collection(db, 'supplierInvoices'), where('date', '>=', all ? '2000-01-01' : from), orderBy('date', 'desc')), [from, all]);
  const payments = useQuery(() => query(collection(db, 'supplierPayments'), where('date', '>=', all ? '2000-01-01' : from), orderBy('date', 'desc')), [from, all]);
  const today = todayISO();

  const debtRows = useMemo(() => {
    if (!all) return [];
    const by = {};
    const add = (id, name) => (by[id] ||= { id, supplierName: name, debits: [], credits: [] });
    for (const r of supplierLedgerRows(invoices.data, payments.data).rows) {
      const rec = r.record;
      const d = add(rec.supplierId, rec.supplierName);
      (r.debit ? d.debits : d.credits).push(r);
    }
    return Object.values(by).map((d) => {
      const a = agingOf(d.debits, d.credits, today);
      const invoiced = round2(d.debits.reduce((s, r) => s + r.debit, 0));
      const paid = round2(d.credits.reduce((s, r) => s + r.credit, 0));
      return { id: d.id, supplierName: suppliersById[d.id]?.name || d.supplierName, invoiced, paid, balance: round2(invoiced - paid), overdue: round2(a.total - a.buckets.current), ...a.buckets };
    }).filter((d) => Math.abs(d.balance) > 0.01);
  }, [all, invoices.data, payments.data, suppliersById, today]);

  const ledgerLink = (id) => `/financa/kartela-furnitori?furnitori=${prettySegment('suppliers', suppliersById[id] || { id }, { suppliers })}`;

  return (
    <>
      <PageHeader title={section.title} subtitle={section.subtitle} actions={<SupplierActions setForm={setForm} />} />
      {!all && <Field label="Nga data"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 200, marginBottom: 12 }} /></Field>}
      {section.tab === 'supplierDebts' && (
        <DataTable
          title="Detyrimet ndaj furnitorëve"
          rows={debtRows}
          initialSort={{ key: 'balance', dir: 'desc' }}
          columns={[
            { key: 'supplierName', label: 'Furnitori', render: (d) => <Link to={ledgerLink(d.id)}>{d.supplierName}</Link> },
            { key: 'invoiced', label: 'Faturuar', type: 'money', total: true },
            { key: 'paid', label: 'Paguar', type: 'money', total: true },
            { key: 'balance', label: 'Detyrimi', type: 'money', total: true },
            { key: 'current', label: 'Pa skaduar', type: 'money', total: true },
            { key: 'overdue', label: 'Me afat të kaluar', type: 'money', total: true },
            { key: 'd90plus', label: 'Mbi 90 ditë', type: 'money', total: true },
            { key: 'ledger', label: '', export: false, sortable: false, render: (d) => <Link className="btn small" to={ledgerLink(d.id)}>Kartela</Link> },
          ]}
        />
      )}
      {section.tab === 'supplierInvoices' && (
        <DataTable
          title="Faturat e blerjes"
          rows={invoices.data}
          onRowClick={canEdit ? (i) => setForm({ kind: i.type === 'opening' ? 'opening' : 'invoice', record: { ...i, _col: 'supplierInvoices' } }) : undefined}
          columns={[
            { key: 'date', label: 'Data', render: (i) => date(i.date) },
            { key: 'internalNumber', label: 'Nr. i brendshëm' },
            { key: 'number', label: 'Nr. i furnitorit' },
            { key: 'supplierName', label: 'Furnitori' },
            { key: 'type', label: 'Lloji', value: invoiceLabel },
            { key: 'dueDate', label: 'Afati', render: (i) => (i.type === 'opening' ? '' : date(i.dueDate)) },
            { key: 'receipts', label: 'Fletëhyrje', value: (i) => (i.movementIds || []).length || '' },
            { key: 'amount', label: 'Vlera', type: 'money', total: true, value: (i) => (i.status === 'cancelled' ? 0 : inAll(i)), render: (i) => (i.status === 'cancelled' ? money(0) : moneyWithAll(i)) },
            { key: 'status', label: 'Statusi', value: (i) => SUPPLIER_INVOICE_STATUS[i.status], render: (i) => <StatusBadge status={i.status === 'cancelled' ? 'cancelled' : 'active'} labels={SUPPLIER_INVOICE_STATUS} /> },
          ]}
        />
      )}
      {section.tab === 'supplierPayments' && (
        <DataTable
          title="Pagesat te furnitorët"
          rows={payments.data}
          onRowClick={canEdit ? (p) => p.type === 'opening' && setForm({ kind: 'opening', record: { ...p, _col: 'supplierPayments' } }) : undefined}
          columns={[
            { key: 'date', label: 'Data', render: (p) => date(p.date) },
            { key: 'number', label: 'Nr.' },
            { key: 'supplierName', label: 'Furnitori' },
            { key: 'method', label: 'Mënyra', value: (p) => PAYMENT_METHOD_LABELS[p.method] || p.method },
            { key: 'accountName', label: 'Banka / arka' },
            { key: 'reference', label: 'Referenca' },
            { key: 'amount', label: 'Shuma', type: 'money', total: true, value: (p) => (p.status === 'cancelled' ? 0 : inAll(p)), render: (p) => (p.status === 'cancelled' ? 'Anuluar' : moneyWithAll(p)) },
            {
              key: 'cancel', label: '', export: false, sortable: false,
              render: (p) => canEdit && p.status !== 'cancelled' && p.type !== 'opening' && !p.bankTxId && (
                <button type="button" className="btn small" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Të anulohet pagesa ${p.number}?`)) updateDoc(doc(db, 'supplierPayments', p.id), { status: 'cancelled', updatedAt: serverTimestamp() }); }}>Anulo</button>
              ),
            },
          ]}
        />
      )}
      <Forms form={form} setForm={setForm} />
    </>
  );
}
