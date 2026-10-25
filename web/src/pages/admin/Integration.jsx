import { collection, getDocs, query, where } from 'firebase/firestore';
import { useState } from 'react';

import { Card, Field, PageHeader, useAction } from '../../components/ui.jsx';
import { useData, useQuery } from '../../lib/data.jsx';
import { downloadCsv, readTableWithImages } from '../../lib/export.js';
import { linkProductImage, uploadProductImage } from '../../lib/images.js';
import { call, db } from '../../lib/firebase.js';
import { date } from '../../lib/format.js';

// Kolonat e pranuara për çdo lloj importi (titujt në rreshtin e parë të skedarit).
const IMPORTS = {
  products: {
    label: 'Artikujt',
    columns: ['code / kodi*', 'name / emri*', 'description', 'brand', 'model', 'unit (cope, m, m2, kg, l…)', 'category', 'supplier', 'purchasePrice', 'salePrice', 'minStock', 'image / foto (link)'],
    sample: [{ code: 'PMP-001', name: 'Pompë 1HP', unit: 'cope', category: 'Pompa', supplier: 'Furnitori X', purchasePrice: 25000, salePrice: 38000, minStock: 2, image: 'https://…/pompe.jpg' }],
    help: 'Fotot: mund t\'i vendosni direkt në qelizat e Excel-it (Insert → Picture → Place in cell / mbi rreshtin e artikullit), ose një link te kolona "image". Mund t\'i ngarkoni edhe më vonë te "Foto sipas kodit".',
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
  const [images, setImages] = useState({});
  const [photoProgress, setPhotoProgress] = useState('');
  const [fileName, setFileName] = useState('');
  const [locationId, setLocationId] = useState('main');
  const [result, setResult] = useState(null);
  const [run, busy] = useAction();
  const def = IMPORTS[type];
  const pendingInvoices = useQuery(() => query(collection(db, 'invoices'), where('status', '==', 'pending_fiscal')), []);

  const load = (file) => run(async () => {
    setResult(null);
    setFileName(file.name);
    const table = await readTableWithImages(file);
    setRows(table.rows);
    setImages(table.images);
  });
  const submit = () => run(async () => {
    const res = await call('importData', { type, rows, options: { locationId } });
    if (type === 'products') res.photos = await attachPhotos(rows, images, setPhotoProgress);
    setResult(res);
    setRows(null);
    setImages({});
    return res;
  }, (r) => `Importi përfundoi: ${r.created} të reja, ${r.updated} të përditësuara${r.photos ? `, ${r.photos.done} foto` : ''}.`);

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
              <div className="alert info">
                {fileName}: {rows.length} rreshta. Kolonat e gjetura: {headers.join(', ')}
                {type === 'products' && `\nFoto të gjetura në skedar: ${Object.keys(images).length}; me link: ${rows.filter((r) => imageLinkOf(r)).length}`}
              </div>
              <div className="table-wrap" style={{ maxHeight: 260 }}>
                <table className="table">
                  <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{rows.slice(0, 10).map((r, i) => <tr key={i}>{headers.map((h) => <td key={h}>{String(r[h] ?? '')}</td>)}</tr>)}</tbody>
                </table>
              </div>
              <button type="button" className="btn primary" style={{ marginTop: 10 }} disabled={busy} onClick={submit}>Importo {rows.length} rreshta</button>
            </div>
          )}
          {photoProgress && busy && <div className="alert info" style={{ marginTop: 12 }}>{photoProgress}</div>}
          {result && (
            <div className={`alert ${result.errors.length ? 'warn' : 'ok'}`} style={{ marginTop: 12 }}>
              Të reja: {result.created} · Të përditësuara: {result.updated}
              {result.photos && ` · Foto: ${result.photos.done}${result.photos.failed.length ? ` (${result.photos.failed.length} dështuan: ${result.photos.failed.slice(0, 10).join(', ')})` : ''}`}
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
        <PhotosByCode />
      </div>
    </>
  );
}

const codeOf = (r) => String(r.code ?? r.kodi ?? r.Kodi ?? r.Code ?? '').trim();
const imageLinkOf = (r) => {
  const v = String(r.image ?? r.foto ?? r.Foto ?? r.Image ?? r.imageUrl ?? '').trim();
  return /^https?:\/\//i.test(v) ? v : '';
};

async function productIdsByCode(codes) {
  const out = {};
  const unique = [...new Set(codes.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 30) {
    const snap = await getDocs(query(collection(db, 'products'), where('code', 'in', unique.slice(i, i + 30))));
    snap.forEach((d) => { out[d.get('code')] = d.id; });
  }
  return out;
}

/** Pas importit të artikujve: ngarkon fotot e futura në Excel ose lidh linket e kolonës "image". */
async function attachPhotos(rows, images, setProgress) {
  const jobs = rows.map((r, i) => ({ code: codeOf(r), image: images[i], link: imageLinkOf(r) })).filter((j) => j.code && (j.image || j.link));
  const result = { done: 0, failed: [] };
  if (!jobs.length) return result;
  const ids = await productIdsByCode(jobs.map((j) => j.code));
  for (const [n, j] of jobs.entries()) {
    setProgress(`Duke ngarkuar fotot: ${n + 1} / ${jobs.length}…`);
    const id = ids[j.code];
    try {
      if (!id) throw new Error('artikulli nuk u gjet');
      if (j.image) await uploadProductImage(id, j.image.buffer, `image/${j.image.extension === 'jpg' ? 'jpeg' : j.image.extension}`);
      else await linkProductImage(id, j.link);
      result.done += 1;
    } catch (err) {
      console.error(j.code, err);
      result.failed.push(j.code);
    }
  }
  setProgress('');
  return result;
}

/** Ngarkim i shumë fotove njëherësh: emri i skedarit = kodi i artikullit (p.sh. TUB-50.jpg). */
function PhotosByCode() {
  const { products } = useData();
  const [report, setReport] = useState(null);
  const [progress, setProgress] = useState('');
  const [run, busy] = useAction();
  const byCode = Object.fromEntries(products.map((p) => [String(p.code).trim().toLowerCase(), p]));

  const upload = (files) => run(async () => {
    const list = [...files];
    const done = [];
    const missing = [];
    for (const [n, f] of list.entries()) {
      setProgress(`Duke ngarkuar ${n + 1} / ${list.length}: ${f.name}`);
      const base = f.name.replace(/\.[^.]+$/, '').trim().toLowerCase();
      // Pranohet edhe "KODI (1).jpg" ose "KODI_1.jpg" kur kodi i plotë nuk gjendet.
      const product = byCode[base] || byCode[base.replace(/\s*\(\d+\)$/, '')] || byCode[base.replace(/[_ ]\d+$/, '')];
      if (!product) { missing.push(f.name); continue; }
      try {
        await uploadProductImage(product.id, f);
        done.push(product.code);
      } catch (err) {
        console.error(err);
        missing.push(`${f.name} (${err.message})`);
      }
    }
    setProgress('');
    setReport({ done, missing });
  }, 'Ngarkimi i fotove përfundoi.');

  return (
    <Card title="3. Foto sipas kodit të artikullit">
      <p className="muted" style={{ marginTop: 0 }}>
        Emërtoni çdo foto me kodin e artikullit, p.sh. <code>TUB-50.jpg</code>, <code>RAK-90-50.png</code>, dhe zgjidhini të gjitha njëherësh.
        Fotot zvogëlohen automatikisht; nëse artikulli ka foto, zëvendësohet.
      </p>
      <input type="file" accept="image/*" multiple disabled={busy} onChange={(e) => e.target.files.length && upload(e.target.files)} />
      {progress && <div className="alert info" style={{ marginTop: 12 }}>{progress}</div>}
      {report && (
        <div className={`alert ${report.missing.length ? 'warn' : 'ok'}`} style={{ marginTop: 12 }}>
          U ngarkuan: {report.done.length}
          {report.missing.length > 0 && `\nPa artikull me këtë kod (${report.missing.length}): ${report.missing.slice(0, 30).join(', ')}`}
        </div>
      )}
    </Card>
  );
}
