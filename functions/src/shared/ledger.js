// Kartela e partnerit (klient ose furnitor) dhe vjetërsia e detyrimeve.
// Logjikë e pastër, e përbashkët për aplikacionin web dhe testet.
//
// "debits" rrisin detyrimin (faturat e klientit / faturat e blerjes nga furnitori),
// "credits" e ulin (likujdimet / pagesat te furnitori). Të gjitha shumat janë në lekë.
//   debit:  { id, date, dueDate?, amount, createdAt? }
//   credit: { id, date, amount, linkId?, createdAt? }   linkId = fatura që likujdon

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0);

/** Rreshtat e periudhës me gjendjen pas secilit; gjendja fillestare = gjithçka para `from`. */
export function buildLedger(debits, credits, from = '0000-00-00', to = '9999-99-99') {
  const all = [
    ...debits.map((d) => ({ ...d, debit: r2(d.amount), credit: 0 })),
    ...credits.map((c) => ({ ...c, debit: 0, credit: r2(c.amount) })),
  ].sort(byDate);
  const opening = r2(all.filter((r) => r.date < from).reduce((s, r) => s + r.debit - r.credit, 0));
  let balance = opening;
  const rows = all.filter((r) => r.date >= from && r.date <= to).map((r) => {
    balance = r2(balance + r.debit - r.credit);
    return { ...r, balance };
  });
  const debit = r2(rows.reduce((s, r) => s + r.debit, 0));
  const credit = r2(rows.reduce((s, r) => s + r.credit, 0));
  return { opening, rows, debit, credit, closing: balance };
}

export const AGING_BUCKETS = [
  { key: 'current', label: 'Pa skaduar' },
  { key: 'd30', label: '1–30 ditë' },
  { key: 'd60', label: '31–60 ditë' },
  { key: 'd90', label: '61–90 ditë' },
  { key: 'd90plus', label: 'Mbi 90 ditë' },
];

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/**
 * Sa ka mbetur pa u likujduar nga çdo faturë deri më `asOf`:
 * pagesat e lidhura me një faturë shkojnë së pari te ajo, pjesa tjetër (dhe pagesat pa lidhje)
 * mbyll faturat më të vjetra (FIFO). Kthen { open: [{...debit, remaining, daysOverdue}], buckets, total, unapplied }.
 */
export function agingOf(debits, credits, asOf = '9999-99-99') {
  const ds = debits.filter((d) => d.date <= asOf).sort(byDate).map((d) => ({ ...d, remaining: r2(d.amount) }));
  const byId = new Map(ds.map((d) => [d.id, d]));
  let pool = 0;
  for (const c of credits.filter((x) => x.date <= asOf).sort(byDate)) {
    let left = r2(c.amount);
    const target = c.linkId && byId.get(c.linkId);
    if (target) {
      const take = Math.min(left, Math.max(0, target.remaining));
      target.remaining = r2(target.remaining - take);
      left = r2(left - take);
    }
    pool = r2(pool + left);
  }
  for (const d of ds) {
    if (pool <= 0) break;
    const take = Math.min(pool, Math.max(0, d.remaining));
    d.remaining = r2(d.remaining - take);
    pool = r2(pool - take);
  }
  const buckets = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0]));
  const open = ds.filter((d) => d.remaining > 0.005).map((d) => {
    const due = d.dueDate || d.date;
    const daysOverdue = asOf === '9999-99-99' ? 0 : Math.max(0, daysBetween(due, asOf));
    const key = daysOverdue <= 0 ? 'current' : daysOverdue <= 30 ? 'd30' : daysOverdue <= 60 ? 'd60' : daysOverdue <= 90 ? 'd90' : 'd90plus';
    buckets[key] = r2(buckets[key] + d.remaining);
    return { ...d, daysOverdue, bucket: key };
  });
  const total = r2(open.reduce((s, d) => s + d.remaining, 0));
  return { open, buckets, total, unapplied: pool };
}
