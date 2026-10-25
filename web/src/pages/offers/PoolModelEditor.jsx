import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { POOL_SECTIONS, POOL_TYPES, UNITS } from '@shared/constants.js';
import { FORMULA_FUNCTIONS, FORMULA_VARIABLES, evaluateFormula, poolVariables } from '@shared/formula.js';

import { Card, Field, Loading, PageHeader, SearchSelect, useAction, useUi } from '../../components/ui.jsx';
import { unitCostOf, useData, useDocument } from '../../lib/data.jsx';
import { db } from '../../lib/firebase.js';
import { money, qty, toNumber } from '../../lib/format.js';
import { newKey, priceFromCost } from '../../lib/offerCalc.js';

const emptyItem = () => ({ key: newKey(), section: 'other', productId: '', description: '', unit: 'cope', formula: '1', unitCost: '', unitPrice: '', markupPct: '', showOnClient: true });

export default function PoolModelEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { ask } = useUi();
  const { products, productsById, costsById } = useData();
  const { data: model, loading } = useDocument(`poolModels/${id}`);
  const [form, setForm] = useState(null);
  const [test, setTest] = useState({ length: 8, width: 4, depthMin: 1.2, depthMax: 1.6 });
  const [run, busy] = useAction();

  useEffect(() => {
    if (model && !form) {
      setForm({ ...model, items: (model.items || []).map((i) => ({ ...emptyItem(), ...i, key: i.key || newKey() })) });
      setTest({ length: model.length || 8, width: model.width || 4, depthMin: model.depthMin || 1.2, depthMax: model.depthMax || 1.6 });
    }
  }, [model, form]);

  const vars = useMemo(() => poolVariables(test), [test]);
  const productOptions = useMemo(() => products.filter((p) => p.active !== false).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })), [products]);

  if (loading || !form) return <Loading />;
  if (!model) return <div className="alert error">Modeli nuk u gjet.</div>;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (i, patch) => set('items', form.items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i, d) => {
    const items = [...form.items];
    const [it] = items.splice(i, 1);
    items.splice(Math.max(0, Math.min(items.length, i + d)), 0, it);
    set('items', items);
  };

  const evalItem = (it) => {
    try { return { qty: evaluateFormula(it.formula, vars) }; } catch (err) { return { error: err.message }; }
  };
  const costOf = (it) => (it.productId ? unitCostOf(costsById, it.productId) : toNumber(it.unitCost));
  const priceOf = (it) => (toNumber(it.unitPrice) > 0 ? toNumber(it.unitPrice) : priceFromCost(costOf(it), it.markupPct !== '' ? it.markupPct : form.markupPct));
  const totals = form.items.reduce((acc, it) => {
    const q = evalItem(it).qty || 0;
    acc.cost += q * costOf(it);
    acc.price += q * priceOf(it);
    return acc;
  }, { cost: 0, price: 0 });

  const save = () => run(async () => {
    const errors = form.items.map((it, i) => (evalItem(it).error ? `Rreshti ${i + 1}: ${evalItem(it).error}` : null)).filter(Boolean);
    if (errors.length) throw new Error(errors.join('\n'));
    const { id: _id, ...data } = form;
    data.items = form.items.map(({ key, ...it }) => ({
      ...it,
      key,
      productId: it.productId || null,
      unitCost: it.unitCost === '' ? '' : toNumber(it.unitCost),
      unitPrice: it.unitPrice === '' ? '' : toNumber(it.unitPrice),
      markupPct: it.markupPct === '' ? '' : toNumber(it.markupPct),
    }));
    data.markupPct = toNumber(form.markupPct);
    Object.assign(data, { length: toNumber(test.length), width: toNumber(test.width), depthMin: toNumber(test.depthMin), depthMax: toNumber(test.depthMax) });
    data.updatedAt = serverTimestamp();
    await setDoc(doc(db, 'poolModels', id), data);
  }, 'Modeli u ruajt.');

  const remove = async () => {
    if (await ask({ title: 'Fshi modelin', message: `Fshi "${form.name}"? Ofertat ekzistuese nuk preken.`, danger: true, confirmLabel: 'Fshi' })) {
      run(async () => { await deleteDoc(doc(db, 'poolModels', id)); navigate('/modelet'); }, 'Modeli u fshi.');
    }
  };

  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/modelet">Modelet e pishinave</Link>}
        title={form.name}
        actions={(
          <>
            <button type="button" className="btn danger" onClick={remove}>Fshi</button>
            <button type="button" className="btn primary" disabled={busy} onClick={save}>Ruaj modelin</button>
          </>
        )}
      />
      <Card>
        <div className="form-grid">
          <Field label="Emri" required><input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Kodi"><input value={form.code || ''} onChange={(e) => set('code', e.target.value)} /></Field>
          <Field label="Lloji i pishinës">
            <select value={form.poolType} onChange={(e) => set('poolType', e.target.value)}>
              {Object.entries(POOL_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Sistemi i qarkullimit"><input value={form.circulation || ''} onChange={(e) => set('circulation', e.target.value)} /></Field>
          <Field label="Marzhi standard (%)" hint="Çmimi = kosto × (1 + marzhi). Mund të ndryshohet për çdo rresht.">
            <input className="num" type="number" step="any" value={form.markupPct} onChange={(e) => set('markupPct', e.target.value)} />
          </Field>
          <Field>
            <label className="checkbox"><input type="checkbox" checked={form.active !== false} onChange={(e) => set('active', e.target.checked)} /> Aktiv</label>
          </Field>
          <Field label="Përshkrimi teknik për ofertën (teksti standard)" className="span-all">
            <textarea value={form.technicalText || ''} onChange={(e) => set('technicalText', e.target.value)} />
          </Field>
          <Field label="Sistemi i filtrimit (teksti standard)" className="span-all">
            <textarea value={form.filtration || ''} onChange={(e) => set('filtration', e.target.value)} />
          </Field>
        </div>
      </Card>
      <Card title="Provo formulat me përmasa">
        <div className="form-grid">
          {[['length', 'Gjatësia L (m)'], ['width', 'Gjerësia W (m)'], ['depthMin', 'Thellësia min H1 (m)'], ['depthMax', 'Thellësia max H2 (m)']].map(([k, l]) => (
            <Field key={k} label={l}><input className="num" type="number" step="any" value={test[k]} onChange={(e) => setTest({ ...test, [k]: e.target.value })} /></Field>
          ))}
        </div>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Variablat: {Object.entries(FORMULA_VARIABLES).map(([k, l]) => <span key={k} style={{ marginRight: 10 }}><code>{k}</code> {l} = <b>{qty(vars[k])}</b></span>)}
          <br />Funksionet: {Object.keys(FORMULA_FUNCTIONS).map((f) => <code key={f} style={{ marginRight: 6 }}>{f}()</code>)} <code>if(kusht, po, jo)</code>.
          Shembuj: <code>ceil(P / 6)</code> · <code>S * 1.1</code> · <code>if(V &gt; 60, 2, 1)</code>
        </p>
      </Card>
      <Card title="Materialet dhe pajisjet e modelit" actions={<span className="muted">Kosto: <b>{money(totals.cost)}</b> · Çmimi: <b>{money(totals.price)}</b></span>}>
        <div className="table-wrap">
          <table className="table lines">
            <thead>
              <tr>
                <th>Seksioni</th><th style={{ minWidth: 240 }}>Artikulli / përshkrimi</th><th style={{ minWidth: 150 }}>Formula e sasisë</th><th className="r">Sasia (test)</th>
                <th className="r">Kosto nj.</th><th className="r">Çmim fiks</th><th className="r">Marzh %</th><th className="r">Çmimi</th><th>Te klienti</th><th />
              </tr>
            </thead>
            <tbody>
              {form.items.map((it, i) => {
                const ev = evalItem(it);
                const product = productsById[it.productId];
                return (
                  <tr key={it.key}>
                    <td>
                      <select value={it.section} onChange={(e) => setItem(i, { section: e.target.value })}>
                        {Object.entries(POOL_SECTIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </td>
                    <td>
                      <SearchSelect options={productOptions} value={it.productId || ''} placeholder="Artikull nga magazina (opsional)" onChange={(v) => setItem(i, { productId: v, description: it.description || productsById[v]?.name || '' })} />
                      <input style={{ marginTop: 4 }} placeholder="Përshkrimi për ofertën / shërbimi" value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} />
                      {!it.productId && (
                        <select style={{ marginTop: 4 }} value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })}>
                          {Object.entries(UNITS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      )}
                    </td>
                    <td>
                      <input value={it.formula} onChange={(e) => setItem(i, { formula: e.target.value })} style={{ fontFamily: 'monospace' }} />
                      {ev.error && <small className="text-danger">{ev.error}</small>}
                    </td>
                    <td className="r">{ev.error ? '—' : `${qty(ev.qty)} ${UNITS[product?.unit || it.unit] || ''}`}</td>
                    <td className="r">
                      {it.productId ? money(costOf(it)) : <input className="num" type="number" step="any" value={it.unitCost} onChange={(e) => setItem(i, { unitCost: e.target.value })} style={{ maxWidth: 100 }} />}
                    </td>
                    <td className="r"><input className="num" type="number" step="any" placeholder="auto" value={it.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value })} style={{ maxWidth: 100 }} /></td>
                    <td className="r"><input className="num" type="number" step="any" placeholder={String(form.markupPct)} value={it.markupPct} onChange={(e) => setItem(i, { markupPct: e.target.value })} style={{ maxWidth: 70 }} /></td>
                    <td className="r">{money(priceOf(it))}</td>
                    <td><input type="checkbox" checked={it.showOnClient !== false} onChange={(e) => setItem(i, { showOnClient: e.target.checked })} /></td>
                    <td className="nowrap">
                      <button type="button" className="icon-btn" title="Lart" onClick={() => move(i, -1)}>↑</button>
                      <button type="button" className="icon-btn" title="Poshtë" onClick={() => move(i, 1)}>↓</button>
                      <button type="button" className="icon-btn" title="Hiq" onClick={() => set('items', form.items.filter((_, j) => j !== i))}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => set('items', [...form.items, emptyItem()])}>+ Shto rresht</button>
      </Card>
    </>
  );
}
