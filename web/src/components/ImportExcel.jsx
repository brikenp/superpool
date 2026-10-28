// Importi nga Excel/CSV: i njëjti panel te Integrimi dhe te çdo seksion (Artikujt, Klientët, Furnitorët…).

import { collection, getDocs, query, where } from 'firebase/firestore';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useState } from 'react';

import { CAPS } from '@shared/roles.js';

import { useAuth } from '../lib/auth.jsx';
import { useData } from '../lib/data.jsx';
import { downloadTemplate, readTableWithImages } from '../lib/export.js';
import { call, db } from '../lib/firebase.js';
import { toNumber } from '../lib/format.js';
import { linkProductImage, uploadProductImage } from '../lib/images.js';
import { Field, Modal, useAction } from './ui.jsx';

// Kolonat e pranuara për çdo lloj importi (titujt në rreshtin e parë të skedarit).
// Pranohen edhe emrat shqip: kodi, emri, njesia, kategoria, furnitori, cmimi_blerjes, cmimi_shitjes, stoku_minimal, foto.
const UNIT_LIST = ['cope', 'm', 'm2', 'm3', 'kg', 'l', 'pako', 'set', 'rrotull', 'ore'];
export const IMPORTS = {
  products: {
    caps: [CAPS.INVENTORY_MANAGE],
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
      { key: 'supplier', width: 22, help: 'Emri i furnitorit kryesor. Nëse nuk ekziston te Furnitorët, krijohet automatikisht.' },
      { key: 'purchasePrice', help: 'Çmimi i blerjes (pa TVSH), në monedhën e kolonës purchaseCurrency.' },
      { key: 'purchaseCurrency', list: ['ALL', 'EUR'], help: 'Monedha e çmimit të blerjes: ALL (lekë) ose EUR. Bosh = ALL.' },
      { key: 'salePrice', help: 'Çmimi i shitjes (me TVSH), në monedhën e kolonës saleCurrency.' },
      { key: 'saleCurrency', list: ['ALL', 'EUR'], help: 'Monedha e çmimit të shitjes: ALL (lekë) ose EUR. Bosh = ALL.' },
      { key: 'qty', help: 'Gjendja fillestare (sasia që keni). Shtohet te magazina e zgjedhur vetëm nëse artikulli nuk ka ende stok; vlerësohet me çmimin e blerjes.' },
      { key: 'minStock', help: 'Stoku minimal për listën e porosive.' },
      { key: 'image', width: 16, help: 'Fotoja: ngjitni foton në këtë qelizë (Insert → Pictures → Place in Cell) ose shkruani një link https://…' },
    ],
    sample: [
      { code: 'PMP-001', name: 'Pompë 1HP', unit: 'cope', category: 'Pompa', brand: 'Astral', purchasePrice: 250, purchaseCurrency: 'EUR', salePrice: 380, saleCurrency: 'EUR', qty: 4, minStock: 2 },
      { code: 'RAK-90-50', name: 'Bërryl 90° PVC 50mm', unit: 'cope', category: 'Rakorderi', purchasePrice: 120, purchaseCurrency: 'ALL', salePrice: 250, saleCurrency: 'ALL', qty: 120, minStock: 50 },
      { code: 'FLT-600', name: 'Filtër rëre 600mm', unit: 'cope', category: 'Filtra', purchasePrice: 180, purchaseCurrency: 'EUR', salePrice: 32000, saleCurrency: 'ALL', minStock: 1 },
    ],
    photoColumn: true,
    notes: [
      'Fotot: në Excel zgjidhni qelizën e kolonës "image" të artikullit → Insert → Pictures → Place in Cell (ose "Place over Cells" mbi rreshtin e artikullit).',
      'Mund t\'i ngarkoni fotot edhe më vonë te "Foto sipas kodit", duke i emërtuar skedarët me kodin e artikullit.',
      'Çmimet: çdo artikull mund ta ketë blerjen dhe shitjen në lekë (ALL) ose në euro (EUR). Çmimet në euro ruhen në euro dhe përdoren direkt te ofertat/faturat në euro; në lekë kthehen me kursin e euros.',
      'Gjendja (qty): krijon një fletë rregullimi "Stok fillestar" te magazina e zgjedhur. Artikujt që kanë tashmë stok nuk ndryshohen — për ta korrigjoni përdorni inventarizimin.',
      'Fshini rreshtat shembull para importit.',
    ],
    help: 'Kolona qty vendos gjendjen fillestare. Fotot mund t\'i vendosni direkt në qelizat e kolonës "image" (Insert → Pictures → Place in Cell), ose një link. Mund t\'i ngarkoni edhe më vonë te "Foto sipas kodit".',
  },
  openingStock: {
    caps: [CAPS.INVENTORY_MANAGE],
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
    caps: [CAPS.CLIENTS_MANAGE, CAPS.FINANCE],
    label: 'Klientët',
    sheet: 'Klientët',
    columns: [
      { key: 'name', required: true, width: 30, help: 'Emri / subjekti.' },
      { key: 'tradeName', width: 24, help: 'Emri tregtar (p.sh. emri i hotelit ose dyqanit).' },
      { key: 'nipt', help: 'NIPT (për biznese). Përdoret për të gjetur klientët ekzistues.' },
      { key: 'phone', help: 'Telefoni.' },
      { key: 'email', width: 24, help: 'Email.' },
      { key: 'address', width: 30, help: 'Adresa.' },
      { key: 'city', help: 'Qyteti.' },
      { key: 'billingId', help: 'ID e klientit në programin e faturimit.' },
    ],
    sample: [{ name: 'Riviera Sh.p.k.', tradeName: 'Hotel Riviera', nipt: 'L12345678A', phone: '0691234567', city: 'Durrës' }],
  },
  clientBalances: {
    caps: [CAPS.FINANCE],
    label: 'Gjendjet fillestare të klientëve',
    sheet: 'Gjendjet',
    columns: [
      { key: 'client', width: 30, help: 'Emri, emri tregtar ose NIPT-i i klientit. Nëse nuk ekziston, klienti krijohet.' },
      { key: 'nipt', help: 'NIPT (opsional, për gjetjen e saktë të klientit).' },
      { key: 'amount', required: true, help: 'Gjendja: pozitive = klienti na detyrohet; negative = klienti ka paguar më shumë (parapagim).' },
      { key: 'currency', list: ['ALL', 'EUR'], help: 'Monedha: ALL ose EUR. Bosh = ALL.' },
      { key: 'exchangeRate', help: 'Kursi i euros (për EUR). Bosh = kursi te Cilësimet.' },
      { key: 'date', help: 'Data e gjendjes (p.sh. 01.01.2026).' },
      { key: 'notes', width: 30, help: 'Shënime.' },
    ],
    sample: [
      { client: 'Hotel Riviera', nipt: 'L12345678A', amount: 250000, currency: 'ALL', date: '01.01.2026', notes: 'Detyrim i mbartur' },
      { client: 'Vila Golem', amount: 1500, currency: 'EUR', exchangeRate: 98, date: '01.01.2026' },
      { client: 'Arben Hoxha', amount: -20000, currency: 'ALL', date: '01.01.2026', notes: 'Parapagim' },
    ],
    notes: [
      'Çdo klient ka vetëm një gjendje fillestare; klientët që e kanë nuk ndryshohen (ndryshojeni te Financa → Kartela e klientit).',
      'Likujdimet e mëvonshme regjistrohen si pagesa dhe zbresin nga kjo gjendje te kartela e klientit.',
      'Fshini rreshtat shembull para importit.',
    ],
    help: 'Pozitive = klienti na detyrohet, negative = parapagim. Shfaqen te Financa → Kartela e klientit dhe te Detyrimet.',
  },
  suppliers: {
    caps: [CAPS.SUPPLIERS],
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
    caps: [CAPS.FINANCE],
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
    caps: [CAPS.FINANCE],
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
    caps: [CAPS.INVENTORY_MANAGE],
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
  employees: {
    caps: [CAPS.FLEET],
    label: 'Punonjësit',
    sheet: 'Punonjësit',
    columns: [
      { key: 'name', required: true, width: 26, help: 'Emri e mbiemri. Nëse ekziston, punonjësi përditësohet.' },
      { key: 'position', width: 18, help: 'Pozicioni (p.sh. Teknik, Shofer).' },
      { key: 'phone', help: 'Telefoni.' },
      { key: 'hourlyCost', help: 'Kosto për orë pune (L).' },
      { key: 'active', list: ['po', 'jo'], help: 'Aktiv: po / jo. Bosh = po.' },
    ],
    sample: [{ name: 'Arben Hoxha', position: 'Teknik', phone: '0691234567', hourlyCost: 600, active: 'po' }],
  },
  vehicles: {
    caps: [CAPS.FLEET],
    label: 'Automjetet',
    sheet: 'Automjetet',
    columns: [
      { key: 'plate', required: true, help: 'Targa (p.sh. AA123BB). Nëse ekziston, automjeti përditësohet.' },
      { key: 'description', width: 26, help: 'Marka, modeli.' },
      { key: 'responsible', width: 22, help: 'Emri i punonjësit përgjegjës (duhet të ekzistojë te Punonjësit).' },
      { key: 'active', list: ['po', 'jo'], help: 'Aktiv: po / jo. Bosh = po.' },
    ],
    sample: [{ plate: 'AA123BB', description: 'Fiat Doblo', responsible: 'Arben Hoxha', active: 'po' }],
    help: 'Çdo automjet merr nënmagazinën e vet automatikisht.',
  },
};

export const codeOf = (r) => String(r.code ?? r.kodi ?? r.Kodi ?? r.Code ?? '').trim();
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
export async function attachPhotos(rows, images, setProgress) {
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


const summary = (r) => [
  `${r.created} të reja`, `${r.updated} të përditësuara`,
  r.stock && `gjendje për ${r.stock} artikuj`, r.balances && `${r.balances} gjendje fillestare`,
  r.suppliers && `${r.suppliers} furnitorë të rinj`, r.photos && `${r.photos.done} foto`,
].filter(Boolean).join(', ');

/** Llojet e importit që përdoruesi mund të bëjë (Integrimi i sheh të gjitha). */
export function useImportTypes() {
  const { can } = useAuth();
  return Object.keys(IMPORTS).filter((k) => can(CAPS.INTEGRATION, ...IMPORTS[k].caps));
}

/** Paneli i importit: modeli Excel, zgjedhja e skedarit, parapamja dhe rezultati. */
export function ImportPanel({ type: initialType = 'products', fixed = false, onDone }) {
  const { locations, company } = useData();
  const types = useImportTypes();
  const [type, setType] = useState(initialType);
  const [eurRate, setEurRate] = useState('');
  const [rows, setRows] = useState(null);
  const [images, setImages] = useState({});
  const [photoProgress, setPhotoProgress] = useState('');
  const [fileName, setFileName] = useState('');
  const [locationId, setLocationId] = useState('main');
  const [result, setResult] = useState(null);
  const [run, busy] = useAction();
  const def = IMPORTS[type];

  const load = (file) => run(async () => {
    setResult(null);
    setFileName(file.name);
    const table = await readTableWithImages(file);
    setRows(table.rows);
    setImages(table.images);
  });
  const submit = () => run(async () => {
    const res = await call('importData', { type, rows, options: { locationId, eurRate: toNumber(eurRate || company.eurRate) } });
    if (type === 'products') res.photos = await attachPhotos(rows, images, setPhotoProgress);
    setResult(res);
    setRows(null);
    setImages({});
    onDone?.(res);
    return res;
  }, (r) => `Importi përfundoi: ${summary(r)}.`);

  const headers = rows?.length ? Object.keys(rows[0]) : [];

  return (
    <>
      <div className="form-grid">
        {!fixed && (
          <Field label="Lloji i të dhënave">
            <select value={type} onChange={(e) => { setType(e.target.value); setRows(null); setResult(null); }}>
              {types.map((k) => <option key={k} value={k}>{IMPORTS[k].label}</option>)}
            </select>
          </Field>
        )}
        {(type === 'openingStock' || type === 'products') && (
          <Field label="Magazina" hint={type === 'products' ? 'Ku shtohet gjendja fillestare (kolona qty).' : undefined}>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.filter((l) => ['main', 'agent'].includes(l.kind)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
        )}
        {(type === 'products' || type === 'clientBalances') && (
          <Field label="Kursi i euros (L për 1 €)" hint="Për vlerat në EUR: vlera në lekë = shuma në euro × kursi.">
            <input className="num" type="number" step="any" value={eurRate} placeholder={company.eurRate ? String(company.eurRate) : 'p.sh. 98'} onChange={(e) => setEurRate(e.target.value)} />
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
          {summary(result)}
          {result.photos?.failed.length > 0 && ` (${result.photos.failed.length} foto dështuan: ${result.photos.failed.slice(0, 10).join(', ')})`}
          {result.errors.length > 0 && <>{'\n'}Gabime ({result.errors.length}):{'\n'}{result.errors.slice(0, 30).join('\n')}</>}
        </div>
      )}
    </>
  );
}

/** Butoni "Import nga Excel" për faqet e seksioneve; shfaqet vetëm për ata që kanë të drejtë. */
export function ImportButton({ type, label = 'Import nga Excel', className = 'btn' }) {
  const types = useImportTypes();
  const [open, setOpen] = useState(false);
  if (!types.includes(type)) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}><Upload size={16} /> {label}</button>
      {open && (
        <Modal title={`Import nga Excel · ${IMPORTS[type].label}`} onClose={() => setOpen(false)} wide
          footer={<button type="button" className="btn" onClick={() => setOpen(false)}>Mbyll</button>}>
          <ImportPanel type={type} fixed />
        </Modal>
      )}
    </>
  );
}
