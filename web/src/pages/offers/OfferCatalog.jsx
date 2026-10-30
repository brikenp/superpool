import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { ArrowDown, ArrowUp, Plus, Trash2, Upload, X } from 'lucide-react';
import { useState } from 'react';

import { FORMULA_VARIABLES, formulaError } from '@shared/formula.js';
import { UNITS } from '@shared/constants.js';

import { Badge, Card, Field, Modal, PageHeader, useAction, useUi } from '../../components/ui.jsx';
import { useCollection } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';
import { toNumber } from '../../lib/format.js';
import { MAX_CATALOG_PHOTOS, importCatalogFromExcel, removeCatalogPhoto, sortCatalog, uploadCatalogPhoto } from '../../lib/offerCatalog.js';
import { readOfferExcel } from '../../lib/offerImport.js';

/** Katalogu i ofertës: artikujt bazë (në çdo ofertë) dhe opsionalët, me përshkrim teknik dhe foto. */
export default function OfferCatalog() {
  const catalog = useCollection('offerCatalog');
  const { ask } = useUi();
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [run, busy] = useAction();
  const items = sortCatalog(catalog.data);
  const basic = items.filter((i) => i.basic);
  const optional = items.filter((i) => !i.basic);

  const move = (item, dir) => run(async () => {
    const list = item.basic ? basic : optional;
    const idx = list.findIndex((i) => i.id === item.id);
    const other = list[idx + dir];
    if (!other) return;
    await Promise.all([
      updateDoc(doc(db, 'offerCatalog', item.id), { order: toNumber(other.order) }),
      updateDoc(doc(db, 'offerCatalog', other.id), { order: toNumber(item.order) === toNumber(other.order) ? toNumber(item.order) + dir : toNumber(item.order) }),
    ]);
  });
  const remove = async (item) => {
    if (!(await ask({ title: 'Fshi nga katalogu', message: `«${item.title}» do të hiqet nga katalogu. Ofertat ekzistuese nuk ndryshojnë.`, danger: true, confirmLabel: 'Fshi' }))) return;
    run(async () => {
      for (const im of item.images || []) await removeCatalogPhoto(im.path);
      await deleteDoc(doc(db, 'offerCatalog', item.id));
    }, 'U fshi.');
  };

  const section = (title, list, hint) => (
    <Card title={`${title} (${list.length})`}>
      <p className="muted" style={{ marginTop: 0 }}>{hint}</p>
      <div className="catalog-list">
        {list.map((it, idx) => (
          <div key={it.id} className="catalog-item" onClick={() => setEditing(it)} role="button" tabIndex={0}>
            <div className="catalog-photos">
              {(it.images || []).slice(0, MAX_CATALOG_PHOTOS).map((im) => <img key={im.path} src={im.url} alt="" />)}
              {!(it.images || []).length && <span className="muted" style={{ fontSize: '0.8rem' }}>pa foto</span>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{it.title}</b>
              <div className="muted catalog-details">{it.details}</div>
            </div>
            <div className="r" style={{ whiteSpace: 'nowrap' }}>
              {it.formula ? <code title="Sasia me formulë">{it.formula}</code> : <span>{it.defaultQty}</span>} {UNITS[it.unit] || it.unit}
              {it.active === false && <div><Badge>joaktiv</Badge></div>}
            </div>
            <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
              <button type="button" className="icon-btn" disabled={busy || idx === 0} title="Lart" onClick={() => move(it, -1)}><ArrowUp size={15} /></button>
              <button type="button" className="icon-btn" disabled={busy || idx === list.length - 1} title="Poshtë" onClick={() => move(it, 1)}><ArrowDown size={15} /></button>
              <button type="button" className="icon-btn" disabled={busy} title="Fshi" onClick={() => remove(it)}><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
        {!list.length && <div className="muted">—</div>}
      </div>
    </Card>
  );

  return (
    <>
      <PageHeader
        title="Katalogu i ofertës"
        subtitle="Artikujt standardë të pishinës me përshkrim teknik dhe foto. Bazikët dalin vetë në çdo ofertë të re; opsionalët shtohen kur duhen."
        actions={(
          <>
            <button type="button" className="btn" onClick={() => setImporting(true)}><Upload size={16} /> Importo nga Excel</button>
            <button type="button" className="btn primary" onClick={() => setEditing({ basic: false, unit: 'cope', defaultQty: 1, active: true, images: [] })}><Plus size={16} /> Artikull</button>
          </>
        )}
      />
      {!items.length && !catalog.loading && (
        <div className="alert info">Katalogu është bosh. Klikoni «Importo nga Excel» dhe zgjidhni ofertën tuaj Excel (p.sh. OFERTE 8x4): artikujt me sasi bëhen bazë, ata me sasi 0 opsionalë, bashkë me përshkrimet dhe fotot.</div>
      )}
      {section('Artikujt bazë', basic, 'Dalin automatikisht në çdo ofertë të re, me këtë renditje, përshkrim dhe foto.')}
      {section('Artikujt opsionalë', optional, 'Shtohen në ofertë me butonin «Shto nga katalogu».')}
      {editing && <CatalogItemForm item={editing} nextOrder={(items.at(-1)?.order || 0) + 10} onClose={() => setEditing(null)} />}
      {importing && <CatalogImport existing={catalog.data} onClose={() => setImporting(false)} />}
    </>
  );
}

function CatalogItemForm({ item, nextOrder, onClose }) {
  const [v, setV] = useState(() => ({ title: '', details: '', unit: 'cope', defaultQty: 1, formula: '', basic: false, active: true, unitPrice: '', ...item, images: [...(item.images || [])] }));
  const [removed, setRemoved] = useState([]);
  const [newFiles, setNewFiles] = useState([]);
  const [run, busy] = useAction();
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));
  const fErr = v.formula ? formulaError(v.formula) : null;
  const save = () => run(async () => {
    if (!v.title.trim()) throw new Error('Shkruani titullin.');
    if (fErr) throw new Error(`Formula: ${fErr}`);
    const data = {
      title: v.title.trim(), details: v.details || '', unit: v.unit, defaultQty: toNumber(v.defaultQty) || 1, formula: (v.formula || '').trim(),
      basic: Boolean(v.basic), active: v.active !== false, unitPrice: toNumber(v.unitPrice), updatedAt: serverTimestamp(),
    };
    let id = item.id;
    if (id) await updateDoc(doc(db, 'offerCatalog', id), data);
    else id = (await addDoc(collection(db, 'offerCatalog'), { ...data, order: nextOrder, images: [], createdAt: serverTimestamp() })).id;
    for (const p of removed) await removeCatalogPhoto(p);
    const images = v.images.filter((im) => !removed.includes(im.path));
    for (const f of newFiles.slice(0, MAX_CATALOG_PHOTOS - images.length)) images.push(await uploadCatalogPhoto(id, f));
    await updateDoc(doc(db, 'offerCatalog', id), { images });
    onClose();
  }, 'Artikulli u ruajt.');
  const shown = v.images.filter((im) => !removed.includes(im.path));
  return (
    <Modal title={item.id ? 'Ndrysho artikullin e katalogut' : 'Artikull i ri në katalog'} onClose={onClose} wide
      footer={<><button type="button" className="btn" onClick={onClose}>Anulo</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Ruaj</button></>}>
      <div className="form-grid">
        <Field label="Titulli" required className="span-all"><input value={v.title} onChange={(e) => set('title', e.target.value)} placeholder="p.sh. FILTËR PISHINE ME QUARTZ" /></Field>
        <Field label="Përshkrimi teknik (del në ofertë)" className="span-all"><textarea rows={7} value={v.details} onChange={(e) => set('details', e.target.value)} /></Field>
        <Field label="Njësia">
          <select value={v.unit} onChange={(e) => set('unit', e.target.value)}>{Object.entries(UNITS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label="Sasia"><input className="num" type="number" step="any" value={v.defaultQty} onChange={(e) => set('defaultQty', e.target.value)} /></Field>
        <Field label="Sasia me formulë (opsionale)" hint={fErr ? <span className="text-danger">{fErr}</span> : `Sipas pishinës: ${Object.keys(FORMULA_VARIABLES).join(', ')} — p.sh. ceil(P / 6)`}>
          <input value={v.formula} onChange={(e) => set('formula', e.target.value)} placeholder="bosh = sasia fikse" />
        </Field>
        <Field label="Çmimi për njësi (opsional)"><input className="num" type="number" step="any" value={v.unitPrice} onChange={(e) => set('unitPrice', e.target.value)} /></Field>
        <Field className="span-all">
          <label className="checkbox"><input type="checkbox" checked={Boolean(v.basic)} onChange={(e) => set('basic', e.target.checked)} /> Artikull bazë — del vetë në çdo ofertë të re</label>
          <label className="checkbox"><input type="checkbox" checked={v.active !== false} onChange={(e) => set('active', e.target.checked)} /> Aktiv</label>
        </Field>
        <Field label={`Fotot (deri në ${MAX_CATALOG_PHOTOS})`} className="span-all">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {shown.map((im) => (
              <span key={im.path} className="catalog-photo-edit">
                <img src={im.url} alt="" />
                <button type="button" className="icon-btn" title="Hiq" onClick={() => setRemoved((r) => [...r, im.path])}><X size={14} /></button>
              </span>
            ))}
            {newFiles.map((f, k) => <span key={k} className="catalog-photo-edit"><img src={URL.createObjectURL(f)} alt="" /></span>)}
          </div>
          {shown.length + newFiles.length < MAX_CATALOG_PHOTOS && (
            <input type="file" accept="image/*" multiple style={{ marginTop: 6 }} onChange={(e) => setNewFiles((s) => [...s, ...e.target.files].slice(0, MAX_CATALOG_PHOTOS - shown.length))} />
          )}
        </Field>
      </div>
    </Modal>
  );
}

function CatalogImport({ existing, onClose }) {
  const [parsed, setParsed] = useState(null);
  const [progress, setProgress] = useState('');
  const [run, busy] = useAction();
  const load = (file) => run(async () => setParsed(await readOfferExcel(file)));
  const x = parsed?.offer;
  const start = () => run(async () => {
    const r = await importCatalogFromExcel(parsed, existing, { onProgress: setProgress });
    onClose();
    return r;
  }, (r) => `Katalogu u përditësua: ${r.created} të rinj, ${r.updated} të përditësuar, ${r.photos} foto.`);
  return (
    <Modal title="Mbush katalogun nga oferta Excel" onClose={busy ? undefined : onClose} wide
      footer={<><button type="button" className="btn" disabled={busy} onClick={onClose}>Anulo</button><button type="button" className="btn primary" disabled={busy || !x} onClick={start}>{busy && progress ? progress : 'Importo në katalog'}</button></>}>
      <Field label="Oferta Excel (.xlsx)" hint="Lexohet vetëm fleta e parë. Artikujt me sasi në Excel bëhen BAZË, ata me sasi 0 OPSIONALË. Artikujt me të njëjtin titull përditësohen.">
        <input type="file" accept=".xlsx" disabled={busy} onChange={(e) => e.target.files[0] && load(e.target.files[0])} />
      </Field>
      {busy && !x && <p className="muted">Duke lexuar skedarin…</p>}
      {x && (
        <div className="alert info"><div>
          Fleta: <b>{parsed.sheetName}</b> · {x.items.length} artikuj: <b>{x.items.filter((i) => i.qty > 0).length} bazë</b>, {x.items.filter((i) => !(i.qty > 0)).length} opsionalë
          {' '}· {Object.values(parsed.photos).reduce((s, l) => s + l.length, 0)} foto
        </div></div>
      )}
    </Modal>
  );
}
