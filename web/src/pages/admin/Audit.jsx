import { collection, limit, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { useState } from 'react';

import { DataTable } from '../../components/DataTable.jsx';
import { Field, Modal, PageHeader } from '../../components/ui.jsx';
import { useQuery } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';
import { addDays, dateTime, todayISO } from '../../lib/format.js';

const ACTIONS = {
  create: 'Krijim', update: 'Ndryshim', delete: 'Fshirje', confirm: 'Konfirmim', approve: 'Miratim', reject: 'Refuzim',
  cancel: 'Anulim', import: 'Importim', other: 'Tjetër',
};

export default function Audit() {
  const [from, setFrom] = useState(addDays(todayISO(), -7));
  const [selected, setSelected] = useState(null);
  const log = useQuery(() => query(
    collection(db, 'auditLog'),
    where('at', '>=', Timestamp.fromDate(new Date(`${from}T00:00:00`))),
    orderBy('at', 'desc'),
    limit(2000),
  ), [from]);

  return (
    <>
      <PageHeader title="Gjurmët e veprimeve" subtitle="Kush ndryshoi çfarë: sasi, anulime, kthime, miratime, ndryshime çmimesh dhe të dhënash." />
      <Field label="Nga data"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 200, marginBottom: 12 }} /></Field>
      <DataTable
        title="Gjurmët e veprimeve"
        rows={log.data}
        onRowClick={setSelected}
        columns={[
          { key: 'at', label: 'Koha', value: (r) => r.at?.seconds || 0, render: (r) => dateTime(r.at) },
          { key: 'userName', label: 'Përdoruesi' },
          { key: 'action', label: 'Veprimi', value: (r) => ACTIONS[r.action] || r.action },
          { key: 'collection', label: 'Moduli' },
          { key: 'label', label: 'Dokumenti' },
          { key: 'note', label: 'Shënim' },
        ]}
      />
      {selected && (
        <Modal title={`${ACTIONS[selected.action] || selected.action} · ${selected.label}`} onClose={() => setSelected(null)} wide>
          <p className="muted">{dateTime(selected.at)} · {selected.userName} · {selected.collection}/{selected.docId}</p>
          {selected.note && <p>{selected.note}</p>}
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', background: '#f4f7f9', padding: 12, borderRadius: 8 }}>
            {JSON.stringify(selected.changes, null, 2)}
          </pre>
        </Modal>
      )}
    </>
  );
}
