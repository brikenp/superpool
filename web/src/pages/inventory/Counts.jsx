import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { DataTable } from '../../components/DataTable.jsx';
import { Field, Modal, PageHeader, StatusBadge, useAction } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { physicalLocations, useCollection, useData } from '../../lib/data.jsx';
import { call, db } from '../../lib/firebase.js';
import { date, todayISO } from '../../lib/format.js';

const STATUS = { draft: 'Në numërim', confirmed: 'Konfirmuar', cancelled: 'Anuluar' };

export default function Counts() {
  const navigate = useNavigate();
  const counts = useCollection('inventoryCounts');
  const [creating, setCreating] = useState(false);
  const rows = [...counts.data].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return (
    <>
      <PageHeader
        title="Inventarizimi"
        subtitle="Numërimi fizik i magazinës, automjeteve ose nënmagazinës së shitësit. Diferencat kthehen në lëvizje rregullimi."
        actions={<button type="button" className="btn primary" onClick={() => setCreating(true)}>+ Inventarizim i ri</button>}
      />
      <DataTable
        title="Inventarizimet"
        rows={rows}
        onRowClick={(c) => navigate(`/inventarizim/${c.id}`)}
        columns={[
          { key: 'date', label: 'Data', render: (c) => date(c.date) },
          { key: 'number', label: 'Nr.' },
          { key: 'locationName', label: 'Vendi' },
          { key: 'lines', label: 'Artikuj', type: 'number', value: (c) => (c.lines || []).length },
          { key: 'diffs', label: 'Me diferencë', type: 'number', value: (c) => (c.lines || []).filter((l) => l.difference).length },
          { key: 'status', label: 'Statusi', value: (c) => STATUS[c.status], render: (c) => <StatusBadge status={c.status} labels={STATUS} /> },
        ]}
      />
      {creating && <NewCount onClose={() => setCreating(false)} onCreated={(id) => navigate(`/inventarizim/${id}`)} />}
    </>
  );
}

function NewCount({ onClose, onCreated }) {
  const { locations, productsById } = useData();
  const { uid, profile } = useAuth();
  const [locationId, setLocationId] = useState('main');
  const [day, setDay] = useState(todayISO());
  const [run, busy] = useAction();

  const create = () => run(async () => {
    const stock = await getDocs(query(collection(db, 'stock'), where('locationId', '==', locationId)));
    const lines = stock.docs
      .map((d) => d.data())
      .filter((s) => Number(s.qty) !== 0 && productsById[s.productId])
      .map((s) => ({ productId: s.productId, code: productsById[s.productId].code, name: productsById[s.productId].name, unit: productsById[s.productId].unit, systemQty: Number(s.qty), countedQty: null }))
      .sort((a, b) => a.code.localeCompare(b.code));
    const { number } = await call('allocateNumber', { prefix: 'NUM' });
    const loc = locations.find((l) => l.id === locationId);
    const ref = await addDoc(collection(db, 'inventoryCounts'), {
      number, locationId, locationName: loc?.name || '', date: day, status: 'draft', lines, notes: '',
      createdBy: uid, createdByName: profile?.name || '', createdAt: serverTimestamp(),
    });
    onCreated(ref.id);
  });

  return (
    <Modal
      title="Inventarizim i ri"
      onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Anulo</button><button type="button" className="btn primary" disabled={busy} onClick={create}>Krijo fletën e numërimit</button></>}
    >
      <div className="form-grid">
        <Field label="Vendi">
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {physicalLocations(locations).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Data"><input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
      </div>
      <p className="muted">Fleta plotësohet me artikujt që sistemi i ka në gjendje në këtë vend. Mund të shtoni artikuj të tjerë që gjeni fizikisht.</p>
    </Modal>
  );
}
