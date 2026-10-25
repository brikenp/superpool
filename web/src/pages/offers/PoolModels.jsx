import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { POOL_TYPES } from '@shared/constants.js';

import { DataTable } from '../../components/DataTable.jsx';
import { Badge, PageHeader, useAction } from '../../components/ui.jsx';
import { useCollection } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';

export default function PoolModels() {
  const models = useCollection('poolModels');
  const navigate = useNavigate();
  const [run, busy] = useAction();
  const create = () => run(async () => {
    const ref = await addDoc(collection(db, 'poolModels'), {
      name: 'Model i ri', code: '', poolType: 'skimmer', circulation: 'Skimer', markupPct: 35, active: true,
      length: 8, width: 4, depthMin: 1.2, depthMax: 1.6, technicalText: '', items: [], createdAt: serverTimestamp(),
    });
    navigate(`/modelet/${ref.id}`);
  });
  return (
    <>
      <PageHeader
        title="Modelet e pishinave"
        subtitle="Biblioteka e modeleve: rregullat e përllogaritjes së materialeve, pajisjet standarde dhe çmimet."
        actions={<button type="button" className="btn primary" disabled={busy} onClick={create}><Plus size={16} /> Model i ri</button>}
      />
      <DataTable
        title="Modelet e pishinave"
        rows={models.data}
        onRowClick={(m) => navigate(`/modelet/${m.id}`)}
        columns={[
          { key: 'code', label: 'Kodi' },
          { key: 'name', label: 'Emri' },
          { key: 'poolType', label: 'Lloji', value: (m) => POOL_TYPES[m.poolType] || m.poolType },
          { key: 'circulation', label: 'Qarkullimi' },
          { key: 'items', label: 'Rreshta', type: 'number', value: (m) => (m.items || []).length },
          { key: 'markupPct', label: 'Marzhi %', type: 'number' },
          { key: 'active', label: '', render: (m) => (m.active === false ? <Badge>joaktiv</Badge> : null) },
        ]}
      />
    </>
  );
}
