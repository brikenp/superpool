import { addDoc, collection, deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { OFFER_STATUS, POOL_SECTIONS, POOL_TYPES, UNITS } from '@shared/constants.js';

import { EntityForm } from '../../components/EntityForm.jsx';
import { Card, Field, Loading, PageHeader, SearchSelect, Stat, StatusBadge, useAction, useUi } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { unitCostOf, useCollection, useData, useDocument } from '../../lib/data.jsx';
import { call, db } from '../../lib/firebase.js';
import { addDays, money, qty, round2, todayISO, toNumber } from '../../lib/format.js';
import { linesFromModel, newKey, offerTotals, offerVariables, priceFromCost, recalcQuantities } from '../../lib/offerCalc.js';
import { clientOfferPdf, internalEstimatePdf } from '../../lib/offerPdf.js';
import { clientFields, normalizeClient } from '../partners/Clients.jsx';
import { freeQty } from '../inventory/Products.jsx';

const TEXT_FIELDS = [
  ['technicalText', 'Zgjidhja teknike (përshkrimi i punimeve)'],
  ['filtration', 'Sistemi i qarkullimit dhe filtrimit'],
  ['equipmentText', 'Pajisje të tjera të përfshira'],
  ['servicesText', 'Shërbimet e përfshira'],
  ['paymentTerms', 'Kushtet e pagesës'],
  ['deliveryTerm', 'Afati i realizimit'],
  ['clientNotes', 'Shënime për klientin'],
];

const emptyLine = () => ({ key: newKey(), section: 'other', productId: null, code: '', description: '', unit: 'cope', formula: '', qty: 1, unitCost: 0, unitPrice: 0, showOnClient: true });

export default function OfferEditor() {
  const { id } = useParams();
  const isNew = id === 're';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { uid, profile } = useAuth();
  const { ask } = useUi();
  const { clients, clientsById, products, productsById, suppliersById, costsById, company } = useData();
  const models = useCollection('poolModels');
  const { data: offer, loading } = useDocument(isNew ? null : `offers/${id}`);
  const [form, setForm] = useState(null);
  const [modelId, setModelId] = useState('');
  const [newClient, setNewClient] = useState(false);
  const [run, busy] = useAction();

  useEffect(() => {
    if (form) return;
    if (isNew) {
      if (!company.loaded) return;
      setForm({
        status: 'draft', date: todayISO(), validUntil: addDays(todayISO(), Number(company.offerValidityDays || 30)),
        clientId: params.get('klienti') || '', projectName: '', location: '',
        poolType: 'skimmer', circulation: '', length: 8, width: 4, depthMin: 1.2, depthMax: 1.6, volume: '', volumeManual: false,
        technicalText: '', filtration: '', equipmentText: '', servicesText: '',
        paymentTerms: company.defaultPaymentTerms || '', deliveryTerm: company.defaultDeliveryTerm || '', clientNotes: '',
        discountPct: 0, vatPct: company.vatPct ?? 20, showLinePrices: false, notesInternal: '', lines: [],
      });
    } else if (offer) {
      setForm({ ...offer, lines: (offer.lines || []).map((l) => ({ ...l, key: l.key || newKey() })) });
    }
  }, [isNew, offer, form, company, params]);

  const totals = useMemo(() => (form ? offerTotals(form) : null), [form]);
  const vars = useMemo(() => (form ? offerVariables(form) : null), [form]);
  const productOptions = useMemo(() => products.filter((p) => p.active !== false).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })), [products]);

  if (!isNew && loading) return <Loading />;
  if (!isNew && !offer) return <div className="alert error">Oferta nuk u gjet.</div>;
  if (!form) return <Loading />;

  const locked = ['accepted', 'rejected', 'expired'].includes(form.status);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setDims = (k, v) => setForm((f) => {
    const next = { ...f, [k]: v };
    return { ...next, lines: recalcQuantities(next.lines, next) };
  });
  const setLine = (i, patch) => set('lines', form.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const costOf = (pid) => unitCostOf(costsById, pid);

  const applyModel = async () => {
    const model = models.data.find((m) => m.id === modelId);
    if (!model) return;
    if (form.lines.length && !(await ask({ title: 'Apliko modelin', message: 'Rreshtat ekzistues do të zëvendësohen me materialet e modelit.', confirmLabel: 'Apliko' }))) return;
    const { lines, errors } = linesFromModel(model, form, { productsById, costOf });
    setForm((f) => ({
      ...f,
      modelId: model.id,
      modelName: model.name,
      poolType: model.poolType || f.poolType,
      circulation: model.circulation || f.circulation,
      technicalText: f.technicalText || model.technicalText || '',
      filtration: f.filtration || model.filtration || '',
      lines,
    }));
    if (errors.length) ask({ title: 'Disa formula kanë gabime', message: errors.join('\n'), confirmLabel: 'OK' });
  };

  const refreshCosts = () => set('lines', form.lines.map((l) => (l.productId ? { ...l, unitCost: round2(costOf(l.productId)) } : l)));

  const payload = () => {
    const client = clientsById[form.clientId];
    const { id: _id, ...rest } = form;
    return {
      ...rest,
      clientName: client?.name || form.clientName || '',
      volume: form.volumeManual ? toNumber(form.volume) : round2(vars.V),
      area: round2(vars.A),
      length: toNumber(form.length), width: toNumber(form.width), depthMin: toNumber(form.depthMin), depthMax: toNumber(form.depthMax),
      discountPct: toNumber(form.discountPct), vatPct: toNumber(form.vatPct),
      lines: form.lines.map((l) => ({
        ...l, qty: toNumber(l.qty), unitCost: toNumber(l.unitCost), unitPrice: toNumber(l.unitPrice), productId: l.productId || null,
      })),
      totals,
      updatedAt: serverTimestamp(),
    };
  };

  const save = (extra = {}) => run(async () => {
    if (!form.clientId) throw new Error('Zgjidhni klientin.');
    const data = { ...payload(), ...extra };
    if (isNew) {
      const { number } = await call('allocateNumber', { prefix: 'OF' });
      const ref = await addDoc(collection(db, 'offers'), { ...data, number, createdBy: uid, createdByName: profile?.name || '', createdAt: serverTimestamp() });
      navigate(`/ofertat/${ref.id}`, { replace: true });
    } else {
      await setDoc(doc(db, 'offers', id), data, { merge: true });
      setForm(null);
    }
  }, 'Oferta u ruajt.');

  const accept = async () => {
    const ok = await ask({
      title: 'Klienti e pranoi ofertën',
      message: 'Oferta do të kthehet në projekt aktiv: krijohet kartela e projektit, kantieri dhe materialet e planifikuara. Pastaj mund të rezervoni materialet.',
      confirmLabel: 'Krijo projektin',
    });
    if (!ok) return;
    run(async () => {
      await setDoc(doc(db, 'offers', id), payload(), { merge: true });
      const res = await call('acceptOffer', { offerId: id });
      navigate(`/projektet/${res.projectId}`);
      return res;
    }, (r) => `U krijua projekti ${r.code}.`);
  };

  const duplicate = () => run(async () => {
    const { number } = await call('allocateNumber', { prefix: 'OF' });
    const data = payload();
    delete data.projectId;
    delete data.acceptedAt;
    const ref = await addDoc(collection(db, 'offers'), { ...data, number, status: 'draft', date: todayISO(), createdBy: uid, createdByName: profile?.name || '', createdAt: serverTimestamp() });
    navigate(`/ofertat/${ref.id}`);
    setForm(null);
  }, 'U krijua një kopje e ofertës.');

  const remove = async () => {
    if (await ask({ title: 'Fshi ofertën', message: 'Vetëm ofertat draft mund të fshihen.', danger: true, confirmLabel: 'Fshi' })) {
      run(async () => { await deleteDoc(doc(db, 'offers', id)); navigate('/ofertat'); }, 'Oferta u fshi.');
    }
  };

  const pdfClient = () => run(() => clientOfferPdf({ ...form, totals }, company, clientsById[form.clientId]));
  const pdfInternal = () => run(() => internalEstimatePdf({ ...form, totals, clientName: clientsById[form.clientId]?.name || form.clientName }, company, { productsById, suppliersById, freeQtyOf: freeQty }));

  const sections = Object.keys(POOL_SECTIONS);

  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/ofertat">Ofertat</Link>}
        title={isNew ? 'Ofertë e re' : `Oferta ${form.number}`}
        subtitle={!isNew && <><StatusBadge status={form.status} labels={OFFER_STATUS} />{form.modelName ? ` · Modeli: ${form.modelName}` : ''}{form.projectId && <> · <Link to={`/projektet/${form.projectId}`}>shiko projektin</Link></>}</>}
        actions={(
          <>
            {!isNew && <button type="button" className="btn" onClick={pdfClient}>PDF për klientin</button>}
            {!isNew && <button type="button" className="btn" onClick={pdfInternal}>Preventivi i brendshëm</button>}
            {!isNew && <button type="button" className="btn" disabled={busy} onClick={duplicate}>Kopjo</button>}
            {!locked && <button type="button" className="btn primary" disabled={busy} onClick={() => save()}>Ruaj</button>}
          </>
        )}
      />
      {!isNew && !locked && (
        <div className="row" style={{ marginBottom: 12 }}>
          {form.status === 'draft' && <button type="button" className="btn" disabled={busy} onClick={() => save({ status: 'sent', sentAt: serverTimestamp() })}>Shëno si të dërguar</button>}
          <button type="button" className="btn ok" disabled={busy} onClick={accept}>Klienti e pranoi → Krijo projektin</button>
          <button type="button" className="btn danger" disabled={busy} onClick={() => save({ status: 'rejected' })}>Refuzuar nga klienti</button>
          {form.status === 'draft' && <button type="button" className="btn ghost" onClick={remove}>Fshi</button>}
        </div>
      )}
      {locked && <div className="alert info">Oferta është {OFFER_STATUS[form.status].toLowerCase()} dhe nuk mund të ndryshohet. Përdorni "Kopjo" për një version të ri.</div>}

      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="grid grid-2">
          <Card title="Klienti dhe projekti">
            <div className="form-grid">
              <Field label="Klienti" required className="span-all">
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <div style={{ flex: 1 }}>
                    <SearchSelect options={clients.map((c) => ({ value: c.id, label: c.name, sub: [c.nipt, c.phone].filter(Boolean).join(' · ') }))} value={form.clientId} onChange={(v) => set('clientId', v)} />
                  </div>
                  <button type="button" className="btn" onClick={() => setNewClient(true)}>+ I ri</button>
                </div>
              </Field>
              <Field label="Emri i projektit"><input value={form.projectName} onChange={(e) => set('projectName', e.target.value)} placeholder="p.sh. Pishinë vile, Golem" /></Field>
              <Field label="Vendndodhja"><input value={form.location} onChange={(e) => set('location', e.target.value)} /></Field>
              <Field label="Data"><input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} /></Field>
              <Field label="E vlefshme deri më"><input type="date" value={form.validUntil || ''} onChange={(e) => set('validUntil', e.target.value)} /></Field>
            </div>
          </Card>
          <Card title="Pishina">
            <div className="form-grid">
              <Field label="Modeli standard" className="span-all">
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <select value={modelId || form.modelId || ''} onChange={(e) => setModelId(e.target.value)}>
                    <option value="">Zgjidh modelin…</option>
                    {models.data.filter((m) => m.active !== false).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <button type="button" className="btn" disabled={!modelId} onClick={applyModel}>Llogarit materialet</button>
                </div>
              </Field>
              <Field label="Lloji">
                <select value={form.poolType} onChange={(e) => set('poolType', e.target.value)}>
                  {Object.entries(POOL_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
              <Field label="Qarkullimi"><input value={form.circulation || ''} onChange={(e) => set('circulation', e.target.value)} /></Field>
              <Field label="Gjatësia (m)"><input className="num" type="number" step="any" value={form.length} onChange={(e) => setDims('length', e.target.value)} /></Field>
              <Field label="Gjerësia (m)"><input className="num" type="number" step="any" value={form.width} onChange={(e) => setDims('width', e.target.value)} /></Field>
              <Field label="Thellësia min (m)"><input className="num" type="number" step="any" value={form.depthMin} onChange={(e) => setDims('depthMin', e.target.value)} /></Field>
              <Field label="Thellësia max (m)"><input className="num" type="number" step="any" value={form.depthMax} onChange={(e) => setDims('depthMax', e.target.value)} /></Field>
              <Field label="Vëllimi i ujit (m³)" hint={form.volumeManual ? 'Vendosur me dorë' : `Llogaritur: ${qty(vars.V)} m³ · sipërfaqja ${qty(vars.A)} m²`}>
                <input className="num" type="number" step="any" value={form.volumeManual ? form.volume : round2(vars.V)}
                  onChange={(e) => setForm((f) => { const next = { ...f, volume: e.target.value, volumeManual: true }; return { ...next, lines: recalcQuantities(next.lines, next) }; })} />
              </Field>
              {form.volumeManual && <Field label=" "><button type="button" className="btn small" onClick={() => setDims('volumeManual', false)}>Llogarit automatikisht</button></Field>}
            </div>
          </Card>
        </div>

        <Card
          title="Materialet, pajisjet dhe shërbimet"
          actions={!locked && (
            <>
              <button type="button" className="btn small" onClick={refreshCosts}>Rifresko kostot nga magazina</button>
              <button type="button" className="btn small" onClick={() => set('lines', recalcQuantities(form.lines.map((l) => ({ ...l, qty: l.autoQty ?? l.qty })), form))}>Rikthe sasitë automatike</button>
            </>
          )}
        >
          <div className="table-wrap">
            <table className="table lines">
              <thead>
                <tr>
                  <th>Seksioni</th><th style={{ minWidth: 260 }}>Artikulli / përshkrimi</th><th className="r">Sasia</th><th>Nj.</th>
                  <th className="r">Kosto nj.</th><th className="r">Çmimi nj.</th><th className="r">Vlera</th><th className="r">Stoku i lirë</th><th>Klient</th><th />
                </tr>
              </thead>
              <tbody>
                {sections.flatMap((s) => form.lines
                  .map((l, i) => ({ l, i }))
                  .filter(({ l }) => (l.section || 'other') === s)
                  .map(({ l, i }) => {
                    const p = l.productId ? productsById[l.productId] : null;
                    const free = p ? freeQty(p) : null;
                    const manual = l.autoQty !== undefined && l.formula && toNumber(l.qty) !== Number(l.autoQty);
                    return (
                      <tr key={l.key}>
                        <td>
                          <select value={l.section || 'other'} onChange={(e) => setLine(i, { section: e.target.value })}>
                            {sections.map((k) => <option key={k} value={k}>{POOL_SECTIONS[k]}</option>)}
                          </select>
                        </td>
                        <td>
                          <SearchSelect options={productOptions} value={l.productId || ''} placeholder="Artikull nga magazina (opsional)"
                            onChange={(v) => {
                              const prod = productsById[v];
                              const cost = v ? round2(costOf(v)) : 0;
                              setLine(i, { productId: v || null, code: prod?.code || '', unit: prod?.unit || l.unit, description: prod?.name || l.description, unitCost: cost, unitPrice: l.unitPrice || priceFromCost(cost, 35) });
                            }} />
                          <input style={{ marginTop: 4 }} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Përshkrimi" />
                          {l.formula && <small className="muted">Formula: <code>{l.formula}</code> = {qty(l.autoQty)}</small>}
                        </td>
                        <td className="r">
                          <input className="num" type="number" step="any" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} style={{ maxWidth: 90, borderColor: manual ? 'var(--warn)' : undefined }} title={manual ? 'Ndryshuar me dorë' : ''} />
                        </td>
                        <td>
                          {p ? UNITS[p.unit] : (
                            <select value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })}>
                              {Object.entries(UNITS).map(([k, lab]) => <option key={k} value={k}>{lab}</option>)}
                            </select>
                          )}
                        </td>
                        <td className="r"><input className="num" type="number" step="any" value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} style={{ maxWidth: 100 }} /></td>
                        <td className="r"><input className="num" type="number" step="any" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} style={{ maxWidth: 110 }} /></td>
                        <td className="r">{money(toNumber(l.qty) * toNumber(l.unitPrice))}</td>
                        <td className={`r ${p && free < toNumber(l.qty) ? 'text-danger' : ''}`}>{p ? qty(free) : ''}</td>
                        <td><input type="checkbox" checked={l.showOnClient !== false} onChange={(e) => setLine(i, { showOnClient: e.target.checked })} title="Shfaqet në ofertën për klientin" /></td>
                        <td><button type="button" className="icon-btn" onClick={() => set('lines', form.lines.filter((_, j) => j !== i))}>✕</button></td>
                      </tr>
                    );
                  }))}
              </tbody>
            </table>
            {!form.lines.length && <div className="empty">Zgjidhni një model pishine dhe shtypni "Llogarit materialet", ose shtoni rreshta me dorë.</div>}
          </div>
          {!locked && <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => set('lines', [...form.lines, emptyLine()])}>+ Shto rresht</button>}
          <p className="muted" style={{ fontSize: '0.83rem' }}>Sasitë me kornizë portokalli janë ndryshuar me dorë dhe nuk rillogariten kur ndryshojnë përmasat.</p>
        </Card>

        <div className="grid grid-2">
          <Card title="Tekstet e ofertës">
            <div className="stack">
              {TEXT_FIELDS.map(([k, label]) => (
                <Field key={k} label={label}><textarea value={form[k] || ''} onChange={(e) => set(k, e.target.value)} /></Field>
              ))}
            </div>
          </Card>
          <div>
            <Card title="Vlera e ofertës">
              <div className="form-grid">
                <Field label="Zbritje (%)"><input className="num" type="number" step="any" value={form.discountPct} onChange={(e) => set('discountPct', e.target.value)} /></Field>
                <Field label="TVSH (%)"><input className="num" type="number" step="any" value={form.vatPct} onChange={(e) => set('vatPct', e.target.value)} /></Field>
                <Field className="span-all">
                  <label className="checkbox"><input type="checkbox" checked={Boolean(form.showLinePrices)} onChange={(e) => set('showLinePrices', e.target.checked)} /> Shfaq çmimet për çdo rresht në ofertën e klientit</label>
                </Field>
              </div>
              <dl className="props" style={{ marginTop: 12 }}>
                <dt>Vlera</dt><dd>{money(totals.subtotal)}</dd>
                {totals.discount > 0 && <><dt>Zbritje</dt><dd>- {money(totals.discount)}</dd></>}
                <dt>Pa TVSH</dt><dd>{money(totals.net)}</dd>
                <dt>TVSH</dt><dd>{money(totals.vat)}</dd>
                <dt className="bold">Totali</dt><dd className="bold">{money(totals.total)}</dd>
              </dl>
            </Card>
            <Card title="Preventivi i brendshëm (konfidencial)">
              <div className="grid grid-3">
                <Stat label="Kosto" value={money(totals.cost)} />
                <Stat label="Marzhi" value={money(totals.margin)} tone={totals.margin < 0 ? 'danger' : 'ok'} />
                <Stat label="Marzhi %" value={`${totals.marginPct}%`} tone={totals.marginPct < 15 ? 'warn' : 'ok'} />
              </div>
              <Field label="Shënime të brendshme" className="span-all">
                <textarea value={form.notesInternal || ''} onChange={(e) => set('notesInternal', e.target.value)} />
              </Field>
            </Card>
          </div>
        </div>
      </fieldset>
      {newClient && (
        <EntityForm title="Klient i ri" collectionName="clients" defaults={{ type: 'individual' }} fields={clientFields} transform={normalizeClient}
          onClose={() => setNewClient(false)} onSaved={(c) => set('clientId', c.id)} />
      )}
    </>
  );
}
