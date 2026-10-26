import { collection, orderBy, query, where } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { MOVEMENT_KINDS, MOVEMENT_STATUS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { PrintMovementButton, printColumn } from '../../components/PrintButton.jsx';
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
  printColumn((m) => <PrintMovementButton movement={m} />),
];

// Seksionet e menysë "Lëvizjet e mallit": secili tregon vetëm llojet e veta.
export const MOVEMENT_SECTIONS = {
  miratim: { title: 'Lëvizjet për miratim', subtitle: 'Daljet, kthimet, humbjet dhe transferimet e regjistruara nga terreni që presin miratimin.', kinds: null, status: 'pending' },
  hyrjet: { title: 'Hyrjet nga blerja', subtitle: 'Fletëhyrjet nga furnitorët (faturat e blerjes) dhe kthimet nga klientët.', kinds: ['purchase', 'customer_return'], create: 'purchase', createLabel: 'Fletëhyrje e re' },
  daljet: { title: 'Daljet', subtitle: 'Materialet që dalin nga magazina drejt automjeteve, kantiereve ose shitësit të kimikateve.', kinds: ['issue', 'agent_issue'], create: 'issue', createLabel: 'Dalje e re' },
  dorezimet: { title: 'Dorëzimet në kantier', subtitle: 'Materialet e shkarkuara nga automjeti në kantier.', kinds: ['delivery'], create: 'delivery', createLabel: 'Dorëzim i ri' },
  perdorimi: { title: 'Përdorimi në projekte', subtitle: 'Materialet e përdorura realisht në projekte.', kinds: ['consumption'], create: 'consumption', createLabel: 'Regjistro përdorim' },
  kthimet: { title: 'Kthimet', subtitle: 'Kthimet në magazinë nga automjetet/kantieret dhe kthimet te furnitorët.', kinds: ['return', 'supplier_return'], create: 'return', createLabel: 'Kthim i ri' },
  transferimet: { title: 'Transferimet', subtitle: 'Lëvizjet ndërmjet magazinave, automjeteve dhe kantiereve.', kinds: ['transfer'], create: 'transfer', createLabel: 'Transferim i ri' },
  prodhimi: { title: 'Fletët e prodhimit', subtitle: 'Prodhimi i artikujve me recetë (p.sh. Aditivi): materialet dalin nga magazina dhe artikulli i prodhuar hyn në stok. Krijohen edhe automatikisht kur shitet më shumë sesa ka gjendje.', kinds: ['production'], createTo: '/prodhimi/i-ri', createLabel: 'Fletë prodhimi e re', createCaps: [CAPS.INVENTORY_MANAGE, CAPS.MOVEMENTS_APPROVE] },
  humbjet: { title: 'Dëmtime & rregullime', subtitle: 'Mallrat e dëmtuara ose të humbura dhe rregullimet e inventarit.', kinds: ['loss', 'adjustment'], create: 'loss', createLabel: 'Regjistro dëmtim' },
};

export default function Movements() {
  const [params] = useSearchParams();
  const section = MOVEMENT_SECTIONS[params.get('seksioni')] || null;
  return <MovementsList key={params.get('seksioni') || 'all'} section={section} />;
}

function MovementsList({ section }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { locations } = useData();
  const [tab, setTab] = useState(section?.status || 'all');
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
    .filter((m) => (!section?.kinds || section.kinds.includes(m.kind)) && (!kind || m.kind === kind) && (!location || m.sourceId === location || m.destId === location))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.number).localeCompare(String(a.number))), [source.data, kind, location, section]);
  const inSection = (m) => !section?.kinds || section.kinds.includes(m.kind);
  const kindOptions = Object.entries(MOVEMENT_KINDS).filter(([k]) => !section?.kinds || section.kinds.includes(k));

  const newKinds = Object.entries(MOVEMENT_KINDS).filter(([k]) => k !== 'sale' && k !== 'production'
    && (can(CAPS.INVENTORY_MANAGE, CAPS.MOVEMENTS_APPROVE) || ['issue', 'delivery', 'consumption', 'return', 'loss'].includes(k)));

  return (
    <>
      <PageHeader
        breadcrumb={section && <Link to="/levizjet">Lëvizjet e mallit</Link>}
        title={section?.title || 'Të gjitha lëvizjet'}
        subtitle={section?.subtitle || 'Fletëhyrje, fletëdalje, dorëzime në kantier, përdorime, kthime, humbje dhe rregullime.'}
        actions={can(...(section?.createCaps || [CAPS.MOVEMENTS_CREATE])) && (section?.create || section?.createTo
          ? <Link className="btn primary" to={section.createTo || `/levizjet/re/${section.create}`}><Plus size={16} /> {section.createLabel}</Link>
          : (
            <select className="btn primary" value="" onChange={(e) => e.target.value && navigate(`/levizjet/re/${e.target.value}`)} style={{ width: 'auto' }}>
              <option value="">+ Dokument i ri…</option>
              {newKinds.map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
            </select>
          ))}
      />
      {section?.status !== 'pending' && (
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { key: 'all', label: 'Sipas periudhës' },
            { key: 'pending', label: `Në pritje të miratimit (${pending.data.filter(inSection).length})` },
            { key: 'draft', label: `Draft (${drafts.data.filter(inSection).length})` },
          ]}
        />
      )}
      <div className="form-grid" style={{ marginBottom: 12 }}>
        {tab === 'all' && (
          <>
            <Field label="Nga data"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Deri më"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </>
        )}
        {kindOptions.length > 1 && (
          <Field label="Lloji">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Të gjitha</option>
              {kindOptions.map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
            </select>
          </Field>
        )}
        <Field label="Vendi">
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
            <option value="">Të gjitha</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
      </div>
      <DataTable
        title={section?.title || 'Lëvizjet e mallit'}
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
