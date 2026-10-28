import { collection, query, where } from 'firebase/firestore';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { CAPS } from '@shared/roles.js';

import { DataTable } from '../../components/DataTable.jsx';
import { EntityForm } from '../../components/EntityForm.jsx';
import { Badge, Card, PageHeader } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useData, useQuery } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';
import { FlowSummary } from '../inventory/LocationDetail.jsx';
import { movementColumns } from '../inventory/Movements.jsx';
import { StockTable } from '../inventory/Stock.jsx';
import { ImportButton } from '../../components/ImportExcel.jsx';

export default function Vehicles() {
  const { vehicles, vehiclesById, employees, employeesById } = useData();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(null);
  const selectedId = params.get('id');
  const selected = vehiclesById[selectedId];
  const canManage = can(CAPS.FLEET);

  return (
    <>
      <PageHeader
        title="Automjetet"
        subtitle="Çdo automjet ka nënmagazinën e vet: materialet që ndodhen në të, përgjegjësin dhe historikun."
        actions={canManage && (
          <>
            <ImportButton type="vehicles" />
            <button type="button" className="btn primary" onClick={() => setEditing({})}><Plus size={16} /> Automjet</button>
          </>
        )}
      />
      <DataTable
        title="Automjetet"
        rows={vehicles}
        search={vehicles.length > 8}
        onRowClick={(v) => setParams({ id: v.id })}
        columns={[
          { key: 'plate', label: 'Targa', render: (v) => <b>{v.plate}</b> },
          { key: 'description', label: 'Përshkrimi' },
          { key: 'responsible', label: 'Përgjegjësi', value: (v) => employeesById[v.responsibleId]?.name || '' },
          { key: 'active', label: 'Statusi', render: (v) => (v.active === false ? <Badge>joaktiv</Badge> : <Badge tone="ok">aktiv</Badge>) },
          {
            key: 'edit', label: '', sortable: false, export: false, hidden: !canManage,
            render: (v) => <button type="button" className="btn small" onClick={(e) => { e.stopPropagation(); setEditing(v); }}>Ndrysho</button>,
          },
        ]}
      />
      {selected && <VehiclePanel vehicle={selected} />}
      {editing && (
        <EntityForm
          title={editing.id ? `Ndrysho ${editing.plate}` : 'Automjet i ri'}
          collectionName="vehicles"
          record={editing.id ? editing : null}
          defaults={{ active: true }}
          onClose={() => setEditing(null)}
          fields={[
            { key: 'plate', label: 'Targa', required: true },
            { key: 'description', label: 'Përshkrimi (marka, modeli)' },
            { key: 'responsibleId', label: 'Përgjegjësi', type: 'select', options: employees.filter((e) => e.active !== false).map((e) => ({ value: e.id, label: e.name })) },
            { key: 'active', label: 'Aktiv', type: 'checkbox' },
          ]}
          transform={(d) => ({ ...d, plate: d.plate.toUpperCase().replace(/\s+/g, ''), responsibleId: d.responsibleId || null, responsibleName: employeesById[d.responsibleId]?.name || '' })}
        />
      )}
    </>
  );
}

function VehiclePanel({ vehicle }) {
  const navigate = useNavigate();
  const locationId = `veh_${vehicle.id}`;
  const moves = useQuery(() => query(collection(db, 'movements'), where('vehicleId', '==', vehicle.id)), [vehicle.id]);
  const rows = [...moves.data].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return (
    <>
      <Card title={`Materialet në automjetin ${vehicle.plate}`} actions={<Link className="btn small" to={`/levizjet/re/return?nga=${locationId}`}>Kthe në magazinë</Link>}>
        <StockTable locationIds={[locationId]} title={`Materialet në automjetin ${vehicle.plate}`} />
      </Card>
      <Card title="Hyrjet, daljet dhe kthimet">
        <DataTable title={`Historiku ${vehicle.plate}`} rows={rows} onRowClick={(m) => navigate(`/levizjet/${m.id}`)} columns={movementColumns()} />
      </Card>
      <Card title="Përmbledhje sipas artikujve">
        <FlowSummary movements={rows} locationId={locationId} title={`Përmbledhje ${vehicle.plate}`} />
      </Card>
    </>
  );
}
