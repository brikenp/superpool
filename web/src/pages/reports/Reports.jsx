import { collection, getDocs, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  CONDITIONS, LOCATION_KINDS, MOVEMENT_KINDS, OFFER_STATUS, PAYMENT_METHODS, PO_STATUS, PROJECT_STATUS, UNITS,
} from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';
import { projectResult } from '@shared/stock.js';

import { DataTable } from '../../components/DataTable.jsx';
import { Card, Field, Loading, PageHeader, SearchSelect } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { unitCostOf, useData, useQuery } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';
import { date, firstOfMonth, round2, todayISO } from '../../lib/format.js';
import { StockTable } from '../inventory/Stock.jsx';
import { productOption } from '../../components/ProductImage.jsx';

const REPORTS = [
  { key: 'stock', label: 'Gjendja e magazinës', filters: [] },
  { key: 'movements', label: 'Hyrjet dhe daljet', filters: ['period', 'kind', 'product', 'project', 'vehicle', 'employee', 'supplier', 'client'] },
  { key: 'vehicles', label: 'Materialet në automjete', filters: ['vehicle'] },
  { key: 'sites', label: 'Materialet në kantiere', filters: ['project'] },
  { key: 'returns', label: 'Kthimet dhe diferencat', filters: ['period', 'project', 'vehicle', 'employee'] },
  { key: 'chem', label: 'Shitjet e kimikateve', filters: ['period', 'client', 'product'] },
  { key: 'orders', label: 'Porositë e furnitorëve', filters: ['period', 'supplier', 'project'] },
  { key: 'offers', label: 'Ofertat dhe statusi', filters: ['period', 'client'] },
  { key: 'projects', label: 'Kostot e projekteve', filters: ['client'], caps: [CAPS.VIEW_COSTS] },
  { key: 'invoices', label: 'Faturat dhe pagesat e klientëve', filters: ['period', 'client', 'project'] },
];

function Filters({ report, f, setF }) {
  const { products, vehicles, employees, suppliers, clients } = useData();
  const projects = useQuery(() => (report.filters.includes('project') ? query(collection(db, 'projects')) : null), [report.key]);
  const has = (k) => report.filters.includes(k);
  if (!report.filters.length) return null;
  return (
    <Card>
      <div className="form-grid">
        {has('period') && (
          <>
            <Field label="Nga data"><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
            <Field label="Deri më"><input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          </>
        )}
        {has('kind') && (
          <Field label="Lloji i lëvizjes">
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="">Të gjitha</option>
              {Object.entries(MOVEMENT_KINDS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
            </select>
          </Field>
        )}
        {has('product') && <Field label="Artikulli"><SearchSelect options={products.map((p) => productOption(p))} value={f.product} onChange={(v) => setF({ ...f, product: v })} /></Field>}
        {has('project') && <Field label="Projekti"><SearchSelect options={projects.data.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} value={f.project} onChange={(v) => setF({ ...f, project: v })} /></Field>}
        {has('vehicle') && (
          <Field label="Automjeti">
            <select value={f.vehicle} onChange={(e) => setF({ ...f, vehicle: e.target.value })}>
              <option value="">Të gjitha</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}
            </select>
          </Field>
        )}
        {has('employee') && (
          <Field label="Punonjësi">
            <select value={f.employee} onChange={(e) => setF({ ...f, employee: e.target.value })}>
              <option value="">Të gjithë</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
        )}
        {has('supplier') && <Field label="Furnitori"><SearchSelect options={suppliers.map((s) => ({ value: s.id, label: s.name }))} value={f.supplier} onChange={(v) => setF({ ...f, supplier: v })} /></Field>}
        {has('client') && <Field label="Klienti"><SearchSelect options={clients.map((c) => ({ value: c.id, label: c.name }))} value={f.client} onChange={(v) => setF({ ...f, client: v })} /></Field>}
      </div>
    </Card>
  );
}

/** Ngarkon lëvizjet e periudhës dhe (për përdoruesit me kosto) kostot e tyre. */
function useMovementLines(f, enabled) {
  const { can } = useAuth();
  const showCosts = can(CAPS.VIEW_COSTS);
  const moves = useQuery(() => (enabled ? query(collection(db, 'movements'), where('date', '>=', f.from), where('date', '<=', f.to)) : null), [enabled, f.from, f.to]);
  const costs = useQuery(() => (enabled && showCosts ? query(collection(db, 'movementCosts'), where('date', '>=', f.from), where('date', '<=', f.to)) : null), [enabled, showCosts, f.from, f.to]);
  return useMemo(() => {
    const costById = Object.fromEntries(costs.data.map((c) => [c.id, c.lineCosts || []]));
    const lines = [];
    for (const m of moves.data) {
      if (m.status !== 'confirmed') continue;
      (m.lines || []).forEach((l, i) => {
        const unitCost = costById[m.id]?.[i];
        lines.push({ id: `${m.id}_${i}`, m, ...l, unitCost, value: unitCost !== undefined ? round2(unitCost * l.qty) : undefined });
      });
    }
    return { loading: moves.loading, lines };
  }, [moves.data, moves.loading, costs.data]);
}

const periodText = (f) => [`Periudha: ${date(f.from)} – ${date(f.to)}`];

function MovementsReport({ f }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const { lines } = useMovementLines(f, true);
  const rows = lines.filter(({ m, productId }) => (!f.kind || m.kind === f.kind) && (!f.product || productId === f.product)
    && (!f.project || m.projectId === f.project) && (!f.vehicle || m.vehicleId === f.vehicle) && (!f.employee || m.employeeId === f.employee)
    && (!f.supplier || m.supplierId === f.supplier) && (!f.client || m.clientId === f.client));
  return (
    <DataTable
      title="Hyrjet dhe daljet"
      filtersText={periodText(f)}
      rows={rows}
      onRowClick={(r) => navigate(`/levizjet/${r.m.id}`)}
      columns={[
        { key: 'date', label: 'Data', value: (r) => r.m.date, render: (r) => date(r.m.date) },
        { key: 'number', label: 'Nr.', value: (r) => r.m.number },
        { key: 'kind', label: 'Lloji', value: (r) => MOVEMENT_KINDS[r.m.kind]?.label },
        { key: 'from', label: 'Nga', value: (r) => r.m.sourceName },
        { key: 'to', label: 'Drejt', value: (r) => r.m.destName },
        { key: 'code', label: 'Kodi' },
        { key: 'name', label: 'Artikulli' },
        { key: 'qty', label: 'Sasia', type: 'number' },
        { key: 'unit', label: 'Nj.', value: (r) => UNITS[r.unit] || r.unit },
        { key: 'value', label: 'Vlera me kosto', type: 'money', total: true, hidden: !can(CAPS.VIEW_COSTS) },
      ]}
    />
  );
}

function ReturnsReport({ f }) {
  const navigate = useNavigate();
  const { lines } = useMovementLines(f, true);
  const rows = lines.filter(({ m }) => ['return', 'loss'].includes(m.kind)
    && (!f.project || m.projectId === f.project) && (!f.vehicle || m.vehicleId === f.vehicle) && (!f.employee || m.employeeId === f.employee));
  const pending = useQuery(() => query(collection(db, 'movements'), where('status', '==', 'pending')), []);
  return (
    <>
      {pending.data.filter((m) => ['return', 'loss'].includes(m.kind)).length > 0 && (
        <div className="alert warn">Ka {pending.data.filter((m) => ['return', 'loss'].includes(m.kind)).length} kthime/humbje në pritje të konfirmimit. <Link to="/levizjet">Shiko</Link></div>
      )}
      <DataTable
        title="Kthimet dhe diferencat"
        filtersText={periodText(f)}
        rows={rows}
        onRowClick={(r) => navigate(`/levizjet/${r.m.id}`)}
        columns={[
          { key: 'date', label: 'Data', value: (r) => r.m.date, render: (r) => date(r.m.date) },
          { key: 'number', label: 'Nr.', value: (r) => r.m.number },
          { key: 'kind', label: 'Lloji', value: (r) => MOVEMENT_KINDS[r.m.kind]?.label },
          { key: 'from', label: 'Nga', value: (r) => r.m.sourceName },
          { key: 'name', label: 'Artikulli' },
          { key: 'qty', label: 'Sasia', type: 'number' },
          { key: 'condition', label: 'Gjendja', value: (r) => (r.m.kind === 'loss' ? 'Humbje/dëmtim' : CONDITIONS[r.condition || 'good']) },
          { key: 'reason', label: 'Shpjegimi', value: (r) => r.note || r.m.notes || '' },
          { key: 'value', label: 'Vlera', type: 'money', total: true },
        ]}
      />
    </>
  );
}

function StockByKind({ kind, title, filterLoc }) {
  const { locations } = useData();
  const ids = locations.filter((l) => l.kind === kind && (!filterLoc || filterLoc(l))).map((l) => l.id);
  if (!ids.length) return <Card><p className="muted">Nuk ka vende të këtij lloji.</p></Card>;
  // Firestore lejon deri në 30 vlera në "in": ndajmë në grupe.
  const chunks = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  return chunks.map((c, i) => <StockTable key={i} locationIds={c} title={title} showLocation />);
}

function ChemReport({ f }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { costsById, company } = useData();
  const vatFactor = 1 + Number(company.vatPct ?? 20) / 100;
  const sales = useQuery(() => query(collection(db, 'sales'), where('date', '>=', f.from), where('date', '<=', f.to)), [f.from, f.to]);
  const rows = sales.data
    .filter((s) => s.status === 'confirmed' && (!f.client || s.clientId === f.client))
    .flatMap((s) => (s.lines || []).map((l, i) => ({ id: `${s.id}_${i}`, s, ...l })))
    .filter((r) => !f.product || r.productId === f.product);
  return (
    <DataTable
      title="Shitjet e kimikateve"
      filtersText={periodText(f)}
      rows={rows}
      onRowClick={(r) => navigate(`/kimikate/${r.s.id}`)}
      columns={[
        { key: 'date', label: 'Data', value: (r) => r.s.date, render: (r) => date(r.s.date) },
        { key: 'number', label: 'Nr.', value: (r) => r.s.number },
        { key: 'client', label: 'Klienti', value: (r) => r.s.clientName },
        { key: 'seller', label: 'Shitësi', value: (r) => r.s.sellerName },
        { key: 'name', label: 'Produkti' },
        { key: 'qty', label: 'Sasia', type: 'number', total: Boolean(f.product) },
        { key: 'unitPrice', label: 'Çmimi', type: 'money' },
        { key: 'total', label: 'Vlera', type: 'money', total: true },
        { key: 'payment', label: 'Pagesa', value: (r) => PAYMENT_METHODS[r.s.paymentMethod] },
        { key: 'margin', label: 'Marzhi (vlerësim)', type: 'money', total: true, hidden: !can(CAPS.VIEW_COSTS), value: (r) => round2(r.total / vatFactor - r.qty * unitCostOf(costsById, r.productId)) },
      ]}
    />
  );
}

function OrdersReport({ f }) {
  const navigate = useNavigate();
  const orders = useQuery(() => query(collection(db, 'purchaseOrders'), where('date', '>=', f.from), where('date', '<=', f.to)), [f.from, f.to]);
  const rows = orders.data
    .filter((o) => (!f.supplier || o.supplierId === f.supplier) && (!f.project || o.projectId === f.project))
    .flatMap((o) => (o.lines || []).map((l, i) => ({ id: `${o.id}_${i}`, o, ...l })));
  return (
    <DataTable
      title="Porositë e furnitorëve"
      filtersText={periodText(f)}
      rows={rows}
      onRowClick={(r) => navigate(`/porosite/${r.o.id}`)}
      columns={[
        { key: 'date', label: 'Data', value: (r) => r.o.date, render: (r) => date(r.o.date) },
        { key: 'number', label: 'Nr.', value: (r) => r.o.number },
        { key: 'supplier', label: 'Furnitori', value: (r) => r.o.supplierName },
        { key: 'name', label: 'Artikulli' },
        { key: 'qty', label: 'Porositur', type: 'number' },
        { key: 'receivedQty', label: 'Pranuar', type: 'number', value: (r) => Number(r.receivedQty || 0) },
        { key: 'value', label: 'Vlera', type: 'money', total: true, value: (r) => r.qty * Number(r.unitPrice || 0) },
        { key: 'expected', label: 'Mbërritja', value: (r) => r.o.expectedDate, render: (r) => date(r.o.expectedDate) },
        { key: 'status', label: 'Statusi', value: (r) => PO_STATUS[r.o.status] },
      ]}
    />
  );
}

function OffersReport({ f }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const offers = useQuery(() => query(collection(db, 'offers'), where('date', '>=', f.from), where('date', '<=', f.to)), [f.from, f.to]);
  const rows = offers.data.filter((o) => !f.client || o.clientId === f.client);
  return (
    <DataTable
      title="Ofertat dhe statusi"
      filtersText={periodText(f)}
      rows={rows}
      onRowClick={(o) => navigate(`/ofertat/${o.id}`)}
      columns={[
        { key: 'date', label: 'Data', render: (o) => date(o.date) },
        { key: 'number', label: 'Nr.' },
        { key: 'clientName', label: 'Klienti' },
        { key: 'projectName', label: 'Projekti' },
        { key: 'createdByName', label: 'Përgatiti' },
        { key: 'net', label: 'Pa TVSH', type: 'money', total: true, value: (o) => Number(o.totals?.net || 0) },
        { key: 'cost', label: 'Kosto', type: 'money', total: true, hidden: !can(CAPS.VIEW_COSTS), value: (o) => Number(o.totals?.cost || 0) },
        { key: 'marginPct', label: 'Marzhi %', type: 'number', hidden: !can(CAPS.VIEW_COSTS), value: (o) => Number(o.totals?.marginPct || 0) },
        { key: 'status', label: 'Statusi', value: (o) => OFFER_STATUS[o.status] },
      ]}
    />
  );
}

function ProjectsReport({ f }) {
  const navigate = useNavigate();
  const projects = useQuery(() => query(collection(db, 'projects')), []);
  const finance = useQuery(() => query(collection(db, 'projectFinance')), []);
  const invoices = useQuery(() => query(collection(db, 'invoices'), where('kind', '==', 'project')), []);
  const [expenses, setExpenses] = useState({});
  const ids = projects.data.map((p) => p.id).join(',');
  useEffect(() => {
    let alive = true;
    (async () => {
      const out = {};
      for (const p of projects.data) {
        const snap = await getDocs(collection(db, 'projectFinance', p.id, 'expenses'));
        out[p.id] = snap.docs.reduce((s, d) => s + Number(d.get('amount') || 0), 0);
      }
      if (alive) setExpenses(out);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  const finById = Object.fromEntries(finance.data.map((x) => [x.id, x]));
  const rows = projects.data
    .filter((p) => !f.client || p.clientId === f.client)
    .map((p) => {
      const fin = finById[p.id] || {};
      const invoiced = invoices.data.filter((i) => i.projectId === p.id && i.status !== 'cancelled').reduce((s, i) => s + Number(i.amount || 0), 0);
      return { ...p, r: projectResult({ ...fin, contractValue: Number(fin.contractValue || 0), expenses: expenses[p.id] || 0, invoiced }) };
    });
  return (
    <DataTable
      title="Kostot e projekteve"
      rows={rows}
      onRowClick={(p) => navigate(`/projektet/${p.id}`)}
      columns={[
        { key: 'code', label: 'Kodi' },
        { key: 'name', label: 'Projekti' },
        { key: 'clientName', label: 'Klienti' },
        { key: 'status', label: 'Statusi', value: (p) => PROJECT_STATUS[p.status] },
        { key: 'contract', label: 'Kontrata', type: 'money', total: true, value: (p) => p.r.contractValue },
        { key: 'planned', label: 'Kosto e parashikuar', type: 'money', total: true, value: (p) => p.r.plannedCost },
        { key: 'real', label: 'Kosto reale', type: 'money', total: true, value: (p) => p.r.realCost },
        { key: 'variance', label: 'Diferenca', type: 'money', total: true, value: (p) => p.r.costVariance },
        { key: 'margin', label: 'Rezultati', type: 'money', total: true, value: (p) => p.r.realMargin },
        { key: 'marginPct', label: 'Rezultati %', type: 'number', value: (p) => p.r.realMarginPct },
        { key: 'invoiced', label: 'Faturuar', type: 'money', total: true, value: (p) => p.r.invoiced },
      ]}
    />
  );
}

function InvoicesReport({ f }) {
  const invoices = useQuery(() => query(collection(db, 'invoices'), where('date', '>=', f.from), where('date', '<=', f.to)), [f.from, f.to]);
  const payments = useQuery(() => query(collection(db, 'payments'), where('date', '>=', f.from), where('date', '<=', f.to)), [f.from, f.to]);
  const rows = [
    ...invoices.data.filter((i) => i.status !== 'cancelled').map((i) => ({ id: `i${i.id}`, date: i.date, type: 'Faturë', doc: i.fiscalNumber || i.internalNumber || '', clientId: i.clientId, clientName: i.clientName, projectId: i.projectId, debit: Number(i.amount || 0), credit: 0 })),
    ...payments.data.filter((p) => p.status !== 'cancelled').map((p) => ({ id: `p${p.id}`, date: p.date, type: `Pagesë (${PAYMENT_METHODS[p.method] || p.method})`, doc: p.reference || '', clientId: p.clientId, clientName: p.clientName, projectId: null, debit: 0, credit: Number(p.amount || 0) })),
  ]
    .filter((r) => (!f.client || r.clientId === f.client) && (!f.project || r.projectId === f.project))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return (
    <DataTable
      title="Faturat dhe pagesat e klientëve"
      filtersText={periodText(f)}
      rows={rows}
      columns={[
        { key: 'date', label: 'Data', render: (r) => date(r.date) },
        { key: 'clientName', label: 'Klienti' },
        { key: 'type', label: 'Dokumenti' },
        { key: 'doc', label: 'Nr. / referenca' },
        { key: 'debit', label: 'Faturuar', type: 'money', total: true },
        { key: 'credit', label: 'Paguar', type: 'money', total: true },
      ]}
    />
  );
}

export default function Reports() {
  const { key = 'stock' } = useParams();
  const { can } = useAuth();
  const [f, setF] = useState({ from: firstOfMonth(), to: todayISO(), kind: '', product: '', project: '', vehicle: '', employee: '', supplier: '', client: '' });
  const available = REPORTS.filter((r) => !r.caps || can(...r.caps));
  const report = available.find((r) => r.key === key) || available[0];
  if (!report) return <Loading />;

  return (
    <>
      <PageHeader breadcrumb="Raportet" title={report.label} subtitle="Filtroni sipas nevojës dhe eksportoni në Excel ose PDF." />
      <Filters report={report} f={f} setF={setF} />
      <Card title={report.label}>
        {report.key === 'stock' && <StockTable locationIds={null} title="Gjendja e magazinës (të gjitha vendet)" showLocation />}
        {report.key === 'movements' && <MovementsReport f={f} />}
        {report.key === 'vehicles' && <StockByKind kind="vehicle" title="Materialet në automjete" filterLoc={f.vehicle ? (l) => l.vehicleId === f.vehicle : null} />}
        {report.key === 'sites' && <StockByKind kind="site" title="Materialet në kantiere" filterLoc={f.project ? (l) => l.projectId === f.project : null} />}
        {report.key === 'returns' && <ReturnsReport f={f} />}
        {report.key === 'chem' && <ChemReport f={f} />}
        {report.key === 'orders' && <OrdersReport f={f} />}
        {report.key === 'offers' && <OffersReport f={f} />}
        {report.key === 'projects' && <ProjectsReport f={f} />}
        {report.key === 'invoices' && <InvoicesReport f={f} />}
      </Card>
      <p className="muted" style={{ fontSize: '0.83rem' }}>Llojet e vendeve: {Object.values(LOCATION_KINDS).slice(0, 4).join(', ')}.</p>
    </>
  );
}
