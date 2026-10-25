import { collection, query, where } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { UNITS } from '@shared/constants.js';

import { Card, PageHeader, useAction } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useCollection, useData, useQuery } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';
import { money, qty, round3, toNumber } from '../../lib/format.js';
import { createPurchaseOrder } from './PurchaseOrders.jsx';

/**
 * Lista e nevojave për porosi: stoku minimal + mungesat e projekteve aktive – sasitë që janë në porosi.
 */
export default function Needs() {
  const { products, suppliersById, costsById } = useData();
  const { uid, profile } = useAuth();
  const navigate = useNavigate();
  const orders = useCollection('purchaseOrders');
  const projects = useQuery(() => query(collection(db, 'projects'), where('status', 'in', ['planned', 'active'])), []);
  const prices = useCollection('supplierPrices');
  const [overrides, setOverrides] = useState({});
  const [selected, setSelected] = useState({});
  const [run, busy] = useAction();

  const rows = useMemo(() => {
    const onOrder = {};
    for (const o of orders.data) {
      if (['received', 'cancelled'].includes(o.status)) continue;
      for (const l of o.lines || []) onOrder[l.productId] = (onOrder[l.productId] || 0) + Math.max(0, l.qty - Number(l.receivedQty || 0));
    }
    const projectNeed = {};
    const projectNames = {};
    for (const p of projects.data) {
      for (const s of p.shortages || []) {
        projectNeed[s.productId] = (projectNeed[s.productId] || 0) + Number(s.missing || 0);
        (projectNames[s.productId] ||= []).push(p.code);
      }
    }
    const bestPrice = {};
    for (const pr of prices.data) if (!bestPrice[pr.productId] || pr.price < bestPrice[pr.productId].price) bestPrice[pr.productId] = pr;

    return products
      .filter((p) => p.active !== false)
      .map((p) => {
        const free = Number(p.qtyMain || 0) - Number(p.qtyReserved || 0);
        const minGap = Math.max(0, Number(p.minStock || 0) - free);
        const need = projectNeed[p.id] || 0;
        const ordered = onOrder[p.id] || 0;
        const suggested = round3(Math.max(0, minGap + need - ordered));
        return {
          ...p, free, minGap, need, ordered, suggested,
          projects: projectNames[p.id] || [],
          best: bestPrice[p.id],
          lastPrice: costsById[p.id]?.purchasePrice || 0,
        };
      })
      .filter((r) => r.suggested > 0)
      .sort((a, b) => String(a.supplierName || 'zzz').localeCompare(String(b.supplierName || 'zzz')) || a.code.localeCompare(b.code));
  }, [products, orders.data, projects.data, prices.data, costsById]);

  const qtyFor = (r) => (overrides[r.id] !== undefined ? toNumber(overrides[r.id]) : r.suggested);
  const supplierFor = (r) => r.supplierId || r.best?.supplierId || '';
  const chosen = rows.filter((r) => selected[r.id] && qtyFor(r) > 0);

  const createOrders = () => run(async () => {
    const groups = {};
    for (const r of chosen) {
      const sid = supplierFor(r);
      if (!sid) throw new Error(`"${r.name}" nuk ka furnitor. Caktoni furnitorin te kartela e artikullit.`);
      (groups[sid] ||= []).push(r);
    }
    const ids = [];
    for (const [sid, items] of Object.entries(groups)) {
      ids.push(await createPurchaseOrder({
        supplier: suppliersById[sid],
        uid,
        userName: profile?.name,
        notes: 'Krijuar nga lista e nevojave',
        lines: items.map((r) => {
          const own = r.best?.supplierId === sid ? r.best.price : null;
          return { productId: r.id, code: r.code, name: r.name, unit: r.unit, qty: qtyFor(r), unitPrice: own ?? r.lastPrice, receivedQty: 0, note: r.projects.join(', ') };
        }),
      }));
    }
    setSelected({});
    if (ids.length === 1) navigate(`/porosite/${ids[0]}`);
    return ids;
  }, (ids) => `U krijuan ${ids.length} porosi draft.`);

  const allSelected = rows.length > 0 && rows.every((r) => selected[r.id]);

  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/porosite">Porositë</Link>}
        title="Lista e nevojave për porosi"
        subtitle="Sugjerim = mungesa ndaj stokut minimal + mungesat e projekteve aktive – sasitë që janë tashmë në porosi."
        actions={<button type="button" className="btn primary" disabled={!chosen.length || busy} onClick={createOrders}>Krijo porositë ({chosen.length})</button>}
      />
      <Card>
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr>
                <th><input type="checkbox" checked={allSelected} onChange={(e) => setSelected(Object.fromEntries(rows.map((r) => [r.id, e.target.checked])))} /></th>
                <th>Furnitori</th><th>Kodi</th><th>Artikulli</th>
                <th className="r">E lirë</th><th className="r">Min.</th><th className="r">Për projekte</th><th className="r">Në porosi</th>
                <th className="r">Për t'u porositur</th><th className="r">Çmimi i fundit</th><th>Oferta më e mirë</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><input type="checkbox" checked={Boolean(selected[r.id])} onChange={(e) => setSelected({ ...selected, [r.id]: e.target.checked })} /></td>
                  <td data-label="Furnitori">{suppliersById[supplierFor(r)]?.name || <span className="text-danger">pa furnitor</span>}</td>
                  <td data-label="Kodi"><Link to={`/artikuj/${r.id}`}>{r.code}</Link></td>
                  <td data-label="Artikulli">{r.name}{r.projects.length > 0 && <small className="muted"> ({r.projects.join(', ')})</small>}</td>
                  <td data-label="E lirë" className="r">{qty(r.free)}</td>
                  <td data-label="Min." className="r">{qty(r.minStock)}</td>
                  <td data-label="Për projekte" className="r">{qty(r.need)}</td>
                  <td data-label="Në porosi" className="r">{qty(r.ordered)}</td>
                  <td data-label="Për t'u porositur" className="r">
                    <input className="num" style={{ maxWidth: 100 }} type="number" step="any" value={overrides[r.id] ?? r.suggested}
                      onChange={(e) => setOverrides({ ...overrides, [r.id]: e.target.value })} /> {UNITS[r.unit] || ''}
                  </td>
                  <td data-label="Çmimi i fundit" className="r">{money(r.lastPrice)}</td>
                  <td data-label="Oferta më e mirë">{r.best ? `${money(r.best.price)} · ${suppliersById[r.best.supplierId]?.name || ''}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="empty">Nuk ka nevoja për porosi. Stoku mbulon minimumet dhe projektet aktive.</div>}
        </div>
      </Card>
    </>
  );
}
