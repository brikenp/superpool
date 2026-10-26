import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { OFFER_STATUS } from '@shared/constants.js';

import { DataTable } from '../../components/DataTable.jsx';
import { Badge, PageHeader, Stat, StatusBadge } from '../../components/ui.jsx';
import { useCollection } from '../../lib/data.jsx';
import { date, money, offerAll } from '../../lib/format.js';

// Seksionet e menysë "Ofertat": secili tregon vetëm ofertat me statuset e veta.
const OFFER_SECTIONS = {
  draft: { title: 'Ofertat draft', subtitle: 'Oferta në përgatitje, ende pa u dërguar te klienti.', statuses: ['draft'] },
  derguara: { title: 'Ofertat e dërguara', subtitle: 'Oferta të dërguara te klienti që presin përgjigje.', statuses: ['sent'] },
  pranuara: { title: 'Ofertat e pranuara', subtitle: 'Oferta të pranuara nga klienti dhe të kthyera në projekte.', statuses: ['accepted'] },
  refuzuara: { title: 'Ofertat e refuzuara / skaduara', subtitle: 'Oferta të refuzuara nga klienti ose që u ka kaluar afati.', statuses: ['rejected', 'expired'] },
};

const isOverdue = (o) => ['draft', 'sent'].includes(o.status) && o.validUntil && o.validUntil < new Date().toISOString().slice(0, 10);

export default function Offers() {
  const [params] = useSearchParams();
  const key = params.get('seksioni') || '';
  return <OffersSection key={key} section={OFFER_SECTIONS[key] || null} />;
}

function OffersSection({ section }) {
  const offers = useCollection('offers');
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const rows = offers.data
    .filter((o) => (!section || section.statuses.includes(o.status)) && (!status || o.status === status))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.number).localeCompare(String(a.number)));
  const open = offers.data.filter((o) => ['draft', 'sent'].includes(o.status));
  const accepted = offers.data.filter((o) => o.status === 'accepted');
  const decided = offers.data.filter((o) => ['accepted', 'rejected'].includes(o.status)).length;

  return (
    <>
      <PageHeader
        breadcrumb={section && <Link to="/ofertat">Ofertat</Link>}
        title={section?.title || 'Të gjitha ofertat'}
        subtitle={section?.subtitle || 'Ofertat dhe preventivat për klientët, me vlerën dhe marzhin.'}
        actions={(
          <>
            <Link className="btn" to="/modelet">Modelet e pishinave</Link>
            <Link className="btn primary" to="/ofertat/re"><Plus size={16} /> Ofertë e re</Link>
          </>
        )}
      />
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <Stat label="Oferta të hapura" value={open.length} sub={money(open.reduce((s, o) => s + offerAll(o), 0))} />
        <Stat label="Të pranuara" value={accepted.length} sub={money(accepted.reduce((s, o) => s + offerAll(o), 0))} tone="ok" />
        <Stat label="Shkalla e pranimit" value={decided ? `${Math.round((accepted.length / decided) * 100)}%` : '—'} />
      </div>
      <DataTable
        title={section?.title || 'Ofertat'}
        rows={rows}
        onRowClick={(o) => navigate(`/ofertat/${o.id}`)}
        toolbar={(!section || section.statuses.length > 1) && (
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Të gjitha statuset</option>
            {Object.entries(OFFER_STATUS).filter(([k]) => !section || section.statuses.includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
        columns={[
          { key: 'date', label: 'Data', render: (o) => date(o.date) },
          { key: 'number', label: 'Nr.' },
          { key: 'clientName', label: 'Klienti' },
          { key: 'projectName', label: 'Projekti' },
          { key: 'location', label: 'Vendndodhja' },
          { key: 'dims', label: 'Përmasat', value: (o) => (o.length ? `${o.length}×${o.width}` : '') },
          { key: 'net', label: 'Vlera pa TVSH', type: 'money', total: true, value: (o) => offerAll(o, 'net'), render: (o) => (o.currency === 'EUR' ? `${money(o.totals?.net, 'EUR')} (≈ ${money(offerAll(o, 'net'))})` : money(o.totals?.net)) },
          { key: 'marginPct', label: 'Marzhi %', type: 'number', value: (o) => Number(o.totals?.marginPct || 0) },
          { key: 'status', label: 'Statusi', value: (o) => OFFER_STATUS[o.status], render: (o) => (isOverdue(o)
            ? <span className="row" style={{ gap: 4 }}><StatusBadge status={o.status} labels={OFFER_STATUS} /><Badge tone="danger">afati kaloi</Badge></span>
            : <StatusBadge status={o.status} labels={OFFER_STATUS} />) },
        ]}
      />
    </>
  );
}
