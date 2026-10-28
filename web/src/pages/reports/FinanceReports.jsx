// Raportet financiare: pasqyra e klientëve, pasqyra e furnitorëve dhe bankat/arka.
import { collection } from 'firebase/firestore';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { AGING_BUCKETS, agingOf, buildLedger } from '@shared/ledger.js';

import { DataTable } from '../../components/DataTable.jsx';
import { ACCOUNT_KINDS, accountLedger } from '../../lib/accounts.js';
import { useData, useQuery } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';
import { date, money, round2 } from '../../lib/format.js';
import { prettySegment } from '../../lib/prettyUrl.jsx';
import { ledgerRows } from '../finance/ClientLedger.jsx';
import { supplierLedgerRows } from '../finance/SupplierFinance.jsx';

const periodText = (f) => [`Periudha: ${date(f.from)} – ${date(f.to)}`];
const all = (name) => () => collection(db, name);

/** Për çdo partner: gjendja fillestare, debi/kredi e periudhës, gjendja fundore dhe vjetërsia e saj. */
function statementByParty(rows, partyOf, from, to) {
  const groups = new Map();
  for (const r of rows) {
    const id = partyOf(r.record);
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, { debits: [], credits: [] });
    (r.debit ? groups.get(id).debits : groups.get(id).credits).push({ ...r, amount: r.debit || r.credit });
  }
  return [...groups.entries()].map(([id, g]) => {
    const l = buildLedger(g.debits, g.credits, from, to);
    const a = agingOf(g.debits, g.credits, to);
    return { id, opening: l.opening, debit: l.debit, credit: l.credit, closing: l.closing, ...a.buckets, prepaid: a.unapplied };
  }).filter((r) => Math.abs(r.opening) > 0.01 || r.debit || r.credit || Math.abs(r.closing) > 0.01);
}

const agingColumns = AGING_BUCKETS.map((b) => ({ key: b.key, label: b.label, type: 'money', total: true }));

export function ClientStatementReport({ f }) {
  const { clients, clientsById } = useData();
  const invoices = useQuery(all('invoices'), []);
  const payments = useQuery(all('payments'), []);
  const rows = useMemo(() => {
    const { rows: lr } = ledgerRows(invoices.data, payments.data);
    return statementByParty(lr, (rec) => rec.clientId, f.from, f.to)
      .filter((r) => !f.client || r.id === f.client)
      .map((r) => ({ ...r, name: clientsById[r.id]?.name || '(klient i fshirë)', nipt: clientsById[r.id]?.nipt || '' }));
  }, [invoices.data, payments.data, f.from, f.to, f.client, clientsById]);
  const link = (id) => `/financa/kartela?klienti=${prettySegment('clients', clientsById[id] || { id }, { clients })}`;
  return (
    <DataTable
      title="Pasqyra e klientëve"
      filtersText={periodText(f)}
      rows={rows}
      initialSort={{ key: 'closing', dir: 'desc' }}
      columns={[
        { key: 'name', label: 'Klienti', render: (r) => <Link to={link(r.id)}>{r.name}</Link> },
        { key: 'nipt', label: 'NIPT' },
        { key: 'opening', label: `Gjendja më ${date(f.from)}`, type: 'money', total: true },
        { key: 'debit', label: 'Faturuar', type: 'money', total: true },
        { key: 'credit', label: 'Arkëtuar', type: 'money', total: true },
        { key: 'closing', label: `Gjendja më ${date(f.to)}`, type: 'money', total: true },
        ...agingColumns,
        { key: 'prepaid', label: 'Parapagim', type: 'money', total: true },
      ]}
    />
  );
}

export function SupplierStatementReport({ f }) {
  const { suppliers, suppliersById } = useData();
  const invoices = useQuery(all('supplierInvoices'), []);
  const payments = useQuery(all('supplierPayments'), []);
  const rows = useMemo(() => {
    const { rows: lr } = supplierLedgerRows(invoices.data, payments.data);
    return statementByParty(lr, (rec) => rec.supplierId, f.from, f.to)
      .filter((r) => !f.supplier || r.id === f.supplier)
      .map((r) => ({ ...r, name: suppliersById[r.id]?.name || '(furnitor i fshirë)', nipt: suppliersById[r.id]?.nipt || '' }));
  }, [invoices.data, payments.data, f.from, f.to, f.supplier, suppliersById]);
  const link = (id) => `/financa/kartela-furnitori?furnitori=${prettySegment('suppliers', suppliersById[id] || { id }, { suppliers })}`;
  return (
    <DataTable
      title="Pasqyra e furnitorëve"
      filtersText={periodText(f)}
      rows={rows}
      initialSort={{ key: 'closing', dir: 'desc' }}
      columns={[
        { key: 'name', label: 'Furnitori', render: (r) => <Link to={link(r.id)}>{r.name}</Link> },
        { key: 'nipt', label: 'NIPT' },
        { key: 'opening', label: `Gjendja më ${date(f.from)}`, type: 'money', total: true },
        { key: 'debit', label: 'Faturat e blerjes', type: 'money', total: true },
        { key: 'credit', label: 'Paguar', type: 'money', total: true },
        { key: 'closing', label: `Detyrimi më ${date(f.to)}`, type: 'money', total: true },
        ...agingColumns,
        { key: 'prepaid', label: 'Parapagim', type: 'money', total: true },
      ]}
    />
  );
}

export function BankReport({ f }) {
  const { accounts, company } = useData();
  const payments = useQuery(all('payments'), []);
  const supplierPayments = useQuery(all('supplierPayments'), []);
  const bankTx = useQuery(all('bankTransactions'), []);
  const rate = Number(company.eurRate) || 0;
  const { summary, detail } = useMemo(() => {
    const s = [];
    const d = [];
    for (const a of accounts) {
      const l = accountLedger(a, { payments: payments.data, supplierPayments: supplierPayments.data, other: bankTx.data }, f.from, f.to, company.eurRate);
      const toAll = (x) => (a.currency === 'EUR' ? round2(x * rate) : x);
      s.push({ id: a.id, name: a.name, kind: ACCOUNT_KINDS[a.kind] || a.kind, currency: a.currency || 'ALL', opening: l.opening, in: l.debit, out: l.credit, closing: l.closing, closingAll: toAll(l.closing), inAll: toAll(l.debit), outAll: toAll(l.credit) });
      for (const r of l.rows) d.push({ ...r, id: `${a.id}_${r.id}`, account: a.name, currency: a.currency || 'ALL' });
    }
    d.sort((x, y) => (x.date || '').localeCompare(y.date || ''));
    return { summary: s, detail: d };
  }, [accounts, payments.data, supplierPayments.data, bankTx.data, f.from, f.to, company.eurRate, rate]);
  return (
    <>
      <DataTable
        title="Bankat dhe arka · gjendjet"
        filtersText={periodText(f)}
        rows={summary}
        search={false}
        columns={[
          { key: 'name', label: 'Llogaria' },
          { key: 'kind', label: 'Lloji' },
          { key: 'opening', label: `Gjendja më ${date(f.from)}`, type: 'money', render: (r) => money(r.opening, r.currency) },
          { key: 'in', label: 'Hyrje', type: 'money', render: (r) => money(r.in, r.currency) },
          { key: 'out', label: 'Dalje', type: 'money', render: (r) => money(r.out, r.currency) },
          { key: 'closing', label: `Gjendja më ${date(f.to)}`, type: 'money', render: (r) => money(r.closing, r.currency) },
          { key: 'inAll', label: 'Hyrje (L)', type: 'money', total: true },
          { key: 'outAll', label: 'Dalje (L)', type: 'money', total: true },
          { key: 'closingAll', label: 'Gjendja (L)', type: 'money', total: true },
        ]}
      />
      <div style={{ height: 16 }} />
      <DataTable
        title="Bankat dhe arka · lëvizjet"
        filtersText={periodText(f)}
        rows={detail}
        columns={[
          { key: 'date', label: 'Data', render: (r) => date(r.date) },
          { key: 'account', label: 'Llogaria' },
          { key: 'doc', label: 'Dokumenti' },
          { key: 'party', label: 'Klienti / furnitori' },
          { key: 'description', label: 'Përshkrimi' },
          { key: 'debit', label: 'Hyrje', type: 'money', render: (r) => (r.debit ? money(r.debit, r.currency) : '') },
          { key: 'credit', label: 'Dalje', type: 'money', render: (r) => (r.credit ? money(r.credit, r.currency) : '') },
        ]}
      />
    </>
  );
}
