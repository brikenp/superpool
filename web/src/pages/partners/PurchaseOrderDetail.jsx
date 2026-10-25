import { collection, doc, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { LOC, PO_STATUS, UNITS } from '@shared/constants.js';

import { LinesEditor, emptyLine } from '../../components/LinesEditor.jsx';
import { Card, Field, Loading, Modal, PageHeader, StatusBadge, useAction, useUi } from '../../components/ui.jsx';
import { physicalLocations, useData, useDocument, useQuery } from '../../lib/data.jsx';
import { companyHeader } from '../../lib/docPdf.js';
import { loadPdf } from '../../lib/export.js';
import { call, db } from '../../lib/firebase.js';
import { date, money, qty, round3, todayISO, toNumber } from '../../lib/format.js';
import { poTotal } from './PurchaseOrders.jsx';

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const { data: po, loading } = useDocument(`purchaseOrders/${id}`);
  const { productsById, suppliersById, costsById, company } = useData();
  const { ask } = useUi();
  const [form, setForm] = useState(null);
  const [receiving, setReceiving] = useState(false);
  const [run, busy] = useAction();
  const prices = useQuery(() => query(collection(db, 'supplierPrices')), []);

  useEffect(() => {
    if (po && !form) setForm({ ...po, lines: (po.lines || []).map((l, i) => ({ ...l, key: `${i}` })) });
  }, [po, form]);

  const bestPrices = useMemo(() => {
    const best = {};
    for (const p of prices.data) {
      if (!best[p.productId] || p.price < best[p.productId].price) best[p.productId] = p;
    }
    return best;
  }, [prices.data]);

  if (loading || !form) return <Loading />;
  if (!po) return <div className="alert error">Porosia nuk u gjet.</div>;
  const editable = ['draft', 'sent', 'confirmed'].includes(po.status) && !(po.receiptIds || []).length;
  const ownPrice = (productId) => prices.data.find((p) => p.productId === productId && p.supplierId === po.supplierId)?.price;

  const save = (extra = {}) => run(async () => {
    const lines = form.lines.filter((l) => l.productId && toNumber(l.qty) > 0).map((l) => ({
      productId: l.productId,
      code: productsById[l.productId]?.code || l.code || '',
      name: productsById[l.productId]?.name || l.name || '',
      unit: productsById[l.productId]?.unit || l.unit || '',
      qty: toNumber(l.qty),
      unitPrice: toNumber(l.unitPrice),
      receivedQty: Number(l.receivedQty || 0),
      note: l.note || '',
    }));
    await updateDoc(doc(db, 'purchaseOrders', id), {
      expectedDate: form.expectedDate || '',
      notes: form.notes || '',
      lines,
      updatedAt: serverTimestamp(),
      ...extra,
    });
    setForm(null);
  }, 'Porosia u ruajt.');

  const cancel = async () => {
    if (await ask({ title: 'Anulo porosinë', message: 'Porosia do të shënohet si e anuluar.', danger: true, confirmLabel: 'Anulo porosinë' })) {
      run(() => updateDoc(doc(db, 'purchaseOrders', id), { status: 'cancelled' }), 'Porosia u anulua.');
    }
  };

  const pdf = () => run(async () => {
    const { jsPDF, autoTable } = await loadPdf();
    const d = new jsPDF({ unit: 'mm', format: 'a4' });
    let y = companyHeader(d, company, 'Porosi blerjeje', `${po.number} · ${date(po.date)}`);
    const s = suppliersById[po.supplierId] || {};
    d.setFontSize(10);
    d.text([`Për: ${s.name || po.supplierName}`, s.address || '', s.nipt ? `NIPT: ${s.nipt}` : '', `Data e kërkuar e dorëzimit: ${date(po.expectedDate)}`].filter(Boolean), 14, y);
    y += 20;
    autoTable(d, {
      startY: y,
      head: [['#', 'Kodi', 'Artikulli', 'Njësia', 'Sasia', 'Çmimi', 'Vlera']],
      body: (po.lines || []).map((l, i) => [i + 1, l.code, l.name, UNITS[l.unit] || l.unit, qty(l.qty), money(l.unitPrice), money(l.qty * l.unitPrice)]),
      foot: [['', '', 'Totali (pa TVSH)', '', '', '', money(poTotal(po))]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [11, 111, 164] },
      footStyles: { fillColor: [235, 242, 247], textColor: 20 },
    });
    if (po.notes) d.text(d.splitTextToSize(`Shënime: ${po.notes}`, 180), 14, d.lastAutoTable.finalY + 8);
    d.save(`${po.number}.pdf`);
  });

  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/porosite">Porositë</Link>}
        title={`${po.number} · ${po.supplierName}`}
        subtitle={<><StatusBadge status={po.status} labels={PO_STATUS} /> · {date(po.date)}{po.projectName ? ` · Projekti: ${po.projectName}` : ''}</>}
        actions={(
          <>
            <button type="button" className="btn" onClick={pdf}>PDF për furnitorin</button>
            {editable && <button type="button" className="btn" disabled={busy} onClick={() => save()}>Ruaj</button>}
            {po.status === 'draft' && <button type="button" className="btn" disabled={busy} onClick={() => save({ status: 'sent', sentAt: serverTimestamp() })}>Shëno si të dërguar</button>}
            {po.status === 'sent' && <button type="button" className="btn" disabled={busy} onClick={() => save({ status: 'confirmed' })}>Konfirmuar nga furnitori</button>}
            {!['received', 'cancelled', 'draft'].includes(po.status) && <button type="button" className="btn primary" onClick={() => setReceiving(true)}>Prano mallin</button>}
            {!['received', 'cancelled'].includes(po.status) && !(po.receiptIds || []).length && <button type="button" className="btn danger" onClick={cancel}>Anulo</button>}
          </>
        )}
      />
      <Card>
        <div className="form-grid">
          <Field label="Data e parashikuar e mbërritjes">
            <input type="date" value={form.expectedDate || ''} disabled={!editable} onChange={(e) => setForm({ ...form, expectedDate: e.target.value })} />
          </Field>
          <Field label="Shënime" className="span-2">
            <input value={form.notes || ''} disabled={!editable} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
      </Card>
      <Card title="Artikujt e porositur">
        {editable ? (
          <LinesEditor
            lines={form.lines.length ? form.lines : [emptyLine()]}
            onChange={(lines) => setForm({ ...form, lines })}
            priceField="unitPrice"
            priceLabel="Çmimi (pa TVSH)"
            defaultPrice={(p) => ownPrice(p.id) ?? costsById[p.id]?.purchasePrice ?? 0}
          />
        ) : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Kodi</th><th>Artikulli</th><th className="r">Porositur</th><th className="r">Pranuar</th><th className="r">Çmimi</th><th className="r">Vlera</th></tr></thead>
              <tbody>
                {(po.lines || []).map((l) => (
                  <tr key={l.productId}>
                    <td data-label="Kodi">{l.code}</td>
                    <td data-label="Artikulli">{l.name}</td>
                    <td data-label="Porositur" className="r">{qty(l.qty)} {UNITS[l.unit] || ''}</td>
                    <td data-label="Pranuar" className={`r ${Number(l.receivedQty) >= l.qty ? 'text-ok' : 'text-warn'}`}>{qty(l.receivedQty)}</td>
                    <td data-label="Çmimi" className="r">{money(l.unitPrice)}</td>
                    <td data-label="Vlera" className="r">{money(l.qty * l.unitPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Krahasimi me ofertat e furnitorëve të tjerë">
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>Artikulli</th><th className="r">Çmimi në porosi</th><th>Oferta më e mirë</th><th className="r">Kursimi i mundshëm</th></tr></thead>
            <tbody>
              {form.lines.filter((l) => l.productId).map((l) => {
                const best = bestPrices[l.productId];
                const saving = best && best.supplierId !== po.supplierId ? (toNumber(l.unitPrice) - best.price) * toNumber(l.qty) : 0;
                return (
                  <tr key={l.key || l.productId}>
                    <td data-label="Artikulli">{productsById[l.productId]?.name || l.name}</td>
                    <td data-label="Çmimi" className="r">{money(l.unitPrice)}</td>
                    <td data-label="Oferta më e mirë">{best ? `${money(best.price)} · ${suppliersById[best.supplierId]?.name || ''}` : <span className="muted">s'ka oferta</span>}</td>
                    <td data-label="Kursimi" className={`r ${saving > 0 ? 'text-ok bold' : ''}`}>{saving > 0 ? money(saving) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {(po.receiptIds || []).length > 0 && (
        <Card title="Fletëhyrjet e lidhura">
          {po.receiptIds.map((r) => <Link key={r} className="btn small" style={{ marginRight: 6 }} to={`/levizjet/${r}`}>Shiko fletëhyrjen</Link>)}
        </Card>
      )}
      {receiving && <ReceiveModal po={po} onClose={() => setReceiving(false)} />}
    </>
  );
}

function ReceiveModal({ po, onClose }) {
  const { locations } = useData();
  const [destId, setDestId] = useState(LOC.MAIN);
  const [fiscalRef, setFiscalRef] = useState('');
  const [day, setDay] = useState(todayISO());
  const [lines, setLines] = useState((po.lines || []).map((l) => ({
    ...l, receive: Math.max(0, round3(l.qty - Number(l.receivedQty || 0))), unitCost: l.unitPrice,
  })));
  const [run, busy] = useAction();
  const submit = () => run(async () => {
    await call('receivePurchaseOrder', {
      poId: po.id, destId, fiscalRef, date: day,
      lines: lines.filter((l) => toNumber(l.receive) > 0).map((l) => ({ productId: l.productId, qty: toNumber(l.receive), unitCost: toNumber(l.unitCost) })),
    });
    onClose();
  }, 'Malli u pranua dhe stoku u përditësua.');

  return (
    <Modal title={`Pranimi i mallit · ${po.number}`} onClose={onClose} wide
      footer={<><button type="button" className="btn" onClick={onClose}>Anulo</button><button type="button" className="btn primary" disabled={busy} onClick={submit}>Konfirmo fletëhyrjen</button></>}>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <Field label="Data"><input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        <Field label="Magazina">
          <select value={destId} onChange={(e) => setDestId(e.target.value)}>
            {physicalLocations(locations).filter((l) => ['main', 'agent'].includes(l.kind)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Nr. i faturës së blerjes"><input value={fiscalRef} onChange={(e) => setFiscalRef(e.target.value)} /></Field>
      </div>
      <div className="table-wrap">
        <table className="table lines responsive">
          <thead><tr><th>Artikulli</th><th className="r">Mbetur</th><th className="r">Pranohet</th><th className="r">Kosto njësi</th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.productId}>
                <td data-label="Artikulli">{l.code} · {l.name}</td>
                <td data-label="Mbetur" className="r">{qty(Math.max(0, l.qty - Number(l.receivedQty || 0)))}</td>
                <td data-label="Pranohet"><input className="num" type="number" step="any" value={l.receive} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, receive: e.target.value } : x)))} /></td>
                <td data-label="Kosto njësi"><input className="num" type="number" step="any" value={l.unitCost} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
