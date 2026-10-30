// Lexues i lehtë i .xlsx (pa ExcelJS): qelizat e kolonave të para dhe pozicionet e fotove.
// Disa oferta Excel kanë qindra mijëra qeliza bosh me format (deri te kolona VXH) që e bëjnë ExcelJS shumë të ngadaltë;
// këtu XML-ja skanohet me shprehje të rregullta dhe mbahen vetëm kolonat që na duhen.

const decode = (s) => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const textsIn = (xml) => [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => decode(m[1])).join('');

/** Tekstet e përbashkëta (sharedStrings.xml), edhe me formatim të pjesshëm (rich text). */
export function parseSharedStrings(xml = '') {
  return [...xml.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => textsIn(m[1]));
}

export const colNumber = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

/**
 * Qelizat e fletës deri te kolona `maxCol`: { "r:c": vlera, "r:c#f": formula } (r, c nga 1).
 * Numrat kthehen si numra; tekstet nga sharedStrings ose inline.
 */
export function parseSheetCells(sheetXml, shared = [], maxCol = 12) {
  const cells = {};
  const re = /<c r="([A-Z]{1,3})(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = re.exec(sheetXml))) {
    const inner = m[4];
    if (!inner) continue;
    const col = colNumber(m[1]);
    if (col > maxCol) continue;
    const key = `${m[2]}:${col}`;
    const type = (m[3].match(/\st="(\w+)"/) || [])[1];
    const f = inner.match(/<f[^>]*>([\s\S]*?)<\/f>/);
    if (f) cells[`${key}#f`] = decode(f[1]);
    const v = inner.match(/<v>([\s\S]*?)<\/v>/);
    let value;
    if (type === 's') value = v ? shared[Number(v[1])] : '';
    else if (type === 'inlineStr') value = textsIn(inner);
    else if (type === 'str' || type === 'e') value = v ? decode(v[1]) : '';
    else if (type === 'b') value = v ? v[1] === '1' : '';
    else value = v ? Number(v[1]) : '';
    if (value !== '' && value !== undefined && value !== null) cells[key] = value;
  }
  return cells;
}

const resolve = (base, target) => {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
};

const relsOf = (xml = '') => Object.fromEntries([...xml.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => {
  const attr = (n) => (m[1].match(new RegExp(`\\b${n}="([^"]*)"`)) || [])[1];
  return [attr('Id'), { target: attr('Target'), type: attr('Type') || '' }];
}));

/** Rruga e fletës së parë (sipas renditjes te workbook.xml) dhe e vizatimit të saj. */
export function firstSheetPaths(workbookXml, workbookRelsXml) {
  const sheet = workbookXml.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
  const rel = sheet && relsOf(workbookRelsXml)[sheet[1]];
  const sheetPath = rel ? resolve('xl/workbook.xml', rel.target) : 'xl/worksheets/sheet1.xml';
  const name = (workbookXml.match(/<sheet\b[^>]*\bname="([^"]*)"/) || [])[1] || '';
  return { sheetPath, sheetRelsPath: sheetPath.replace(/([^/]+)$/, '_rels/$1.rels'), name: decode(name) };
}

/** Vizatimi i fletës (nga lidhjet e saj). */
export function drawingPathOf(sheetPath, sheetRelsXml) {
  const rel = Object.values(relsOf(sheetRelsXml)).find((r) => r.type.endsWith('/drawing'));
  return rel ? resolve(sheetPath, rel.target) : null;
}

/**
 * Fotot e vizatimit me qelizën ku fillojnë: [{ row, col, media }] (row, col nga 1; media = rruga brenda zip-it).
 * Merren vetëm fotot raster (jpg/png/gif/webp); SVG-të kanë gjithmonë një kopje raster.
 */
export function parseDrawingImages(drawingPath, drawingXml, drawingRelsXml) {
  const rels = relsOf(drawingRelsXml);
  const out = [];
  const anchorRe = /<xdr:(?:twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g;
  for (const a of drawingXml.match(anchorRe) || []) {
    const from = a.match(/<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
    const blip = a.match(/<a:blip\b[^>]*\br:embed="([^"]+)"/);
    if (!from || !blip || !rels[blip[1]]) continue;
    const media = resolve(drawingPath, rels[blip[1]].target);
    if (!/\.(jpe?g|png|gif|webp)$/i.test(media)) continue;
    out.push({ col: Number(from[1]) + 1, row: Number(from[2]) + 1, media });
  }
  return out;
}
