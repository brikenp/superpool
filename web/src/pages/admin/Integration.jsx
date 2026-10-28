import { collection, query, where } from 'firebase/firestore';
import { useState } from 'react';

import { ImportPanel } from '../../components/ImportExcel.jsx';
import { Card, PageHeader, useAction } from '../../components/ui.jsx';
import { useData, useQuery } from '../../lib/data.jsx';
import { downloadCsv } from '../../lib/export.js';
import { uploadProductImage } from '../../lib/images.js';
import { db } from '../../lib/firebase.js';
import { FiscalSettings } from './FiscalSettings.jsx';
import { date } from '../../lib/format.js';

export default function Integration() {
  const pendingInvoices = useQuery(() => query(collection(db, 'invoices'), where('status', '==', 'pending_fiscal')), []);

  const exportPending = () => downloadCsv('shitje_per_faturim.csv', [
    { label: 'Nr. shitjes', value: (i) => i.saleNumber },
    { label: 'Data', value: (i) => i.date },
    { label: 'Klienti', value: (i) => i.clientName },
    { label: 'Vlera me TVSH', value: (i) => i.amount },
    { label: 'Nr. i brendshëm', value: (i) => i.internalNumber },
  ], pendingInvoices.data);

  return (
    <>
      <PageHeader
        title="Integrimi me programin e faturimit"
        subtitle="Fiskalizimi direkt me POS.AL dhe shkëmbimi i të dhënave me skedarë Excel/CSV."
      />
      <FiscalSettings />
      <div className="grid grid-2">
        <Card title="1. Import nga programi i faturimit / Excel">
          <ImportPanel type="products" />
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: 10 }}>Importi bëhet edhe direkt nga çdo seksion (Artikujt, Klientët, Furnitorët, Punonjësit…) me butonin «Import nga Excel».</p>
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
