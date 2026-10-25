import { addDoc, collection, query, serverTimestamp, where } from 'firebase/firestore';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PROJECT_STATUS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { DataTable } from '../../components/DataTable.jsx';
import { Field, Modal, PageHeader, SearchSelect, StatusBadge, useAction } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useData, useQuery } from '../../lib/data.jsx';
import { call, db } from '../../lib/firebase.js';
import { date, todayISO } from '../../lib/format.js';

export default function Projects() {
  const { uid, can } = useAuth();
  const navigate = useNavigate();
  const seesAll = can(CAPS.PROJECTS_VIEW);
  const projects = useQuery(() => (seesAll
    ? query(collection(db, 'projects'))
    : query(collection(db, 'projects'), where('teamUids', 'array-contains', uid))), [seesAll, uid]);
  const [status, setStatus] = useState('open');
  const [creating, setCreating] = useState(false);
  const rows = projects.data
    .filter((p) => (status === 'open' ? ['planned', 'active'].includes(p.status) : !status || p.status === status))
    .sort((a, b) => String(b.code).localeCompare(String(a.code)));

  return (
    <>
      <PageHeader
        title="Projektet dhe kantieret"
        subtitle="Çdo ofertë e pranuar bëhet projekt me kantierin, materialet e planifikuara dhe kostot."
        actions={can(CAPS.PROJECTS_MANAGE) && <button type="button" className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> Projekt pa ofertë</button>}
      />
      <DataTable
        title="Projektet"
        rows={rows}
        onRowClick={(p) => navigate(`/projektet/${p.id}`)}
        toolbar={(
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
            <option value="open">Në planifikim dhe aktive</option>
            <option value="">Të gjitha</option>
            {Object.entries(PROJECT_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
        columns={[
          { key: 'code', label: 'Kodi' },
          { key: 'name', label: 'Projekti' },
          { key: 'clientName', label: 'Klienti' },
          { key: 'address', label: 'Vendndodhja' },
          { key: 'managerName', label: 'Përgjegjësi' },
          { key: 'startDate', label: 'Fillimi', render: (p) => date(p.startDate) },
          { key: 'shortages', label: 'Mungesa', type: 'number', value: (p) => (p.shortages || []).length },
          { key: 'status', label: 'Statusi', value: (p) => PROJECT_STATUS[p.status], render: (p) => <StatusBadge status={p.status} labels={PROJECT_STATUS} /> },
        ]}
      />
      {creating && <NewProject onClose={() => setCreating(false)} />}
    </>
  );
}

function NewProject({ onClose }) {
  const { clients, clientsById } = useData();
  const { uid, profile } = useAuth();
  const navigate = useNavigate();
  const [v, setV] = useState({ name: '', clientId: '', address: '' });
  const [run, busy] = useAction();
  const create = () => run(async () => {
    if (!v.name.trim() || !v.clientId) throw new Error('Emri dhe klienti janë të detyrueshëm.');
    const { number } = await call('allocateNumber', { prefix: 'PRJ' });
    const ref = await addDoc(collection(db, 'projects'), {
      code: number, name: v.name.trim(), clientId: v.clientId, clientName: clientsById[v.clientId]?.name || '', address: v.address,
      status: 'active', startDate: todayISO(), endDate: '', managerUid: uid, managerName: profile?.name || '',
      teamEmployeeIds: [], notes: '', createdBy: uid, createdAt: serverTimestamp(),
    });
    navigate(`/projektet/${ref.id}`);
  });
  return (
    <Modal title="Projekt i ri" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Anulo</button><button type="button" className="btn primary" disabled={busy} onClick={create}>Krijo</button></>}>
      <div className="form-grid">
        <Field label="Emri i projektit" required className="span-all"><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Klienti" required className="span-all">
          <SearchSelect options={clients.map((c) => ({ value: c.id, label: c.name }))} value={v.clientId} onChange={(c) => setV({ ...v, clientId: c })} />
        </Field>
        <Field label="Vendndodhja" className="span-all"><input value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
