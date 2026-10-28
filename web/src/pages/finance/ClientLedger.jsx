import { collection, query, where } from 'firebase/firestore';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { PAYMENT_METHOD_LABELS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { ImportButton } from '../../components/ImportExcel.jsx';
import { Card, Field, PageHeader, SearchSelect } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { clientLabel, clientOption } from '../../lib/clients.js';
import { useData, useQuery } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';
import { firstOfYear, inAll, todayISO } from '../../lib/format.js';
import { prettySegment } from '../../lib/prettyUrl.jsx';
import { agingOf, buildLedger } from '@shared/ledger.js';
import { LedgerView } from '../../components/LedgerView.jsx';
import { InvoiceForm, PaymentForm, invoiceTypeLabel } from './Finance.jsx';
import { OPENING_LABEL, OpeningBalanceForm } from './OpeningBalance.jsx';

const seconds = (x) => x?.createdAt?.seconds || 0;

/** Rreshtat e kartelës (debi = fatura / gjendje fillestare debitore, kredi = likujdime) me gjendjen pas secilit. */
export function ledgerRows(invoices, payments, from, to) {
  const debits = invoices.filter((i) => i.status !== 'cancelled').map((i) => ({
    id: `i${i.id}`, record: i, col: 'invoices', date: i.date, createdAt: seconds(i),
    doc: i.fiscalNumber || i.internalNumber || i.saleNumber || '',
    description: [invoiceTypeLabel(i), i.notes].filter(Boolean).join(' · '),
    dueDate: i.type === 'opening' ? '' : i.dueDate, amount: inAll(i), original: i,
  }));
  const credits = payments.filter((p) => p.status !== 'cancelled').map((p) => ({
    id: `p${p.id}`, record: p, col: 'payments', date: p.date, createdAt: seconds(p),
    doc: p.number || p.reference || '',
    description: p.type === 'opening'
      ? [`${OPENING_LABEL} (parapagim)`, p.notes].filter(Boolean).join(' · ')
      : [`Likujdim · ${PAYMENT_METHOD_LABELS[p.method] || p.method}`, p.accountName, p.reference].filter(Boolean).join(' · '),
    dueDate: '', amount: inAll(p), linkId: p.invoiceId ? `i${p.invoiceId}` : null, original: p,
  }));
  return buildLedger(debits, credits, from, to);
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
  const ledger = useMemo(() => ledgerRows(invoices.data, payments.data, from, to), [invoices.data, payments.data, from, to]);
  const aging = useMemo(() => {
    const all = ledgerRows(invoices.data, payments.data);
    return agingOf(all.rows.filter((r) => r.debit), all.rows.filter((r) => r.credit), to);
  }, [invoices.data, payments.data, to]);
  const openRecord = (r) => {
    if (r.col === 'invoices') setForm({ kind: 'invoice', record: r.record });
    else if (r.record.type === 'opening') setForm({ kind: 'opening', record: { ...r.record, _col: 'payments' } });
  };

  return (
    <>
      <LedgerView
        title={`Kartela · ${clientLabel(client)}`}
        exportTitle={`Kartela e klientit · ${client?.name || ''}${client?.nipt ? ` (NIPT ${client.nipt})` : ''}`}
        ledger={ledger}
        aging={aging}
        from={from} to={to} setFrom={setFrom} setTo={setTo} today={todayISO()}
        labels={{ debit: 'Debi (faturuar)', credit: 'Kredi (likujduar)', owes: 'Gjendja (detyrimi i klientit)', prepaid: 'Gjendja (parapaguar nga klienti)', openTitle: 'Faturat e pashlyera' }}
        onRowClick={canEdit ? openRecord : undefined}
        actions={canEdit && (
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn small" onClick={() => setForm({ kind: 'opening', record: { clientId } })}><Plus size={15} /> Gjendje fillestare</button>
            <button type="button" className="btn small" onClick={() => setForm({ kind: 'invoice', record: { clientId } })}><Plus size={15} /> Faturë</button>
            <button type="button" className="btn small primary" onClick={() => setForm({ kind: 'payment', record: { clientId } })}><Plus size={15} /> Likujdim</button>
          </div>
        )}
      />
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
