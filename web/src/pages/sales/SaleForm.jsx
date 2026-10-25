import { collection, query, where } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { LOC, PAYMENT_METHODS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { EntityForm } from '../../components/EntityForm.jsx';
import { LinesEditor, cleanLines, emptyLine } from '../../components/LinesEditor.jsx';
import { Card, Field, PageHeader, SearchSelect, useAction } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useData, useQuery } from '../../lib/data.jsx';
import { call, db } from '../../lib/firebase.js';
import { money, todayISO, toNumber } from '../../lib/format.js';
import { clientFields, normalizeClient } from '../partners/Clients.jsx';

export default function SaleForm() {
  const { uid, can } = useAuth();
  const { locations, clients } = useData();
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
  const available = useMemo(() => Object.fromEntries(stock.data.map((s) => [s.productId, Number(s.qty || 0)])), [stock.data]);
  const total = form.lines.reduce((s, l) => s + toNumber(l.qty) * toNumber(l.unitPrice), 0);

  const submit = () => run(async () => {
    if (!form.clientId) throw new Error('Zgjidhni klientin.');
    const lines = cleanLines(form.lines, 'unitPrice');
    if (!lines.length) throw new Error('Shtoni të paktën një produkt.');
    const res = await call('confirmSale', { sale: { ...form, lines } });
    navigate(`/kimikate/${res.id}`, { replace: true });
    return res;
  }, (r) => `Shitja ${r.number} u regjistrua (${money(r.total)}).`);

  return (
    <>
      <PageHeader breadcrumb={<Link to="/kimikate">Shitjet</Link>} title="Shitje e re" subtitle="Malli zbritet nga stoku dhe krijohet fatura në pritje të numrit fiskal." />
      <Card>
        <div className="form-grid">
          <Field label="Klienti" required className="span-2">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <div style={{ flex: 1 }}>
                <SearchSelect options={clients.map((c) => ({ value: c.id, label: c.name, sub: [c.nipt, c.phone, c.city].filter(Boolean).join(' · ') }))} value={form.clientId} onChange={(v) => set('clientId', v)} />
              </div>
              {can(CAPS.CLIENTS_MANAGE) && <button type="button" className="btn" onClick={() => setNewClient(true)}>+ I ri</button>}
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
          available={available}
          priceField="unitPrice"
          priceLabel="Çmimi me TVSH"
          defaultPrice={(p) => Number(p.salePrice || 0)}
          productFilter={seesAll ? undefined : (p) => p.isChemical}
        />
      </Card>
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
