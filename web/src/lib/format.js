const moneyFmt = new Intl.NumberFormat('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat('sq-AL', { maximumFractionDigits: 3 });
const pctFmt = new Intl.NumberFormat('sq-AL', { maximumFractionDigits: 1 });

export const money = (v) => `${moneyFmt.format(Number(v || 0))} L`;
export const num = (v) => moneyFmt.format(Number(v || 0));
export const qty = (v) => qtyFmt.format(Number(v || 0));
export const pct = (v) => `${pctFmt.format(Number(v || 0))}%`;

export const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
export const round3 = (n) => Math.round(Number(n || 0) * 1000) / 1000;

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const addDays = (iso, days) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export const firstOfMonth = () => `${todayISO().slice(0, 8)}01`;

/** Data në formatin dd.mm.yyyy (pranon ISO string ose Firestore Timestamp). */
export function date(v) {
  if (!v) return '';
  if (typeof v === 'string') {
    const [y, m, d] = v.slice(0, 10).split('-');
    return d ? `${d}.${m}.${y}` : v;
  }
  const d = v.toDate ? v.toDate() : v instanceof Date ? v : null;
  if (!d) return '';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

export function dateTime(v) {
  const d = v?.toDate ? v.toDate() : v instanceof Date ? v : null;
  if (!d) return '';
  return `${date(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const toNumber = (v) => {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export const byText = (field) => (a, b) => String(a[field] || '').localeCompare(String(b[field] || ''), 'sq');
