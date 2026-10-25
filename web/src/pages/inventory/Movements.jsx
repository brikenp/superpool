import { collection, orderBy, query, where } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { MOVEMENT_KINDS, MOVEMENT_STATUS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { DataTable } from '../../components/DataTable.jsx';
import { Field, PageHeader, StatusBadge, Tabs } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useData, useQuery } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';
import { addDays, date, qty, todayISO } from '../../lib/format.js';

export const movementColumns = (extra = []) => [
  { key: 'date', label: 'Data', value: (m) => m.date, render: (m) => date(m.date) },
  { key: 'number', label: 'Nr.' },
  { key: 'kind', label: 'Lloji', value: (m) => MOVEMENT_KINDS[m.kind]?.label },
  { key: 'sourceName', label: 'Nga' },
  { key: 'destName', label: 'Drejt' },
  ...extra,
  { key: 'lines', label: 'Artikuj', type: 'number', value: (m) => (m.lines || []).length },
  { key: 'createdByName', label: 'Regjistroi' },
  { key: 'status', label: 'Statusi', value: (m) => MOVEMENT_STATUS[m.status], render: (m) => <StatusBadge status={m.status} labels={MOVEMENT_STATUS} /> },
];

export default function Movements() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { locations } = useData();
  const [tab, setTab] = useState('all');
  const [from, setFrom] = useState(addDays(todayISO(), -30));
  const [to, setTo] = useState(todayISO());
  const [kind, setKind] = useState('');
  const [location, setLocation] = useState('');

  const ranged = useQuery(() => (tab === 'all'
    ? query(collection(db, 'movements'), where('date', '>=', from), where('date', '<=', to), orderBy('date', 'desc'))
    : null), [tab, from, to]);
  const pending = useQuery(() => query(collection(db, 'movements'), where('status', '==', 'pending')), []);
  const drafts = useQuery(() => query(collection(db, 'movements'), where('status', '==', 'draft')), []);

  const source = tab === 'pending' ? pending : tab === 'draft' ? drafts : ranged;
  const rows = useMemo(() => source.data
    .filter((m) => (!kind || m.kind === kind) && (!location || m.sourceId === location || m.destId === location))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.number).localeCompare(String(a.number))), [source.data, kind, location]);

  const newKinds = Object.entries(MOVEMENT_KINDS).filter(([k]) => k !== 'sale'
    && (can(CAPS.INVENTORY_MANAGE, CAPS.MOVEMENTS_APPROVE) || ['issue', 'delivery', 'consumption', 'return', 'loss'].includes(k)));

  return (
    <>
      <PageHeader
        title="Lëvizjet e mallit"
        subtitle="Fletëhyrje, fletëdalje, dorëzime në kantier, përdorime, kthime, humbje dhe rregullime."
        actions={can(CAPS.MOVEMENTS_CREATE) && (
          <select className="btn primary" value="" onChange={(e) => e.target.value && navigate(`/levizjet/re/${e.target.value}`)} style={{ width: 'auto' }}>
            <option value="">+ Dokument i ri…</option>
            {newKinds.map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
          </select>
        )}
      />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'all', label: 'Sipas periudhës' },
          { key: 'pending', label: `Në pritje të miratimit (${pending.data.length})` },
          { key: 'draft', label: `Draft (${drafts.data.length})` },
        ]}
      />
      <div className="form-grid" style={{ marginBottom: 12 }}>
        {tab === 'all' && (
          <>
            <Field label="Nga data"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Deri më"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </>
        )}
        <Field label="Lloji">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Të gjitha</option>
            {Object.entries(MOVEMENT_KINDS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
          </select>
        </Field>
        <Field label="Vendi">
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
            <option value="">Të gjitha</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
      </div>
      <DataTable
        title="Lëvizjet e mallit"
        filtersText={tab === 'all' ? [`Periudha: ${date(from)} – ${date(to)}`] : [MOVEMENT_STATUS[tab]]}
        rows={rows}
        onRowClick={(m) => navigate(`/levizjet/${m.id}`)}
        columns={movementColumns([
          { key: 'qtyTotal', label: 'Sasia', type: 'number', hidden: true, value: (m) => (m.lines || []).reduce((s, l) => s + Number(l.qty || 0), 0) },
        ])}
        empty={source.loading ? 'Duke ngarkuar…' : 'Nuk ka lëvizje.'}
      />
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Sasitë: {qty(rows.reduce((s, m) => s + (m.lines || []).length, 0))} rreshta artikujsh. Shiko edhe <Link to="/stoku">gjendjen e stokut</Link>.
      </p>
    </>
  );
}
