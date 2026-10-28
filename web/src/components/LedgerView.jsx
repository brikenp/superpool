import { AGING_BUCKETS } from '@shared/ledger.js';

import { date, money } from '../lib/format.js';
import { DataTable } from './DataTable.jsx';
import { Card, Field, Stat } from './ui.jsx';

/**
 * Pamja e kartelës (klient ose furnitor): shumat kryesore, periudha, rreshtat me gjendjen pas secilit
 * dhe dokumentet e pashlyera me vjetërsinë e tyre.
 *   ledger = buildLedger(...), aging = agingOf(...)
 *   labels = { debit, credit, owes, prepaid, openTitle }
 */
export function LedgerView({ title, exportTitle, ledger, aging, from, to, setFrom, setTo, labels, actions, onRowClick, today }) {
  const { opening, rows, debit, credit, closing } = ledger;
  const tableRows = [
    { id: 'opening', date: from, doc: '', description: `Gjendja më ${date(from)}`, debit: opening > 0 ? opening : 0, credit: opening < 0 ? -opening : 0, balance: opening, isOpening: true },
    ...rows,
  ];
  return (
    <>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label={`Gjendja më ${date(from)}`} value={money(opening, labels.currency)} />
        <Stat label={labels.debit} value={money(debit, labels.currency)} />
        <Stat label={labels.credit} value={money(credit, labels.currency)} tone="ok" />
        <Stat
          label={closing < -0.01 ? labels.prepaid : labels.owes}
          value={money(labels.signed ? closing : Math.abs(closing), labels.currency)}
          tone={labels.signed ? (closing < -0.01 ? 'danger' : 'ok') : closing > 0.01 ? 'danger' : 'ok'}
        />
      </div>
      <Card title={title} actions={actions}>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <Field label="Nga data"><input type="date" value={from} onChange={(e) => setFrom(e.target.value || '2000-01-01')} /></Field>
          <Field label="Deri më"><input type="date" value={to} onChange={(e) => setTo(e.target.value || today)} /></Field>
        </div>
        <DataTable
          search={false}
          title={exportTitle}
          filtersText={[`Periudha: ${date(from)} – ${date(to)}`]}
          rows={tableRows}
          onRowClick={onRowClick ? (r) => !r.isOpening && onRowClick(r) : undefined}
          empty="Nuk ka veprime në këtë periudhë."
          columns={[
            { key: 'date', label: 'Data', sortable: false, render: (r) => date(r.date), value: (r) => r.date },
            { key: 'doc', label: 'Dokumenti', sortable: false },
            ...(labels.partyColumn ? [{ key: 'party', label: labels.partyColumn, sortable: false }] : []),
            { key: 'description', label: 'Përshkrimi', sortable: false, render: (r) => (r.isOpening ? <strong>{r.description}</strong> : r.description) },
            ...(labels.noDue ? [] : [{ key: 'dueDate', label: 'Afati', sortable: false, render: (r) => (r.dueDate ? date(r.dueDate) : ''), value: (r) => r.dueDate || '' }]),
            ...(labels.currency === 'EUR' ? [] : [{ key: 'original', label: 'Në euro', sortable: false, value: (r) => (r.original?.currency === 'EUR' ? r.original.amount : ''), render: (r) => (r.original?.currency === 'EUR' ? money(r.original.amount, 'EUR') : '') }]),
            { key: 'debit', label: labels.debitColumn || 'Debi', type: 'money', total: true, sortable: false },
            { key: 'credit', label: labels.creditColumn || 'Kredi', type: 'money', total: true, sortable: false },
            { key: 'balance', label: 'Gjendja', type: 'money', sortable: false },
          ]}
        />
      </Card>
      {aging && aging.open.length > 0 && (
        <Card title={`${labels.openTitle} më ${date(to)}`}>
          <div className="grid grid-4" style={{ marginBottom: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            {AGING_BUCKETS.map((b) => <Stat key={b.key} label={b.label} value={money(aging.buckets[b.key])} tone={b.key !== 'current' && aging.buckets[b.key] > 0 ? 'danger' : undefined} />)}
          </div>
          <DataTable
            search={false}
            title={`${labels.openTitle} · ${exportTitle}`}
            rows={aging.open}
            initialSort={{ key: 'date', dir: 'asc' }}
            columns={[
              { key: 'date', label: 'Data', render: (r) => date(r.date) },
              { key: 'doc', label: 'Dokumenti' },
              { key: 'description', label: 'Përshkrimi' },
              { key: 'dueDate', label: 'Afati', render: (r) => (r.dueDate ? date(r.dueDate) : '') },
              { key: 'amount', label: 'Vlera', type: 'money', total: true },
              { key: 'remaining', label: 'Pa shlyer', type: 'money', total: true },
              { key: 'daysOverdue', label: 'Ditë vonesë', type: 'number' },
            ]}
          />
        </Card>
      )}
    </>
  );
}
