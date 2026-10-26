import { PlugZap, Stamp } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge, Card, Field, useAction } from '../../components/ui.jsx';
import { useData } from '../../lib/data.jsx';
import { call } from '../../lib/firebase.js';

const ENVS = { test: 'Test (pos-al-dev) — për prova, pa vlerë tatimore', prod: 'Prodhim (pos-al) — fatura reale', custom: 'Adresë tjetër' };

/** Lidhja me programin fiskal POS.AL: Shop ID, çelësi API, TVSH dhe llogaritë bankare. */
export function FiscalSettings() {
  const { company } = useData();
  const [v, setV] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [test, setTest] = useState({ nipt: '', result: null });
  const [run, busy] = useAction();
  useEffect(() => { call('getFiscalConfig').then((c) => setV({ ...c, bankAccounts: c.bankAccounts.length ? c.bankAccounts : [{ bank: '', iban: '', swift: '' }] })).catch(() => setV(false)); }, []);
  if (v === null) return <Card title="Programi fiskal POS.AL"><span className="muted">Po ngarkohet…</span></Card>;
  if (v === false) return null;
  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));
  const setBank = (i, patch) => set('bankAccounts', v.bankAccounts.map((b, k) => (k === i ? { ...b, ...patch } : b)));

  const save = () => run(async () => {
    if (v.enabled && !v.shopId) throw new Error('Shkruani Shop ID nga POS.AL.');
    if (v.enabled && !apiKey && !v.apiKeyMasked) throw new Error('Shkruani çelësin API (x-api-key) nga POS.AL.');
    await call('saveFiscalConfig', { ...v, apiKey });
    setApiKey('');
    const c = await call('getFiscalConfig');
    setV({ ...c, bankAccounts: c.bankAccounts.length ? c.bankAccounts : [{ bank: '', iban: '', swift: '' }] });
  }, 'Cilësimet e POS.AL u ruajtën.');
  const tryLookup = () => run(async () => {
    const r = await call('lookupTaxpayer', { nipt: test.nipt || company.nipt });
    setTest((t) => ({ ...t, result: r.taxpayers }));
    return r;
  }, (r) => (r.taxpayers.length ? 'Lidhja me POS.AL funksionon.' : 'Lidhja funksionon, por NIPT-i nuk u gjet.'));

  return (
    <Card title={<span className="row" style={{ gap: 8 }}><Stamp size={18} /> Programi fiskal POS.AL {company.fiscalEnabled ? <Badge tone="ok">aktiv</Badge> : <Badge>joaktiv</Badge>}</span>}>
      <p className="muted" style={{ marginTop: 0 }}>
        Me lidhjen aktive, faturat fiskalizohen direkt nga SuperPool (butoni «Fiskalizo») dhe marrin NIVF, NSLF dhe kodin QR. Të dhënat i merrni nga llogaria juaj në pos.al. Çelësi ruhet vetëm në server.
      </p>
      <div className="form-grid">
        <Field label=" " className="span-all"><label className="checkbox"><input type="checkbox" checked={v.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Aktivizo fiskalizimin nga SuperPool</label></Field>
        <Field label="Mjedisi" className="span-2">
          <select value={v.env} onChange={(e) => set('env', e.target.value)}>
            {Object.entries(ENVS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        {v.env === 'custom' && <Field label="Adresa e API-së" className="span-2"><input value={v.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder="https://…" /></Field>}
        <Field label="Shop ID" required hint="Emri i dyqanit në pos.al (shopId)."><input value={v.shopId} onChange={(e) => set('shopId', e.target.value)} /></Field>
        <Field label="Çelësi API (x-api-key)" required hint={v.apiKeyMasked ? `I ruajtur: ${v.apiKeyMasked}. Lëreni bosh që të mos ndryshojë.` : 'Ngjiteni të plotë.'}>
          <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={v.apiKeyMasked || 'eyJhbGciOi…'} />
        </Field>
        <Field label=" "><label className="checkbox"><input type="checkbox" checked={v.vatPayer} onChange={(e) => set('vatPayer', e.target.checked)} /> Subjekt në TVSH</label></Field>
        <Field label="TVSH standarde %">
          <select value={v.vatPct} onChange={(e) => set('vatPct', Number(e.target.value))}>
            {[20, 10, 6, 0].map((p) => <option key={p} value={p}>{p}%</option>)}
          </select>
        </Field>
      </div>
      <b style={{ display: 'block', margin: '14px 0 6px' }}>Llogaritë bankare (dalin në faturat jo-cash dhe e-faturat)</b>
      {v.bankAccounts.map((b, i) => (
        <div key={i} className="form-grid" style={{ marginBottom: 6 }}>
          <Field label={i === 0 ? 'Banka (kryesore)' : 'Banka'}><input value={b.bank} onChange={(e) => setBank(i, { bank: e.target.value })} /></Field>
          <Field label="IBAN" className="span-2"><input value={b.iban} onChange={(e) => setBank(i, { iban: e.target.value })} /></Field>
          <Field label="SWIFT"><input value={b.swift} onChange={(e) => setBank(i, { swift: e.target.value })} /></Field>
        </div>
      ))}
      {v.bankAccounts.length < 3 && <button type="button" className="btn small" onClick={() => set('bankAccounts', [...v.bankAccounts, { bank: '', iban: '', swift: '' }])}>+ Llogari tjetër</button>}
      <div className="row" style={{ marginTop: 14 }}>
        <button type="button" className="btn primary" disabled={busy} onClick={save}>Ruaj</button>
        <span className="right row" style={{ gap: 6 }}>
          <input style={{ width: 160 }} placeholder={company.nipt || 'NIPT për provë'} value={test.nipt} onChange={(e) => setTest({ ...test, nipt: e.target.value })} />
          <button type="button" className="btn" disabled={busy || !v.apiKeyMasked} onClick={tryLookup}><PlugZap size={16} /> Provo lidhjen</button>
        </span>
      </div>
      {test.result && (
        <ul className="list-plain" style={{ marginTop: 10 }}>
          {test.result.map((t) => <li key={t.nipt}><span style={{ flex: 1 }}><b>{t.name}</b> · {t.nipt}<br /><small className="muted">{t.address}</small></span></li>)}
          {!test.result.length && <li className="muted">Asnjë tatimpagues me këtë NIPT.</li>}
        </ul>
      )}
    </Card>
  );
}
