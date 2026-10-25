import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { PO_STATUS } from '@shared/constants.js';

import { DataTable } from '../../components/DataTable.jsx';
import { Field, Modal, PageHeader, SearchSelect, StatusBadge, useAction } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useCollection, useData } from '../../lib/data.jsx';
import { call, db } from '../../lib/firebase.js';
import { addDays, date, todayISO } from '../../lib/format.js';

export const poTotal = (o) => (o.lines || []).reduce((s, l) => s + Number(l.qty || 0) * Number(l.unitPrice || 0), 0);

/** Krijon një porosi draft dhe kthen id-në. */
export async function createPurchaseOrder({ supplier, lines = [], projectId = null, projectName = '', uid, userName, notes = '' }) {
  const { number } = await call('allocateNumber', { prefix: 'POR' });
  const ref = await addDoc(collection(db, 'purchaseOrders'), {
    number,
    supplierId: supplier.id,
    supplierName: supplier.name,
    status: 'draft',
    date: todayISO(),
    expectedDate: addDays(todayISO(), 7),
    projectId,
    projectName,
    lines,
    notes,
    createdBy: uid,
    createdByName: userName,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const orders = useCollection('purchaseOrders');
  const [status, setStatus] = useState('open');
  const [creating, setCreating] = useState(Boolean(params.get('furnitori')));
  const rows = orders.data
    .filter((o) => (status === 'open' ? !['received', 'cancelled'].includes(o.status) : !status || o.status === status))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return (
    <>
      <PageHeader
        title="Porositë e furnitorëve"
        actions={(
          <>
            <Link className="btn" to="/porosite/nevojat">Lista e nevojave</Link>
            <button type="button" className="btn primary" onClick={() => setCreating(true)}>+ Porosi e re</button>
          </>
        )}
      />
      <DataTable
        title="Porositë e furnitorëve"
        rows={rows}
        onRowClick={(o) => navigate(`/porosite/${o.id}`)}
        toolbar={(
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
            <option value="open">Të hapura</option>
            <option value="">Të gjitha</option>
            {Object.entries(PO_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
        columns={[
          { key: 'date', label: 'Data', render: (o) => date(o.date) },
          { key: 'number', label: 'Nr.' },
          { key: 'supplierName', label: 'Furnitori' },
          { key: 'projectName', label: 'Projekti' },
          { key: 'expectedDate', label: 'Mbërritja e parashikuar', render: (o) => date(o.expectedDate) },
          { key: 'lines', label: 'Artikuj', type: 'number', value: (o) => (o.lines || []).length },
          { key: 'total', label: 'Vlera', type: 'money', total: true, value: poTotal },
          { key: 'status', label: 'Statusi', value: (o) => PO_STATUS[o.status], render: (o) => <StatusBadge status={o.status} labels={PO_STATUS} /> },
        ]}
      />
      {creating && <NewOrder initialSupplier={params.get('furnitori') || ''} onClose={() => setCreating(false)} />}
    </>
  );
}

function NewOrder({ initialSupplier, onClose }) {
  const { suppliers, suppliersById } = useData();
  const { uid, profile } = useAuth();
  const navigate = useNavigate();
  const [supplierId, setSupplierId] = useState(initialSupplier);
  const [run, busy] = useAction();
  const create = () => run(async () => {
    const id = await createPurchaseOrder({ supplier: suppliersById[supplierId], uid, userName: profile?.name });
    navigate(`/porosite/${id}`);
  });
  return (
    <Modal title="Porosi e re" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Anulo</button><button type="button" className="btn primary" disabled={!supplierId || busy} onClick={create}>Krijo</button></>}>
      <Field label="Furnitori" required>
        <SearchSelect options={suppliers.map((s) => ({ value: s.id, label: s.name }))} value={supplierId} onChange={setSupplierId} autoFocus />
      </Field>
    </Modal>
  );
}
