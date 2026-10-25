import { collection, getDocs, query, where } from 'firebase/firestore';
import { FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';

import { Card, Field, PageHeader, useAction } from '../../components/ui.jsx';
import { useData, useQuery } from '../../lib/data.jsx';
import { downloadCsv, downloadTemplate, readTableWithImages } from '../../lib/export.js';
import { linkProductImage, uploadProductImage } from '../../lib/images.js';
import { call, db } from '../../lib/firebase.js';
import { date } from '../../lib/format.js';

// Kolonat e pranuara për çdo lloj importi (titujt në rreshtin e parë të skedarit).
// Pranohen edhe emrat shqip: kodi, emri, njesia, kategoria, furnitori, cmimi_blerjes, cmimi_shitjes, stoku_minimal, foto.
const UNIT_LIST = ['cope', 'm', 'm2', 'm3', 'kg', 'l', 'pako', 'set', 'rrotull', 'ore'];
const IMPORTS = {
  products: {
    label: 'Artikujt',
    sheet: 'Artikujt',
    columns: [
      { key: 'code', required: true, help: 'Kodi unik i artikullit (p.sh. TUB-50). Nëse ekziston, artikulli përditësohet.' },
      { key: 'name', required: true, width: 34, help: 'Emri i artikullit.' },
      { key: 'description', width: 34, help: 'Përshkrimi teknik.' },
      { key: 'brand', help: 'Marka.' },
      { key: 'model', help: 'Modeli.' },
      { key: 'unit', list: UNIT_LIST, help: `Njësia: ${UNIT_LIST.join(', ')}.` },
      { key: 'category', width: 18, help: 'Kategoria (krijohet nëse nuk ekziston). Kategoritë me "kimik" në emër shënohen si kimikate.' },
      { key: 'supplier', width: 22, help: 'Emri i furnitorit kryesor (duhet të ekzistojë te Furnitorët).' },
      { key: 'purchasePrice', help: 'Çmimi i blerjes (L, pa TVSH).' },
      { key: 'salePrice', help: 'Çmimi i shitjes (L, me TVSH).' },
      { key: 'minStock', help: 'Stoku minimal për listën e porosive.' },
      { key: 'image', width: 16, help: 'Fotoja: ngjitni foton në këtë qelizë (Insert → Pictures → Place in Cell) ose shkruani një link https://…' },
    ],
    sample: [
      { code: 'PMP-001', name: 'Pompë 1HP', unit: 'cope', category: 'Pompa', brand: 'Astral', purchasePrice: 25000, salePrice: 38000, minStock: 2 },
      { code: 'RAK-90-50', name: 'Bërryl 90° PVC 50mm', unit: 'cope', category: 'Rakorderi', purchasePrice: 120, salePrice: 250, minStock: 50 },
    ],
    photoColumn: true,
    notes: [
      'Fotot: në Excel zgjidhni qelizën e kolonës "image" të artikullit → Insert → Pictures → Place in Cell (ose "Place over Cells" mbi rreshtin e artikullit).',
      'Mund t\'i ngarkoni fotot edhe më vonë te "Foto sipas kodit", duke i emërtuar skedarët me kodin e artikullit.',
      'Fshini rreshtat shembull para importit.',
    ],
    help: 'Fotot mund t\'i vendosni direkt në qelizat e kolonës "image" (Insert → Pictures → Place in Cell), ose një link. Mund t\'i ngarkoni edhe më vonë te "Foto sipas kodit".',
  },
  openingStock: {
    label: 'Stoku fillestar',
    sheet: 'Stoku',
    columns: [
      { key: 'code', required: true, help: 'Kodi i artikullit (duhet të ekzistojë).' },
      { key: 'qty', required: true, help: 'Sasia në gjendje.' },
      { key: 'unitCost', help: 'Kosto për njësi (L). Vendos koston mesatare fillestare.' },
    ],
    sample: [{ code: 'PMP-001', qty: 5, unitCost: 25000 }],
    help: 'Krijon lëvizje rregullimi drejt magazinës së zgjedhur. Përdoret një herë në fillim.',
  },
  clients: {
    label: 'Klientët',
    sheet: 'Klientët',
    columns: [
      { key: 'name', required: true, width: 30, help: 'Emri / subjekti.' },
      { key: 'nipt', help: 'NIPT (për biznese). Përdoret për të gjetur klientët ekzistues.' },
      { key: 'phone', help: 'Telefoni.' },
      { key: 'email', width: 24, help: 'Email.' },
      { key: 'address', width: 30, help: 'Adresa.' },
      { key: 'city', help: 'Qyteti.' },
      { key: 'billingId', help: 'ID e klientit në programin e faturimit.' },
    ],
    sample: [{ name: 'Hotel Riviera', nipt: 'L12345678A', phone: '0691234567', city: 'Durrës' }],
  },
  suppliers: {
    label: 'Furnitorët',
    sheet: 'Furnitorët',
    columns: [
      { key: 'name', required: true, width: 30, help: 'Emri i furnitorit.' },
      { key: 'nipt', help: 'NIPT.' },
      { key: 'contactPerson', width: 20, help: 'Personi i kontaktit.' },
      { key: 'phone', help: 'Telefoni.' },
      { key: 'email', width: 24, help: 'Email.' },
      { key: 'address', width: 30, help: 'Adresa.' },
    ],
    sample: [{ name: 'Furnitori X', nipt: 'K00000000X', phone: '042123456' }],
  },
  invoices: {
    label: 'Faturat (nga programi i faturimit)',
    sheet: 'Faturat',
    columns: [
      { key: 'number', required: true, help: 'Numri fiskal i faturës.' },
      { key: 'date', required: true, help: 'Data (2026-10-01 ose 01.10.2026).' },
      { key: 'nipt', help: 'NIPT i klientit (ose plotësoni kolonën client).' },
      { key: 'client', width: 26, help: 'Emri i klientit, nëse nuk ka NIPT.' },
      { key: 'amount', required: true, help: 'Vlera me TVSH.' },
      { key: 'dueDate', help: 'Afati i pagesës.' },
      { key: 'saleNumber', width: 18, help: 'Nr. i shitjes në SuperPool (p.sh. SHT-2026-0012) për ta lidhur faturën me shitjen.' },
    ],
    sample: [{ number: 'ABC123/2026', date: '2026-10-01', nipt: 'L12345678A', amount: 12000, saleNumber: 'SHT-2026-0012' }],
    help: 'Nëse jepet saleNumber, numri fiskal lidhet automatikisht me shitjen përkatëse.',
  },
  payments: {
    label: 'Pagesat',
    sheet: 'Pagesat',
    columns: [
      { key: 'date', required: true, help: 'Data e pagesës.' },
      { key: 'amount', required: true, help: 'Shuma.' },
      { key: 'invoiceNumber', help: 'Nr. fiskal i faturës (ose plotësoni nipt / client).' },
      { key: 'nipt', help: 'NIPT i klientit.' },
      { key: 'client', width: 26, help: 'Emri i klientit.' },
      { key: 'method', list: ['cash', 'bank', 'card'], help: 'cash, bank ose card.' },
      { key: 'reference', width: 20, help: 'Referenca e pagesës.' },
    ],
    sample: [{ date: '2026-10-05', amount: 12000, invoiceNumber: 'ABC123/2026', method: 'bank' }],
  },
  fiscalStock: {
    label: 'Gjendja fiskale e magazinës',
    sheet: 'Gjendja fiskale',
    columns: [
      { key: 'code', required: true, help: 'Kodi i artikullit.' },
      { key: 'quantity', required: true, help: 'Sasia sipas programit të faturimit.' },
      { key: 'value', help: 'Vlera fiskale.' },
      { key: 'asOf', help: 'Data e gjendjes.' },
    ],
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
            Kolonat: {def.columns.map((c) => <code key={c.key} style={{ marginRight: 4 }}>{c.key}{c.required ? '*' : ''}</code>)}
            {def.help && <><br />{def.help}</>}
          </p>
          <button type="button" className="btn small" disabled={busy} onClick={() => run(() => downloadTemplate({
            filename: `SuperPool_${def.sheet}.xlsx`, sheetName: def.sheet, columns: def.columns, rows: def.sample, notes: def.notes, photoColumn: def.photoColumn,
          }))}
          ><FileSpreadsheet size={15} /> Shkarko modelin Excel</button>
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
