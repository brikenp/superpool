import { collection, query, where } from 'firebase/firestore';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { LOC, UNITS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';
import { explodeRecipes, isComposite } from '@shared/stock.js';

import { productOption } from '../../components/ProductImage.jsx';
import { Card, Field, PageHeader, SearchSelect, useAction } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { unitCostOf, useData, useQuery } from '../../lib/data.jsx';
import { call, db } from '../../lib/firebase.js';
import { qty as fmtQty, money, todayISO, toNumber } from '../../lib/format.js';

/** Fletë prodhimi: prodhon artikuj me recetë dhe i shton në stok, duke shkarkuar materialet. */
export default function ProductionForm() {
  const { can } = useAuth();
  const { products, productsById, locations, costsById } = useData();
  const navigate = useNavigate();
  const showCosts = can(CAPS.VIEW_COSTS);
  const [form, setForm] = useState({ date: todayISO(), locationId: LOC.MAIN, notes: '', items: [{ productId: '', qty: '' }] });
  const [run, busy] = useAction();
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (i, patch) => set('items', form.items.map((it, k) => (k === i ? { ...it, ...patch } : it)));

  const places = locations.filter((l) => l.active !== false && ['main', 'agent', 'vehicle'].includes(l.kind));
  const composites = products.filter((p) => p.active !== false && isComposite(p));
  const stock = useQuery(() => query(collection(db, 'stock'), where('locationId', '==', form.locationId)), [form.locationId]);
  const available = useMemo(() => Object.fromEntries(stock.data.map((s) => [s.productId, Number(s.qty || 0)])), [stock.data]);
  const items = form.items.filter((i) => i.productId && toNumber(i.qty) > 0).map((i) => ({ productId: i.productId, qty: toNumber(i.qty) }));
  const materials = useMemo(() => explodeRecipes(items, productsById), [items, productsById]);
  const shortage = materials.some((m) => m.qty > (available[m.productId] || 0) + 0.0005);
  const cost = materials.reduce((s, m) => s + m.qty * unitCostOf(costsById, m.productId), 0);

  const submit = () => run(async () => {
    if (!items.length) throw new Error('Zgjidhni artikullin dhe sasinë që prodhohet.');
    const res = await call('confirmProduction', { production: { date: form.date, locationId: form.locationId, notes: form.notes, items } });
    navigate(`/levizjet/${res.id}`, { replace: true });
    return res;
  }, (r) => `Fleta e prodhimit ${r.number} u konfirmua.`);

  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/levizjet?seksioni=prodhimi">Fletët e prodhimit</Link>}
        title="Fletë prodhimi e re"
        subtitle="Materialet sipas recetës dalin nga stoku dhe artikulli i prodhuar hyn në të njëjtin vend."
      />
      {!composites.length && (
        <div className="alert warn">Nuk ka ende artikuj me recetë. Hapni artikullin (p.sh. Aditivi) → Ndrysho → «Artikull i përbërë» dhe shtoni materialet.</div>
      )}
      <Card>
        <div className="form-grid">
          <Field label="Vendi i prodhimit">
            <select value={form.locationId} onChange={(e) => set('locationId', e.target.value)}>
              {places.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Data"><input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label="Shënime (p.sh. nr. i serisë)" className="span-2"><input value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
      </Card>
      <Card title="Çfarë prodhohet">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Artikulli me recetë</th><th className="r" style={{ width: 140 }}>Sasia</th><th className="r">Gjendja tani</th><th style={{ width: 40 }} /></tr></thead>
            <tbody>
              {form.items.map((it, i) => {
                const p = productsById[it.productId];
                return (
                  <tr key={i}>
                    <td><SearchSelect options={composites.map((c) => productOption(c, `${c.recipe.length} materiale`))} value={it.productId} onChange={(v) => setItem(i, { productId: v })} /></td>
                    <td><input className="num" type="number" step="any" min="0" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} /></td>
                    <td className="r">{p ? `${fmtQty(available[p.id] || 0)} ${UNITS[p.unit] || p.unit || ''}` : ''}</td>
                    <td><button type="button" className="btn ghost small" aria-label="Hiq" onClick={() => set('items', form.items.filter((_, k) => k !== i))}><Trash2 size={16} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn small" style={{ marginTop: 8 }} onClick={() => set('items', [...form.items, { productId: '', qty: '' }])}><Plus size={14} /> Artikull</button>
      </Card>
      {materials.length > 0 && (
        <Card title="Materialet që shkarkohen">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Materiali</th><th className="r">Sasia</th><th className="r">Gjendja</th>{showCosts && <th className="r">Kosto</th>}</tr></thead>
              <tbody>
                {materials.map((m) => {
                  const p = productsById[m.productId] || {};
                  const short = m.qty > (available[m.productId] || 0) + 0.0005;
                  return (
                    <tr key={m.productId} className={short ? 'text-danger' : ''}>
                      <td>{p.code} · {p.name}</td>
                      <td className="r">{fmtQty(m.qty)} {UNITS[p.unit] || p.unit || ''}</td>
                      <td className="r">{fmtQty(available[m.productId] || 0)}{short ? ' — nuk mjafton' : ''}</td>
                      {showCosts && <td className="r">{money(m.qty * unitCostOf(costsById, m.productId))}</td>}
                    </tr>
                  );
                })}
              </tbody>
              {showCosts && <tfoot><tr><td colSpan={3}>Kosto e prodhimit</td><td className="r">{money(cost)}</td></tr></tfoot>}
            </table>
          </div>
        </Card>
      )}
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => navigate(-1)}>Anulo</button>
        <button type="button" className="btn primary big" disabled={busy || shortage || !items.length} onClick={submit}>Konfirmo prodhimin</button>
      </div>
    </>
  );
}
