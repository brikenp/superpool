// Fotot "Place in Cell" të Excel-it (Microsoft 365) ruhen si "rich data" dhe nuk lexohen nga ExcelJS.
// Ky modul i nxjerr direkt nga paketa .xlsx:
//   qeliza (vm="N") → xl/metadata.xml → xl/richData/rdrichvalue.xml → richValueRel.xml → xl/media/imageX.png

const parse = (text) => new DOMParser().parseFromString(text, 'application/xml');
const byLocal = (node, name) => [...node.getElementsByTagName('*')].filter((e) => e.localName === name);
const child = (node, name) => [...node.children].filter((e) => e.localName === name);

async function readXml(zip, path) {
  const file = zip.file(path);
  return file ? parse(await file.async('text')) : null;
}

function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** Rruga e fletës së parë sipas workbook.xml. */
async function firstSheetPath(zip) {
  const wb = await readXml(zip, 'xl/workbook.xml');
  const rels = await readXml(zip, 'xl/_rels/workbook.xml.rels');
  const sheet = wb && byLocal(wb, 'sheet')[0];
  const rid = sheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheet?.getAttribute('r:id');
  const rel = rels && byLocal(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid);
  return rel ? resolvePath('xl/workbook.xml', rel.getAttribute('Target')) : 'xl/worksheets/sheet1.xml';
}

/**
 * Kthen { [numriRreshtit]: { buffer, extension } } për fotot brenda qelizave të fletës së parë.
 * Nëse skedari nuk ka foto të tilla, kthen {}.
 */
export async function readInCellImages(arrayBuffer) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(arrayBuffer);
  if (!zip.file('xl/richData/rdrichvalue.xml')) return {};

  const metadata = await readXml(zip, 'xl/metadata.xml');
  const richValues = await readXml(zip, 'xl/richData/rdrichvalue.xml');
  const structures = await readXml(zip, 'xl/richData/rdrichvaluestructure.xml');
  const relList = await readXml(zip, 'xl/richData/richValueRel.xml');
  const relRels = await readXml(zip, 'xl/richData/_rels/richValueRel.xml.rels');
  if (!metadata || !richValues || !structures || !relList || !relRels) return {};

  // vm (1-based) → indeksi i rich value
  const future = byLocal(metadata, 'futureMetadata').find((f) => f.getAttribute('name') === 'XLRICHVALUE');
  const futureIdx = future ? child(future, 'bk').map((bk) => Number(byLocal(bk, 'rvb')[0]?.getAttribute('i'))) : [];
  const valueMeta = byLocal(metadata, 'valueMetadata')[0];
  const vmToRich = valueMeta ? child(valueMeta, 'bk').map((bk) => futureIdx[Number(byLocal(bk, 'rc')[0]?.getAttribute('v'))]) : [];

  // rich value → indeksi i lidhjes së fotos
  const structKeys = child(structures.documentElement, 's').map((s) => child(s, 'k').map((k) => k.getAttribute('n')));
  const richToRel = child(richValues.documentElement, 'rv').map((rv) => {
    const keys = structKeys[Number(rv.getAttribute('s'))] || [];
    const pos = keys.indexOf('_rvRel:LocalImageIdentifier');
    const values = child(rv, 'v').map((v) => v.textContent);
    return pos >= 0 ? Number(values[pos]) : null;
  });

  // lidhja → skedari i fotos
  const relIds = child(relList.documentElement, 'rel').map((r) => r.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || r.getAttribute('r:id'));
  const targets = Object.fromEntries(byLocal(relRels, 'Relationship').map((r) => [r.getAttribute('Id'), resolvePath('xl/richData/richValueRel.xml', r.getAttribute('Target'))]));

  const sheet = await readXml(zip, await firstSheetPath(zip));
  if (!sheet) return {};
  const out = {};
  for (const c of byLocal(sheet, 'c')) {
    const vm = c.getAttribute('vm');
    if (!vm) continue;
    const rich = vmToRich[Number(vm) - 1];
    const rel = rich === undefined ? null : richToRel[rich];
    const path = rel === null || rel === undefined ? null : targets[relIds[rel]];
    const file = path && zip.file(path);
    if (!file) continue;
    const row = Number(String(c.getAttribute('r')).replace(/^[A-Z]+/i, ''));
    if (!out[row]) out[row] = { buffer: await file.async('arraybuffer'), extension: path.split('.').pop().toLowerCase() };
  }
  return out;
}
