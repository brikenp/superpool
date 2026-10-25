import { useState } from 'react';

import { DataTable } from '../../components/DataTable.jsx';
import { EntityForm } from '../../components/EntityForm.jsx';
import { Badge, PageHeader } from '../../components/ui.jsx';
import { useData } from '../../lib/data.jsx';

export default function Employees() {
  const { employees, usersById, vehicles } = useData();
  const [editing, setEditing] = useState(null);
  return (
    <>
      <PageHeader
        title="Punonjësit"
        subtitle="Punonjësit lidhen me automjetet, daljet e materialeve dhe ekipet e projekteve. Lidhja me llogarinë e përdoruesit bëhet te Përdoruesit."
        actions={<button type="button" className="btn primary" onClick={() => setEditing({})}>+ Punonjës</button>}
      />
      <DataTable
        title="Punonjësit"
        rows={employees}
        onRowClick={setEditing}
        columns={[
          { key: 'name', label: 'Emri' },
          { key: 'position', label: 'Pozicioni' },
          { key: 'phone', label: 'Telefoni' },
          { key: 'vehicles', label: 'Automjeti', value: (e) => vehicles.filter((v) => v.responsibleId === e.id).map((v) => v.plate).join(', ') },
          { key: 'user', label: 'Llogaria', value: (e) => usersById[e.userId]?.email || '' },
          { key: 'hourlyCost', label: 'Kosto / orë', type: 'money' },
          { key: 'active', label: 'Statusi', render: (e) => (e.active === false ? <Badge>joaktiv</Badge> : <Badge tone="ok">aktiv</Badge>) },
        ]}
      />
      {editing && (
        <EntityForm
          title={editing.id ? `Ndrysho ${editing.name}` : 'Punonjës i ri'}
          collectionName="employees"
          record={editing.id ? editing : null}
          defaults={{ active: true }}
          onClose={() => setEditing(null)}
          fields={[
            { key: 'name', label: 'Emri e mbiemri', required: true },
            { key: 'position', label: 'Pozicioni' },
            { key: 'phone', label: 'Telefoni', type: 'tel' },
            { key: 'hourlyCost', label: 'Kosto për orë pune (L)', type: 'number', hint: 'Përdoret për llogaritjen e kostos së punës në projekte.' },
            { key: 'active', label: 'Aktiv', type: 'checkbox' },
          ]}
          transform={({ userId, ...d }) => d}
        />
      )}
    </>
  );
}
