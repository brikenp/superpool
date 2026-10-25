import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { OFFER_STATUS } from '@shared/constants.js';

import { DataTable } from '../../components/DataTable.jsx';
import { PageHeader, Stat, StatusBadge } from '../../components/ui.jsx';
import { useCollection } from '../../lib/data.jsx';
import { date, money } from '../../lib/format.js';

export default function Offers() {
  const offers = useCollection('offers');
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const rows = offers.data
    .filter((o) => !status || o.status === status)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.number).localeCompare(String(a.number)));
  const open = offers.data.filter((o) => ['draft', 'sent'].includes(o.status));
  const accepted = offers.data.filter((o) => o.status === 'accepted');
  const decided = offers.data.filter((o) => ['accepted', 'rejected'].includes(o.status)).length;

  return (
    <>
      <PageHeader
        title="Ofertat dhe preventivat"
        actions={(
          <>
            <Link className="btn" to="/modelet">Modelet e pishinave</Link>
            <Link className="btn primary" to="/ofertat/re">+ Ofertë e re</Link>
          </>
        )}
      />
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <Stat label="Oferta të hapura" value={open.length} sub={money(open.reduce((s, o) => s + Number(o.totals?.total || 0), 0))} />
        <Stat label="Të pranuara" value={accepted.length} sub={money(accepted.reduce((s, o) => s + Number(o.totals?.total || 0), 0))} tone="ok" />
        <Stat label="Shkalla e pranimit" value={decided ? `${Math.round((accepted.length / decided) * 100)}%` : '—'} />
      </div>
      <DataTable
        title="Ofertat"
        rows={rows}
        onRowClick={(o) => navigate(`/ofertat/${o.id}`)}
        toolbar={(
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Të gjitha statuset</option>
            {Object.entries(OFFER_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
        columns={[
          { key: 'date', label: 'Data', render: (o) => date(o.date) },
          { key: 'number', label: 'Nr.' },
          { key: 'clientName', label: 'Klienti' },
          { key: 'projectName', label: 'Projekti' },
          { key: 'location', label: 'Vendndodhja' },
          { key: 'dims', label: 'Përmasat', value: (o) => (o.length ? `${o.length}×${o.width}` : '') },
          { key: 'net', label: 'Vlera pa TVSH', type: 'money', total: true, value: (o) => Number(o.totals?.net || 0) },
          { key: 'marginPct', label: 'Marzhi %', type: 'number', value: (o) => Number(o.totals?.marginPct || 0) },
          { key: 'status', label: 'Statusi', value: (o) => OFFER_STATUS[o.status], render: (o) => <StatusBadge status={o.status} labels={OFFER_STATUS} /> },
        ]}
      />
    </>
  );
}
