import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { LOCATION_KINDS } from '@shared/constants.js';

import { DataTable } from '../../components/DataTable.jsx';
import { EntityForm } from '../../components/EntityForm.jsx';
import { Badge, PageHeader } from '../../components/ui.jsx';
import { physicalLocations, useData } from '../../lib/data.jsx';

export default function Locations() {
  const { locations, users } = useData();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(null);
  const sellers = users.filter((u) => ['kimikate', 'magazine', 'admin'].includes(u.role));

  return (
    <>
      <PageHeader
        title="Magazinat dhe nënmagazinat"
        subtitle="Nënmagazinat e automjeteve dhe të kantiereve krijohen automatikisht. Këtu shtoni magazina të tjera ose nënmagazinën e shitësit të kimikateve."
        actions={<button type="button" className="btn primary" onClick={() => setEditing({ kind: 'agent' })}><Plus size={16} /> Magazinë / nënmagazinë</button>}
      />
      <DataTable
        title="Vendet e magazinimit"
        rows={physicalLocations(locations).concat(locations.filter((l) => l.active === false))}
        onRowClick={(l) => navigate(`/vendet/${l.id}`)}
        columns={[
          { key: 'name', label: 'Emri' },
          { key: 'kind', label: 'Lloji', value: (l) => LOCATION_KINDS[l.kind] },
          { key: 'agent', label: 'Shitësi', value: (l) => users.find((u) => u.id === l.agentUid)?.name || '' },
          { key: 'active', label: 'Statusi', render: (l) => (l.active === false ? <Badge>joaktive</Badge> : <Badge tone="ok">aktive</Badge>) },
          {
            key: 'edit', label: '', sortable: false, export: false,
            render: (l) => (['main', 'agent'].includes(l.kind)
              ? <button type="button" className="btn small" onClick={(e) => { e.stopPropagation(); setEditing(l); }}>Ndrysho</button>
              : null),
          },
        ]}
      />
      {editing && (
        <EntityForm
          title={editing.id ? `Ndrysho ${editing.name}` : 'Vend i ri magazinimi'}
          collectionName="locations"
          record={editing.id ? editing : null}
          defaults={{ kind: 'agent', active: true }}
          onClose={() => setEditing(null)}
          fields={[
            { key: 'name', label: 'Emri', required: true },
            { key: 'kind', label: 'Lloji', type: 'select', required: true, options: [{ value: 'main', label: 'Magazinë' }, { value: 'agent', label: 'Nënmagazinë shitësi (p.sh. Gerti)' }] },
            { key: 'agentUid', label: 'Shitësi përgjegjës', type: 'select', options: sellers.map((u) => ({ value: u.id, label: u.name })), hint: 'Vetëm për nënmagazinat e shitësve.' },
            { key: 'active', label: 'Aktive', type: 'checkbox' },
          ]}
          transform={(d) => ({ ...d, agentUid: d.kind === 'agent' ? d.agentUid || null : null })}
        />
      )}
    </>
  );
}
