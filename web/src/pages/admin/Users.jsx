import { Check, Plus, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';

import { CAP_GROUPS, CAP_LABELS, CUSTOM_ROLE, ROLES, ROLE_CAPS, capsForRole } from '@shared/roles.js';

import { DataTable } from '../../components/DataTable.jsx';
import { Badge, Card, Field, Modal, PageHeader, useAction } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useData } from '../../lib/data.jsx';
import { call } from '../../lib/firebase.js';

const STANDARD_ROLES = Object.keys(ROLES).filter((r) => r !== CUSTOM_ROLE);

// Lejet që kanë kuptim vetëm bashkë me leje të tjera (p.sh. ofertat kërkojnë klientët dhe artikujt).
const DEPENDS_ON = {
  inventory_manage: ['inventory_view'],
  movements_approve: ['inventory_view', 'movements_create'],
  suppliers: ['inventory_view'],
  clients_manage: ['clients_view'],
  finance: ['clients_view'],
  chem_sales_all: ['chem_sales'],
  chem_sales: ['clients_view'],
  offers: ['clients_view', 'inventory_view'],
  pool_models: ['inventory_view'],
  projects_manage: ['projects_view', 'clients_view'],
  view_costs: ['inventory_view'],
};
const missingDeps = (caps) => [...new Set(caps.flatMap((c) => (DEPENDS_ON[c] || []).filter((d) => !caps.includes(d))))];

export default function Users() {
  const { users, employees, employeesById } = useData();
  const [editing, setEditing] = useState(null);
  return (
    <>
      <PageHeader
        title="Përdoruesit dhe autorizimet"
        subtitle="Çdo përdorues sheh dhe ndryshon vetëm atë që i lejon roli. Me rolin «I personalizuar» zgjidhni me dorë çdo leje."
        actions={<button type="button" className="btn primary" onClick={() => setEditing({})}><Plus size={16} /> Përdorues</button>}
      />
      <DataTable
        title="Përdoruesit"
        rows={users}
        onRowClick={setEditing}
        columns={[
          { key: 'name', label: 'Emri' },
          { key: 'email', label: 'Email' },
          {
            key: 'role', label: 'Roli', value: (u) => ROLES[u.role] || u.role,
            render: (u) => (u.role === CUSTOM_ROLE
              ? <span className="row" style={{ gap: 6 }}><Badge tone="info">I personalizuar</Badge><small className="muted">{(u.caps || []).length} leje</small></span>
              : ROLES[u.role] || u.role),
          },
          { key: 'employee', label: 'Punonjësi', value: (u) => employeesById[u.employeeId]?.name || '' },
          { key: 'active', label: 'Statusi', render: (u) => (u.active === false ? <Badge tone="danger">joaktiv</Badge> : <Badge tone="ok">aktiv</Badge>) },
        ]}
      />
      <Card title="Çfarë lejon çdo rol standard">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Leja</th>{STANDARD_ROLES.map((r) => <th key={r} style={{ whiteSpace: 'normal', textAlign: 'center' }}>{ROLES[r]}</th>)}</tr></thead>
            <tbody>
              {Object.entries(CAP_LABELS).map(([cap, label]) => (
                <tr key={cap}>
                  <td>{label}</td>
                  {STANDARD_ROLES.map((r) => <td key={r} style={{ textAlign: 'center' }}>{ROLE_CAPS[r].includes(cap) ? <Check size={16} className="text-ok" /> : ''}</td>)}
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
  const { uid } = useAuth();
  const [v, setV] = useState({
    name: user?.name || '', email: user?.email || '', password: '', role: user?.role || 'terren',
    employeeId: user?.employeeId || '', active: user?.active !== false,
    caps: [...capsForRole(user?.role || 'terren', user?.caps)],
  });
  const [run, busy] = useAction();
  const isCustom = v.role === CUSTOM_ROLE;
  const set = (patch) => setV((s) => ({ ...s, ...patch }));
  const toggleCap = (cap) => set({ caps: v.caps.includes(cap) ? v.caps.filter((c) => c !== cap) : [...v.caps, cap] });
  const toggleGroup = (group) => {
    const keys = Object.keys(group.caps);
    const all = keys.every((k) => v.caps.includes(k));
    set({ caps: all ? v.caps.filter((c) => !keys.includes(c)) : [...new Set([...v.caps, ...keys])] });
  };
  // Kur kalohet te "I personalizuar", nis nga lejet e rolit të mëparshëm (si shabllon).
  const changeRole = (role) => set({ role, caps: role === CUSTOM_ROLE ? (v.role === CUSTOM_ROLE ? v.caps : [...ROLE_CAPS[v.role]]) : [...ROLE_CAPS[role]] });

  const save = () => run(async () => {
    if (isCustom && !v.caps.length) throw new Error('Zgjidhni të paktën një leje.');
    const payload = { name: v.name, role: v.role, employeeId: v.employeeId || null, caps: isCustom ? v.caps : [] };
    if (user) await call('updateUser', { uid: user.id, ...payload, active: v.active, password: v.password || undefined });
    else await call('createUser', { ...payload, email: v.email, password: v.password });
    onClose();
  }, 'Përdoruesi u ruajt.');

  return (
    <Modal title={user ? `Ndrysho ${user.name}` : 'Përdorues i ri'} onClose={onClose} wide={isCustom}
      footer={<><button type="button" className="btn" onClick={onClose}>Anulo</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Ruaj</button></>}>
      <div className="form-grid">
        <Field label="Emri" required><input value={v.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Email" required><input type="email" value={v.email} disabled={Boolean(user)} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label={user ? 'Fjalëkalim i ri (opsional)' : 'Fjalëkalimi'} required={!user} hint="Të paktën 8 karaktere.">
          <input type="password" autoComplete="new-password" value={v.password} onChange={(e) => set({ password: e.target.value })} />
        </Field>
        <Field label="Roli" required>
          <select value={v.role} onChange={(e) => changeRole(e.target.value)}>
            {Object.entries(ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Kartela e punonjësit" hint="E nevojshme për punonjësit e terrenit (automjeti, projektet).">
          <select value={v.employeeId} onChange={(e) => set({ employeeId: e.target.value })}>
            <option value="">—</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        {user && <Field label=" "><label className="checkbox"><input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} /> Aktiv</label></Field>}
      </div>

      {isCustom ? (
        <div style={{ marginTop: 18 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <SlidersHorizontal size={18} className="text-ok" />
            <b>Lejet e këtij përdoruesi</b>
            <span className="muted">({v.caps.length} të zgjedhura)</span>
            <select className="right" style={{ width: 'auto' }} value="" onChange={(e) => e.target.value && set({ caps: [...ROLE_CAPS[e.target.value]] })}>
              <option value="">Nis nga shablloni i një roli…</option>
              {STANDARD_ROLES.map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
            </select>
          </div>
          <div className="grid grid-2">
            {CAP_GROUPS.map((g) => {
              const keys = Object.keys(g.caps);
              const count = keys.filter((k) => v.caps.includes(k)).length;
              return (
                <div key={g.title} className="card" style={{ marginBottom: 0, padding: 14 }}>
                  <label className="checkbox" style={{ fontWeight: 600, marginBottom: 8 }}>
                    <input type="checkbox" checked={count === keys.length} ref={(el) => { if (el) el.indeterminate = count > 0 && count < keys.length; }} onChange={() => toggleGroup(g)} />
                    {g.title}
                  </label>
                  <div className="stack" style={{ paddingLeft: 4 }}>
                    {keys.map((k) => (
                      <label key={k} className="checkbox">
                        <input type="checkbox" checked={v.caps.includes(k)} onChange={() => toggleCap(k)} />
                        {g.caps[k]}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {missingDeps(v.caps).length > 0 && (
            <div className="alert warn" style={{ marginTop: 12, alignItems: 'center' }}>
              <span style={{ flex: 1 }}>Disa leje të zgjedhura punojnë vetëm bashkë me: {missingDeps(v.caps).map((c) => CAP_LABELS[c]).join(', ')}.</span>
              <button type="button" className="btn small" onClick={() => set({ caps: [...v.caps, ...missingDeps(v.caps)] })}>Shtoji</button>
            </div>
          )}
          {user?.id === uid && !v.caps.includes('users') && (
            <div className="alert warn" style={{ marginTop: 12 }}>Nuk mund t'i hiqni vetes lejen «Përdoruesit» — do të humbisni aksesin te kjo faqe.</div>
          )}
        </div>
      ) : (
        <p className="muted" style={{ marginBottom: 0, fontSize: '0.85rem' }}>
          Lejet e rolit: {[...capsForRole(v.role)].map((c) => CAP_LABELS[c]).join(' · ') || '—'}.
          Për të zgjedhur lejet një nga një, zgjidhni rolin «I personalizuar».
        </p>
      )}
    </Modal>
  );
}
