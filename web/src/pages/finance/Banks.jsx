// Bankat dhe arka: llogaritë me gjendjen dhe lëvizjet, pagesat pa llogari,
// dhe rakordimi i ekstraktit bankar me arkëtimet nga klientët dhe pagesat te furnitorët.
import { collection, deleteField, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { Check, Plus, Undo2, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';

import { detectColumns, statementRows, suggestMatch, txKey } from '@shared/bank.js';
import { CAPS } from '@shared/roles.js';

import { DataTable } from '../../components/DataTable.jsx';
import { EntityForm } from '../../components/EntityForm.jsx';
import { Card, Field, Modal, PageHeader, SearchSelect, Tabs, useAction } from '../../components/ui.jsx';
import { LedgerView } from '../../components/LedgerView.jsx';
import { ACCOUNT_KINDS, accountLabel, accountLedger, amountInAccount, defaultAccountId } from '../../lib/accounts.js';
import { useAuth } from '../../lib/auth.jsx';
import { clientOption } from '../../lib/clients.js';
import { useData, useQuery } from '../../lib/data.jsx';
import { readSheetMatrix } from '../../lib/export.js';
import { call, db } from '../../lib/firebase.js';
import { date, firstOfYear, inAll, money, round2, todayISO, toNumber } from '../../lib/format.js';

const OTHER_CATEGORIES = ['Komision banke', 'Transfertë mes llogarive', 'Tërheqje / derdhje cash', 'Rroga', 'Tatime dhe sigurime', 'Qira', 'Karburant', 'Shpenzime të tjera', 'Të ardhura të tjera'];
const all = (name) => () => collection(db, name);
const FEE_RE = /(komision|commission|tarif|fee|mirembajtje|mirëmbajtje|interes|interest|charge)/i;

/** Të dhënat e përbashkëta të faqes: pagesat e klientëve, të furnitorëve dhe rreshtat e ekstrakteve. */
function useBankData() {
  const payments = useQuery(all('payments'), []);
  const supplierPayments = useQuery(all('supplierPayments'), []);
  const bankTx = useQuery(all('bankTransactions'), []);
  return { payments: payments.data, supplierPayments: supplierPayments.data, bankTx: bankTx.data, loading: payments.loading || supplierPayments.loading || bankTx.loading };
}

export function BanksPage({ section }) {
  const { accounts } = useData();
  const { can } = useAuth();
  const canEdit = can(CAPS.FINANCE);
  const [tab, setTab] = useState('accounts');
  const [accountForm, setAccountForm] = useState(null);
  const data = useBankData();
  const unassigned = [
    ...data.payments.filter((p) => p.status !== 'cancelled' && p.type !== 'opening' && !p.accountId),
    ...data.supplierPayments.filter((p) => p.status !== 'cancelled' && p.type !== 'opening' && !p.accountId),
  ];
  const openTx = data.bankTx.filter((t) => t.status === 'open').length;
  return (
    <>
      <PageHeader
        title={section.title}
        subtitle={section.subtitle}
        actions={canEdit && <button type="button" className="btn primary" onClick={() => setAccountForm({})}><Plus size={16} /> Llogari / arkë</button>}
      />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'accounts', label: 'Llogaritë dhe gjendjet' },
        { key: 'reconcile', label: `Ekstrakti bankar${openTx ? ` (${openTx} pa rakorduar)` : ''}` },
        { key: 'unassigned', label: `Pagesat pa bankë/arkë (${unassigned.length})` },
      ]} />
      {!accounts.length && (
        <div className="alert info">Shtoni llogaritë bankare (BKT, Raiffeisen…) dhe arkën me butonin «Llogari / arkë». Pastaj çdo pagesë lidhet me llogarinë ku hyn ose nga ku del.</div>
      )}
      {tab === 'accounts' && <AccountsTab data={data} onEdit={canEdit ? setAccountForm : undefined} />}
      {tab === 'reconcile' && <ReconcileTab data={data} canEdit={canEdit} />}
      {tab === 'unassigned' && <UnassignedTab rows={unassigned} canEdit={canEdit} />}
      {accountForm && (
        <EntityForm
          title={accountForm.id ? `Ndrysho ${accountForm.name}` : 'Llogari e re'}
          collectionName="accounts"
          record={accountForm.id ? accountForm : null}
          defaults={{ kind: 'bank', currency: 'ALL', openingBalance: 0, openingDate: firstOfYear(), active: true }}
          onClose={() => setAccountForm(null)}
          fields={[
            { key: 'name', label: 'Emri', required: true, hint: 'p.sh. BKT lekë, Raiffeisen euro, Arka kryesore' },
            { key: 'kind', label: 'Lloji', type: 'select', required: true, options: Object.entries(ACCOUNT_KINDS).map(([value, label]) => ({ value, label })) },
            { key: 'currency', label: 'Monedha', type: 'select', required: true, options: [{ value: 'ALL', label: 'Lekë (ALL)' }, { value: 'EUR', label: 'Euro (EUR)' }] },
            { key: 'bank', label: 'Banka' },
            { key: 'iban', label: 'IBAN', span: 2 },
            { key: 'openingBalance', label: 'Gjendja fillestare', type: 'number', hint: 'Gjendja e llogarisë në datën e fillimit.' },
            { key: 'openingDate', label: 'Data e gjendjes fillestare', type: 'date' },
            { key: 'active', label: 'Aktive', type: 'checkbox' },
          ]}
          transform={(d) => ({ ...d, iban: String(d.iban || '').replace(/\s+/g, '').toUpperCase(), openingBalance: toNumber(d.openingBalance) })}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- Llogaritë dhe lëvizjet

function AccountsTab({ data, onEdit }) {
  const { accounts, company } = useData();
  const [selected, setSelected] = useState(null);
  const [from, setFrom] = useState(firstOfYear());
  const [to, setTo] = useState(todayISO());
  const [manual, setManual] = useState(false);
  const { can } = useAuth();
  const today = todayISO();
  const rows = accounts.map((a) => {
    const l = accountLedger(a, { payments: data.payments, supplierPayments: data.supplierPayments, other: data.bankTx }, '0000-00-00', today, company.eurRate);
    return { ...a, balance: l.closing, balanceAll: a.currency === 'EUR' ? round2(l.closing * (Number(company.eurRate) || 0)) : l.closing };
  });
  const account = accounts.find((a) => a.id === selected) || null;
  const ledger = useMemo(
    () => (account ? accountLedger(account, { payments: data.payments, supplierPayments: data.supplierPayments, other: data.bankTx }, from, to, company.eurRate) : null),
    [account, data.payments, data.supplierPayments, data.bankTx, from, to, company.eurRate],
  );
  return (
    <>
      <DataTable
        title="Llogaritë bankare dhe arka"
        rows={rows}
        search={false}
        onRowClick={(a) => setSelected(a.id)}
        columns={[
          { key: 'name', label: 'Llogaria', render: (a) => <strong>{a.name}</strong> },
          { key: 'kind', label: 'Lloji', value: (a) => ACCOUNT_KINDS[a.kind] || a.kind },
          { key: 'bank', label: 'Banka' },
          { key: 'iban', label: 'IBAN' },
          { key: 'currency', label: 'Monedha' },
          { key: 'balance', label: 'Gjendja sot', type: 'money', render: (a) => money(a.balance, a.currency) },
          { key: 'balanceAll', label: 'Në lekë', type: 'money', total: true },
          { key: 'active', label: 'Statusi', value: (a) => (a.active === false ? 'Joaktive' : 'Aktive') },
          ...(onEdit ? [{ key: 'edit', label: '', export: false, sortable: false, render: (a) => <button type="button" className="btn small" onClick={(e) => { e.stopPropagation(); onEdit(a); }}>Ndrysho</button> }] : []),
        ]}
      />
      {account && ledger && (
        <LedgerView
          title={`Lëvizjet · ${accountLabel(account)}`}
          exportTitle={`Lëvizjet e llogarisë · ${account.name}${account.iban ? ` (${account.iban})` : ''}`}
          ledger={ledger}
          from={from} to={to} setFrom={setFrom} setTo={setTo} today={today}
          labels={{ debit: 'Hyrje', credit: 'Dalje', owes: 'Gjendja', prepaid: 'Gjendja (negative)', signed: true, currency: account.currency, debitColumn: 'Hyrje', creditColumn: 'Dalje', partyColumn: 'Klienti / furnitori', noDue: true }}
          actions={can(CAPS.FINANCE) && <button type="button" className="btn small" onClick={() => setManual(true)}><Plus size={15} /> Lëvizje tjetër</button>}
        />
      )}
      {manual && account && <OtherMovementForm account={account} onClose={() => setManual(false)} />}
    </>
  );
}

/** Lëvizje që nuk është arkëtim apo pagesë furnitori (komision, rrogë, derdhje cash…), p.sh. për arkën. */
function OtherMovementForm({ account, onClose, tx }) {
  const { uid } = useAuth();
  const [v, setV] = useState({ date: tx?.date || todayISO(), direction: tx ? (tx.amount >= 0 ? 'in' : 'out') : 'out', amount: tx ? Math.abs(tx.amount) : '', category: OTHER_CATEGORIES[0], description: tx?.description || '' });
  const [run, busy] = useAction();
  const save = () => run(async () => {
    if (!(toNumber(v.amount) > 0)) throw new Error('Shkruani shumën.');
    const amount = (v.direction === 'in' ? 1 : -1) * toNumber(v.amount);
    const ref = tx ? doc(db, 'bankTransactions', tx.id) : doc(collection(db, 'bankTransactions'));
    const match = { kind: 'other', category: v.category, by: uid, at: new Date().toISOString() };
    if (tx) await updateDoc(ref, { status: 'matched', match });
    else await setDoc(ref, { accountId: account.id, accountName: account.name, date: v.date, amount, description: v.description, counterparty: '', reference: '', status: 'matched', match, source: 'manual', createdBy: uid, createdAt: serverTimestamp() });
    onClose();
  }, 'Lëvizja u regjistrua.');
  return (
    <Modal title={`Lëvizje tjetër · ${account.name}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Anulo</button><button type="button" className="btn primary" disabled={busy} onClick={save}>Ruaj</button></>}>
      <div className="form-grid">
        <Field label="Drejtimi">
          <select value={v.direction} disabled={Boolean(tx)} onChange={(e) => setV({ ...v, direction: e.target.value })}>
            <option value="out">Dalje</option>
            <option value="in">Hyrje</option>
          </select>
        </Field>
        <Field label={`Shuma (${account.currency === 'EUR' ? '€' : 'L'})`}><input className="num" type="number" step="any" value={v.amount} disabled={Boolean(tx)} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
        <Field label="Data"><input type="date" value={v.date} disabled={Boolean(tx)} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
        <Field label="Kategoria">
          <select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>
            {OTHER_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Përshkrimi" className="span-all"><input value={v.description} disabled={Boolean(tx)} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Pagesat pa llogari

function UnassignedTab({ rows, canEdit }) {
  const { accounts, accountsById } = useData();
  const [run, busy] = useAction();
  const assign = (p, accountId) => updateDoc(doc(db, p.supplierId ? 'supplierPayments' : 'payments', p.id), { accountId: accountId || null, accountName: accountId ? accountLabel(accountsById[accountId]) : '' });
  const auto = () => run(async () => {
    let n = 0;
    for (const p of rows) {
      const id = defaultAccountId(p.method, accounts, p.currency || 'ALL');
      if (id) { await assign(p, id); n += 1; }
    }
    return n;
  }, (n) => `${n} pagesa u lidhën me bankën / arkën.`);
  return (
    <Card
      title="Pagesat pa bankë ose arkë"
      actions={canEdit && rows.length > 0 && accounts.length > 0 && <button type="button" className="btn small primary" disabled={busy} onClick={auto}>Cakto automatikisht (cash → arka, bankë/kartë → banka)</button>}
    >
      <p className="muted" style={{ marginTop: 0 }}>Që gjendjet e bankave dhe arkës të jenë të sakta, çdo pagesë duhet të jetë e lidhur me llogarinë ku hyri ose nga doli.</p>
      <DataTable
        title="Pagesat pa bankë/arkë"
        rows={rows}
        empty="Të gjitha pagesat janë të lidhura me një llogari."
        columns={[
          { key: 'date', label: 'Data', render: (p) => date(p.date) },
          { key: 'number', label: 'Nr.' },
          { key: 'type', label: 'Lloji', value: (p) => (p.supplierId ? 'Pagesë te furnitori' : 'Arkëtim nga klienti') },
          { key: 'party', label: 'Klienti / furnitori', value: (p) => p.clientName || p.supplierName },
          { key: 'method', label: 'Mënyra' },
          { key: 'amount', label: 'Shuma', type: 'money', total: true, value: (p) => inAll(p) },
          {
            key: 'account', label: 'Banka / arka', export: false, sortable: false,
            render: (p) => canEdit && (
              <select value="" onChange={(e) => run(() => assign(p, e.target.value), 'U lidh.')} onClick={(e) => e.stopPropagation()}>
                <option value="">Zgjidh…</option>
                {accounts.filter((a) => a.active !== false).map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
              </select>
            ),
          },
        ]}
      />
    </Card>
  );
}

// ---------------------------------------------------------------- Rakordimi i ekstraktit

function ReconcileTab({ data, canEdit }) {
  const { accounts, accountsById, clients, clientsById, suppliers, suppliersById, company } = useData();
  const { uid } = useAuth();
  const banks = accounts.filter((a) => a.active !== false);
  const [accountId, setAccountId] = useState(() => banks.find((a) => a.kind === 'bank')?.id || banks[0]?.id || '');
  const [importing, setImporting] = useState(false);
  const [choices, setChoices] = useState({});
  const [otherTx, setOtherTx] = useState(null);
  const [run, busy] = useAction();
  const account = accountsById[accountId];
  const txs = data.bankTx.filter((t) => t.accountId === accountId).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const open = txs.filter((t) => t.status === 'open');
  const done = txs.filter((t) => t.status !== 'open');

  const withAmounts = (list) => list.map((p) => ({ ...p, accountAmount: amountInAccount(p, account, company.eurRate) }));
  const ctx = useMemo(() => ({
    accountId, clients, suppliers, payments: withAmounts(data.payments), supplierPayments: withAmounts(data.supplierPayments),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [accountId, clients, suppliers, data.payments, data.supplierPayments, account, company.eurRate]);

  const choiceOf = (t) => {
    if (choices[t.id]) return choices[t.id];
    const s = suggestMatch(t, ctx);
    if (!s) {
      // Komisionet dhe tarifat e bankës nuk janë pagesa partnerësh.
      if (FEE_RE.test(`${t.description} ${t.counterparty}`)) return { kind: 'other', suggested: false };
      return { kind: t.amount > 0 ? 'client' : 'supplier', partyId: '', suggested: false };
    }
    if (s.kind === 'link') return { kind: 'link', col: s.col, paymentId: s.payment.id, payment: s.payment, suggested: true };
    return { kind: s.kind, partyId: s.party.id, suggested: true };
  };
  const setChoice = (t, patch) => setChoices((c) => ({ ...c, [t.id]: { ...choiceOf(t), ...patch, suggested: false } }));

  /** Konfirmon një rresht: lidh pagesën ekzistuese, krijon arkëtim/pagesë të re, ose e shënon si lëvizje tjetër. */
  const confirmTx = async (t, ch) => {
    const batch = writeBatch(db);
    const txRef = doc(db, 'bankTransactions', t.id);
    const at = new Date().toISOString();
    const accFields = { accountId: account.id, accountName: accountLabel(account) };
    if (ch.kind === 'link') {
      batch.update(doc(db, ch.col, ch.paymentId), { ...accFields, bankTxId: t.id });
      const p = ch.payment;
      batch.update(txRef, { status: 'matched', match: { kind: ch.col === 'payments' ? 'client' : 'supplier', paymentId: ch.paymentId, col: ch.col, created: false, partyId: p.clientId || p.supplierId, partyName: p.clientName || p.supplierName, by: uid, at } });
    } else if (ch.kind === 'client' || ch.kind === 'supplier') {
      if (!ch.partyId) throw new Error(`Zgjidhni ${ch.kind === 'client' ? 'klientin' : 'furnitorin'} për rreshtin e ${date(t.date)} (${money(t.amount, account.currency)}).`);
      const isClient = ch.kind === 'client';
      const col = isClient ? 'payments' : 'supplierPayments';
      const rate = account.currency === 'EUR' ? Number(company.eurRate) : 1;
      if (account.currency === 'EUR' && !(rate > 1)) throw new Error('Vendosni kursin e euros te Cilësimet.');
      const { number } = await call('allocateNumber', { prefix: isClient ? 'MA' : 'MP' });
      const ref = doc(collection(db, col));
      const amount = Math.abs(t.amount);
      const party = isClient ? clientsById[ch.partyId] : suppliersById[ch.partyId];
      batch.set(ref, {
        number, date: t.date, amount, currency: account.currency || 'ALL', exchangeRate: rate, amountAll: round2(amount * rate),
        method: 'bank', reference: [t.reference, t.description].filter(Boolean).join(' · ').slice(0, 200), ...accFields, bankTxId: t.id,
        ...(isClient ? { clientId: party.id, clientName: party.name, invoiceId: null } : { supplierId: party.id, supplierName: party.name, supplierInvoiceId: null }),
        status: 'active', source: 'bank', createdBy: uid, createdAt: serverTimestamp(),
      });
      batch.update(txRef, { status: 'matched', match: { kind: ch.kind, paymentId: ref.id, col, created: true, partyId: party.id, partyName: party.name, by: uid, at } });
    } else if (ch.kind === 'ignore') {
      batch.update(txRef, { status: 'ignored', match: { kind: 'ignore', by: uid, at } });
    }
    await batch.commit();
  };

  const confirmOne = (t) => {
    const ch = choiceOf(t);
    if (ch.kind === 'other') { setOtherTx(t); return; }
    run(() => confirmTx(t, ch), 'Rreshti u rakordua.');
  };
  const confirmSuggested = () => run(async () => {
    let n = 0;
    for (const t of open) {
      const ch = choiceOf(t);
      if (!ch.suggested) continue;
      await confirmTx(t, ch);
      n += 1;
    }
    return n;
  }, (n) => `${n} rreshta u rakorduan sipas sugjerimeve.`);

  const undo = (t) => run(async () => {
    const batch = writeBatch(db);
    const m = t.match || {};
    if (m.paymentId && m.col) {
      batch.update(doc(db, m.col, m.paymentId), m.created ? { status: 'cancelled', bankTxId: deleteField() } : { bankTxId: deleteField() });
    }
    batch.update(doc(db, 'bankTransactions', t.id), { status: 'open', match: deleteField() });
    await batch.commit();
  }, 'Rakordimi u zhbë.');

  const kindOptions = (t) => (t.amount > 0
    ? [['client', 'Arkëtim nga klienti'], ['link', 'Lidh me arkëtim ekzistues'], ['other', 'Tjetër (komision, transfertë…)'], ['ignore', 'Injoro']]
    : [['supplier', 'Pagesë te furnitori'], ['link', 'Lidh me pagesë ekzistuese'], ['other', 'Tjetër (komision, rroga…)'], ['ignore', 'Injoro']]);
  const linkCandidates = (t) => (t.amount > 0 ? ctx.payments : ctx.supplierPayments)
    .filter((p) => p.status !== 'cancelled' && !p.bankTxId && p.type !== 'opening' && (!p.accountId || p.accountId === accountId))
    .filter((p) => Math.abs(p.accountAmount - Math.abs(t.amount)) < 0.01);
  const suggestedCount = open.filter((t) => choiceOf(t).suggested).length;

  if (!banks.length) return null;
  return (
    <>
      <Card>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Llogaria">
            <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setChoices({}); }}>
              {banks.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}{a.iban ? ` · ${a.iban}` : ''}</option>)}
            </select>
          </Field>
          {canEdit && <button type="button" className="btn primary" onClick={() => setImporting(true)}><Upload size={16} /> Importo ekstraktin (Excel / CSV)</button>}
          {canEdit && suggestedCount > 0 && <button type="button" className="btn ok" disabled={busy} onClick={confirmSuggested}><Check size={16} /> Konfirmo {suggestedCount} sugjerime</button>}
        </div>
        <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 0 }}>
          Shkarkoni ekstraktin nga e-banking në Excel (.xlsx) ose CSV. Sistemi gjen vetë kolonat (data, përshkrimi, debi/kredi ose shuma) dhe sugjeron klientin ose furnitorin nga NIPT-i / emri në përshkrim,
          ose pagesën e regjistruar me të njëjtën shumë. Rreshtat e importuar më parë nuk dyfishohen.
        </p>
      </Card>
      <Card title={`Pa rakorduar (${open.length})`}>
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr><th>Data</th><th>Përshkrimi</th><th className="r">Shuma</th><th>Rakordimi</th><th /></tr>
            </thead>
            <tbody>
              {open.map((t) => {
                const ch = choiceOf(t);
                const isIn = t.amount > 0;
                return (
                  <tr key={t.id}>
                    <td data-label="Data">{date(t.date)}</td>
                    <td data-label="Përshkrimi" style={{ maxWidth: 360 }}>
                      {t.counterparty && <strong>{t.counterparty} · </strong>}{t.description}
                      {t.reference && <div className="muted" style={{ fontSize: '0.8rem' }}>Ref. {t.reference}</div>}
                    </td>
                    <td data-label="Shuma" className="r" style={{ color: isIn ? 'var(--ok, #15803d)' : 'var(--danger, #b91c1c)', whiteSpace: 'nowrap' }}>{money(t.amount, account?.currency)}</td>
                    <td data-label="Rakordimi" style={{ minWidth: 300 }}>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <select value={ch.kind} disabled={!canEdit} onChange={(e) => {
                          const kind = e.target.value;
                          if (kind === 'link') { const c = linkCandidates(t)[0]; setChoice(t, { kind, col: isIn ? 'payments' : 'supplierPayments', paymentId: c?.id || '', payment: c }); } else setChoice(t, { kind });
                        }}>
                          {kindOptions(t).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                        {(ch.kind === 'client' || ch.kind === 'supplier') && (
                          <SearchSelect
                            options={ch.kind === 'client' ? clients.map((c) => clientOption(c)) : suppliers.map((s) => ({ value: s.id, label: s.name, sub: s.nipt || '' }))}
                            value={ch.partyId || ''} disabled={!canEdit}
                            onChange={(id) => setChoice(t, { partyId: id })}
                            placeholder={ch.kind === 'client' ? 'Zgjidh klientin…' : 'Zgjidh furnitorin…'}
                          />
                        )}
                        {ch.kind === 'link' && (
                          <select value={ch.paymentId || ''} disabled={!canEdit} onChange={(e) => { const c = linkCandidates(t).find((p) => p.id === e.target.value); setChoice(t, { paymentId: e.target.value, payment: c }); }}>
                            <option value="">— asnjë pagesë me këtë shumë —</option>
                            {linkCandidates(t).map((p) => <option key={p.id} value={p.id}>{p.number || ''} · {date(p.date)} · {p.clientName || p.supplierName}</option>)}
                          </select>
                        )}
                        {ch.suggested && <small className="text-ok">Sugjerim automatik</small>}
                      </div>
                    </td>
                    <td className="r">
                      {canEdit && <button type="button" className="btn small primary" disabled={busy || (ch.kind === 'link' && !ch.paymentId)} onClick={() => confirmOne(t)}>Konfirmo</button>}
                    </td>
                  </tr>
                );
              })}
              {!open.length && <tr><td colSpan={5} className="muted">Nuk ka rreshta pa rakorduar për këtë llogari.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={`Të rakorduara (${done.length})`}>
        <DataTable
          title={`Rakordimi · ${account?.name || ''}`}
          rows={[...done].reverse()}
          columns={[
            { key: 'date', label: 'Data', render: (t) => date(t.date) },
            { key: 'description', label: 'Përshkrimi', value: (t) => [t.counterparty, t.description].filter(Boolean).join(' · ') },
            { key: 'amount', label: 'Shuma', type: 'money', total: true },
            { key: 'match', label: 'Lidhur me', value: (t) => ({ client: `Klienti: ${t.match?.partyName}`, supplier: `Furnitori: ${t.match?.partyName}`, other: t.match?.category, ignore: 'Injoruar' }[t.match?.kind] || '') },
            { key: 'how', label: '', value: (t) => (t.match?.created ? 'pagesë e re' : t.match?.paymentId ? 'pagesë ekzistuese' : '') },
            ...(canEdit ? [{ key: 'undo', label: '', export: false, sortable: false, render: (t) => t.source !== 'manual' && <button type="button" className="btn small" disabled={busy} onClick={() => undo(t)}><Undo2 size={14} /> Zhbëj</button> }] : []),
          ]}
        />
      </Card>
      {importing && account && <StatementImport account={account} existing={new Set(txs.map((t) => t.id))} onClose={() => setImporting(false)} />}
      {otherTx && account && <OtherMovementForm account={account} tx={otherTx} onClose={() => setOtherTx(null)} />}
    </>
  );
}

const FIELD_LABELS = {
  date: 'Data', description: 'Përshkrimi', counterparty: 'Pagues / përfitues', amount: 'Shuma (+ / −)', credit: 'Kredi (hyrje)', debit: 'Debi (dalje)', reference: 'Referenca',
};

/** Importi i ekstraktit: lexim, harta e kolonave (e gjetur automatikisht, e ndryshueshme), parapamja dhe ruajtja. */
function StatementImport({ account, existing, onClose }) {
  const { uid } = useAuth();
  const [matrix, setMatrix] = useState(null);
  const [fileName, setFileName] = useState('');
  const [headerRow, setHeaderRow] = useState(0);
  const [map, setMap] = useState({});
  const [run, busy] = useAction();
  const load = (file) => run(async () => {
    const m = await readSheetMatrix(file);
    const d = detectColumns(m);
    setFileName(file.name);
    setMatrix(m);
    setHeaderRow(d.headerRow);
    setMap(d.map);
  });
  const headers = matrix ? (matrix[headerRow] || []).map((h, i) => String(h || `Kolona ${i + 1}`)) : [];
  const rows = matrix && map.date !== undefined ? statementRows(matrix, headerRow, map) : [];
  const keyed = rows.map((r) => ({ ...r, id: txKey(account.id, r) }));
  const fresh = keyed.filter((r, i) => !existing.has(r.id) && keyed.findIndex((x) => x.id === r.id) === i);
  const save = () => run(async () => {
    for (let i = 0; i < fresh.length; i += 400) {
      const batch = writeBatch(db);
      for (const r of fresh.slice(i, i + 400)) {
        const { id, ...rest } = r;
        batch.set(doc(db, 'bankTransactions', id), { ...rest, accountId: account.id, accountName: account.name, status: 'open', source: 'statement', fileName, createdBy: uid, createdAt: serverTimestamp() });
      }
      await batch.commit();
    }
    onClose();
    return fresh.length;
  }, (n) => `${n} rreshta u importuan. Rakordojini më poshtë.`);
  const setCol = (key, idx) => setMap((m) => { const next = { ...m }; if (idx === '') delete next[key]; else next[key] = Number(idx); return next; });

  return (
    <Modal title={`Importo ekstraktin · ${account.name}`} onClose={onClose} wide
      footer={<><button type="button" className="btn" onClick={onClose}>Anulo</button><button type="button" className="btn primary" disabled={busy || !fresh.length} onClick={save}>Importo {fresh.length} rreshta</button></>}>
      <Field label="Skedari i ekstraktit (.xlsx ose .csv)">
        <input type="file" accept=".xlsx,.csv,.txt" disabled={busy} onChange={(e) => e.target.files[0] && load(e.target.files[0])} />
      </Field>
      <p className="muted" style={{ fontSize: '0.85rem' }}>Nëse banka jep .xls (format i vjetër), hapeni në Excel dhe ruajeni si .xlsx ose CSV.</p>
      {matrix && (
        <>
          <div className="form-grid" style={{ marginTop: 8 }}>
            <Field label="Rreshti i titujve"><input className="num" type="number" min={1} value={headerRow + 1} onChange={(e) => setHeaderRow(Math.max(0, Number(e.target.value) - 1))} /></Field>
            {Object.entries(FIELD_LABELS).map(([key, label]) => (
              <Field key={key} label={label}>
                <select value={map[key] ?? ''} onChange={(e) => setCol(key, e.target.value)}>
                  <option value="">—</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
              </Field>
            ))}
          </div>
          {map.date === undefined || (map.amount === undefined && map.debit === undefined && map.credit === undefined) ? (
            <div className="alert warn">Zgjidhni kolonën e datës dhe kolonën e shumës (ose kolonat Debi / Kredi).</div>
          ) : (
            <>
              <div className="alert info">
                {rows.length} veprime të lexuara · hyrje {money(round2(rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0)), account.currency)} · dalje {money(round2(rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0)), account.currency)}
                {rows.length - fresh.length > 0 && ` · ${rows.length - fresh.length} të importuara më parë (anashkalohen)`}
              </div>
              <div className="table-wrap" style={{ maxHeight: 280 }}>
                <table className="table">
                  <thead><tr><th>Data</th><th>Përshkrimi</th><th className="r">Shuma</th></tr></thead>
                  <tbody>{rows.slice(0, 15).map((r, i) => <tr key={i}><td>{date(r.date)}</td><td>{[r.counterparty, r.description].filter(Boolean).join(' · ')}</td><td className="r">{money(r.amount, account.currency)}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
