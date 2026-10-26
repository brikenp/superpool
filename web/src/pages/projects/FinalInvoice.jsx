import { addDoc, collection, doc, getDoc, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { UNITS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { Field, Modal, useAction } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useData, useDocument, useQuery } from '../../lib/data.jsx';
import { call, db } from '../../lib/firebase.js';
import { addDays, date, inAll, money, round2, todayISO, toNumber } from '../../lib/format.js';
import { CurrencyFields, currencyData } from '../../components/Currency.jsx';
import { invoicePdf } from '../../lib/printDocs.js';
import { invoiceTypeLabel } from '../finance/Finance.jsx';

/**
 * Fatura përfundimtare e projektit: rreshtat e ofertës (ose vlera e kontratës), TVSH, dhe zbritja e
 * paradhënieve / situacioneve të faturuara më parë. Vlera e faturës = sa mbetet për t'u paguar.
 */
export function FinalInvoiceForm({ project, onClose }) {
  const { company, clientsById } = useData();
  const { data: finance } = useDocument(`projectFinance/${project.id}`);
  const invoiceQuery = useQuery(() => query(collection(db, 'invoices'), where('projectId', '==', project.id)), [project.id]);
  const invoices = invoiceQuery.data;
  const { uid, can } = useAuth();
  const [run, busy] = useAction();
  const [lines, setLines] = useState(null);
  const [v, setV] = useState({ date: todayISO(), dueDate: addDays(todayISO(), 15), fiscalNumber: '', notes: '', vatPct: company.vatPct ?? 20, complete: true, currency: 'ALL', exchangeRate: 1 });
  const rate = v.currency === 'EUR' ? toNumber(v.exchangeRate) : 1;
  // Paradhëniet mund të jenë në monedhë tjetër: kthehen në monedhën e kësaj fature përmes vlerës në lekë.
  const inCurrency = (i) => ((i.currency || 'ALL') === v.currency ? Number(i.amount || 0) : round2(inAll(i) / (rate || 1)));
  // Ndryshimi i monedhës / kursit i kthen çmimet e rreshtave (oferta është në lekë).
  const changeCurrency = (patch) => {
    const next = { ...v, ...patch };
    const fromRate = v.currency === 'EUR' ? toNumber(v.exchangeRate) : 1;
    const toRate = next.currency === 'EUR' ? toNumber(next.exchangeRate) : 1;
    if (fromRate > 0 && toRate > 0 && fromRate !== toRate) {
      setLines((ls) => (ls || []).map((l) => ({ ...l, unitPrice: round2((toNumber(l.unitPrice) * fromRate) / toRate) })));
    }
    setV(next);
  };
  const previous = invoices.filter((i) => i.status !== 'cancelled' && i.type !== 'final');

  // Rreshtat nisin nga oferta e pranuar; rreshtat e fshehur për klientin bashkohen në një rresht.
  useEffect(() => {
    let alive = true;
    (async () => {
      let offer = null;
      if (project.offerId) {
        try { const s = await getDoc(doc(db, 'offers', project.offerId)); offer = s.exists() ? s.data() : null; } catch { offer = null; }
      }
      let out = [];
      if (offer?.lines?.length) {
        const visible = offer.lines.filter((l) => l.showOnClient !== false && toNumber(l.qty) > 0);
        const hidden = offer.lines.filter((l) => l.showOnClient === false);
        out = visible.map((l) => ({ description: l.description || l.name || '', unit: l.unit || 'cope', qty: toNumber(l.qty), unitPrice: toNumber(l.unitPrice) }));
        const hiddenValue = round2(hidden.reduce((s, l) => s + toNumber(l.qty) * toNumber(l.unitPrice), 0));
        if (hiddenValue) out.push({ description: 'Materiale dhe punime të tjera montimi', unit: 'set', qty: 1, unitPrice: hiddenValue });
        if (toNumber(offer.discountPct)) {
          const sub = out.reduce((s, l) => s + l.qty * l.unitPrice, 0);
          out.push({ description: `Zbritje ${offer.discountPct}%`, unit: 'set', qty: 1, unitPrice: -round2((sub * toNumber(offer.discountPct)) / 100) });
        }
        if (alive) setV((s) => ({ ...s, vatPct: offer.vatPct ?? s.vatPct }));
      }
      // Pa ofertë: një rresht me vlerën e kontratës.
      if (!out.length) {
        out = [{ description: `Ndërtim pishine sipas kontratës — ${project.name}`, unit: 'set', qty: 1, unitPrice: toNumber(finance?.contractValue) }];
      }
      if (alive) setLines(out);
    })();
    return () => { alive = false; };
  }, [project, finance?.contractValue]);

  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));
  const setLine = (i, patch) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const net = round2((lines || []).reduce((s, l) => s + toNumber(l.qty) * toNumber(l.unitPrice), 0));
  const vat = round2((net * toNumber(v.vatPct)) / 100);
  const gross = round2(net + vat);
  const deducted = round2(previous.reduce((s, i) => s + inCurrency(i), 0));
  const toPay = round2(gross - deducted);
  const contract = toNumber(finance?.contractValue);

  const save = () => run(async () => {
    if (!lines?.length || !(net > 0)) throw new Error('Shtoni rreshtat e faturës.');
    if (toPay < 0) throw new Error('Faturat e mëparshme e kalojnë vlerën totale. Kontrolloni rreshtat ose paradhëniet.');
    const { number: internalNumber } = await call('allocateNumber', { prefix: 'FAT' });
    const client = clientsById[project.clientId];
    const data = {
      type: 'final', kind: 'project', source: 'superpool',
      internalNumber, fiscalNumber: v.fiscalNumber.trim(),
      status: v.fiscalNumber.trim() ? 'issued' : 'pending_fiscal',
      date: v.date, dueDate: v.dueDate,
      clientId: project.clientId, clientName: client?.name || project.clientName || '',
      projectId: project.id,
      lines: lines.map((l) => ({ description: String(l.description || '').trim(), unit: l.unit || '', qty: toNumber(l.qty), unitPrice: round2(toNumber(l.unitPrice)) })),
      vatPct: toNumber(v.vatPct), net, vat, gross,
      deductions: previous.map((i) => ({ invoiceId: i.id, label: `${invoiceTypeLabel(i)} ${i.fiscalNumber || i.internalNumber || ''}`.trim(), date: i.date || '', amount: inCurrency(i) })),
      amount: toPay,
      ...currencyData(v.currency, v.exchangeRate, toPay),
      notes: v.notes || '',
      createdBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    };
    const ref = await addDoc(collection(db, 'invoices'), data);
    if (v.complete && can(CAPS.PROJECTS_MANAGE) && project.status !== 'completed') {
      await updateDoc(doc(db, 'projects', project.id), { status: 'completed', endDate: project.endDate || v.date });
    }
    await invoicePdf({ id: ref.id, ...data }, { company, clientsById });
    onClose();
  }, 'Fatura përfundimtare u krijua dhe PDF-ja u shkarkua.');

  return (
    <Modal title={`Fatura përfundimtare · ${project.code}`} onClose={onClose} wide
      footer={<><button type="button" className="btn" onClick={onClose}>Anulo</button><button type="button" className="btn primary" disabled={busy || !lines} onClick={save}>Krijo faturën dhe PDF</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>
        Rreshtat vijnë nga oferta e pranuar (mund t'i ndryshoni ose të shtoni punime shtesë). Paradhëniet dhe situacionet e faturuara më parë zbriten, dhe fatura del me shumën që mbetet për t'u paguar.
      </p>
      <div className="form-grid">
        <Field label="Data"><input type="date" value={v.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <Field label="Afati i pagesës"><input type="date" value={v.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></Field>
        <Field label="Nr. fiskal (nëse është lëshuar)"><input value={v.fiscalNumber} onChange={(e) => set('fiscalNumber', e.target.value)} /></Field>
        <Field label="TVSH %"><input className="num" type="number" step="any" value={v.vatPct} onChange={(e) => set('vatPct', e.target.value)} /></Field>
        <CurrencyFields currency={v.currency} rate={v.exchangeRate} amount={toPay} onChange={(patch) => changeCurrency(patch.currency === 'EUR' && !toNumber(patch.exchangeRate ?? v.exchangeRate) ? { ...patch, exchangeRate: company.eurRate || '' } : patch)} />
      </div>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="table">
          <thead><tr><th>Përshkrimi</th><th style={{ width: 90 }}>Njësia</th><th className="r" style={{ width: 100 }}>Sasia</th><th className="r" style={{ width: 140 }}>Çmimi pa TVSH ({v.currency === 'EUR' ? '€' : 'L'})</th><th className="r">Vlera</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {!lines && <tr><td colSpan={6} className="muted">Po ngarkohen rreshtat e ofertës…</td></tr>}
            {(lines || []).map((l, i) => (
              <tr key={i}>
                <td><input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                <td>
                  <select value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })}>
                    {Object.entries(UNITS).map(([k, u]) => <option key={k} value={k}>{u}</option>)}
                  </select>
                </td>
                <td><input className="num" type="number" step="any" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                <td><input className="num" type="number" step="any" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} /></td>
                <td className="r">{money(toNumber(l.qty) * toNumber(l.unitPrice), v.currency)}</td>
                <td><button type="button" className="btn ghost small" aria-label="Hiq" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}><Trash2 size={16} /></button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={4}>Vlera pa TVSH{contract > 0 && rate > 0 && Math.abs(contract / rate - net) > 1 ? <small className="text-danger"> (kontrata: {money(contract)})</small> : null}</td><td className="r">{money(net, v.currency)}</td><td /></tr>
            <tr><td colSpan={4}>TVSH {v.vatPct}%</td><td className="r">{money(vat, v.currency)}</td><td /></tr>
            <tr><td colSpan={4}><b>Totali me TVSH</b></td><td className="r"><b>{money(gross, v.currency)}</b></td><td /></tr>
            {previous.map((i) => (
              <tr key={i.id}><td colSpan={4}>Minus: {invoiceTypeLabel(i)} {i.fiscalNumber || i.internalNumber || ''} · {date(i.date)}</td><td className="r">−{money(inCurrency(i), v.currency)}</td><td /></tr>
            ))}
            <tr><td colSpan={4}><b>Për t'u paguar</b></td><td className="r"><b className={toPay < 0 ? 'text-danger' : ''}>{money(toPay, v.currency)}</b></td><td /></tr>
          </tfoot>
        </table>
      </div>
      <button type="button" className="btn small" style={{ marginTop: 8 }} onClick={() => setLines((ls) => [...(ls || []), { description: 'Punime shtesë', unit: 'cope', qty: 1, unitPrice: 0 }])}><Plus size={14} /> Rresht (punime shtesë)</button>
      <div className="form-grid" style={{ marginTop: 12 }}>
        <Field label="Shënime në faturë" className="span-all"><input value={v.notes} onChange={(e) => set('notes', e.target.value)} placeholder="p.sh. Garancia 24 muaj nga data e dorëzimit" /></Field>
        {can(CAPS.PROJECTS_MANAGE) && project.status !== 'completed' && (
          <label className="checkbox span-all"><input type="checkbox" checked={v.complete} onChange={(e) => set('complete', e.target.checked)} /> Shëno projektin si të përfunduar</label>
        )}
      </div>
    </Modal>
  );
}
