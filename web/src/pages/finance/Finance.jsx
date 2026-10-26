import { addDoc, collection, doc, orderBy, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { PAYMENT_METHODS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { DataTable } from '../../components/DataTable.jsx';
import { Field, Modal, PageHeader, SearchSelect, StatusBadge, useAction } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useData, useQuery } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';
import { addDays, date, money, todayISO, toNumber } from '../../lib/format.js';

export const INVOICE_STATUS = { pending_fiscal: 'Pa numër fiskal', issued: 'E lëshuar', cancelled: 'Anuluar' };
// Lloji i faturës manuale (fusha "type"); faturat e shitjeve krijohen nga moduli i shitjeve.
export const INVOICE_TYPES = {
  advance: 'Paradhënie',
  partial: 'Situacion / faturë e pjesshme',
  final: 'Faturë përfundimtare',
  other: 'Tjetër',
};
export const invoiceTypeLabel = (i) => (i.saleId ? 'Shitje' : INVOICE_TYPES[i.type] || (i.projectId ? 'Projekt' : 'Tjetër'));

export function InvoiceForm({ record, onClose }) {
  const { clients, clientsById } = useData();
  const { uid } = useAuth();
  const projects = useQuery(() => query(collection(db, 'projects')), []);
  const isNew = !record.id;
  const [v, setV] = useState({
    fiscalNumber: '', date: todayISO(), dueDate: addDays(todayISO(), 15), amount: '', projectId: '', notes: '',
    type: record.projectId ? 'advance' : 'other', ...record,
  });
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
    if (!(toNumber(v.amount) > 0)) throw new Error('Shkruani vlerën e faturës.');
    const data = {
      fiscalNumber: v.fiscalNumber.trim(),
      status: v.status === 'cancelled' ? 'cancelled' : v.fiscalNumber.trim() ? 'issued' : 'pending_fiscal',
      date: v.date,
      dueDate: v.dueDate,
      clientId: v.clientId,
      clientName: clientsById[v.clientId]?.name || v.clientName || '',
      amount: toNumber(v.amount),
      projectId: v.projectId || null,
      notes: v.notes || '',
      updatedAt: serverTimestamp(),
    };
    if (!record.saleId) data.type = INVOICE_TYPES[v.type] ? v.type : 'other';
    if (isNew && record.contractId) Object.assign(data, { contractId: record.contractId, contractNumber: record.contractNumber || '', installmentKey: record.installmentKey || null });
    if (isNew) {
      const ref = await addDoc(collection(db, 'invoices'), { ...data, kind: v.projectId ? 'project' : 'other', source: 'superpool', createdBy: uid, createdAt: serverTimestamp() });
      if (v.paidNow) {
        await addDoc(collection(db, 'payments'), {
          date: v.date, clientId: v.clientId, clientName: data.clientName, invoiceId: ref.id, projectId: data.projectId,
          amount: data.amount, method: v.paidMethod || 'bank', reference: data.fiscalNumber || INVOICE_TYPES[data.type],
          status: 'active', source: 'superpool', createdBy: uid, createdAt: serverTimestamp(),
        });
      }
    } else {
      if (record.saleId) delete data.amount; // vlera e shitjes vjen nga dokumenti i shitjes
      await setDoc(doc(db, 'invoices', record.id), data, { merge: true });
    }
    onClose();
  }, 'Fatura u ruajt.');

  return (
    <Modal title={isNew ? 'Shto faturë manuale' : `Fatura ${record.fiscalNumber || record.internalNumber || ''}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Anulo</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Ruaj</button></>}>
      {record.contractNumber && <div className="alert info">Kësti i kontratës {record.contractNumber} — fatura lidhet me kontratën.</div>}
      <p className="muted" style={{ marginTop: 0 }}>Fatura fiskale lëshohet në programin e faturimit; këtu regjistrohet numri dhe vlera për ndjekjen e detyrimeve.</p>
      <div className="form-grid">
        <Field label="Klienti" required className="span-2">
          <SearchSelect options={clients.map((c) => ({ value: c.id, label: c.name, sub: c.nipt }))} value={v.clientId || ''} onChange={pickClient} disabled={!isNew} />
        </Field>
        {!record.saleId && (
          <Field label="Lloji">
            <select value={v.type} onChange={(e) => set('type', e.target.value)}>
              {Object.entries(INVOICE_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        )}
        <Field label="Nr. fiskal i faturës"><input value={v.fiscalNumber} onChange={(e) => set('fiscalNumber', e.target.value)} /></Field>
        <Field label="Vlera me TVSH (L)" required><input className="num" type="number" step="any" value={v.amount} disabled={Boolean(record.saleId)} onChange={(e) => set('amount', e.target.value)} /></Field>
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
  const [v, setV] = useState({ date: todayISO(), amount: '', method: 'bank', reference: '', invoiceId: '', ...record });
  const [run, busy] = useAction();
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));
  const clientInvoices = invoices.filter((i) => i.clientId === v.clientId);

  const save = () => run(async () => {
    if (!v.clientId) throw new Error('Zgjidhni klientin.');
    if (!(toNumber(v.amount) > 0)) throw new Error('Shkruani shumën.');
    await addDoc(collection(db, 'payments'), {
      date: v.date, clientId: v.clientId, clientName: clientsById[v.clientId]?.name || '', invoiceId: v.invoiceId || null,
      amount: toNumber(v.amount), method: v.method, reference: v.reference || '', status: 'active', source: 'superpool',
      createdBy: uid, createdAt: serverTimestamp(),
    });
    onClose();
  }, 'Pagesa u regjistrua.');

  return (
    <Modal title="Regjistro pagesë" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Anulo</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Ruaj</button></>}>
      <div className="form-grid">
        <Field label="Klienti" required className="span-2">
          <SearchSelect options={clients.map((c) => ({ value: c.id, label: c.name, sub: c.nipt }))} value={v.clientId || ''} onChange={(val) => set('clientId', val)} />
        </Field>
        <Field label="Shuma (L)" required><input className="num" type="number" step="any" value={v.amount} onChange={(e) => set('amount', e.target.value)} /></Field>
        <Field label="Data"><input type="date" value={v.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="Mënyra">
          <select value={v.method} onChange={(e) => set('method', e.target.value)}>
            {Object.entries(PAYMENT_METHODS).filter(([k]) => k !== 'credit').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Fatura">
          <select value={v.invoiceId || ''} onChange={(e) => set('invoiceId', e.target.value)}>
            <option value="">—</option>
            {clientInvoices.map((i) => <option key={i.id} value={i.id}>{i.fiscalNumber || i.internalNumber} · {money(i.amount)}</option>)}
          </select>
        </Field>
        <Field label="Referenca (nr. transferte, kupon…)" className="span-2"><input value={v.reference} onChange={(e) => set('reference', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

const FINANCE_SECTIONS = {
  detyrimet: { tab: 'debts', title: 'Detyrimet e klientëve', subtitle: 'Klientët me fatura të papaguara, sipas detyrimit dhe afatit.' },
  faturat: { tab: 'invoices', title: 'Faturat', subtitle: 'Faturat lëshohen në programin e faturimit; këtu ndiqen numrat fiskalë, vlerat dhe afatet.' },
  pagesat: { tab: 'payments', title: 'Pagesat', subtitle: 'Pagesat e arkëtuara nga klientët (cash, bankë, kartë).' },
};

export default function Finance() {
  const { section: key = 'detyrimet' } = useParams();
  const section = FINANCE_SECTIONS[key] || FINANCE_SECTIONS.detyrimet;
  return <FinanceSection key={section.tab} section={section} />;
}

function FinanceSection({ section }) {
  const { can } = useAuth();
  const tab = section.tab;
  const [from, setFrom] = useState(addDays(todayISO(), -90));
  const [invoiceForm, setInvoiceForm] = useState(null);
  const [paymentForm, setPaymentForm] = useState(null);
  const invoices = useQuery(() => query(collection(db, 'invoices'), where('date', '>=', tab === 'debts' ? '2000-01-01' : from), orderBy('date', 'desc')), [from, tab]);
  const payments = useQuery(() => query(collection(db, 'payments'), where('date', '>=', tab === 'debts' ? '2000-01-01' : from), orderBy('date', 'desc')), [from, tab]);
  const canEdit = can(CAPS.FINANCE);

  const debts = {};
  for (const i of invoices.data) {
    if (i.status === 'cancelled') continue;
    const d = (debts[i.clientId] ||= { id: i.clientId, clientName: i.clientName, invoiced: 0, paid: 0, overdue: 0, lastDate: '' });
    d.invoiced += Number(i.amount || 0);
    if (i.dueDate && i.dueDate < todayISO()) d.overdue += Number(i.amount || 0);
    if (i.date > d.lastDate) d.lastDate = i.date;
  }
  for (const p of payments.data) {
    if (p.status === 'cancelled') continue;
    const d = (debts[p.clientId] ||= { id: p.clientId, clientName: p.clientName, invoiced: 0, paid: 0, overdue: 0, lastDate: '' });
    d.paid += Number(p.amount || 0);
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
            { key: 'fiscalNumber', label: 'Nr. fiskal' },
            { key: 'internalNumber', label: 'Nr. i brendshëm', value: (i) => i.internalNumber || i.saleNumber || '' },
            { key: 'clientName', label: 'Klienti' },
            { key: 'dueDate', label: 'Afati', render: (i) => date(i.dueDate) },
            { key: 'amount', label: 'Vlera', type: 'money', total: true, value: (i) => (i.status === 'cancelled' ? 0 : i.amount) },
            { key: 'status', label: 'Statusi', value: (i) => INVOICE_STATUS[i.status], render: (i) => <StatusBadge status={i.status} labels={INVOICE_STATUS} /> },
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
            { key: 'clientName', label: 'Klienti' },
            { key: 'method', label: 'Mënyra', value: (p) => PAYMENT_METHODS[p.method] || p.method },
            { key: 'reference', label: 'Referenca' },
            { key: 'amount', label: 'Shuma', type: 'money', total: true, value: (p) => (p.status === 'cancelled' ? 0 : p.amount) },
          ]}
        />
      )}
      {invoiceForm && <InvoiceForm record={invoiceForm} onClose={() => setInvoiceForm(null)} />}
      {paymentForm && <PaymentForm record={paymentForm} invoices={invoices.data.filter((i) => i.status !== 'cancelled')} onClose={() => setPaymentForm(null)} />}
    </>
  );
}
