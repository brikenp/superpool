// Ekstraktet bankare: leximi i kolonave (të ndryshme sipas bankës) dhe sugjerimi i përputhjes
// me klientët, furnitorët dhe pagesat e regjistruara. Logjikë e pastër, e testueshme.

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** Shuma nga tekste si "1.234,56", "1,234.56", "-500", "(500)", "1 200 L". */
export function parseAmount(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s);
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // ndarësi dhjetor është i fundit
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // "1,234,567" (mijëshe) ose "12,5" (dhjetore)
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ''); // "1.234.567" ose "12.500" (formati shqip pa dhjetore)
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Data ISO nga "2026-10-05", "05.10.2026", "5/10/2026", numri serial i Excel-it. */
export function parseDate(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

const HEADER_PATTERNS = {
  date: /^(data|date|dt|data e (transaksionit|valutes|veprimit)|value date|booking date|transaction date)/,
  description: /(pershkrim|description|detaje|details|narrative|shpjegim|qellim|purpose|informacion|remittance)/,
  counterparty: /(pagues|perfitues|beneficiar|payer|payee|counterparty|emri|name|derguesi|marresi)/,
  debit: /(debi|debit|dalje|terheqje|withdraw|pagesa dalese)/,
  credit: /(kredi|credit|hyrje|depozit|deposit|arketim)/,
  amount: /^(shuma|amount|vlera|value|importi)/,
  reference: /(referenc|^ref|nr\.? ?(transaksion|dokument)|transaction id|document)/,
};

/** Gjen rreshtin e titujve (bankat shpesh kanë rreshta sipër tabelës) dhe kolonat e njohura. */
export function detectColumns(matrix) {
  for (let r = 0; r < Math.min(matrix.length, 25); r++) {
    const headers = matrix[r].map((h) => norm(h));
    const map = {};
    for (const [key, re] of Object.entries(HEADER_PATTERNS)) {
      const idx = headers.findIndex((h, i) => h && re.test(h) && !Object.values(map).includes(i));
      if (idx >= 0) map[key] = idx;
    }
    if (map.date !== undefined && (map.amount !== undefined || map.debit !== undefined || map.credit !== undefined)) {
      return { headerRow: r, headers: matrix[r].map((h) => String(h ?? '').trim()), map };
    }
  }
  return { headerRow: 0, headers: (matrix[0] || []).map((h) => String(h ?? '').trim()), map: {} };
}

/** Rreshtat e ekstraktit sipas hartës së kolonave: { date, amount (+ hyrje / − dalje), description, counterparty, reference }. */
export function statementRows(matrix, headerRow, map) {
  const out = [];
  for (const row of matrix.slice(headerRow + 1)) {
    const date = parseDate(row[map.date]);
    let amount = null;
    if (map.amount !== undefined) amount = parseAmount(row[map.amount]);
    if (amount === null && (map.debit !== undefined || map.credit !== undefined)) {
      const credit = parseAmount(row[map.credit]) || 0;
      const debit = parseAmount(row[map.debit]) || 0;
      amount = Math.abs(credit) - Math.abs(debit);
    }
    if (!date || !amount) continue;
    out.push({
      date,
      amount: Math.round(amount * 100) / 100,
      description: String(row[map.description] ?? '').trim(),
      counterparty: String(row[map.counterparty] ?? '').trim(),
      reference: String(row[map.reference] ?? '').trim(),
    });
  }
  return out;
}

/** Çelës i qëndrueshëm për një rresht (që i njëjti ekstrakt të mos importohet dy herë). */
export function txKey(accountId, t) {
  const raw = `${accountId}|${t.date}|${t.amount.toFixed(2)}|${norm(t.reference)}|${norm(t.description).slice(0, 80)}|${norm(t.counterparty)}`;
  let h1 = 0x811c9dc5;
  let h2 = 0;
  for (let i = 0; i < raw.length; i++) {
    h1 = Math.imul(h1 ^ raw.charCodeAt(i), 16777619) >>> 0;
    h2 = (Math.imul(h2, 31) + raw.charCodeAt(i)) >>> 0;
  }
  return `bt_${h1.toString(36)}${h2.toString(36)}`;
}

const NIPT_RE = /\b([A-Z]\d{8}[A-Z])\b/gi;
const daysApart = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

/** Partneri (klient ose furnitor) që përmendet në tekst: së pari me NIPT, pastaj me emër / emër tregtar. */
export function findParty(text, parties) {
  const t = norm(text);
  if (!t) return null;
  for (const m of String(text).matchAll(NIPT_RE)) {
    const p = parties.find((x) => x.nipt && x.nipt.toUpperCase() === m[1].toUpperCase());
    if (p) return p;
  }
  let best = null;
  for (const p of parties) {
    for (const name of [p.name, p.tradeName]) {
      const n = norm(name).replace(/\b(sh\.?p\.?k\.?|shpk|sha|sh\.a\.?|pf|p\.f\.?)\b/g, '').trim();
      if (n.length >= 4 && t.includes(n) && (!best || n.length > best.len)) best = { party: p, len: n.length };
    }
  }
  return best?.party || null;
}

/**
 * Sugjerimi për një rresht të ekstraktit:
 *  - { kind: 'link', col, payment }   pagesë ekzistuese me të njëjtën shumë (±5 ditë), pa lidhje me bankën
 *  - { kind: 'client' | 'supplier', party }   partneri i gjetur në përshkrim
 *  - null   pa sugjerim
 * payments/supplierPayments: pagesat aktive, me `accountAmount` = shuma në monedhën e llogarisë.
 */
export function suggestMatch(tx, { accountId, clients = [], suppliers = [], payments = [], supplierPayments = [] }) {
  const incoming = tx.amount > 0;
  const amount = Math.abs(tx.amount);
  const pool = incoming ? payments : supplierPayments;
  const text = `${tx.counterparty} ${tx.description} ${tx.reference}`;
  const party = findParty(text, incoming ? clients : suppliers);
  const candidates = pool
    .filter((p) => p.status !== 'cancelled' && !p.bankTxId && p.type !== 'opening' && (!p.accountId || p.accountId === accountId))
    .filter((p) => Math.abs(Number(p.accountAmount) - amount) < 0.01 && daysApart(p.date, tx.date) <= 5)
    .sort((a, b) => {
      const pa = party && (a.clientId || a.supplierId) === party.id ? 0 : 1;
      const pb = party && (b.clientId || b.supplierId) === party.id ? 0 : 1;
      return pa - pb || daysApart(a.date, tx.date) - daysApart(b.date, tx.date);
    });
  if (candidates.length) return { kind: 'link', col: incoming ? 'payments' : 'supplierPayments', payment: candidates[0] };
  if (party) return { kind: incoming ? 'client' : 'supplier', party };
  return null;
}
