// Leximi i një oferte Excel të SuperPool (fleta e parë) në të dhënat e ofertës.
// Logjikë e pastër: merr qelizat si tekst ({ "rresht:kolonë": vlerë }, me numërim nga 1) dhe kthen ofertën.
//
// Formati (si OFERTE 8x4): klienti poshtë "Oferte per klientin:", përmasat te "Permasat: 8m x 4m x 1.5m",
// tekstet (standardi, kompania, hyrja), tabela NR | PËRSHKRIMI | FOTO | NJËSIA | SASIA, totali "TOTAL PA TVSH",
// kushtet e pagesës, të dhënat bankare, termat e garancisë dhe manuali i pishinës.

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** Pastron hapësirat e veçanta dhe rreshtat bosh të tepërt. */
export const cleanText = (s) => String(s ?? '')
  .replace(/[  -​  　]/g, ' ')
  .replace(/\r/g, '')
  .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
  .replace(/\n{2,}/g, '\n')
  .trim();

const num = (v) => {
  if (typeof v === 'number') return v;
  const m = String(v ?? '').replace(/\s/g, '').replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

const UNIT_MAP = [
  [/^cop|^pcs|^pc$/, 'cope'], [/^kg/, 'kg'], [/^komplet|^set/, 'set'], [/^m(eter|etër)? ?linear|^ml$|^m$/, 'm'],
  [/^m2|^m²/, 'm2'], [/^m3|^m³/, 'm3'], [/^lit|^l$/, 'l'], [/^or[eë]/, 'ore'], [/^pak/, 'pako'], [/^rrot/, 'rrotull'],
];
export const unitOf = (s) => {
  const n = norm(s);
  return (UNIT_MAP.find(([re]) => re.test(n)) || [null, 'cope'])[1];
};

/** Titulli (rreshti i parë, ose teksti para pikës së parë "•") dhe përshkrimi teknik. */
export function splitDescription(text) {
  const t = cleanText(text).replace(/^[^\p{L}\p{N}]+/u, '');
  let [first, ...rest] = t.split('\n');
  const bullet = first.indexOf('•');
  if (bullet > 0) { rest = [first.slice(bullet), ...rest]; first = first.slice(0, bullet); }
  return { title: first.trim(), details: rest.join('\n').trim() };
}

/** Lexon përmasat nga "Permasat: 8m x 4m x 1.5m" dhe llogaritjet nën të. */
function parseDims(lines) {
  const out = {};
  for (const l of lines) {
    const n = norm(l);
    const m = n.match(/permasat[^\d]*([\d.,]+)\s*m?\s*[x×*]\s*([\d.,]+)\s*m?\s*(?:[x×*]\s*([\d.,]+)(?:\s*[-–]\s*([\d.,]+))?)?/);
    if (m) {
      out.length = num(m[1]); out.width = num(m[2]);
      if (m[3]) { out.depthMin = num(m[3]); out.depthMax = num(m[4] || m[3]); }
    } else if (/^v[eë]llimi/.test(n)) out.volume = num(n.split('=')[1]);
    else if (/^depo/.test(n)) out.tank = num(n.split('=')[1]);
    else if (/^qarkullimi/.test(n)) {
      const h = n.match(/\/\s*([\d.,]+)\s*or/);
      if (h) out.turnoverHours = num(h[1]);
    }
  }
  return out;
}

/**
 * cells: { "r:c": vlera, "r:c#f": formula } (r, c nga 1). Kthen:
 * { client: {name, city, country}, dims, validDays, texts: {standard, company, intro, payment, bank, terms, manual},
 *   items: [{ row, no, title, details, unit, qty }], subtotal, vatPct, headerRow, photoCol }
 */
export function parseOfferSheet(cells) {
  const get = (r, c) => cells[`${r}:${c}`];
  const text = (r, c) => cleanText(get(r, c));
  const rows = [...new Set(Object.keys(cells).filter((k) => !k.endsWith('#f')).map((k) => Number(k.split(':')[0])))].sort((a, b) => a - b);
  const maxRow = rows.length ? rows[rows.length - 1] : 0;
  const findRow = (pred, from = 1, to = maxRow) => rows.find((r) => r >= from && r <= to && pred(r)) ?? null;
  const rowHas = (r, re, cols = [1, 2, 3, 4, 5, 6]) => cols.some((c) => re.test(norm(get(r, c))));

  // Tabela e artikujve: rreshti i titujve dhe kolonat e tij.
  const headerRow = findRow((r) => rowHas(r, /^nr\.?$/) && rowHas(r, /^pershkrimi/));
  if (!headerRow) throw new Error('Nuk u gjet tabela e ofertës (kolonat «NR.» dhe «PERSHKRIMI»).');
  const colOf = (re, def) => {
    for (let c = 1; c <= 12; c++) if (re.test(norm(get(headerRow, c)))) return c;
    return def;
  };
  const cNo = colOf(/^nr/, 1);
  const cDesc = colOf(/^pershkrim/, 2);
  const cPhoto = colOf(/^foto/, 3);
  const cUnit = colOf(/^njesi/, 4);
  const cQty = colOf(/^sasi/, 5);
  const cPrice = colOf(/^cmim/, null);

  // Fundi i tabelës: rreshti "TOTAL PA TVSH".
  const totalRow = findRow((r) => rowHas(r, /total pa tvsh/), headerRow + 1);
  const items = [];
  for (const r of rows) {
    if (r <= headerRow || (totalRow && r >= totalRow)) continue;
    const raw = get(r, cDesc);
    if (!cleanText(raw)) continue;
    const qty = num(get(r, cQty)) ?? 0;
    const { title, details } = splitDescription(raw);
    items.push({ row: r, no: text(r, cNo), title, details, unit: unitOf(get(r, cUnit)), qty, ...(cPrice ? { unitPrice: num(get(r, cPrice)) || 0 } : {}) });
  }
  const valueCol = (r) => [cQty, cQty + 1, cUnit].map((c) => num(get(r, c))).find((x) => x !== null && x !== undefined);
  const subtotal = totalRow ? valueCol(totalRow) : null;
  const vatRow = findRow((r) => rowHas(r, /total\s+tvsh/) && !rowHas(r, /pa tvsh|me tvsh/), (totalRow || headerRow) + 1, (totalRow || headerRow) + 4);
  // TVSH-ja nga formula (p.sh. =E52*20%); formula ruhet te çelësi "r:c#f".
  const vatMatch = vatRow ? `${get(vatRow, cQty) ?? ''} ${cells[`${vatRow}:${cQty}#f`] ?? ''}`.match(/(\d+(?:[.,]\d+)?)\s*%/) : null;
  const vatPct = vatMatch ? num(vatMatch[1]) : 20;

  // Klienti: rreshtat poshtë "Oferte per klientin".
  const clientRow = findRow((r) => rowHas(r, /^oferte? per klientin/), 1, headerRow);
  const client = {};
  if (clientRow) {
    const c = [1, 2, 3].find((k) => /^oferte? per klientin/.test(norm(get(clientRow, k)))) || 2;
    const next = [1, 2, 3].map((i) => text(clientRow + i, c)).filter(Boolean);
    [client.name = '', client.city = '', client.country = ''] = next;
  }

  // Përmasat: kolona ku ndodhet "Permasat".
  let dims = {};
  const dimsRow = findRow((r) => rowHas(r, /^permasat/, [3, 4, 5, 6]), 1, headerRow);
  if (dimsRow) {
    const c = [3, 4, 5, 6].find((k) => /^permasat/.test(norm(get(dimsRow, k))));
    dims = parseDims([0, 1, 2, 3, 4, 5, 6].map((i) => text(dimsRow + i, c)).filter(Boolean));
  }

  // Tekstet para tabelës (standardi, kompania, hyrja): tekstet e gjata te kolona e përshkrimit.
  const longTexts = rows
    .filter((r) => r > (clientRow || 0) + 3 && r < headerRow)
    .map((r) => text(r, cDesc))
    .filter((t) => t.length > 40);
  const texts = {};
  let validDays = null;
  for (const t of longTexts) {
    if (!texts.standard && /din|standard/i.test(t.split('\n')[0])) texts.standard = t;
    else if (!texts.company && /kompani|prej vitit|super ?pool/i.test(t)) texts.company = t;
    else if (!texts.intro) {
      validDays = Number(t.match(/vlefshme p[eë]r (\d+) dit/i)?.[1]) || null;
      texts.intro = t.replace(/vlefshme p[eë]r \d+ dit[eë]/i, 'vlefshme për {ditë} ditë');
    }
  }

  // Kushtet e pagesës dhe banka (pas tabelës).
  const after = totalRow || headerRow;
  const payRow = findRow((r) => rowHas(r, /^kushtet e pageses/), after);
  if (payRow) {
    const c = [1, 2, 3].find((k) => /^kushtet e pageses/.test(norm(get(payRow, k)))) || 2;
    const lines = [];
    for (let r = payRow + 1; r <= payRow + 8 && text(r, c); r++) lines.push(text(r, c));
    texts.payment = lines.join('\n');
    const bc = [3, 4, 5, 6].find((k) => /dhenat bankare/.test(norm(get(payRow, k))));
    if (bc) {
      const head = text(payRow, bc).replace(/^t[eë] dh[eë]nat bankare\s*:?\s*/i, '');
      const bank = [head];
      for (let r = payRow + 1; r <= payRow + 8 && text(r, bc); r++) bank.push(text(r, bc));
      texts.bank = bank.filter(Boolean).join('\n');
    }
  }

  // Termat e garancisë dhe manuali (deri në fund të fletës).
  const termsRow = findRow((r) => rowHas(r, /^termat e bashkepunimit/), after);
  const manualRow = findRow((r) => rowHas(r, /^manuali i pishines/), after);
  const block = (from, to) => rows.filter((r) => r > from && r < to).map((r) => text(r, cDesc)).filter(Boolean).join('\n');
  if (termsRow) texts.terms = block(termsRow, manualRow || maxRow + 1);
  if (manualRow) texts.manual = block(manualRow, maxRow + 1);

  return { client, dims, texts, items, subtotal, vatPct, validDays, headerRow, photoCol: cPhoto };
}
