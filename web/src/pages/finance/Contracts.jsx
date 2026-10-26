import { addDoc, collection, doc, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { FileSignature, Paperclip, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { CONTRACT_STATUS, CURRENCIES } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { DataTable } from '../../components/DataTable.jsx';
import { Badge, Card, Field, Loading, Modal, PageHeader, SearchSelect, Stat, StatusBadge, useAction } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useData, useDocument, useQuery } from '../../lib/data.jsx';
import { call, db, storage } from '../../lib/firebase.js';
import { addDays, date, money, round2, todayISO, toNumber } from '../../lib/format.js';
import { newKey } from '../../lib/offerCalc.js';
import { InvoiceForm, PaymentForm, invoiceTypeLabel } from './Finance.jsx';
import { useRouteId } from '../../lib/prettyUrl.jsx';

// Ndarje e shpejtë e kësteve (përqindje e vlerës me TVSH).
const SPLITS = {
  '100': [['Pagesa e plotë', 100]],
  '50/50': [['Paradhënie', 50], ['Në përfundim', 50]],
  '30/40/30': [['Paradhënie', 30], ['Pas strukturës', 40], ['Në përfundim', 30]],
  '40/30/20/10': [['Paradhënie', 40], ['Pas strukturës', 30], ['Pas veshjes', 20], ['Në dorëzim', 10]],
};

const contractTotal = (c) => round2(Number(c.value || 0) * (1 + Number(c.vatPct ?? 20) / 100));

/** Gjendja e çdo kësti nga faturat (contractId + installmentKey) dhe pagesat e tyre. */
export function installmentStatus(contract, invoices, payments) {
  const today = todayISO();
  const active = invoices.filter((i) => i.status !== 'cancelled');
  const paidBy = (ids) => payments.filter((p) => p.status !== 'cancelled' && ids.includes(p.invoiceId)).reduce((s, p) => s + Number(p.amount || 0), 0);
  return (contract.installments || []).map((it) => {
    const inv = active.filter((i) => i.installmentKey === it.key);
    const invoiced = inv.reduce((s, i) => s + Number(i.amount || 0), 0);
    const paid = paidBy(inv.map((i) => i.id));
    const amount = Number(it.amount || 0);
    let state = 'open';
    if (paid >= amount - 0.01 && amount > 0) state = 'paid';
    else if (invoiced >= amount - 0.01 && amount > 0) state = 'invoiced';
    const overdue = state !== 'paid' && it.dueDate && it.dueDate < today;
    return { ...it, invoices: inv, invoiced: round2(invoiced), paid: round2(paid), state, overdue };
  });
}

const STATE_LABEL = { open: 'Pa faturuar', invoiced: 'Faturuar', paid: 'Paguar' };
const STATE_TONE = { open: '', invoiced: 'warn', paid: 'ok' };

export default function Contracts() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const seeInvoices = can(CAPS.FINANCE, CAPS.REPORTS);
  const contracts = useQuery(() => collection(db, 'contracts'), []);
  const invoices = useQuery(() => (seeInvoices ? query(collection(db, 'invoices'), where('contractId', '!=', null)) : null), [seeInvoices]);
  const [editing, setEditing] = useState(null);
  const canEdit = can(CAPS.FINANCE, CAPS.PROJECTS_MANAGE);

  const rows = useMemo(() => contracts.data.map((c) => {
    const inv = invoices.data.filter((i) => i.contractId === c.id && i.status !== 'cancelled');
    const invoiced = inv.reduce((s, i) => s + Number(i.amount || 0), 0);
    const next = (c.installments || []).filter((it) => !inv.some((i) => i.installmentKey === it.key)).sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9'))[0];
    return { ...c, total: contractTotal(c), invoiced, next };
  }).sort((a, b) => (b.date || '').localeCompare(a.date || '')), [contracts.data, invoices.data]);

  return (
    <>
      <PageHeader
        title="Kontratat"
        subtitle="Kontratat me klientët: vlera, afatet e realizimit dhe këstet e pagesës, të lidhura me faturat dhe pagesat."
        actions={canEdit && <button type="button" className="btn primary" onClick={() => setEditing({})}><Plus size={16} /> Kontratë e re</button>}
      />
      <DataTable
        title="Kontratat"
        rows={rows}
        onRowClick={(c) => navigate(`/kontratat/${c.id}`)}
        columns={[
          { key: 'number', label: 'Nr.' },
          { key: 'date', label: 'Data', render: (c) => date(c.date) },
          { key: 'clientName', label: 'Klienti' },
          { key: 'projectName', label: 'Projekti' },
          { key: 'title', label: 'Objekti' },
          { key: 'endDate', label: 'Afati', render: (c) => (c.endDate ? <span className={c.endDate < todayISO() && !['completed', 'cancelled'].includes(c.status) ? 'text-danger' : ''}>{date(c.endDate)}</span> : '') },
          { key: 'total', label: 'Vlera me TVSH', type: 'money', render: (c) => money(c.total, c.currency) },
          { key: 'invoiced', label: 'Faturuar', type: 'money', render: (c) => money(c.invoiced, c.currency) },
          { key: 'next', label: 'Kësti i radhës', value: (c) => (c.next ? `${c.next.label} · ${date(c.next.dueDate)}` : ''), render: (c) => (c.next ? <span className={c.next.dueDate && c.next.dueDate < todayISO() ? 'text-danger' : ''}>{c.next.label} · {money(c.next.amount, c.currency)} · {date(c.next.dueDate)}</span> : '') },
          { key: 'status', label: 'Statusi', value: (c) => CONTRACT_STATUS[c.status], render: (c) => <StatusBadge status={c.status} labels={CONTRACT_STATUS} /> },
        ]}
        empty="Nuk ka kontrata. Krijoni një nga butoni «Kontratë e re» ose nga projekti."
      />
      {editing && <ContractForm record={editing} onClose={() => setEditing(null)} onSaved={(id) => navigate(`/kontratat/${id}`)} />}
    </>
  );
}

/** Formulari i kontratës (krijim / ndryshim). record mund të vijë i parambushur nga projekti. */
export function ContractForm({ record, onClose, onSaved }) {
  const { clients, clientsById } = useData();
  const { uid, profile } = useAuth();
  const projects = useQuery(() => collection(db, 'projects'), []);
  const isNew = !record.id;
  const [v, setV] = useState(() => ({
    title: '', date: todayISO(), startDate: todayISO(), endDate: addDays(todayISO(), 60), value: '', vatPct: 20, warrantyMonths: 24,
    paymentTerms: '', notes: '', status: 'draft', clientId: '', projectId: '', ...record,
    installments: (record.installments || []).map((i) => ({ ...i })),
  }));
  const [run, busy] = useAction();
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));
  const total = contractTotal(v);
  const sum = round2(v.installments.reduce((s, i) => s + toNumber(i.amount), 0));
  const clientProjects = projects.data.filter((p) => !v.clientId || p.clientId === v.clientId);
  const setInst = (i, patch) => set('installments', v.installments.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const applySplit = (key) => {
    const parts = SPLITS[key];
    const start = v.startDate || todayISO();
    const span = Math.max(0, (new Date(v.endDate || start) - new Date(start)) / 86400000);
    let left = total;
    set('installments', parts.map(([label, pct], i) => {
      const amount = i === parts.length - 1 ? round2(left) : round2((total * pct) / 100);
      left -= amount;
      const due = i === 0 ? v.date || start : addDays(start, Math.round((span * (i + 1)) / parts.length));
      return { key: newKey(), label: `${label} (${pct}%)`, pct, amount, dueDate: due };
    }));
  };
  const pickProject = (id) => {
    const p = projects.data.find((x) => x.id === id);
    setV((s) => ({ ...s, projectId: id, ...(p ? { clientId: p.clientId || s.clientId, title: s.title || p.name } : {}) }));
  };

  const save = () => run(async () => {
    if (!v.clientId) throw new Error('Zgjidhni klientin.');
    if (!(toNumber(v.value) > 0)) throw new Error('Shkruani vlerën e kontratës.');
    if (v.installments.some((i) => !(toNumber(i.amount) > 0))) throw new Error('Çdo këst duhet të ketë shumë më të madhe se zero.');
    if (v.installments.length && Math.abs(sum - total) > 1) throw new Error(`Shuma e kësteve (${money(sum, v.currency)}) nuk përputhet me vlerën me TVSH (${money(total, v.currency)}).`);
    const project = projects.data.find((p) => p.id === v.projectId);
    const data = {
      title: v.title.trim(), date: v.date, startDate: v.startDate || '', endDate: v.endDate || '',
      clientId: v.clientId, clientName: clientsById[v.clientId]?.name || v.clientName || '',
      projectId: v.projectId || null, projectName: project ? `${project.code} · ${project.name}` : '',
      offerId: v.offerId || null,
      value: toNumber(v.value), vatPct: toNumber(v.vatPct), total, currency: v.currency === 'EUR' ? 'EUR' : 'ALL', warrantyMonths: toNumber(v.warrantyMonths),
      paymentTerms: v.paymentTerms || '', notes: v.notes || '', status: v.status,
      installments: v.installments.map((i) => ({ key: i.key || newKey(), label: String(i.label || '').trim() || 'Këst', amount: round2(toNumber(i.amount)), dueDate: i.dueDate || '', pct: i.pct ?? null })),
      updatedAt: serverTimestamp(),
    };
    if (isNew) {
      const { number } = await call('allocateNumber', { prefix: 'KON' });
      const ref = await addDoc(collection(db, 'contracts'), { ...data, number, files: [], createdBy: uid, createdByName: profile?.name || '', createdAt: serverTimestamp() });
      onClose();
      onSaved?.(ref.id);
    } else {
      await setDoc(doc(db, 'contracts', record.id), data, { merge: true });
      onClose();
    }
  }, 'Kontrata u ruajt.');

  return (
    <Modal title={isNew ? 'Kontratë e re' : `Kontrata ${record.number}`} onClose={onClose} wide
      footer={<><button type="button" className="btn" onClick={onClose}>Anulo</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Ruaj</button></>}>
      <div className="form-grid">
        <Field label="Klienti" required className="span-2">
          <SearchSelect options={clients.map((c) => ({ value: c.id, label: c.name, sub: c.nipt }))} value={v.clientId} onChange={(val) => set('clientId', val)} disabled={!isNew} />
        </Field>
        <Field label="Projekti" className="span-2">
          <SearchSelect options={[{ value: '', label: '— pa projekt —' }, ...clientProjects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}`, sub: p.clientName }))]} value={v.projectId || ''} onChange={pickProject} />
        </Field>
        <Field label="Objekti i kontratës" className="span-2"><input value={v.title} onChange={(e) => set('title', e.target.value)} placeholder="p.sh. Ndërtim pishine 8×4 m me skimer" /></Field>
        <Field label="Statusi">
          <select value={v.status} onChange={(e) => set('status', e.target.value)}>
            {Object.entries(CONTRACT_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Data e nënshkrimit"><input type="date" value={v.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="Fillimi i punimeve"><input type="date" value={v.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
        <Field label="Afati i përfundimit"><input type="date" value={v.endDate} onChange={(e) => set('endDate', e.target.value)} /></Field>
        <Field label="Garancia (muaj)"><input className="num" type="number" value={v.warrantyMonths} onChange={(e) => set('warrantyMonths', e.target.value)} /></Field>
        <Field label="Monedha">
          <select value={v.currency || 'ALL'} onChange={(e) => set('currency', e.target.value)}>
            {Object.entries(CURRENCIES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
          </select>
        </Field>
        <Field label={`Vlera pa TVSH (${v.currency === 'EUR' ? '€' : 'L'})`} required><input className="num" type="number" step="any" value={v.value} onChange={(e) => set('value', e.target.value)} /></Field>
        <Field label="TVSH %"><input className="num" type="number" step="any" value={v.vatPct} onChange={(e) => set('vatPct', e.target.value)} /></Field>
        <Field label="Vlera me TVSH"><input className="num" value={money(total, v.currency)} disabled /></Field>
        <Field label="Kushtet e pagesës" className="span-all"><input value={v.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} /></Field>
        <Field label="Shënime" className="span-all"><textarea value={v.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>

      <div className="row" style={{ margin: '18px 0 8px' }}>
        <b>Këstet e pagesës</b>
        <span className={`muted ${v.installments.length && Math.abs(sum - total) > 1 ? 'text-danger' : ''}`}>Shuma: {money(sum, v.currency)} / {money(total, v.currency)}</span>
        <select className="right" style={{ width: 'auto' }} value="" onChange={(e) => e.target.value && applySplit(e.target.value)} disabled={!(total > 0)}>
          <option value="">Ndarje e shpejtë…</option>
          {Object.keys(SPLITS).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Kësti</th><th style={{ width: 150 }}>Afati</th><th className="r" style={{ width: 160 }}>Shuma me TVSH</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {v.installments.map((it, i) => (
              <tr key={it.key || i}>
                <td><input value={it.label} onChange={(e) => setInst(i, { label: e.target.value })} /></td>
                <td><input type="date" value={it.dueDate || ''} onChange={(e) => setInst(i, { dueDate: e.target.value })} /></td>
                <td><input className="num" type="number" step="any" value={it.amount} onChange={(e) => setInst(i, { amount: e.target.value })} /></td>
                <td><button type="button" className="btn ghost small" aria-label="Hiq" onClick={() => set('installments', v.installments.filter((_, k) => k !== i))}><Trash2 size={16} /></button></td>
              </tr>
            ))}
            {!v.installments.length && <tr><td colSpan={4} className="muted">Pa këste — zgjidhni një ndarje të shpejtë ose shtoni këste me dorë.</td></tr>}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn small" style={{ marginTop: 8 }} onClick={() => set('installments', [...v.installments, { key: newKey(), label: `Kësti ${v.installments.length + 1}`, amount: round2(Math.max(0, total - sum)), dueDate: v.endDate || '' }])}>
        <Plus size={14} /> Këst
      </button>
    </Modal>
  );
}

export function ContractDetail() {
  const id = useRouteId();
  const { can, uid, profile } = useAuth();
  const { data: c, loading } = useDocument(`contracts/${id}`);
  const seeInvoices = can(CAPS.FINANCE, CAPS.REPORTS);
  const invoices = useQuery(() => (seeInvoices ? query(collection(db, 'invoices'), where('contractId', '==', id)) : null), [id, seeInvoices]);
  const invIds = invoices.data.map((i) => i.id);
  const payments = useQuery(() => (invIds.length ? query(collection(db, 'payments'), where('invoiceId', 'in', invIds.slice(0, 30))) : null), [invIds.join(',')]);
  const [editing, setEditing] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState(null);
  const [paymentForm, setPaymentForm] = useState(null);
  const [run, busy] = useAction();
  const canEdit = can(CAPS.FINANCE, CAPS.PROJECTS_MANAGE);
  const canInvoice = can(CAPS.FINANCE);

  if (loading) return <Loading />;
  if (!c) return <div className="alert error">Kontrata nuk u gjet.</div>;
  const items = installmentStatus(c, invoices.data, payments.data);
  const total = contractTotal(c);
  const invoiced = invoices.data.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + Number(i.amount || 0), 0);
  const paid = payments.data.filter((p) => p.status !== 'cancelled').reduce((s, p) => s + Number(p.amount || 0), 0);
  const overdue = items.filter((i) => i.overdue);

  const upload = (file) => run(async () => {
    const path = `clients/${c.clientId}/kontrata_${id}_${Date.now()}_${file.name}`;
    await uploadBytes(storageRef(storage, path), file);
    const url = await getDownloadURL(storageRef(storage, path));
    await updateDoc(doc(db, 'contracts', id), { files: [...(c.files || []), { name: file.name, path, url, at: new Date().toISOString(), by: profile?.name || uid }] });
  }, 'Dokumenti u ngarkua.');
  const setStatus = (status) => run(() => updateDoc(doc(db, 'contracts', id), { status, updatedAt: serverTimestamp() }), 'Statusi u ndryshua.');

  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/kontratat">Kontratat</Link>}
        title={`${c.number} · ${c.clientName}`}
        subtitle={<><StatusBadge status={c.status} labels={CONTRACT_STATUS} /> · {c.title || 'Kontratë'}{c.date ? ` · nënshkruar ${date(c.date)}` : ''}</>}
        actions={canEdit && (
          <>
            {c.status === 'draft' && <button type="button" className="btn" disabled={busy} onClick={() => setStatus('signed')}>Shëno të nënshkruar</button>}
            {c.status === 'signed' && <button type="button" className="btn" disabled={busy} onClick={() => setStatus('active')}>Fillo zbatimin</button>}
            {c.status === 'active' && <button type="button" className="btn ok" disabled={busy} onClick={() => setStatus('completed')}>Shëno të përfunduar</button>}
            <button type="button" className="btn primary" onClick={() => setEditing(true)}>Ndrysho</button>
          </>
        )}
      />
      {overdue.length > 0 && <div className="alert warn">Këste me afat të kaluar: {overdue.map((i) => `${i.label} (${date(i.dueDate)}, ${money(i.amount - i.paid, c.currency)} pa paguar)`).join('; ')}.</div>}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Vlera me TVSH" value={money(total, c.currency)} sub={`Pa TVSH: ${money(c.value, c.currency)}`} />
        <Stat label="Faturuar" value={money(invoiced, c.currency)} sub={`Pa faturuar: ${money(total - invoiced, c.currency)}`} />
        <Stat label="Paguar" value={money(paid, c.currency)} tone="ok" />
        <Stat label="Detyrim i papaguar" value={money(invoiced - paid, c.currency)} tone={invoiced - paid > 0.01 ? 'danger' : 'ok'} />
      </div>
      <div className="grid grid-2">
        <Card title="Të dhënat">
          <dl className="props">
            <dt>Klienti</dt><dd><Link to={`/klientet/${c.clientId}`}>{c.clientName}</Link></dd>
            {c.projectId && <><dt>Projekti</dt><dd><Link to={`/projektet/${c.projectId}`}>{c.projectName || 'shiko projektin'}</Link></dd></>}
            {(c.startDate || c.endDate) && <><dt>Afatet</dt><dd>{date(c.startDate) || '—'} → <span className={c.endDate && c.endDate < todayISO() && !['completed', 'cancelled'].includes(c.status) ? 'text-danger' : ''}>{date(c.endDate) || '—'}</span></dd></>}
            <dt>Garancia</dt><dd>{c.warrantyMonths ? `${c.warrantyMonths} muaj` : '—'}</dd>
            {c.paymentTerms && <><dt>Kushtet e pagesës</dt><dd>{c.paymentTerms}</dd></>}
          </dl>
          {c.notes && <p style={{ whiteSpace: 'pre-line' }}>{c.notes}</p>}
        </Card>
        <Card title="Dokumentet e kontratës">
          <ul className="list-plain">
            {(c.files || []).map((f) => <li key={f.path}><a href={f.url} target="_blank" rel="noreferrer" style={{ flex: 1 }}><Paperclip size={14} /> {f.name}</a><small className="muted">{f.by}</small></li>)}
            {!(c.files || []).length && <li className="muted">Ngarkoni kontratën e nënshkruar (PDF, foto) dhe aneksët.</li>}
          </ul>
          {canInvoice && <input type="file" disabled={busy} onChange={(e) => { if (e.target.files[0]) upload(e.target.files[0]); e.target.value = ''; }} />}
        </Card>
      </div>
      <Card title="Këstet e pagesës">
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>Kësti</th><th>Afati</th><th className="r">Shuma</th><th className="r">Faturuar</th><th className="r">Paguar</th><th>Gjendja</th><th /></tr></thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key}>
                  <td data-label="Kësti">{it.label}{it.invoices.length > 0 && <><br /><small className="muted">{it.invoices.map((i) => `${invoiceTypeLabel(i)} ${i.fiscalNumber || i.internalNumber || ''}`).join(', ')}</small></>}</td>
                  <td data-label="Afati" className={it.overdue ? 'text-danger' : ''}>{date(it.dueDate)}</td>
                  <td data-label="Shuma" className="r">{money(it.amount, c.currency)}</td>
                  <td data-label="Faturuar" className="r">{money(it.invoiced, c.currency)}</td>
                  <td data-label="Paguar" className="r">{money(it.paid, c.currency)}</td>
                  <td data-label="Gjendja"><Badge tone={it.overdue ? 'danger' : STATE_TONE[it.state]}>{it.overdue ? 'Me vonesë' : STATE_LABEL[it.state]}</Badge></td>
                  <td>
                    {canInvoice && it.state === 'open' && c.status !== 'cancelled' && (
                      <button type="button" className="btn small primary" onClick={() => setInvoiceForm({
                        clientId: c.clientId, projectId: c.projectId || '', contractId: id, contractNumber: c.number, installmentKey: it.key, currency: c.currency || 'ALL',
                        type: items[0]?.key === it.key ? 'advance' : items.at(-1)?.key === it.key ? 'final' : 'partial',
                        amount: round2(it.amount - it.invoiced), date: todayISO(), dueDate: it.dueDate && it.dueDate > todayISO() ? it.dueDate : todayISO(),
                        notes: `${c.number} · ${it.label}`,
                      })}
                      >
                        <FileSignature size={14} /> Faturë
                      </button>
                    )}
                    {canInvoice && it.state === 'invoiced' && (
                      <button type="button" className="btn small" onClick={() => setPaymentForm({ clientId: c.clientId, invoiceId: it.invoices[0]?.id || '', amount: round2(it.invoiced - it.paid), currency: it.invoices[0]?.currency || c.currency || 'ALL', exchangeRate: it.invoices[0]?.exchangeRate })}>Pagesë</button>
                    )}
                  </td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={7} className="muted">Kontrata nuk ka këste. Shtojini nga «Ndrysho».</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      {editing && <ContractForm record={c} onClose={() => setEditing(false)} />}
      {invoiceForm && <InvoiceForm record={invoiceForm} onClose={() => setInvoiceForm(null)} />}
      {paymentForm && <PaymentForm record={paymentForm} invoices={invoices.data.filter((i) => i.status !== 'cancelled')} onClose={() => setPaymentForm(null)} />}
    </>
  );
}

/** Lista e shkurtër e kontratave për kartelën e klientit ose projektin. */
export function ContractsCard({ clientId, projectId, preset }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const field = projectId ? 'projectId' : 'clientId';
  const contracts = useQuery(() => query(collection(db, 'contracts'), where(field, '==', projectId || clientId)), [field, projectId, clientId]);
  const [editing, setEditing] = useState(null);
  return (
    <Card title="Kontratat" actions={can(CAPS.FINANCE, CAPS.PROJECTS_MANAGE) && <button type="button" className="btn small" onClick={() => setEditing({ clientId, projectId: projectId || '', ...preset })}><Plus size={14} /> Kontratë</button>}>
      <ul className="list-plain">
        {contracts.data.map((c) => (
          <li key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/kontratat/${c.id}`)}>
            <span style={{ flex: 1 }}>{c.number} · {c.title || 'Kontratë'}<br /><small className="muted">{date(c.date)} → {date(c.endDate)}</small></span>
            <StatusBadge status={c.status} labels={CONTRACT_STATUS} />
            <b>{money(contractTotal(c), c.currency)}</b>
          </li>
        ))}
        {!contracts.loading && !contracts.data.length && <li className="muted">Nuk ka kontrata.</li>}
      </ul>
      {editing && <ContractForm record={editing} onClose={() => setEditing(null)} onSaved={(id) => navigate(`/kontratat/${id}`)} />}
    </Card>
  );
}
