import { collection, query, where } from 'firebase/firestore';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { PAYMENT_METHOD_LABELS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { DataTable } from '../../components/DataTable.jsx';
import { ImportButton } from '../../components/ImportExcel.jsx';
import { Card, Field, PageHeader, SearchSelect, Stat } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { clientLabel, clientOption } from '../../lib/clients.js';
import { useData, useQuery } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';
import { date, firstOfYear, inAll, money, round2, todayISO } from '../../lib/format.js';
import { prettySegment } from '../../lib/prettyUrl.jsx';
import { InvoiceForm, PaymentForm, invoiceTypeLabel } from './Finance.jsx';
import { OPENING_LABEL, OpeningBalanceForm } from './OpeningBalance.jsx';

const seconds = (x) => x?.createdAt?.seconds || 0;

/** Rreshtat e kartelës (debi = fatura / gjendje fillestare debitore, kredi = likujdime) me gjendjen pas secilit. */
export function ledgerRows(invoices, payments, from, to) {
  const all = [
    ...invoices.filter((i) => i.status !== 'cancelled').map((i) => ({
      id: `i${i.id}`, record: i, col: 'invoices', date: i.date, createdAt: seconds(i),
      doc: i.fiscalNumber || i.internalNumber || i.saleNumber || '',
      description: [invoiceTypeLabel(i), i.notes].filter(Boolean).join(' · '),
      dueDate: i.type === 'opening' ? '' : i.dueDate, debit: inAll(i), credit: 0, original: i,
    })),
    ...payments.filter((p) => p.status !== 'cancelled').map((p) => ({
      id: `p${p.id}`, record: p, col: 'payments', date: p.date, createdAt: seconds(p),
      doc: p.number || p.reference || '',
      description: p.type === 'opening'
        ? [`${OPENING_LABEL} (parapagim)`, p.notes].filter(Boolean).join(' · ')
        : [`Likujdim · ${PAYMENT_METHOD_LABELS[p.method] || p.method}`, p.reference].filter(Boolean).join(' · '),
      dueDate: '', debit: 0, credit: inAll(p), original: p,
    })),
  ].sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.createdAt - b.createdAt);
  const before = all.filter((r) => r.date < from);
  const opening = round2(before.reduce((s, r) => s + r.debit - r.credit, 0));
  let balance = opening;
  const rows = all.filter((r) => r.date >= from && r.date <= to).map((r) => {
    balance = round2(balance + r.debit - r.credit);
    return { ...r, balance };
  });
  return { opening, rows, closing: balance };
}

/** Kartela e një klienti: gjendja fillestare, faturat, likujdimet dhe gjendja pas çdo veprimi. */
export function ClientLedger({ clientId }) {
  const { clientsById } = useData();
  const { can } = useAuth();
  const canEdit = can(CAPS.FINANCE);
  const client = clientsById[clientId];
  const [from, setFrom] = useState(firstOfYear());
  const [to, setTo] = useState(todayISO());
  const [form, setForm] = useState(null);
  const invoices = useQuery(() => query(collection(db, 'invoices'), where('clientId', '==', clientId)), [clientId]);
  const payments = useQuery(() => query(collection(db, 'payments'), where('clientId', '==', clientId)), [clientId]);
  const { opening, rows, closing } = useMemo(() => ledgerRows(invoices.data, payments.data, from, to), [invoices.data, payments.data, from, to]);
  const debit = round2(rows.reduce((s, r) => s + r.debit, 0));
  const credit = round2(rows.reduce((s, r) => s + r.credit, 0));
  const tableRows = [
    { id: 'opening', date: from, doc: '', description: `Gjendja më ${date(from)}`, debit: opening > 0 ? opening : 0, credit: opening < 0 ? -opening : 0, balance: opening, isOpening: true },
    ...rows,
  ];
  const openRecord = (r) => {
    if (!canEdit || r.isOpening) return;
    if (r.col === 'invoices') setForm({ kind: 'invoice', record: r.record });
    else if (r.record.type === 'opening') setForm({ kind: 'opening', record: { ...r.record, _col: 'payments' } });
  };
  const tone = (v) => (v > 0.01 ? 'danger' : 'ok');

  return (
    <>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label={`Gjendja më ${date(from)}`} value={money(opening)} />
        <Stat label="Debi (faturuar)" value={money(debit)} />
        <Stat label="Kredi (likujduar)" value={money(credit)} tone="ok" />
        <Stat label={closing < -0.01 ? 'Gjendja (parapaguar nga klienti)' : 'Gjendja (detyrimi i klientit)'} value={money(Math.abs(closing))} tone={tone(closing)} />
      </div>
      <Card
        title={`Kartela · ${clientLabel(client)}`}
        actions={canEdit && (
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn small" onClick={() => setForm({ kind: 'opening', record: { clientId } })}><Plus size={15} /> Gjendje fillestare</button>
            <button type="button" className="btn small" onClick={() => setForm({ kind: 'invoice', record: { clientId } })}><Plus size={15} /> Faturë</button>
            <button type="button" className="btn small primary" onClick={() => setForm({ kind: 'payment', record: { clientId } })}><Plus size={15} /> Likujdim</button>
          </div>
        )}
      >
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <Field label="Nga data"><input type="date" value={from} onChange={(e) => setFrom(e.target.value || '2000-01-01')} /></Field>
          <Field label="Deri më"><input type="date" value={to} onChange={(e) => setTo(e.target.value || todayISO())} /></Field>
        </div>
        <DataTable
          search={false}
          title={`Kartela e klientit · ${client?.name || ''}${client?.nipt ? ` (NIPT ${client.nipt})` : ''}`}
          filtersText={[`Periudha: ${date(from)} – ${date(to)}`]}
          rows={tableRows}
          onRowClick={canEdit ? openRecord : undefined}
          empty="Nuk ka veprime në këtë periudhë."
          columns={[
            { key: 'date', label: 'Data', sortable: false, render: (r) => date(r.date), value: (r) => r.date },
            { key: 'doc', label: 'Dokumenti', sortable: false },
            { key: 'description', label: 'Përshkrimi', sortable: false, render: (r) => (r.isOpening ? <strong>{r.description}</strong> : r.description) },
            { key: 'dueDate', label: 'Afati', sortable: false, render: (r) => (r.dueDate ? date(r.dueDate) : ''), value: (r) => r.dueDate || '' },
            { key: 'original', label: 'Në euro', sortable: false, value: (r) => (r.original?.currency === 'EUR' ? r.original.amount : ''), render: (r) => (r.original?.currency === 'EUR' ? money(r.original.amount, 'EUR') : '') },
            { key: 'debit', label: 'Debi', type: 'money', total: true, sortable: false },
            { key: 'credit', label: 'Kredi', type: 'money', total: true, sortable: false },
            { key: 'balance', label: 'Gjendja', type: 'money', sortable: false },
          ]}
        />
      </Card>
      {form?.kind === 'opening' && <OpeningBalanceForm record={form.record} onClose={() => setForm(null)} />}
      {form?.kind === 'invoice' && <InvoiceForm record={form.record} onClose={() => setForm(null)} />}
      {form?.kind === 'payment' && (
        <PaymentForm record={form.record} invoices={invoices.data.filter((i) => i.status !== 'cancelled')} onClose={() => setForm(null)} />
      )}
    </>
  );
}

/** Faqja Financa → Kartela e klientit: zgjidhet klienti (adresa mban emrin e tij, p.sh. ?klienti=hotel-riviera). */
export function ClientLedgerPage({ section }) {
  const { clients } = useData();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [openingForm, setOpeningForm] = useState(false);
  const slug = params.get('klienti') || '';
  const client = clients.find((c) => prettySegment('clients', c, { clients }) === slug || c.id === slug);
  const pick = (id) => {
    const c = clients.find((x) => x.id === id);
    setParams(c ? { klienti: prettySegment('clients', c, { clients }) } : {});
  };
  return (
    <>
      <PageHeader
        title={section.title}
        subtitle={section.subtitle}
        actions={can(CAPS.FINANCE) && (
          <>
            <ImportButton type="clientBalances" label="Import gjendjesh" />
            <button type="button" className="btn" onClick={() => setOpeningForm(true)}><Plus size={16} /> Gjendje fillestare</button>
          </>
        )}
      />
      <Card>
        <Field label="Klienti">
          <SearchSelect options={clients.map((c) => clientOption(c, [c.nipt, c.phone, c.city]))} value={client?.id || ''} onChange={pick} placeholder="Kërko klientin me emër, emër tregtar ose NIPT…" />
        </Field>
        {client && <p className="muted" style={{ margin: '6px 0 0' }}><Link to={`/klientet/${prettySegment('clients', client, { clients })}`}>Hap kartelën e plotë të klientit →</Link></p>}
        {!client && <p className="muted" style={{ margin: '6px 0 0' }}>Gjendjet fillestare të shumë klientëve njëherësh i importoni nga Excel me butonin «Import gjendjesh».</p>}
      </Card>
      {client && <ClientLedger key={client.id} clientId={client.id} />}
      {openingForm && <OpeningBalanceForm record={client ? { clientId: client.id } : {}} onClose={() => setOpeningForm(false)} />}
    </>
  );
}
