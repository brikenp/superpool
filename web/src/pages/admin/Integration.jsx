import { collection, query, where } from 'firebase/firestore';
import { useState } from 'react';

import { Card, Field, PageHeader, useAction } from '../../components/ui.jsx';
import { useData, useQuery } from '../../lib/data.jsx';
import { downloadCsv, readTable } from '../../lib/export.js';
import { call, db } from '../../lib/firebase.js';
import { date } from '../../lib/format.js';

// Kolonat e pranuara për çdo lloj importi (titujt në rreshtin e parë të skedarit).
const IMPORTS = {
  products: {
    label: 'Artikujt',
    columns: ['code / kodi*', 'name / emri*', 'description', 'brand', 'model', 'unit (cope, m, m2, kg, l…)', 'category', 'supplier', 'purchasePrice', 'salePrice', 'minStock'],
    sample: [{ code: 'PMP-001', name: 'Pompë 1HP', unit: 'cope', category: 'Pompa', supplier: 'Furnitori X', purchasePrice: 25000, salePrice: 38000, minStock: 2 }],
  },
  openingStock: {
    label: 'Stoku fillestar',
    columns: ['code*', 'qty*', 'unitCost'],
    sample: [{ code: 'PMP-001', qty: 5, unitCost: 25000 }],
    help: 'Krijon lëvizje rregullimi drejt magazinës së zgjedhur. Përdoret një herë në fillim.',
  },
  clients: {
    label: 'Klientët',
    columns: ['name / emri*', 'nipt', 'phone', 'email', 'address', 'city', 'billingId'],
    sample: [{ name: 'Hotel Riviera', nipt: 'L12345678A', phone: '069...', city: 'Durrës' }],
  },
  suppliers: {
    label: 'Furnitorët',
    columns: ['name*', 'nipt', 'contactPerson', 'phone', 'email', 'address'],
    sample: [{ name: 'Furnitori X', nipt: 'K00000000X', phone: '04...' }],
  },
  invoices: {
    label: 'Faturat (nga programi i faturimit)',
    columns: ['number*', 'date*', 'nipt ose client*', 'amount*', 'dueDate', 'saleNumber (nr. i shitjes në SuperPool, p.sh. SHT-2026-0012)'],
    sample: [{ number: 'ABC123/2026', date: '2026-10-01', nipt: 'L12345678A', amount: 12000, saleNumber: 'SHT-2026-0012' }],
    help: 'Nëse jepet saleNumber, numri fiskal lidhet automatikisht me shitjen përkatëse.',
  },
  payments: {
    label: 'Pagesat',
    columns: ['date*', 'amount*', 'invoiceNumber ose nipt*', 'method (cash/bank/card)', 'reference'],
    sample: [{ date: '2026-10-05', amount: 12000, invoiceNumber: 'ABC123/2026', method: 'bank' }],
  },
  fiscalStock: {
    label: 'Gjendja fiskale e magazinës',
    columns: ['code*', 'quantity*', 'value', 'asOf'],
    sample: [{ code: 'PMP-001', quantity: 4, asOf: '2026-10-31' }],
    help: 'Përdoret te "Rakordimi fiskal" për krahasimin me stokun fizik.',
  },
};

export default function Integration() {
  const { locations } = useData();
  const [type, setType] = useState('products');
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [locationId, setLocationId] = useState('main');
  const [result, setResult] = useState(null);
  const [run, busy] = useAction();
  const def = IMPORTS[type];
  const pendingInvoices = useQuery(() => query(collection(db, 'invoices'), where('status', '==', 'pending_fiscal')), []);

  const load = (file) => run(async () => {
    setResult(null);
    setFileName(file.name);
    setRows(await readTable(file));
  });
  const submit = () => run(async () => {
    const res = await call('importData', { type, rows, options: { locationId } });
    setResult(res);
    setRows(null);
    return res;
  }, (r) => `Importi përfundoi: ${r.created} të reja, ${r.updated} të përditësuara.`);

  const exportPending = () => downloadCsv('shitje_per_faturim.csv', [
    { label: 'Nr. shitjes', value: (i) => i.saleNumber },
    { label: 'Data', value: (i) => i.date },
    { label: 'Klienti', value: (i) => i.clientName },
    { label: 'Vlera me TVSH', value: (i) => i.amount },
    { label: 'Nr. i brendshëm', value: (i) => i.internalNumber },
  ], pendingInvoices.data);

  const headers = rows?.length ? Object.keys(rows[0]) : [];

  return (
    <>
      <PageHeader
        title="Integrimi me programin e faturimit"
        subtitle="Programi i faturimit mbetet burimi i faturave fiskale. Shkëmbimi bëhet me skedarë Excel/CSV derisa të konfirmohet API-ja e tij."
      />
      <div className="grid grid-2">
        <Card title="1. Import nga programi i faturimit / Excel">
          <div className="form-grid">
            <Field label="Lloji i të dhënave">
              <select value={type} onChange={(e) => { setType(e.target.value); setRows(null); setResult(null); }}>
                {Object.entries(IMPORTS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
              </select>
            </Field>
            {type === 'openingStock' && (
              <Field label="Magazina">
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {locations.filter((l) => ['main', 'agent'].includes(l.kind)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Skedari (.xlsx ose .csv)" className="span-all">
              <input type="file" accept=".xlsx,.csv,.txt" disabled={busy} onChange={(e) => e.target.files[0] && load(e.target.files[0])} />
            </Field>
          </div>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Kolonat: {def.columns.map((c) => <code key={c} style={{ marginRight: 4 }}>{c}</code>)}
            {def.help && <><br />{def.help}</>}
          </p>
          <button type="button" className="btn small" onClick={() => downloadCsv(`shembull_${type}.csv`, Object.keys(def.sample[0]).map((k) => ({ label: k, value: (r) => r[k] })), def.sample)}>Shkarko shembullin</button>
          {rows && (
            <div style={{ marginTop: 12 }}>
              <div className="alert info">{fileName}: {rows.length} rreshta. Kolonat e gjetura: {headers.join(', ')}</div>
              <div className="table-wrap" style={{ maxHeight: 260 }}>
                <table className="table">
                  <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{rows.slice(0, 10).map((r, i) => <tr key={i}>{headers.map((h) => <td key={h}>{String(r[h] ?? '')}</td>)}</tr>)}</tbody>
                </table>
              </div>
              <button type="button" className="btn primary" style={{ marginTop: 10 }} disabled={busy} onClick={submit}>Importo {rows.length} rreshta</button>
            </div>
          )}
          {result && (
            <div className={`alert ${result.errors.length ? 'warn' : 'ok'}`} style={{ marginTop: 12 }}>
              Të reja: {result.created} · Të përditësuara: {result.updated}
              {result.errors.length > 0 && <>{'\n'}Gabime ({result.errors.length}):{'\n'}{result.errors.slice(0, 30).join('\n')}</>}
            </div>
          )}
        </Card>
        <Card title="2. Eksport drejt programit të faturimit">
          <p>Shitjet e regjistruara në SuperPool që presin faturë fiskale: <b>{pendingInvoices.data.length}</b></p>
          <button type="button" className="btn" disabled={!pendingInvoices.data.length} onClick={exportPending}>Shkarko listën (CSV)</button>
          <ul className="list-plain" style={{ marginTop: 12 }}>
            {pendingInvoices.data.slice(0, 15).map((i) => (
              <li key={i.id}><span style={{ flex: 1 }}>{i.saleNumber} · {i.clientName}</span><span className="muted">{date(i.date)}</span></li>
            ))}
          </ul>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Pas lëshimit të faturave, importoni "Faturat" me kolonën <code>saleNumber</code> që numrat fiskalë të lidhen automatikisht me shitjet dhe kartelat e klientëve.
          </p>
        </Card>
      </div>
    </>
  );
}
