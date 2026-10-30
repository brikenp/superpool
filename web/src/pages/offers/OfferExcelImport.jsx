import { Upload } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { UNITS } from '@shared/constants.js';
import { CAPS } from '@shared/roles.js';

import { Field, Modal, useAction } from '../../components/ui.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useData } from '../../lib/data.jsx';
import { money, qty, toNumber } from '../../lib/format.js';
import { createOfferFromExcel, readOfferExcel } from '../../lib/offerImport.js';

/** Butoni «Importo nga Excel»: lexon fletën e parë të një oferte Excel dhe krijon ofertën me fotot. */
export function OfferExcelImport() {
  const { can, uid, profile } = useAuth();
  const { clients, company } = useData();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [currency, setCurrency] = useState('EUR');
  const [rate, setRate] = useState('');
  const [includeZero, setIncludeZero] = useState(false);
  const [progress, setProgress] = useState('');
  const [run, busy] = useAction();
  if (!can(CAPS.OFFERS)) return null;

  const load = (file) => run(async () => {
    const p = await readOfferExcel(file);
    setParsed({ ...p, fileName: file.name });
  });
  const create = () => run(async () => {
    if (currency === 'EUR' && !(toNumber(rate || company.eurRate) > 1)) throw new Error('Shkruani kursin e euros (sa lekë për 1 €).');
    const r = await createOfferFromExcel(parsed, {
      clients, company, uid, userName: profile?.name, currency, exchangeRate: toNumber(rate || company.eurRate), includeZero, onProgress: setProgress,
    });
    setOpen(false);
    setParsed(null);
    navigate(`/ofertat/${r.id}`);
    return r;
  }, (r) => `U krijua oferta ${r.number}: ${r.lines} rreshta, ${r.photos} foto.`);

  const x = parsed?.offer;
  const items = x ? x.items.filter((i) => includeZero || i.qty > 0) : [];
  const existing = x && clients.find((c) => c.name?.trim().toLowerCase() === x.client.name?.trim().toLowerCase());
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}><Upload size={16} /> Importo nga Excel</button>
      {open && (
        <Modal title="Importo ofertë nga Excel" onClose={busy ? undefined : () => { setOpen(false); setParsed(null); }} wide
          footer={(
            <>
              <button type="button" className="btn" disabled={busy} onClick={() => { setOpen(false); setParsed(null); }}>Anulo</button>
              <button type="button" className="btn primary" disabled={busy || !x || !items.length} onClick={create}>{busy && progress ? progress : 'Krijo ofertën'}</button>
            </>
          )}>
          <Field label="Skedari i ofertës (.xlsx)" hint="Lexohet vetëm fleta e parë: klienti, përmasat, artikujt me sasi, fotot, totali dhe tekstet.">
            <input type="file" accept=".xlsx" disabled={busy} onChange={(e) => e.target.files[0] && load(e.target.files[0])} />
          </Field>
          {busy && !x && <p className="muted">Duke lexuar skedarin…</p>}
          {x && (
            <>
              <div className="alert info"><div>
                Fleta: <b>{parsed.sheetName}</b> · Klienti: <b>{x.client.name || '—'}</b>{x.client.city ? `, ${x.client.city}` : ''} {existing ? '(ekziston)' : '(do të krijohet)'}
                {'\n'}Pishina: {qty(x.dims.length)} × {qty(x.dims.width)} × {qty(x.dims.depthMin)} m · vëllimi {qty(x.dims.volume)} m³ · depo {qty(x.dims.tank)} m³ · {qty(x.dims.turnoverHours)} orë
                {'\n'}Rreshta: {items.length} (nga {x.items.length} gjithsej) · Foto: {items.reduce((s, i) => s + (parsed.photos[i.row]?.length || 0), 0)}
                {' '}· Totali pa TVSH: <b>{money(x.subtotal, currency)}</b> · TVSH {x.vatPct}%
              </div></div>
              <div className="form-grid">
                <Field label="Monedha e totalit">
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    <option value="EUR">Euro (€)</option>
                    <option value="ALL">Lekë (L)</option>
                  </select>
                </Field>
                {currency === 'EUR' && (
                  <Field label="Kursi (L për 1 €)"><input className="num" type="number" step="any" value={rate} placeholder={String(company.eurRate || '')} onChange={(e) => setRate(e.target.value)} /></Field>
                )}
                <Field className="span-all">
                  <label className="checkbox"><input type="checkbox" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} /> Përfshi edhe artikujt me sasi 0 (të gjithë katalogun e fletës)</label>
                </Field>
              </div>
              <div className="table-wrap" style={{ maxHeight: 300 }}>
                <table className="table">
                  <thead><tr><th>Nr.</th><th>Artikulli</th><th className="r">Sasia</th><th>Nj.</th><th className="r">Foto</th></tr></thead>
                  <tbody>
                    {items.map((i, k) => (
                      <tr key={i.row}><td>{k + 1}</td><td>{i.title}</td><td className="r">{qty(i.qty)}</td><td>{UNITS[i.unit] || i.unit}</td><td className="r">{parsed.photos[i.row]?.length || 0}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
