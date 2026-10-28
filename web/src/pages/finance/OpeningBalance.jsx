import { addDoc, collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { useState } from 'react';

import { CurrencyFields, currencyData } from '../../components/Currency.jsx';
import { Field, Modal, SearchSelect, useAction } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { clientOption } from '../../lib/clients.js';
import { useData } from '../../lib/data.jsx';
import { call, db } from '../../lib/firebase.js';
import { firstOfYear, money, toNumber } from '../../lib/format.js';

// Gjendja fillestare e klientit (detyrimi ose parapagimi i mbartur nga para SuperPool-it):
//  - klienti na detyrohet → "faturë" me type 'opening' (hyn te detyrimet dhe mund të likujdohet me pagesa)
//  - klienti ka paguar më shumë → "pagesë" me type 'opening'
// Nuk fiskalizohet dhe nuk printohet si faturë.

export const OPENING_LABEL = 'Gjendje fillestare';

/** Gjendjet fillestare aktive të klientit (fatura dhe pagesa). */
export async function findOpeningBalances(clientId) {
  const [inv, pay] = await Promise.all(['invoices', 'payments'].map((c) => getDocs(query(collection(db, c), where('clientId', '==', clientId), where('type', '==', 'opening')))));
  return [...inv.docs, ...pay.docs].map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.status !== 'cancelled');
}

export function OpeningBalanceForm({ record = {}, onClose }) {
  const { clients, clientsById } = useData();
  const { uid } = useAuth();
  const isNew = !record.id;
  // Pagesat kanë "method", faturat jo: kështu dihet koleksioni edhe kur hapet nga lista.
  const existingCol = record._col || (record.method ? 'payments' : 'invoices');
  const [v, setV] = useState(() => ({
    clientId: record.clientId || '',
    date: record.date || firstOfYear(),
    direction: isNew ? 'debit' : existingCol === 'payments' ? 'credit' : 'debit',
    amount: record.amount ?? '',
    currency: record.currency || 'ALL',
    exchangeRate: record.exchangeRate ?? 1,
    notes: record.notes || '',
  }));
  const [run, busy] = useAction();
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));

  const save = () => run(async () => {
    if (!v.clientId) throw new Error('Zgjidhni klientin.');
    if (!(toNumber(v.amount) > 0)) throw new Error('Shkruani shumën e gjendjes fillestare.');
    const amounts = { amount: toNumber(v.amount), ...currencyData(v.currency, v.exchangeRate, v.amount) };
    if (!isNew) {
      await updateDoc(doc(db, existingCol, record.id), {
        date: v.date, ...amounts, notes: v.notes || '', ...(existingCol === 'invoices' ? { dueDate: v.date } : {}), updatedAt: serverTimestamp(),
      });
      onClose();
      return;
    }
    const existing = await findOpeningBalances(v.clientId);
    if (existing.length) {
      throw new Error(`Klienti ka tashmë gjendje fillestare (${existing[0].internalNumber || existing[0].number}, ${money(existing[0].amount, existing[0].currency)}). Hapeni atë për ta ndryshuar.`);
    }
    const { number } = await call('allocateNumber', { prefix: 'GJF' });
    const base = {
      type: 'opening', date: v.date, clientId: v.clientId, clientName: clientsById[v.clientId]?.name || '',
      ...amounts, notes: v.notes || '', status: v.direction === 'debit' ? 'issued' : 'active', source: 'superpool', createdBy: uid, createdAt: serverTimestamp(),
    };
    if (v.direction === 'debit') {
      await addDoc(collection(db, 'invoices'), { ...base, kind: 'opening', internalNumber: number, fiscalNumber: '', dueDate: v.date, projectId: null });
    } else {
      await addDoc(collection(db, 'payments'), { ...base, number, invoiceId: null, method: 'opening', reference: OPENING_LABEL });
    }
    onClose();
  }, 'Gjendja fillestare u ruajt.');

  const cancel = () => run(async () => {
    if (!window.confirm('Të anulohet kjo gjendje fillestare?')) return;
    await updateDoc(doc(db, existingCol, record.id), { status: 'cancelled', updatedAt: serverTimestamp() });
    onClose();
  }, 'Gjendja fillestare u anulua.');

  return (
    <Modal title={isNew ? 'Gjendje fillestare e klientit' : `${OPENING_LABEL} ${record.internalNumber || record.number || ''}`} onClose={onClose}
      footer={(
        <>
          {!isNew && record.status !== 'cancelled' && <button type="button" className="btn danger" disabled={busy} onClick={cancel} style={{ marginRight: 'auto' }}>Anulo gjendjen</button>}
          <button type="button" className="btn" onClick={onClose}>Mbyll</button>
          {record.status !== 'cancelled' && <button type="button" className="btn primary" disabled={busy} onClick={save}>Ruaj</button>}
        </>
      )}>
      <div className="form-grid">
        <Field label="Klienti" required className="span-2">
          <SearchSelect options={clients.map((c) => clientOption(c))} value={v.clientId} onChange={(val) => set('clientId', val)} disabled={!isNew} />
        </Field>
        <Field label="Gjendja" className="span-2">
          <select value={v.direction} onChange={(e) => set('direction', e.target.value)} disabled={!isNew}>
            <option value="debit">Klienti na detyrohet (debi)</option>
            <option value="credit">Klienti ka paguar më shumë / parapagim (kredi)</option>
          </select>
        </Field>
        <Field label={`Shuma (${v.currency === 'EUR' ? '€' : 'L'})`} required>
          <input className="num" type="number" step="any" value={v.amount} onChange={(e) => set('amount', e.target.value)} autoFocus={isNew} />
        </Field>
        <Field label="Data e gjendjes" hint="Zakonisht data e fillimit të punës me SuperPool.">
          <input type="date" value={v.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <CurrencyFields currency={v.currency} rate={v.exchangeRate} amount={v.amount} onChange={(patch) => setV((s) => ({ ...s, ...patch }))} />
        <Field label="Shënime" className="span-all"><input value={v.notes} onChange={(e) => set('notes', e.target.value)} placeholder="p.sh. Detyrim i mbartur nga programi i vjetër" /></Field>
      </div>
    </Modal>
  );
}
