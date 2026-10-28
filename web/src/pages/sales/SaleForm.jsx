import { collection, query, where } from 'firebase/firestore';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { LOC, PAYMENT_METHODS, UNITS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';
import { explodeRecipes, isComposite } from '@shared/stock.js';
import { salePriceIn } from '@shared/prices.js';

import { EntityForm } from '../../components/EntityForm.jsx';
import { LinesEditor, cleanLines, emptyLine } from '../../components/LinesEditor.jsx';
import { Card, Field, PageHeader, SearchSelect, useAction } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useData, useQuery } from '../../lib/data.jsx';
import { call, db } from '../../lib/firebase.js';
import { qty as fmtQty, money, todayISO, toNumber } from '../../lib/format.js';
import { clientFields, normalizeClient } from '../partners/Clients.jsx';
import { clientOption } from '../../lib/clients.js';

export default function SaleForm() {
  const { uid, can } = useAuth();
  const { locations, clients, products, productsById, company } = useData();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const seesAll = can(CAPS.CHEM_SALES_ALL);
  const sourceOptions = locations.filter((l) => l.active !== false
    && ((l.kind === 'agent' && (seesAll || l.agentUid === uid)) || l.kind === 'main'));
  const myAgent = sourceOptions.find((l) => l.kind === 'agent' && l.agentUid === uid);

  const [form, setForm] = useState({
    date: todayISO(),
    clientId: params.get('klienti') || '',
    locationId: myAgent?.id || LOC.MAIN,
    paymentMethod: 'cash',
    notes: '',
    lines: [emptyLine()],
  });
  const [newClient, setNewClient] = useState(false);
  const [run, busy] = useAction();
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const stock = useQuery(() => (form.locationId ? query(collection(db, 'stock'), where('locationId', '==', form.locationId)) : null), [form.locationId]);
  const available = useMemo(() => {
    const a = Object.fromEntries(stock.data.map((s) => [s.productId, Number(s.qty || 0)]));
    // Artikujt me recetë: gjendja e prodhuar + sa mund të prodhohen me materialet që ka ky stok.
    const base = { ...a };
    for (const p of products) {
      if (!isComposite(p)) continue;
      const parts = p.recipe.filter((c) => c.productId && Number(c.qty) > 0);
      a[p.id] = (base[p.id] || 0) + Math.min(...parts.map((c) => Math.floor(((base[c.productId] || 0) / Number(c.qty)) * 1000) / 1000));
    }
    return { all: a, base };
  }, [stock.data, products]);
  // Prodhohet vetëm sasia që nuk mbulohet nga gjendja e artikullit me recetë.
  const materials = useMemo(() => {
    const need = {};
    for (const l of form.lines) if (l.productId && toNumber(l.qty) > 0) need[l.productId] = (need[l.productId] || 0) + toNumber(l.qty);
    const shortfall = Object.entries(need).map(([productId, q]) => ({ productId, qty: q - (available.base[productId] || 0) })).filter((i) => i.qty > 0);
    return explodeRecipes(shortfall, productsById);
  }, [form.lines, productsById, available]);
  const total = form.lines.reduce((s, l) => s + toNumber(l.qty) * toNumber(l.unitPrice), 0);

  const submit = () => run(async () => {
    if (!form.clientId) throw new Error('Zgjidhni klientin.');
    const lines = cleanLines(form.lines, 'unitPrice');
    if (!lines.length) throw new Error('Shtoni të paktën një produkt.');
    const res = await call('confirmSale', { sale: { ...form, lines } });
    navigate(`/kimikate/${res.id}`, { replace: true });
    return res;
  }, (r) => `Shitja ${r.number} u regjistrua (${money(r.total)}).${r.productionNumber ? ` Fletëdalja e prodhimit: ${r.productionNumber}.` : ''}`);

  return (
    <>
      <PageHeader breadcrumb={<Link to="/kimikate">Shitjet</Link>} title="Shitje e re" subtitle="Malli zbritet nga stoku dhe krijohet fatura në pritje të numrit fiskal." />
      <Card>
        <div className="form-grid">
          <Field label="Klienti" required className="span-2">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <div style={{ flex: 1 }}>
                <SearchSelect options={clients.map((c) => clientOption(c, [c.nipt, c.phone, c.city]))} value={form.clientId} onChange={(v) => set('clientId', v)} />
              </div>
              {can(CAPS.CLIENTS_MANAGE) && <button type="button" className="btn" onClick={() => setNewClient(true)}><Plus size={16} /> I ri</button>}
            </div>
          </Field>
          <Field label="Data"><input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label="Nga stoku">
            <select value={form.locationId} onChange={(e) => set('locationId', e.target.value)}>
              {sourceOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Mënyra e pagesës">
            <select value={form.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)}>
              {Object.entries(PAYMENT_METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Shënime" className="span-all"><input value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
      </Card>
      <Card title="Produktet">
        <LinesEditor
          lines={form.lines}
          onChange={(lines) => set('lines', lines)}
          available={available.all}
          priceField="unitPrice"
          priceLabel="Çmimi me TVSH"
          defaultPrice={(p) => salePriceIn(p, 'ALL', company.eurRate)}
          productFilter={seesAll ? undefined : (p) => p.isChemical}
        />
      </Card>
      {materials.length > 0 && (
        <Card title="Materialet për prodhim (fletë prodhimi automatike)">
          <p className="muted" style={{ marginTop: 0 }}>Gjendja e prodhuar nuk mjafton për disa artikuj me recetë. Me konfirmimin e shitjes krijohet automatikisht një fletë prodhimi për sasinë që mungon, e cila shkarkon këto materiale nga stoku i zgjedhur dhe lidhet me shitjen dhe faturën.</p>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Materiali</th><th className="r">Sasia</th><th className="r">Gjendja</th></tr></thead>
              <tbody>
                {materials.map((m) => {
                  const p = productsById[m.productId] || {};
                  const short = m.qty > (available.base[m.productId] || 0) + 0.0005;
                  return (
                    <tr key={m.productId} className={short ? 'text-danger' : ''}>
                      <td>{p.code} · {p.name}</td>
                      <td className="r">{fmtQty(m.qty)} {UNITS[p.unit] || p.unit || ''}</td>
                      <td className="r">{fmtQty(available.base[m.productId] || 0)}{short ? ' — nuk mjafton' : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <div className="form-actions">
        <span className="bold" style={{ marginRight: 'auto', fontSize: '1.1rem' }}>Totali: {money(total)}</span>
        <button type="button" className="btn" onClick={() => navigate(-1)}>Anulo</button>
        <button type="button" className="btn primary big" disabled={busy} onClick={submit}>Konfirmo shitjen</button>
      </div>
      {newClient && (
        <EntityForm title="Klient i ri" collectionName="clients" defaults={{ type: 'individual' }} fields={clientFields} transform={normalizeClient}
          onClose={() => setNewClient(false)} onSaved={(c) => set('clientId', c.id)} />
      )}
    </>
  );
}
