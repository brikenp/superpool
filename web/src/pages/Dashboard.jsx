import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { Link, useNavigate } from 'react-router-dom';

import { MOVEMENT_KINDS, MOVEMENT_STATUS, OFFER_STATUS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { DataTable } from '../components/DataTable.jsx';
import { Card, PageHeader, Stat, StatusBadge } from '../components/ui.jsx';
import { useAuth } from '../lib/auth.jsx';
import { unitCostOf, useData, useQuery } from '../lib/data.jsx';
import { db } from '../lib/firebase.js';
import { date, firstOfMonth, money, todayISO } from '../lib/format.js';
import FieldHome from './field/FieldHome.jsx';
import { freeQty } from './inventory/Products.jsx';

export default function Dashboard() {
  const { role } = useAuth();
  if (role === 'terren') return <FieldHome />;
  return <ManagementDashboard />;
}

function ManagementDashboard() {
  const { can, uid, profile } = useAuth();
  const { products, costsById } = useData();
  const navigate = useNavigate();
  const inv = can(CAPS.INVENTORY_VIEW);
  const approve = can(CAPS.MOVEMENTS_APPROVE);
  const offersCap = can(CAPS.OFFERS);
  const projectsCap = can(CAPS.PROJECTS_VIEW);
  const salesAll = can(CAPS.CHEM_SALES_ALL, CAPS.REPORTS);
  const salesOwn = can(CAPS.CHEM_SALES);

  const pending = useQuery(() => (approve ? query(collection(db, 'movements'), where('status', '==', 'pending')) : null), [approve]);
  const recent = useQuery(() => (inv ? query(collection(db, 'movements'), orderBy('date', 'desc'), limit(12)) : null), [inv]);
  const projects = useQuery(() => (projectsCap ? query(collection(db, 'projects'), where('status', 'in', ['planned', 'active'])) : null), [projectsCap]);
  const offers = useQuery(() => (offersCap ? query(collection(db, 'offers'), where('status', 'in', ['draft', 'sent'])) : null), [offersCap]);
  const sales = useQuery(() => {
    if (salesAll) return query(collection(db, 'sales'), where('date', '>=', firstOfMonth()));
    if (salesOwn) return query(collection(db, 'sales'), where('sellerUid', '==', uid), where('date', '>=', firstOfMonth()));
    return null;
  }, [salesAll, salesOwn, uid]);

  const active = products.filter((p) => p.active !== false);
  const low = active.filter((p) => Number(p.minStock || 0) > 0 && freeQty(p) < Number(p.minStock || 0));
  const stockValue = active.reduce((s, p) => s + Number(p.qtyTotal || 0) * unitCostOf(costsById, p.id), 0);
  const monthSales = sales.data.filter((s) => s.status === 'confirmed');
  const expiring = offers.data.filter((o) => o.validUntil && o.validUntil < todayISO());

  return (
    <>
      <PageHeader title="Paneli" subtitle={`Mirë se vini, ${profile?.name || ''}. ${date(todayISO())}`} />
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        {approve && <Stat label="Në pritje të miratimit" value={pending.data.length} tone={pending.data.length ? 'warn' : 'ok'} to="/levizjet" sub="dalje, kthime, humbje" />}
        {inv && <Stat label="Artikuj nën stokun minimal" value={low.length} tone={low.length ? 'danger' : 'ok'} to="/porosite/nevojat" />}
        {inv && can(CAPS.VIEW_COSTS) && <Stat label="Vlera e stokut" value={money(stockValue)} sub={`${active.length} artikuj aktivë`} to="/stoku?vendi=all" />}
        {projectsCap && <Stat label="Projekte aktive" value={projects.data.length} sub={`${projects.data.filter((p) => (p.shortages || []).length).length} me mungesa materialesh`} to="/projektet" />}
        {offersCap && <Stat label="Oferta të hapura" value={offers.data.length} sub={expiring.length ? `${expiring.length} të skaduara` : money(offers.data.reduce((s, o) => s + Number(o.totals?.total || 0), 0))} to="/ofertat" />}
        {(salesAll || salesOwn) && <Stat label="Shitje kimikatesh këtë muaj" value={money(monthSales.reduce((s, x) => s + Number(x.total || 0), 0))} sub={`${monthSales.length} shitje`} to="/kimikate" />}
      </div>

      <div className="grid grid-2">
        {approve && pending.data.length > 0 && (
          <Card title="Për miratim">
            <ul className="list-plain">
              {pending.data.slice(0, 10).map((m) => (
                <li key={m.id}>
                  <Link to={`/levizjet/${m.id}`} style={{ flex: 1 }}>{m.number} · {MOVEMENT_KINDS[m.kind]?.label}<br /><small className="muted">{m.createdByName} · {m.sourceName} → {m.destName}</small></Link>
                  <span className="muted">{date(m.date)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {inv && low.length > 0 && (
          <Card title="Stok i ulët" actions={<Link className="btn small" to="/porosite/nevojat">Lista e nevojave</Link>}>
            <ul className="list-plain">
              {low.slice(0, 10).map((p) => (
                <li key={p.id}>
                  <Link to={`/artikuj/${p.id}`} style={{ flex: 1 }}>{p.code} · {p.name}</Link>
                  <span className="text-danger">{freeQty(p)} / min {p.minStock}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {offersCap && offers.data.length > 0 && (
          <Card title="Ofertat e hapura">
            <ul className="list-plain">
              {[...offers.data].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 8).map((o) => (
                <li key={o.id}>
                  <Link to={`/ofertat/${o.id}`} style={{ flex: 1 }}>{o.number} · {o.clientName}<br /><small className="muted">{o.projectName}</small></Link>
                  <span>{money(o.totals?.total)}</span>
                  <StatusBadge status={o.status} labels={OFFER_STATUS} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {inv && (
        <Card title="Lëvizjet e fundit" actions={<Link className="btn small" to="/levizjet">Të gjitha</Link>}>
          <DataTable
            search={false}
            exportable={false}
            rows={recent.data}
            onRowClick={(m) => navigate(`/levizjet/${m.id}`)}
            columns={[
              { key: 'date', label: 'Data', render: (m) => date(m.date) },
              { key: 'number', label: 'Nr.' },
              { key: 'kind', label: 'Lloji', value: (m) => MOVEMENT_KINDS[m.kind]?.label },
              { key: 'route', label: 'Lëvizja', value: (m) => `${m.sourceName} → ${m.destName}` },
              { key: 'status', label: 'Statusi', render: (m) => <StatusBadge status={m.status} labels={MOVEMENT_STATUS} /> },
            ]}
          />
        </Card>
      )}
      {!inv && !offersCap && !salesOwn && <Card><p>Zgjidhni një modul nga menyja.</p></Card>}
    </>
  );
}
