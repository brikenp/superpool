import {
  addDoc, collection, deleteDoc, doc, query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { useMemo, useState } from 'react';
import { FileText, PackageMinus, PackagePlus, Paperclip, Plus, TriangleAlert, Undo2, Wrench, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { EXPENSE_CATEGORIES, POOL_TYPES, PROJECT_STATUS, UNITS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';
import { projectMaterialSummary, projectResult } from '@shared/stock.js';

import { DataTable } from '../../components/DataTable.jsx';
import { Badge, Card, Field, Loading, Modal, PageHeader, SearchSelect, Stat, StatusBadge, Tabs, useAction, useUi } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { unitCostOf, useData, useDocument, useQuery } from '../../lib/data.jsx';
import { call, db, storage } from '../../lib/firebase.js';
import { date, dateTime, inAll, money, moneyWithAll, qty, round2, todayISO, toNumber } from '../../lib/format.js';
import { movementColumns } from '../inventory/Movements.jsx';
import { createPurchaseOrder } from '../partners/PurchaseOrders.jsx';
import { productOption } from '../../components/ProductImage.jsx';
import { InvoiceForm, PaymentForm, activeFinalInvoice, invoiceTypeLabel } from '../finance/Finance.jsx';
import { ContractsCard } from '../finance/Contracts.jsx';
import { PrintInvoiceButton } from '../../components/PrintButton.jsx';
import { FiscalizeButton } from '../../components/Fiscal.jsx';
import { FinalInvoiceForm } from './FinalInvoice.jsx';
import { useRouteId } from '../../lib/prettyUrl.jsx';

export default function ProjectDetail() {
  const id = useRouteId();
  const { can } = useAuth();
  const [tab, setTab] = useState('materials');
  const { data: project, loading } = useDocument(`projects/${id}`);
  const showCosts = can(CAPS.VIEW_COSTS);

  if (loading) return <Loading />;
  if (!project) return <div className="alert error">Projekti nuk u gjet ose nuk keni akses.</div>;

  return (
    <>
      <ProjectHeader project={project} />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'materials', label: 'Materialet' },
        { key: 'movements', label: 'Lëvizjet' },
        { key: 'tasks', label: 'Detyrat' },
        { key: 'docs', label: 'Dokumentet' },
        showCosts && { key: 'expenses', label: 'Shpenzimet' },
        showCosts && { key: 'finance', label: 'Rezultati financiar' },
        { key: 'info', label: 'Të dhënat' },
      ]} />
      {tab === 'materials' && <Materials project={project} />}
      {tab === 'movements' && <ProjectMovements project={project} />}
      {tab === 'tasks' && <Tasks project={project} />}
      {tab === 'docs' && <Documents project={project} />}
      {tab === 'expenses' && <Expenses project={project} />}
      {tab === 'finance' && <Finance project={project} />}
      {tab === 'info' && <Info project={project} />}
    </>
  );
}

function ProjectHeader({ project }) {
  const { can } = useAuth();
  const { ask } = useUi();
  const [run, busy] = useAction();
  const [finalForm, setFinalForm] = useState(false);
  const projectInvoices = useQuery(() => (can(CAPS.FINANCE, CAPS.REPORTS) ? query(collection(db, 'invoices'), where('projectId', '==', project.id)) : null), [project.id]);
  const finalInvoice = activeFinalInvoice(projectInvoices.data);
  const setStatus = async (status) => {
    if (status === 'completed' && !(await ask({
      title: 'Mbyll projektin',
      message: 'Sigurohuni që materialet e mbetura janë kthyer ose janë regjistruar si të përdorura para mbylljes.',
      confirmLabel: 'Shëno të përfunduar',
    }))) return;
    run(() => updateDoc(doc(db, 'projects', project.id), { status, ...(status === 'completed' ? { endDate: todayISO() } : {}) }), 'Statusi u ndryshua.');
  };
  const q = `projekti=${project.id}`;
  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/projektet">Projektet</Link>}
        title={`${project.code} · ${project.name}`}
        subtitle={(
          <>
            <StatusBadge status={project.status} labels={PROJECT_STATUS} />
            {' · '}<Link to={`/klientet/${project.clientId}`}>{project.clientName}</Link>
            {project.address ? ` · ${project.address}` : ''}
            {project.offerId && <> · <Link to={`/ofertat/${project.offerId}`}><FileText size={13} style={{ verticalAlign: '-2px' }} /> Oferta {project.offerNumber}</Link></>}
          </>
        )}
        actions={(
          <>
            {finalInvoice
              ? <Badge tone="ok">Faturuar përfundimisht · {finalInvoice.fiscalNumber || finalInvoice.internalNumber}</Badge>
              : can(CAPS.FINANCE) && !projectInvoices.loading && <button type="button" className="btn ok" onClick={() => setFinalForm(true)}><FileText size={16} /> Faturë përfundimtare</button>}
            {can(CAPS.PROJECTS_MANAGE) && (
              <select className="btn" value="" disabled={busy} onChange={(e) => e.target.value && setStatus(e.target.value)} style={{ width: 'auto' }}>
                <option value="">Ndrysho statusin…</option>
                {Object.entries(PROJECT_STATUS).filter(([k]) => k !== project.status).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            )}
          </>
        )}
      />
      {finalForm && <FinalInvoiceForm project={project} onClose={() => setFinalForm(false)} />}
      {can(CAPS.MOVEMENTS_CREATE) && ['planned', 'active'].includes(project.status) && (
        <div className="row" style={{ marginBottom: 14 }}>
          <Link className="btn" to={`/levizjet/re/issue?${q}`}><PackagePlus size={16} /> Dalje materialesh</Link>
          <Link className="btn" to={`/levizjet/re/delivery?${q}`}><PackageMinus size={16} /> Dorëzim në kantier</Link>
          <Link className="btn" to={`/levizjet/re/consumption?${q}`}><Wrench size={16} /> Regjistro përdorim</Link>
          <Link className="btn" to={`/levizjet/re/return?${q}`}><Undo2 size={16} /> Kthim materialesh</Link>
          <Link className="btn" to={`/levizjet/re/loss?${q}`}><TriangleAlert size={16} /> Dëmtim / humbje</Link>
        </div>
      )}
    </>
  );
}

function Materials({ project }) {
  const { can, uid, profile } = useAuth();
  const { productsById, products, suppliersById, costsById } = useData();
  const { ask } = useUi();
  const navigate = useNavigate();
  const [run, busy] = useAction();
  const [adding, setAdding] = useState(false);
  const mats = useQuery(() => query(collection(db, 'projects', project.id, 'materials')), [project.id]);
  const site = useQuery(() => query(collection(db, 'stock'), where('locationId', '==', `site_${project.id}`)), [project.id]);
  const canManage = can(CAPS.PROJECTS_MANAGE);
  const canReserve = can(CAPS.PROJECTS_MANAGE, CAPS.INVENTORY_MANAGE);
  const showCosts = can(CAPS.VIEW_COSTS);

  const onSite = Object.fromEntries(site.data.map((s) => [s.productId, Number(s.qty || 0)]));
  const ids = new Set([...mats.data.map((m) => m.id), ...Object.keys(onSite).filter((k) => onSite[k])]);
  const rows = [...ids].map((pid) => {
    const m = mats.data.find((x) => x.id === pid) || {};
    const p = productsById[pid] || {};
    return { id: pid, code: p.code || m.code, name: p.name || m.name, unit: p.unit || m.unit, ...projectMaterialSummary(m, onSite[pid] || 0), cost: unitCostOf(costsById, pid) };
  }).sort((a, b) => String(a.code).localeCompare(String(b.code)));

  const reserve = (release) => run(async () => {
    const res = await call('reserveProjectMaterials', { projectId: project.id, release });
    return res;
  }, (r) => (r.shortages?.length ? `Rezervimi u krye. ${r.shortages.length} artikuj duhen porositur.` : 'Rezervimi u përditësua.'));

  const orderShortages = () => run(async () => {
    const groups = {};
    for (const s of project.shortages || []) {
      const sid = s.supplierId || productsById[s.productId]?.supplierId;
      if (!sid) throw new Error(`"${s.name}" nuk ka furnitor të caktuar.`);
      (groups[sid] ||= []).push(s);
    }
    const ids2 = [];
    for (const [sid, items] of Object.entries(groups)) {
      ids2.push(await createPurchaseOrder({
        supplier: suppliersById[sid], uid, userName: profile?.name, projectId: project.id, projectName: `${project.code} · ${project.name}`,
        lines: items.map((s) => ({ productId: s.productId, code: s.code, name: s.name, unit: s.unit, qty: s.missing, unitPrice: costsById[s.productId]?.purchasePrice || 0, receivedQty: 0, note: project.code })),
      }));
    }
    if (ids2.length === 1) navigate(`/porosite/${ids2[0]}`);
    return ids2;
  }, (r) => `U krijuan ${r.length} porosi draft.`);

  const editPlanned = async (r) => {
    const value = await ask({ title: `Sasia e planifikuar · ${r.name}`, input: 'Sasia', defaultValue: String(r.planned), confirmLabel: 'Ruaj' });
    if (value === null) return;
    run(() => setDoc(doc(db, 'projects', project.id, 'materials', r.id), { plannedQty: toNumber(value), updatedAt: serverTimestamp() }, { merge: true }), 'U ruajt.');
  };

  return (
    <>
      {(project.shortages || []).length > 0 && (
        <div className="alert warn">
          <b>Mungesa në stok:</b> {project.shortages.map((s) => `${s.name} (${qty(s.missing)} ${UNITS[s.unit] || ''})`).join(', ')}
          {can(CAPS.SUPPLIERS) && <div style={{ marginTop: 6 }}><button type="button" className="btn small" disabled={busy} onClick={orderShortages}>Krijo porositë për mungesat</button></div>}
        </div>
      )}
      <Card
        title="Pasqyra e materialeve"
        actions={(
          <>
            {canManage && <button type="button" className="btn small" onClick={() => setAdding(true)}><Plus size={16} /> Material i planifikuar</button>}
            {canReserve && <button type="button" className="btn small primary" disabled={busy} onClick={() => reserve(false)}>Rezervo nga stoku</button>}
            {canReserve && <button type="button" className="btn small" disabled={busy} onClick={() => reserve(true)}>Liro rezervimet</button>}
          </>
        )}
      >
        <DataTable
          title={`Materialet · ${project.code}`}
          rows={rows}
          columns={[
            { key: 'code', label: 'Kodi' },
            { key: 'name', label: 'Artikulli', render: (r) => <>{r.name}{r.needsAttention && <span className="badge warn" style={{ marginLeft: 6 }}>kontrollo</span>}</> },
            { key: 'planned', label: 'Planifikuar', type: 'number', render: (r) => (canManage ? <button type="button" className="btn small ghost" onClick={() => editPlanned(r)}>{qty(r.planned)}</button> : qty(r.planned)) },
            { key: 'reserved', label: 'Rezervuar', type: 'number' },
            { key: 'purchased', label: 'Blerë', type: 'number' },
            { key: 'issued', label: 'Dalë', type: 'number' },
            { key: 'consumed', label: 'Përdorur', type: 'number' },
            { key: 'returned', label: 'Kthyer', type: 'number' },
            { key: 'loss', label: 'Dëmtuar/humbur', type: 'number' },
            { key: 'onSite', label: 'Në kantier', type: 'number' },
            { key: 'inVehicles', label: 'Në automjete', type: 'number' },
            { key: 'variance', label: 'Diferenca nga plani', type: 'number', render: (r) => <span className={r.variance > 0 ? 'text-danger' : r.variance < 0 ? 'text-ok' : ''}>{qty(r.variance)}</span> },
            { key: 'realCost', label: 'Kosto e përdorur', type: 'money', total: true, hidden: !showCosts, value: (r) => round2((r.consumed + r.loss) * r.cost) },
          ]}
        />
        <p className="muted" style={{ fontSize: '0.83rem' }}>
          "Në automjete" = dalë – përdorur – kthyer – humbur – në kantier. "Diferenca nga plani" = përdorur + humbur – planifikuar (pozitive = më shumë se plani).
        </p>
      </Card>
      {adding && (
        <AddPlanned project={project} products={products} onClose={() => setAdding(false)} />
      )}
    </>
  );
}

function AddPlanned({ project, products, onClose }) {
  const { productsById } = useData();
  const [productId, setProductId] = useState('');
  const [plannedQty, setPlannedQty] = useState('');
  const [run, busy] = useAction();
  const save = () => run(async () => {
    const p = productsById[productId];
    if (!p || !(toNumber(plannedQty) > 0)) throw new Error('Zgjidhni artikullin dhe sasinë.');
    await setDoc(doc(db, 'projects', project.id, 'materials', productId), { productId, code: p.code, name: p.name, unit: p.unit, plannedQty: toNumber(plannedQty) }, { merge: true });
    onClose();
  }, 'Materiali u shtua.');
  return (
    <Modal title="Material i planifikuar" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Anulo</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Shto</button></>}>
      <div className="form-grid">
        <Field label="Artikulli" className="span-all"><SearchSelect options={products.map((p) => productOption(p))} value={productId} onChange={setProductId} /></Field>
        <Field label="Sasia e planifikuar"><input className="num" type="number" step="any" value={plannedQty} onChange={(e) => setPlannedQty(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ProjectMovements({ project }) {
  const { uid, can } = useAuth();
  const navigate = useNavigate();
  const all = can(CAPS.INVENTORY_VIEW, CAPS.MOVEMENTS_APPROVE);
  const moves = useQuery(() => (all
    ? query(collection(db, 'movements'), where('projectId', '==', project.id))
    : query(collection(db, 'movements'), where('projectId', '==', project.id), where('participants', 'array-contains', uid))), [project.id, all, uid]);
  const rows = [...moves.data].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return (
    <Card>
      <DataTable title={`Lëvizjet · ${project.code}`} rows={rows} onRowClick={(m) => navigate(`/levizjet/${m.id}`)} columns={movementColumns()} />
    </Card>
  );
}

function Tasks({ project }) {
  const { uid, profile, can } = useAuth();
  const { employees, employeesById } = useData();
  const tasks = useQuery(() => query(collection(db, 'projects', project.id, 'tasks')), [project.id]);
  const [form, setForm] = useState({ title: '', assignedTo: '', dueDate: '' });
  const [run, busy] = useAction();
  const canManage = can(CAPS.PROJECTS_MANAGE);
  const add = () => run(async () => {
    if (!form.title.trim()) throw new Error('Shkruani detyrën.');
    await addDoc(collection(db, 'projects', project.id, 'tasks'), { ...form, title: form.title.trim(), done: false, createdBy: uid, createdAt: serverTimestamp() });
    setForm({ title: '', assignedTo: '', dueDate: '' });
  });
  const toggle = (t) => run(() => updateDoc(doc(db, 'projects', project.id, 'tasks', t.id), { done: !t.done, doneAt: !t.done ? serverTimestamp() : null, doneBy: !t.done ? profile?.name || uid : null }));
  const list = [...tasks.data].sort((a, b) => Number(a.done) - Number(b.done) || String(a.dueDate || '9').localeCompare(String(b.dueDate || '9')));
  return (
    <Card>
      {canManage && (
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <Field label="Detyrë e re" className="span-2"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Kush e kryen">
            <select value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}>
              <option value="">—</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
          <Field label="Afati"><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></Field>
          <Field label=" "><button type="button" className="btn primary" disabled={busy} onClick={add}>Shto</button></Field>
        </div>
      )}
      <ul className="list-plain">
        {list.map((t) => (
          <li key={t.id}>
            <input type="checkbox" checked={Boolean(t.done)} onChange={() => toggle(t)} style={{ width: 22, height: 22 }} />
            <span style={{ flex: 1, textDecoration: t.done ? 'line-through' : 'none' }}>
              {t.title}
              <br /><small className="muted">{[employeesById[t.assignedTo]?.name, t.dueDate && `afati ${date(t.dueDate)}`, t.done && t.doneBy && `kryer nga ${t.doneBy}`].filter(Boolean).join(' · ')}</small>
            </span>
            {t.dueDate && !t.done && t.dueDate < todayISO() && <span className="badge danger">me vonesë</span>}
            {canManage && <button type="button" className="icon-btn" onClick={() => run(() => deleteDoc(doc(db, 'projects', project.id, 'tasks', t.id)))}><X size={16} /></button>}
          </li>
        ))}
        {!list.length && <li className="muted">Nuk ka detyra.</li>}
      </ul>
    </Card>
  );
}

function Documents({ project }) {
  const { uid, profile, can } = useAuth();
  const docs = useQuery(() => query(collection(db, 'projects', project.id, 'documents')), [project.id]);
  const [run, busy] = useAction();
  const upload = (file) => run(async () => {
    const path = `projects/${project.id}/${Date.now()}_${file.name}`;
    await uploadBytes(storageRef(storage, path), file);
    const url = await getDownloadURL(storageRef(storage, path));
    await addDoc(collection(db, 'projects', project.id, 'documents'), { title: file.name, path, url, size: file.size, uploadedBy: uid, uploadedByName: profile?.name || '', at: serverTimestamp() });
  }, 'Dokumenti u ngarkua.');
  const remove = (d) => run(async () => {
    await deleteObject(storageRef(storage, d.path)).catch(() => {});
    await deleteDoc(doc(db, 'projects', project.id, 'documents', d.id));
  }, 'U fshi.');
  const list = [...docs.data].sort((a, b) => (b.at?.seconds || 0) - (a.at?.seconds || 0));
  return (
    <Card>
      <Field label="Ngarko dokument ose foto (projekt, kontratë, foto kantieri…)">
        <input type="file" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.dwg" capture={undefined} disabled={busy} onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
      </Field>
      <ul className="list-plain" style={{ marginTop: 12 }}>
        {list.map((d) => (
          <li key={d.id}>
            <a href={d.url} target="_blank" rel="noreferrer" style={{ flex: 1 }}><Paperclip size={14} /> {d.title}</a>
            <small className="muted">{d.uploadedByName} · {dateTime(d.at)}</small>
            {can(CAPS.PROJECTS_MANAGE) && <button type="button" className="icon-btn" onClick={() => remove(d)}><X size={16} /></button>}
          </li>
        ))}
        {!list.length && <li className="muted">Nuk ka dokumente.</li>}
      </ul>
    </Card>
  );
}

function Expenses({ project }) {
  const { can, uid } = useAuth();
  const { employees, employeesById } = useData();
  const expenses = useQuery(() => query(collection(db, 'projectFinance', project.id, 'expenses')), [project.id]);
  const [form, setForm] = useState({ date: todayISO(), category: 'labor', description: '', employeeId: '', hours: '', amount: '' });
  const [run, busy] = useAction();
  const canManage = can(CAPS.PROJECTS_MANAGE);
  const hourly = Number(employeesById[form.employeeId]?.hourlyCost || 0);
  const computed = form.category === 'labor' && form.hours && hourly ? round2(toNumber(form.hours) * hourly) : null;

  const add = () => run(async () => {
    const amount = computed ?? toNumber(form.amount);
    if (!(amount > 0)) throw new Error('Shkruani shumën ose orët e punës.');
    await addDoc(collection(db, 'projectFinance', project.id, 'expenses'), {
      ...form, hours: toNumber(form.hours), amount, employeeName: employeesById[form.employeeId]?.name || '', createdBy: uid, createdAt: serverTimestamp(),
    });
    setForm({ ...form, description: '', hours: '', amount: '' });
  }, 'Shpenzimi u regjistrua.');

  return (
    <Card>
      {canManage && (
        <div className="form-grid" style={{ marginBottom: 12 }}>
          <Field label="Data"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Kategoria">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {Object.entries(EXPENSE_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          {form.category === 'labor' && (
            <>
              <Field label="Punonjësi">
                <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                  <option value="">—</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </Field>
              <Field label="Orë pune" hint={hourly ? `${money(hourly)} / orë` : 'Pa kosto/orë: shkruani shumën'}>
                <input className="num" type="number" step="any" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />
              </Field>
            </>
          )}
          <Field label="Shuma (L)"><input className="num" type="number" step="any" value={computed ?? form.amount} disabled={computed !== null} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label="Përshkrimi" className="span-2"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label=" "><button type="button" className="btn primary" disabled={busy} onClick={add}>Shto shpenzim</button></Field>
        </div>
      )}
      <DataTable
        title={`Shpenzimet · ${project.code}`}
        rows={[...expenses.data].sort((a, b) => (b.date || '').localeCompare(a.date || ''))}
        columns={[
          { key: 'date', label: 'Data', render: (e) => date(e.date) },
          { key: 'category', label: 'Kategoria', value: (e) => EXPENSE_CATEGORIES[e.category] },
          { key: 'description', label: 'Përshkrimi' },
          { key: 'employeeName', label: 'Punonjësi' },
          { key: 'hours', label: 'Orë', type: 'number' },
          { key: 'amount', label: 'Shuma', type: 'money', total: true },
          {
            key: 'del', label: '', sortable: false, export: false, hidden: !canManage,
            render: (e) => <button type="button" className="icon-btn" onClick={() => run(() => deleteDoc(doc(db, 'projectFinance', project.id, 'expenses', e.id)), 'U fshi.')}><X size={16} /></button>,
          },
        ]}
      />
    </Card>
  );
}

function Finance({ project }) {
  const { can } = useAuth();
  const { ask } = useUi();
  const [run] = useAction();
  const [invoiceForm, setInvoiceForm] = useState(null);
  const [paymentForm, setPaymentForm] = useState(false);
  const [finalForm, setFinalForm] = useState(false);
  const fin = useDocument(`projectFinance/${project.id}`);
  const expenses = useQuery(() => query(collection(db, 'projectFinance', project.id, 'expenses')), [project.id]);
  const invoices = useQuery(() => query(collection(db, 'invoices'), where('projectId', '==', project.id)), [project.id]);
  const invoiceIds = invoices.data.map((i) => i.id).join(',');
  const finalInvoice = activeFinalInvoice(invoices.data);
  const payments = useQuery(() => (invoices.data.length
    ? query(collection(db, 'payments'), where('invoiceId', 'in', invoices.data.map((i) => i.id).slice(0, 30)))
    : null), [invoiceIds]);

  const f = fin.data || {};
  const expensesTotal = expenses.data.reduce((s, e) => s + Number(e.amount || 0), 0);
  const result = useMemo(() => projectResult({
    contractValue: Number(f.contractValue || 0),
    plannedMaterialCost: Number(f.plannedMaterialCost || 0),
    plannedOtherCost: Number(f.plannedOtherCost || 0),
    realMaterialCost: Number(f.realMaterialCost || 0),
    expenses: expensesTotal,
    invoiced: invoices.data.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + inAll(i), 0),
    paid: payments.data.filter((p) => p.status !== 'cancelled').reduce((s, p) => s + inAll(p), 0),
  }), [f.contractValue, f.plannedMaterialCost, f.plannedOtherCost, f.realMaterialCost, expensesTotal, invoices.data, payments.data]);

  const editContract = async () => {
    const value = await ask({ title: 'Vlera e kontratës (pa TVSH)', input: 'Vlera (L)', defaultValue: String(f.contractValue || 0), confirmLabel: 'Ruaj' });
    if (value !== null) run(() => updateDoc(doc(db, 'projectFinance', project.id), { contractValue: toNumber(value), updatedAt: serverTimestamp() }), 'U ruajt.');
  };

  if (fin.loading) return <Loading />;
  return (
    <>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Vlera e kontratës (pa TVSH)" value={money(result.contractValue)} sub={f.offerValue ? `Oferta: ${money(f.offerValue)}` : undefined} />
        <Stat label="Kosto e parashikuar" value={money(result.plannedCost)} />
        <Stat label="Kosto reale" value={money(result.realCost)} tone={result.costVariance > 0 ? 'danger' : 'ok'} sub={`Diferenca: ${result.costVariance > 0 ? '+' : ''}${money(result.costVariance)}`} />
        <Stat label="Rezultati" value={money(result.realMargin)} tone={result.realMargin < 0 ? 'danger' : 'ok'} sub={`${result.realMarginPct}% e kontratës`} />
      </div>
      <div className="grid grid-2">
        <Card title="Parashikuar vs. reale" actions={can(CAPS.PROJECTS_MANAGE) && <button type="button" className="btn small" onClick={editContract}>Ndrysho vlerën e kontratës</button>}>
          <table className="table">
            <thead><tr><th /><th className="r">Parashikuar</th><th className="r">Reale</th><th className="r">Diferenca</th></tr></thead>
            <tbody>
              <tr><td>Materiale</td><td className="r">{money(f.plannedMaterialCost)}</td><td className="r">{money(f.realMaterialCost)}</td><td className="r">{money(Number(f.realMaterialCost || 0) - Number(f.plannedMaterialCost || 0))}</td></tr>
              <tr><td>Punë dhe shpenzime të tjera</td><td className="r">{money(f.plannedOtherCost)}</td><td className="r">{money(expensesTotal)}</td><td className="r">{money(expensesTotal - Number(f.plannedOtherCost || 0))}</td></tr>
            </tbody>
            <tfoot><tr><td>Totali</td><td className="r">{money(result.plannedCost)}</td><td className="r">{money(result.realCost)}</td><td className="r">{money(result.costVariance)}</td></tr></tfoot>
          </table>
          <p className="muted" style={{ fontSize: '0.83rem' }}>Kosto reale e materialeve = materialet e regjistruara si të përdorura + të dëmtuara/humbura, me koston mesatare në momentin e lëvizjes. Materialet në kantier/automjete nuk përfshihen derisa të përdoren.</p>
        </Card>
        <Card title="Faturat dhe pagesat e klientit">
          <dl className="props">
            <dt>Faturuar</dt><dd>{money(result.invoiced)}</dd>
            <dt>Paguar</dt><dd>{money(result.paid)}</dd>
            <dt>Detyrim i papaguar</dt><dd className={result.outstanding > 0 ? 'text-danger' : ''}>{money(result.outstanding)}</dd>
            <dt>Pa faturuar ende</dt><dd>{finalInvoice ? money(0) : money(result.notInvoiced)}</dd>
          </dl>
          <ul className="list-plain">
            {invoices.data.map((i) => (
              <li key={i.id} className={i.status === 'cancelled' ? 'muted' : ''} style={{ cursor: can(CAPS.FINANCE) ? 'pointer' : undefined }} onClick={() => can(CAPS.FINANCE) && setInvoiceForm(i)}>
                <span style={{ flex: 1 }}>{invoiceTypeLabel(i)} · {i.fiscalNumber || i.internalNumber || 'pa numër'} · {date(i.date)}{i.status === 'cancelled' ? ' (anuluar)' : ''}</span>
                <b>{moneyWithAll(i)}</b>
                <FiscalizeButton invoice={i} />
                <PrintInvoiceButton invoice={i} />
              </li>
            ))}
          </ul>
          {finalInvoice && (
            <div className="alert ok" style={{ marginBottom: 8 }}>
              Projekti është faturuar përfundimisht me faturën {finalInvoice.fiscalNumber || finalInvoice.internalNumber}. Nuk lëshohen fatura të tjera; mund të regjistrohen vetëm pagesat.
            </div>
          )}
          {can(CAPS.FINANCE) && (
            <div className="row">
              {!finalInvoice && <button type="button" className="btn small primary" onClick={() => setInvoiceForm({ clientId: project.clientId, projectId: project.id, type: 'advance' })}><Plus size={14} /> Paradhënie / faturë</button>}
              {!finalInvoice && <button type="button" className="btn small ok" onClick={() => setFinalForm(true)}><FileText size={14} /> Faturë përfundimtare</button>}
              <button type="button" className="btn small" onClick={() => setPaymentForm(true)}><Plus size={14} /> Pagesë</button>
            </div>
          )}
        </Card>
      </div>
      {can(CAPS.FINANCE, CAPS.PROJECTS_MANAGE, CAPS.REPORTS) && (
        <ContractsCard clientId={project.clientId} projectId={project.id} preset={{ value: f.contractValue || '', title: project.name, offerId: project.offerId || null }} />
      )}
      {invoiceForm && <InvoiceForm record={invoiceForm} onClose={() => setInvoiceForm(null)} />}
      {finalForm && <FinalInvoiceForm project={project} onClose={() => setFinalForm(false)} />}
      {paymentForm && <PaymentForm record={{ clientId: project.clientId }} invoices={invoices.data.filter((i) => i.status !== 'cancelled')} onClose={() => setPaymentForm(false)} />}
    </>
  );
}

function Info({ project }) {
  const { can } = useAuth();
  const { employees, employeesById, users } = useData();
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  const canManage = can(CAPS.PROJECTS_MANAGE);
  const save = () => run(async () => {
    const manager = users.find((u) => u.id === edit.managerUid);
    await updateDoc(doc(db, 'projects', project.id), {
      name: edit.name, address: edit.address, startDate: edit.startDate || '', endDate: edit.endDate || '', notes: edit.notes || '',
      managerUid: edit.managerUid || null, managerName: manager?.name || '', teamEmployeeIds: edit.teamEmployeeIds || [],
    });
    setEdit(null);
  }, 'Projekti u ruajt.');
  const pool = project.pool || {};
  return (
    <div className="grid grid-2">
      <Card title="Të dhënat e projektit" actions={canManage && !edit && <button type="button" className="btn small" onClick={() => setEdit({ ...project })}>Ndrysho</button>}>
        {edit ? (
          <div className="form-grid">
            <Field label="Emri" className="span-all"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Vendndodhja" className="span-all"><input value={edit.address || ''} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
            <Field label="Fillimi"><input type="date" value={edit.startDate || ''} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} /></Field>
            <Field label="Përfundimi"><input type="date" value={edit.endDate || ''} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} /></Field>
            <Field label="Përgjegjësi i projektit" className="span-all">
              <select value={edit.managerUid || ''} onChange={(e) => setEdit({ ...edit, managerUid: e.target.value })}>
                <option value="">—</option>
                {users.filter((u) => u.active !== false).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Ekipi (punonjësit shohin projektin nga telefoni)" className="span-all">
              <div className="stack">
                {employees.filter((e) => e.active !== false).map((e) => (
                  <label key={e.id} className="checkbox">
                    <input type="checkbox" checked={(edit.teamEmployeeIds || []).includes(e.id)}
                      onChange={(ev) => setEdit({ ...edit, teamEmployeeIds: ev.target.checked ? [...(edit.teamEmployeeIds || []), e.id] : (edit.teamEmployeeIds || []).filter((x) => x !== e.id) })} />
                    {e.name}{!e.userId && <small className="muted"> (pa llogari)</small>}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Shënime" className="span-all"><textarea value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
            <div className="form-actions span-all">
              <button type="button" className="btn" onClick={() => setEdit(null)}>Anulo</button>
              <button type="button" className="btn primary" disabled={busy} onClick={save}>Ruaj</button>
            </div>
          </div>
        ) : (
          <dl className="props">
            <dt>Klienti</dt><dd><Link to={`/klientet/${project.clientId}`}>{project.clientName}</Link></dd>
            <dt>Vendndodhja</dt><dd>{project.address || '—'}</dd>
            <dt>Periudha</dt><dd>{date(project.startDate)} – {project.endDate ? date(project.endDate) : 'në vazhdim'}</dd>
            <dt>Përgjegjësi</dt><dd>{project.managerName || '—'}</dd>
            <dt>Ekipi</dt><dd>{(project.teamEmployeeIds || []).map((e) => employeesById[e]?.name).filter(Boolean).join(', ') || '—'}</dd>
            {project.notes && <><dt>Shënime</dt><dd style={{ whiteSpace: 'pre-line' }}>{project.notes}</dd></>}
          </dl>
        )}
      </Card>
      <Card title="Pishina">
        <dl className="props">
          <dt>Lloji</dt><dd>{POOL_TYPES[pool.type] || pool.type || '—'}</dd>
          <dt>Përmasat</dt><dd>{pool.length ? `${qty(pool.length)} × ${qty(pool.width)} m` : '—'}</dd>
          <dt>Thellësia</dt><dd>{pool.depthMin ? `${qty(pool.depthMin)} – ${qty(pool.depthMax)} m` : '—'}</dd>
          <dt>Vëllimi</dt><dd>{pool.volume ? `${qty(pool.volume)} m³` : '—'}</dd>
          <dt>Kantieri</dt><dd><Link to={`/vendet/site_${project.id}`}>Materialet në kantier</Link></dd>
        </dl>
      </Card>
    </div>
  );
}
