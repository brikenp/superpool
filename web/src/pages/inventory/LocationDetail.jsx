import { collection, query, where } from 'firebase/firestore';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { LOCATION_KINDS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { DataTable } from '../../components/DataTable.jsx';
import { Card, Loading, PageHeader, Tabs } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useData, useQuery } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';
import { StockTable } from './Stock.jsx';
import { movementColumns } from './Movements.jsx';
import { useRouteId } from '../../lib/prettyUrl.jsx';

/** Pasqyra e lëvizjeve hyrëse/dalëse për çdo artikull të një vendi (p.sh. rakordimi i Gertit). */
export function FlowSummary({ movements, locationId, title }) {
  const { productsById } = useData();
  const flows = {};
  for (const m of movements) {
    if (m.status !== 'confirmed') continue;
    for (const l of m.lines || []) {
      const f = (flows[l.productId] ||= { productId: l.productId, received: 0, sold: 0, returned: 0, used: 0, other: 0 });
      const q = Number(l.qty || 0);
      if (m.destId === locationId && !(m.kind === 'return' && l.condition !== 'good')) f.received += q;
      if (m.sourceId === locationId) {
        if (m.kind === 'sale') f.sold += q;
        else if (m.kind === 'return' && m.destId !== locationId) f.returned += q;
        else if (['consumption', 'delivery'].includes(m.kind)) f.used += q;
        else f.other += q;
      }
    }
  }
  const rows = Object.values(flows).map((f) => ({
    ...f, id: f.productId, product: productsById[f.productId] || {},
    expected: f.received - f.sold - f.returned - f.used - f.other,
  }));
  return (
    <DataTable
      title={title}
      rows={rows}
      columns={[
        { key: 'code', label: 'Kodi', value: (r) => r.product.code },
        { key: 'name', label: 'Artikulli', value: (r) => r.product.name },
        { key: 'received', label: 'Marrë', type: 'number' },
        { key: 'sold', label: 'Shitur', type: 'number' },
        { key: 'used', label: 'Përdorur/dorëzuar', type: 'number' },
        { key: 'returned', label: 'Kthyer', type: 'number' },
        { key: 'other', label: 'Të tjera dalje', type: 'number' },
        { key: 'expected', label: 'Mbetja sipas lëvizjeve', type: 'number' },
      ]}
    />
  );
}

export default function LocationDetail() {
  const id = useRouteId();
  const navigate = useNavigate();
  const { locationsById } = useData();
  const { can } = useAuth();
  const [tab, setTab] = useState('stock');
  const location = locationsById[id];
  const canSeeAll = can(CAPS.INVENTORY_VIEW, CAPS.MOVEMENTS_APPROVE);
  const outgoing = useQuery(() => (canSeeAll ? query(collection(db, 'movements'), where('sourceId', '==', id)) : null), [id, canSeeAll]);
  const incoming = useQuery(() => (canSeeAll ? query(collection(db, 'movements'), where('destId', '==', id)) : null), [id, canSeeAll]);

  if (!location) return <Loading />;
  const movements = [...incoming.data, ...outgoing.data]
    .filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/stoku">Stoku</Link>}
        title={location.name}
        subtitle={LOCATION_KINDS[location.kind]}
        actions={location.kind === 'vehicle' && <Link className="btn" to={`/automjetet?id=${location.vehicleId}`}>Automjeti</Link>}
      />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'stock', label: 'Gjendja' },
        canSeeAll && { key: 'moves', label: 'Lëvizjet' },
        canSeeAll && { key: 'flow', label: 'Hyrje / dalje sipas artikujve' },
      ]} />
      {tab === 'stock' && <Card><StockTable locationIds={[id]} title={`Gjendja · ${location.name}`} /></Card>}
      {tab === 'moves' && (
        <Card>
          <DataTable title={`Lëvizjet · ${location.name}`} rows={movements} onRowClick={(m) => navigate(`/levizjet/${m.id}`)} columns={movementColumns()} />
        </Card>
      )}
      {tab === 'flow' && <Card><FlowSummary movements={movements} locationId={id} title={`Hyrje/dalje · ${location.name}`} /></Card>}
    </>
  );
}
