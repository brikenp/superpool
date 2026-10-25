import { Check, Plus } from 'lucide-react';
import { useState } from 'react';

import { ROLES, ROLE_CAPS } from '@shared/roles.js';

import { DataTable } from '../../components/DataTable.jsx';
import { Badge, Card, Field, Modal, PageHeader, useAction } from '../../components/ui.jsx';
import { useData } from '../../lib/data.jsx';
import { call } from '../../lib/firebase.js';

const CAP_LABELS = {
  inventory_view: 'Shikim stoku', inventory_manage: 'Menaxhim magazine', movements_create: 'Regjistrim lëvizjesh',
  movements_approve: 'Miratim lëvizjesh', fleet: 'Automjete & punonjës', suppliers: 'Furnitorë & porosi',
  clients_view: 'Shikim klientësh', clients_manage: 'Menaxhim klientësh', finance: 'Fatura & pagesa',
  chem_sales: 'Shitje kimikatesh', chem_sales_all: 'Të gjitha shitjet', offers: 'Oferta', pool_models: 'Modelet e pishinave',
  projects_view: 'Shikim projektesh', projects_manage: 'Menaxhim projektesh', view_costs: 'Kosto & marzh',
  reports: 'Raporte', integration: 'Integrim / import', audit: 'Gjurmët', users: 'Përdoruesit', field: 'Ndërfaqja e terrenit',
};

export default function Users() {
  const { users, employees, employeesById } = useData();
  const [editing, setEditing] = useState(null);
  return (
    <>
      <PageHeader
        title="Përdoruesit dhe autorizimet"
        subtitle="Çdo përdorues sheh dhe ndryshon vetëm atë që i lejon roli. Punonjësit e terrenit lidhen me kartelën e punonjësit."
        actions={<button type="button" className="btn primary" onClick={() => setEditing({})}><Plus size={16} /> Përdorues</button>}
      />
      <DataTable
        title="Përdoruesit"
        rows={users}
        onRowClick={setEditing}
        columns={[
          { key: 'name', label: 'Emri' },
          { key: 'email', label: 'Email' },
          { key: 'role', label: 'Roli', value: (u) => ROLES[u.role] || u.role },
          { key: 'employee', label: 'Punonjësi', value: (u) => employeesById[u.employeeId]?.name || '' },
          { key: 'active', label: 'Statusi', render: (u) => (u.active === false ? <Badge tone="danger">joaktiv</Badge> : <Badge tone="ok">aktiv</Badge>) },
        ]}
      />
      <Card title="Çfarë lejon çdo rol">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Aftësia</th>{Object.values(ROLES).map((r) => <th key={r} style={{ whiteSpace: 'normal' }}>{r}</th>)}</tr></thead>
            <tbody>
              {Object.entries(CAP_LABELS).map(([cap, label]) => (
                <tr key={cap}>
                  <td>{label}</td>
                  {Object.keys(ROLES).map((r) => <td key={r} style={{ textAlign: 'center' }}>{ROLE_CAPS[r].includes(cap) ? <Check size={16} className="text-ok" /> : ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {editing && <UserForm user={editing.id ? editing : null} employees={employees} onClose={() => setEditing(null)} />}
    </>
  );
}

function UserForm({ user, employees, onClose }) {
  const [v, setV] = useState({ name: user?.name || '', email: user?.email || '', password: '', role: user?.role || 'terren', employeeId: user?.employeeId || '', active: user?.active !== false });
  const [run, busy] = useAction();
  const save = () => run(async () => {
    if (user) {
      await call('updateUser', { uid: user.id, name: v.name, role: v.role, active: v.active, employeeId: v.employeeId || null, password: v.password || undefined });
    } else {
      await call('createUser', { email: v.email, password: v.password, name: v.name, role: v.role, employeeId: v.employeeId || null });
    }
    onClose();
  }, 'Përdoruesi u ruajt.');
  return (
    <Modal title={user ? `Ndrysho ${user.name}` : 'Përdorues i ri'} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Anulo</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Ruaj</button></>}>
      <div className="form-grid">
        <Field label="Emri" required><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Email" required><input type="email" value={v.email} disabled={Boolean(user)} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label={user ? 'Fjalëkalim i ri (opsional)' : 'Fjalëkalimi'} required={!user} hint="Të paktën 8 karaktere.">
          <input type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
        </Field>
        <Field label="Roli" required>
          <select value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>
            {Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Kartela e punonjësit" hint="E nevojshme për punonjësit e terrenit (automjeti, projektet).">
          <select value={v.employeeId} onChange={(e) => setV({ ...v, employeeId: e.target.value })}>
            <option value="">—</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        {user && <Field><label className="checkbox"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Aktiv</label></Field>}
      </div>
    </Modal>
  );
}
