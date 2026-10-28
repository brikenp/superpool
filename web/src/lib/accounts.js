// Llogaritë bankare dhe arka: ku hyjnë arkëtimet nga klientët dhe nga ku dalin pagesat te furnitorët.
import { buildLedger } from '@shared/ledger.js';

import { inAll, round2 } from './format.js';

export const ACCOUNT_KINDS = { bank: 'Bankë', cash: 'Arkë' };

export const accountLabel = (a) => (a ? `${a.name}${a.currency === 'EUR' ? ' (€)' : ''}` : '');

/** Llogaria e paracaktuar për mënyrën e pagesës: cash → arka, bankë/kartë → banka e parë aktive. */
export function defaultAccountId(method, accounts, currency = 'ALL') {
  const kind = method === 'cash' ? 'cash' : 'bank';
  const active = accounts.filter((a) => a.active !== false && a.kind === kind);
  return (active.find((a) => (a.currency || 'ALL') === currency) || active[0])?.id || '';
}

/** Shuma e një pagese në monedhën e llogarisë (lekë, ose euro për llogaritë në euro). */
export function amountInAccount(doc, account, eurRate) {
  if ((account?.currency || 'ALL') !== 'EUR') return inAll(doc);
  if (doc.currency === 'EUR') return Number(doc.amount) || 0;
  const rate = Number(eurRate) > 1 ? Number(eurRate) : 0;
  return rate ? round2(inAll(doc) / rate) : 0;
}

const seconds = (x) => x?.createdAt?.seconds || 0;

/**
 * Lëvizjet e llogarisë: gjendja fillestare e llogarisë, arkëtimet (hyrje), pagesat te furnitorët (dalje)
 * dhe rreshtat e tjerë të ekstraktit (komisione, transferta…), me gjendjen pas secilit.
 */
export function accountLedger(account, { payments = [], supplierPayments = [], other = [] }, from, to, eurRate) {
  const ins = [];
  const outs = [];
  if (Number(account.openingBalance)) {
    const row = { id: 'account_opening', date: account.openingDate || '2000-01-01', doc: '', description: 'Gjendja fillestare e llogarisë', amount: Math.abs(Number(account.openingBalance)) };
    (Number(account.openingBalance) > 0 ? ins : outs).push(row);
  }
  for (const p of payments) {
    if (p.status === 'cancelled' || p.accountId !== account.id) continue;
    ins.push({ id: `p${p.id}`, record: p, col: 'payments', date: p.date, createdAt: seconds(p), doc: p.number || '', party: p.clientName, description: ['Arkëtim nga klienti', p.reference].filter(Boolean).join(' · '), amount: amountInAccount(p, account, eurRate) });
  }
  for (const p of supplierPayments) {
    if (p.status === 'cancelled' || p.accountId !== account.id) continue;
    outs.push({ id: `s${p.id}`, record: p, col: 'supplierPayments', date: p.date, createdAt: seconds(p), doc: p.number || '', party: p.supplierName, description: ['Pagesë te furnitori', p.reference].filter(Boolean).join(' · '), amount: amountInAccount(p, account, eurRate) });
  }
  for (const t of other) {
    if (t.accountId !== account.id || t.status !== 'matched' || t.match?.kind !== 'other') continue;
    (t.amount >= 0 ? ins : outs).push({ id: `b${t.id}`, record: t, col: 'bankTransactions', date: t.date, doc: t.reference || '', party: t.counterparty || '', description: [t.match.category, t.description].filter(Boolean).join(' · '), amount: Math.abs(Number(t.amount)) });
  }
  return buildLedger(ins, outs, from, to);
}
