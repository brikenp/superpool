import { addDoc, collection, serverTimestamp, writeBatch, doc } from 'firebase/firestore';
import { Download, FileSpreadsheet, Layers, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { POOL_TYPES } from '@shared/constants.js';
import { formulaError } from '@shared/formula.js';

import { DataTable } from '../../components/DataTable.jsx';
import { Badge, Modal, PageHeader, useAction } from '../../components/ui.jsx';
import { useCollection, useData } from '../../lib/data.jsx';
import { downloadTemplate, readTable } from '../../lib/export.js';
import { db } from '../../lib/firebase.js';
import { newKey } from '../../lib/offerCalc.js';
import { MODEL_IMPORT_COLUMNS, MODEL_IMPORT_SAMPLE, POOL_TEMPLATES, modelsFromRows } from '../../lib/poolTemplates.js';

const withKeys = (items) => items.map((it) => ({ markupPct: '', unitCost: '', unitPrice: '', productId: null, ...it, key: newKey() }));

/** Ruan modelet e reja (me çelës për çdo rresht). */
async function saveModels(models) {
  const batch = writeBatch(db);
  for (const m of models) {
    batch.set(doc(collection(db, 'poolModels')), {
      code: '', circulation: '', technicalText: '', filtration: '', length: 8, width: 4, depthMin: 1.2, depthMax: 1.6, active: true,
      ...m,
      items: withKeys(m.items),
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

export default function PoolModels() {
  const models = useCollection('poolModels');
  const { products } = useData();
  const navigate = useNavigate();
  const [run, busy] = useAction();
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const fileRef = useRef(null);

  const create = () => run(async () => {
    const ref = await addDoc(collection(db, 'poolModels'), {
      name: 'Model i ri', code: '', poolType: 'skimmer', circulation: 'Skimer', markupPct: 35, active: true,
      length: 8, width: 4, depthMin: 1.2, depthMax: 1.6, technicalText: '', items: [], createdAt: serverTimestamp(),
    });
    navigate(`/modelet/${ref.id}`);
  });

  const importFile = (file) => run(async () => {
    const rows = await readTable(file);
    const parsed = modelsFromRows(rows, products, formulaError);
    const existing = new Set(models.data.map((m) => m.name.trim().toLowerCase()));
    const dup = parsed.filter((m) => existing.has(m.name.trim().toLowerCase()));
    if (dup.length) throw new Error(`Këto modele ekzistojnë tashmë (ndryshoni emrin në Excel ose fshini modelin): ${dup.map((m) => m.name).join(', ')}`);
    await saveModels(parsed);
    return parsed;
  }, (parsed) => `U importuan ${parsed.length} modele me ${parsed.reduce((s, m) => s + m.items.length, 0)} rreshta.`);

  const template = () => run(() => downloadTemplate({
    filename: 'Modelet_e_pishinave.xlsx',
    sheetName: 'Modelet',
    columns: MODEL_IMPORT_COLUMNS,
    rows: MODEL_IMPORT_SAMPLE,
    notes: [
      'Çdo rresht është një material, pajisje ose shërbim i modelit. Rreshtat me të njëjtin "Modeli" bashkohen në një model.',
      'Formula llogarit sasinë nga përmasat: L gjatësia, W gjerësia, H1/H2 thellësia min/max, H mesatarja, A sipërfaqja e ujit (L×W), P perimetri, S sipërfaqja e brendshme, V vëllimi.',
      'Funksionet: ceil, floor, round, min, max, abs, sqrt, if(kusht, po, jo). Shembull: max(2, ceil(P / 8)).',
      'Nëse vendosni "Kodi i artikullit", kostoja dhe çmimi merren nga magazina.',
    ],
  }));

  return (
    <>
      <PageHeader
        title="Modelet e pishinave"
        subtitle="Biblioteka e modeleve: rregullat e përllogaritjes së materialeve, pajisjet standarde dhe çmimet."
        actions={(
          <>
            <button type="button" className="btn" onClick={() => setTemplatesOpen(true)}><Layers size={16} /> Modelet standarde</button>
            <button type="button" className="btn" onClick={template}><Download size={16} /> Shablloni Excel</button>
            <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}><FileSpreadsheet size={16} /> Importo nga Excel</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; }} />
            <button type="button" className="btn primary" disabled={busy} onClick={create}><Plus size={16} /> Model i ri</button>
          </>
        )}
      />
      {!models.loading && !models.data.length && (
        <div className="alert info">
          Biblioteka është bosh. Filloni me <b>Modelet standarde</b> (4 modele të gatshme me formula) dhe përshtatini, ose importoni modelet tuaja nga Excel.
        </div>
      )}
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
          { key: 'linked', label: 'Pa artikull', type: 'number', value: (m) => (m.items || []).filter((i) => !i.productId && i.section !== 'services').length },
          { key: 'markupPct', label: 'Marzhi %', type: 'number' },
          { key: 'active', label: '', render: (m) => (m.active === false ? <Badge>joaktiv</Badge> : null) },
        ]}
      />
      {templatesOpen && <TemplatesModal existing={models.data} onClose={() => setTemplatesOpen(false)} />}
    </>
  );
}

function TemplatesModal({ existing, onClose }) {
  const has = new Set(existing.map((m) => m.code).filter(Boolean));
  const [picked, setPicked] = useState(() => POOL_TEMPLATES.filter((t) => !has.has(t.code)).map((t) => t.code));
  const [run, busy] = useAction();
  const toggle = (code) => setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));
  const add = () => run(async () => {
    if (!picked.length) throw new Error('Zgjidhni të paktën një model.');
    await saveModels(POOL_TEMPLATES.filter((t) => picked.includes(t.code)));
    onClose();
  }, 'Modelet u shtuan. Hapni secilin dhe lidhni rreshtat me artikujt e magazinës për kostot dhe çmimet.');
  return (
    <Modal title="Modelet standarde" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Anulo</button><button type="button" className="btn primary" disabled={busy} onClick={add}>Shto modelet</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>
        Modele pikënisjeje me seksionet dhe formulat e sasive. Pas shtimit, hapni modelin dhe zgjidhni për çdo rresht artikullin e magazinës (kosto dhe çmimi merren prej tij) ose shkruani koston me dorë. Gjithçka mund të ndryshohet.
      </p>
      <div className="stack">
        {POOL_TEMPLATES.map((t) => (
          <label key={t.code} className="checkbox" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={picked.includes(t.code)} onChange={() => toggle(t.code)} />
            <span>
              <b>{t.name}</b> {has.has(t.code) && <Badge>ekziston</Badge>}
              <br /><small className="muted">{t.items.length} rreshta · {t.circulation} · shembull {t.length}×{t.width} m</small>
            </span>
          </label>
        ))}
      </div>
    </Modal>
  );
}
