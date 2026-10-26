// Modelet standarde të pishinave (pikënisje). Sasitë llogariten me formula nga përmasat:
// L gjatësia, W gjerësia, H1/H2 thellësia min/max, H mesatarja, A sipërfaqja e ujit, P perimetri,
// S sipërfaqja e brendshme (fund + mure), V vëllimi.
// Rreshtat nuk kanë kosto: lidhen me artikujt e magazinës nga redaktori i modelit (ose me "Kodi" në Excel).

import { POOL_SECTIONS, UNITS } from '@shared/constants.js';

const row = (section, description, unit, formula, extra = {}) => ({ section, description, unit, formula, showOnClient: true, ...extra });

const STRUCTURE = [
  row('structure', 'Gërmim dhe largim dheu', 'm3', 'ceil((L + 1) * (W + 1) * (H2 + 0.3))'),
  row('structure', 'Beton C25/30 për fundin dhe muret', 'm3', 'round(A * 0.2 + P * H * 0.2, 1)'),
  row('structure', 'Hekur armature B500', 'kg', 'ceil((A + P * H) * 25)'),
  row('structure', 'Kallëpe dhe punime betoni', 'm2', 'ceil(P * H * 2)'),
];

const PIPING = [
  row('piping', 'Tub PVC presioni Ø50', 'm', 'ceil(P * 2 + 15)'),
  row('piping', 'Tub PVC presioni Ø63', 'm', 'ceil(P + 10)'),
  row('piping', 'Bërryl PVC 90° Ø50', 'cope', 'ceil(P / 2) + 10'),
  row('piping', 'Rakord T PVC Ø50', 'cope', 'ceil(P / 6) + 4'),
  row('piping', 'Valvul sferike PVC Ø50', 'cope', '6'),
  row('piping', 'Ngjitës PVC dhe pastrues', 'l', 'ceil(V / 40) + 1'),
];

const FILTRATION = [
  row('filtration', 'Filtër rëre', 'cope', 'if(V > 70, 2, 1)'),
  row('filtration', 'Rërë kuarci për filtrin (thasë 25 kg)', 'pako', 'ceil(V / 30) * 2'),
  row('filtration', 'Pompë qarkullimi me parafiltër', 'cope', 'if(V > 70, 2, 1)'),
  row('filtration', 'Valvul shumëpozicionëshe', 'cope', 'if(V > 70, 2, 1)'),
];

const DOSING = [
  row('dosing', 'Dozues automatik pH / klor (Redox)', 'cope', '1'),
  row('dosing', 'Kimikate fillestare (pH, klor, flokulant)', 'set', '1'),
];

const LIGHTING = [
  row('lighting', 'Prozhektor LED nënujor', 'cope', 'max(2, ceil(P / 8))'),
  row('lighting', 'Transformator për ndriçimin', 'cope', '1'),
  row('lighting', 'Kabëll elektrik nënujor', 'm', 'ceil(P * 1.5 + 20)'),
];

const FINISH = [
  row('finish', 'Hidroizolim çimentoje elastik', 'kg', 'ceil(S * 3)'),
  row('finish', 'Mozaik / pllaka pishine', 'm2', 'ceil(S * 1.08)'),
  row('finish', 'Kollë dhe fugë për pishina', 'kg', 'ceil(S * 5)'),
  row('finish', 'Bordurë guri / kurorë', 'm', 'ceil(P + 1)'),
];

const ELECTRICAL = [
  row('electrical', 'Kuadër elektrik i pishinës me kohëmatës', 'cope', '1'),
  row('electrical', 'Kabllo dhe aksesorë elektrikë', 'set', '1'),
];

const ASSEMBLY = [
  row('assembly', 'Materiale montimi (fasheta, bulona, silikon)', 'set', '1'),
];

const SERVICES = [
  row('services', 'Punë montimi hidraulik dhe pajisjesh', 'ore', 'ceil(40 + A * 1.5)'),
  row('services', 'Transport dhe vendosje në punë', 'set', '1'),
  row('services', 'Mbushje, vënie në punë dhe trajnim', 'set', '1'),
];

export const POOL_TEMPLATES = [
  {
    code: 'SKM', name: 'Pishinë betoni me skimer', poolType: 'skimmer', circulation: 'Skimer',
    length: 8, width: 4, depthMin: 1.2, depthMax: 1.6, markupPct: 35,
    technicalText: 'Pishinë prej betoni të armuar me sistem qarkullimi me skimer, hidroizolim elastik dhe veshje me mozaik.',
    filtration: 'Filtrim me rërë kuarci, pompë qarkullimi me parafiltër, dozim automatik i pH dhe klorit.',
    items: [
      ...STRUCTURE, ...PIPING,
      row('inlets', 'Skimer me derë lundruese', 'cope', 'max(1, ceil(A / 25))'),
      row('inlets', 'Grykë kthimi në mur', 'cope', 'max(2, ceil(A / 12))'),
      row('inlets', 'Pastrues fundi (main drain)', 'cope', 'if(H2 > 1.6, 2, 1)'),
      row('inlets', 'Prizë për fshesën e pishinës', 'cope', '1'),
      ...FILTRATION, ...DOSING, ...LIGHTING, ...FINISH, ...ELECTRICAL, ...ASSEMBLY, ...SERVICES,
    ],
  },
  {
    code: 'OVF', name: 'Pishinë betoni me tejderdhje (overflow)', poolType: 'overflow', circulation: 'Tejderdhje me rezervuar balancimi',
    length: 10, width: 5, depthMin: 1.2, depthMax: 1.6, markupPct: 35,
    technicalText: 'Pishinë prej betoni të armuar me tejderdhje rreth e rrotull, kanal me grilë dhe rezervuar balancimi.',
    filtration: 'Filtrim me rërë kuarci, rezervuar balancimi me sensor niveli, dozim automatik i pH dhe klorit.',
    items: [
      ...STRUCTURE, ...PIPING,
      row('inlets', 'Kanal tejderdhjeje me grilë', 'm', 'ceil(P)'),
      row('inlets', 'Grykë kthimi në fund', 'cope', 'max(3, ceil(A / 10))'),
      row('inlets', 'Pastrues fundi (main drain)', 'cope', 'if(H2 > 1.6, 2, 1)'),
      row('inlets', 'Rezervuar balancimi', 'm3', 'ceil(V * 0.05 + 1)'),
      row('inlets', 'Sensor niveli dhe valvul mbushjeje automatike', 'set', '1'),
      ...FILTRATION, ...DOSING, ...LIGHTING, ...FINISH, ...ELECTRICAL, ...ASSEMBLY, ...SERVICES,
    ],
  },
  {
    code: 'INF', name: 'Pishinë infinity', poolType: 'infinity', circulation: 'Buzë infinity me kanal mbledhës',
    length: 10, width: 4, depthMin: 1.3, depthMax: 1.6, markupPct: 40,
    technicalText: 'Pishinë prej betoni të armuar me një buzë infinity, kanal mbledhës poshtë buzës dhe rezervuar balancimi.',
    filtration: 'Filtrim me rërë kuarci, pompë e dedikuar për buzën infinity, dozim automatik i pH dhe klorit.',
    items: [
      ...STRUCTURE, ...PIPING,
      row('inlets', 'Buzë infinity (punim dhe profil)', 'm', 'ceil(L)'),
      row('inlets', 'Kanal mbledhës nën buzën infinity', 'm', 'ceil(L + 1)'),
      row('inlets', 'Rezervuar balancimi', 'm3', 'ceil(V * 0.06 + 1)'),
      row('inlets', 'Grykë kthimi në mur', 'cope', 'max(3, ceil(A / 10))'),
      row('inlets', 'Pastrues fundi (main drain)', 'cope', 'if(H2 > 1.6, 2, 1)'),
      row('filtration', 'Pompë shtesë për buzën infinity', 'cope', '1'),
      ...FILTRATION, ...DOSING, ...LIGHTING, ...FINISH, ...ELECTRICAL, ...ASSEMBLY, ...SERVICES,
    ],
  },
  {
    code: 'PRF', name: 'Pishinë e parafabrikuar', poolType: 'prefabricated', circulation: 'Skimer',
    length: 7, width: 3.5, depthMin: 1.5, depthMax: 1.5, markupPct: 30,
    technicalText: 'Pishinë e parafabrikuar e vendosur mbi bazament betoni, me sistem qarkullimi me skimer.',
    filtration: 'Filtrim me rërë kuarci dhe pompë qarkullimi, dozim i pH dhe klorit.',
    items: [
      row('structure', 'Trupi i pishinës së parafabrikuar', 'cope', '1'),
      row('structure', 'Gërmim dhe largim dheu', 'm3', 'ceil((L + 1) * (W + 1) * (H2 + 0.3))'),
      row('structure', 'Bazament beton', 'm3', 'round(A * 0.15, 1)'),
      row('structure', 'Mbushje anësore me zhavorr / beton të dobët', 'm3', 'round(P * H * 0.3, 1)'),
      row('piping', 'Tub PVC presioni Ø50', 'm', 'ceil(P + 10)'),
      row('piping', 'Rakorderi PVC Ø50 (bërryla, T, valvula)', 'set', '1'),
      row('inlets', 'Skimer', 'cope', '1'),
      row('inlets', 'Grykë kthimi', 'cope', '2'),
      ...FILTRATION, ...DOSING,
      row('lighting', 'Prozhektor LED nënujor', 'cope', '2'),
      row('lighting', 'Transformator për ndriçimin', 'cope', '1'),
      row('finish', 'Bordurë guri / kurorë', 'm', 'ceil(P + 1)'),
      ...ELECTRICAL, ...ASSEMBLY,
      row('services', 'Vendosje me vinç dhe montim', 'set', '1'),
      row('services', 'Punë montimi hidraulik', 'ore', 'ceil(24 + A)'),
    ],
  },
];

// --- Importi nga Excel ---

export const MODEL_IMPORT_COLUMNS = [
  { key: 'Modeli', required: true, width: 30, help: 'Emri i modelit. Të gjithë rreshtat me të njëjtin emër formojnë një model.' },
  { key: 'Lloji', width: 18, list: ['skimmer', 'overflow', 'infinity', 'prefabricated', 'other'], help: 'skimmer, overflow, infinity, prefabricated ose other (vetëm në rreshtin e parë të modelit).' },
  { key: 'Seksioni', required: true, width: 22, list: Object.keys(POOL_SECTIONS), help: `Një nga: ${Object.entries(POOL_SECTIONS).map(([k, l]) => `${k} (${l})`).join(', ')}. Pranohet edhe emri shqip.` },
  { key: 'Kodi i artikullit', width: 18, help: 'Kodi i artikullit në magazinë. Nëse gjendet, rreshti lidhet me artikullin (kosto dhe çmim nga magazina).' },
  { key: 'Përshkrimi', width: 40, help: 'E detyrueshme nëse nuk ka kod artikulli (p.sh. shërbime).' },
  { key: 'Njësia', width: 10, list: Object.keys(UNITS), help: `Një nga: ${Object.keys(UNITS).join(', ')}.` },
  { key: 'Formula', required: true, width: 30, help: 'Sasia: numër ose formulë me L, W, H1, H2, H, A, P, S, V. P.sh. ceil(P * 2 + 15).' },
  { key: 'Kosto', width: 12, help: 'Kosto për njësi (vetëm për rreshtat pa artikull).' },
  { key: 'Çmimi', width: 12, help: 'Çmimi i shitjes për njësi (bosh = kosto + marzhi).' },
  { key: 'Te klienti', width: 12, list: ['Po', 'Jo'], help: 'Po = shfaqet në ofertën e klientit.' },
  { key: 'Marzhi %', width: 10, help: 'Marzhi standard i modelit (vetëm në rreshtin e parë).' },
];

export const MODEL_IMPORT_SAMPLE = POOL_TEMPLATES[0].items.slice(0, 6).map((it, i) => ({
  Modeli: POOL_TEMPLATES[0].name,
  Lloji: i === 0 ? 'skimmer' : '',
  Seksioni: it.section,
  'Kodi i artikullit': '',
  Përshkrimi: it.description,
  Njësia: it.unit,
  Formula: it.formula,
  Kosto: '',
  Çmimi: '',
  'Te klienti': 'Po',
  'Marzhi %': i === 0 ? 35 : '',
}));

const norm = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Kthen modelet nga rreshtat e Excel-it, ose hedh gabim me listën e problemeve. */
export function modelsFromRows(rows, products, validateFormula) {
  const byCode = Object.fromEntries(products.filter((p) => p.code).map((p) => [norm(p.code), p]));
  const sectionKey = (v) => {
    const n = norm(v);
    return Object.keys(POOL_SECTIONS).find((k) => k === n || norm(POOL_SECTIONS[k]) === n) || (n ? null : 'other');
  };
  const unitKey = (v) => {
    const n = norm(v);
    return Object.keys(UNITS).find((k) => k === n || norm(UNITS[k]) === n) || (n ? n : 'cope');
  };
  const errors = [];
  const models = new Map();
  rows.forEach((r, i) => {
    const line = i + 2;
    const name = String(r.Modeli ?? '').trim();
    if (!name) return;
    const m = models.get(name) || { name, code: '', poolType: 'skimmer', circulation: '', markupPct: 35, items: [] };
    if (!models.has(name)) models.set(name, m);
    if (r.Lloji) m.poolType = ['skimmer', 'overflow', 'infinity', 'prefabricated', 'other'].includes(norm(r.Lloji)) ? norm(r.Lloji) : 'other';
    if (r['Marzhi %'] !== undefined && r['Marzhi %'] !== '') m.markupPct = Number(r['Marzhi %']) || 0;
    const section = sectionKey(r.Seksioni);
    if (!section) errors.push(`Rreshti ${line}: seksion i panjohur "${r.Seksioni}".`);
    const code = String(r['Kodi i artikullit'] ?? '').trim();
    const product = code ? byCode[norm(code)] : null;
    if (code && !product) errors.push(`Rreshti ${line}: artikulli me kod "${code}" nuk ekziston.`);
    const description = String(r.Përshkrimi ?? '').trim();
    if (!product && !description) errors.push(`Rreshti ${line}: shkruani përshkrimin ose kodin e artikullit.`);
    const formula = String(r.Formula ?? '').trim() || '1';
    const fErr = validateFormula(formula);
    if (fErr) errors.push(`Rreshti ${line}: formula "${formula}" — ${fErr}`);
    m.items.push({
      section: section || 'other',
      productId: product?.id || null,
      description: product ? '' : description,
      unit: product?.unit || unitKey(r.Njësia),
      formula,
      unitCost: r.Kosto === '' || r.Kosto === undefined ? '' : Number(r.Kosto) || 0,
      unitPrice: r.Çmimi === '' || r.Çmimi === undefined ? '' : Number(r.Çmimi) || 0,
      markupPct: '',
      showOnClient: norm(r['Te klienti']) !== 'jo',
    });
  });
  if (errors.length) throw new Error(errors.slice(0, 15).join('\n') + (errors.length > 15 ? `\n… dhe ${errors.length - 15} të tjera` : ''));
  if (!models.size) throw new Error('Skedari nuk ka rreshta me kolonën "Modeli".');
  return [...models.values()];
}
