import { Plus, X } from 'lucide-react';
import { useMemo } from 'react';

import { CONDITIONS, UNITS } from '@shared/constants.js';

import { useData } from '../lib/data.jsx';
import { money, qty as fmtQty, round2, toNumber } from '../lib/format.js';
import { ProductThumb, productOption } from './ProductImage.jsx';
import { SearchSelect } from './ui.jsx';

export const emptyLine = () => ({ key: Math.random().toString(36).slice(2), productId: '', qty: '', condition: 'good', note: '' });

/**
 * Redaktues rreshtash artikujsh.
 * props:
 *  - lines, onChange
 *  - available: { productId: qty } — gjendja në vendin burim (shfaqet dhe kontrollohet)
 *  - priceField: 'unitCost' | 'unitPrice' | null — kolona e çmimit
 *  - showCondition: për kthimet
 *  - productFilter: (product) => bool
 *  - defaultPrice: (product) => numër që vendoset kur zgjidhet artikulli
 */
export function LinesEditor({ lines, onChange, available, priceField, priceLabel, showCondition, productFilter, defaultPrice, readOnly }) {
  const { products, productsById } = useData();
  const options = useMemo(() => products
    .filter((p) => p.active !== false && (!productFilter || productFilter(p)))
    .map((p) => productOption(p, [p.brand, p.model, available ? `gjendje: ${fmtQty(available[p.id] || 0)} ${UNITS[p.unit] || ''}` : ''].filter(Boolean).join(' · '))),
  [products, productFilter, available]);

  const update = (i, patch) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const remove = (i) => onChange(lines.filter((_, j) => j !== i));
  const add = () => onChange([...lines, emptyLine()]);

  const total = priceField ? lines.reduce((s, l) => s + toNumber(l.qty) * toNumber(l[priceField]), 0) : 0;

  return (
    <div>
      <div className="table-wrap">
        <table className="table lines responsive">
          <thead>
            <tr>
              <th style={{ minWidth: 260 }}>Artikulli</th>
              {available && <th className="r">Gjendja</th>}
              <th className="r" style={{ width: 120 }}>Sasia</th>
              {priceField && <th className="r" style={{ width: 130 }}>{priceLabel || 'Çmimi'}</th>}
              {priceField && <th className="r">Vlera</th>}
              {showCondition && <th style={{ width: 170 }}>Gjendja e mallit</th>}
              <th>Shënim</th>
              {!readOnly && <th style={{ width: 40 }} />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const p = productsById[l.productId];
              const avail = available ? Number(available[l.productId] || 0) : null;
              const sameProductQty = lines.filter((x) => x.productId === l.productId).reduce((s, x) => s + toNumber(x.qty), 0);
              const short = available && l.productId && sameProductQty > avail + 0.0005;
              return (
                <tr key={l.key || i}>
                  <td data-label="Artikulli">
                    <div className="product-cell">
                    {p && <ProductThumb product={p} size={34} />}
                    {readOnly ? `${p?.code || ''} · ${p?.name || l.name || ''}` : (
                      <div style={{ flex: 1, minWidth: 0 }}><SearchSelect
                        options={options}
                        value={l.productId}
                        placeholder="Kërko artikull (kod, emër, barkod)…"
                        onChange={(productId) => {
                          const prod = productsById[productId];
                          const patch = { productId };
                          if (priceField && prod && defaultPrice && !toNumber(l[priceField])) patch[priceField] = defaultPrice(prod);
                          update(i, patch);
                        }}
                      /></div>
                    )}
                    </div>
                  </td>
                  {available && (
                    <td data-label="Gjendja" className={`r ${short ? 'text-danger bold' : ''}`}>
                      {l.productId ? `${fmtQty(avail)} ${UNITS[p?.unit] || ''}` : ''}
                    </td>
                  )}
                  <td data-label="Sasia" className="r">
                    {readOnly ? fmtQty(l.qty) : (
                      <input className="num" type="number" inputMode="decimal" step="any" min="0" value={l.qty}
                        onChange={(e) => update(i, { qty: e.target.value })} />
                    )}
                  </td>
                  {priceField && (
                    <td data-label={priceLabel || 'Çmimi'} className="r">
                      {readOnly ? money(l[priceField]) : (
                        <input className="num" type="number" inputMode="decimal" step="any" min="0" value={l[priceField] ?? ''}
                          onChange={(e) => update(i, { [priceField]: e.target.value })} />
                      )}
                    </td>
                  )}
                  {priceField && <td data-label="Vlera" className="r">{money(round2(toNumber(l.qty) * toNumber(l[priceField])))}</td>}
                  {showCondition && (
                    <td data-label="Gjendja e mallit">
                      <select value={l.condition || 'good'} disabled={readOnly} onChange={(e) => update(i, { condition: e.target.value })}>
                        {Object.entries(CONDITIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                      </select>
                    </td>
                  )}
                  <td data-label="Shënim">
                    {readOnly ? l.note : <input value={l.note || ''} onChange={(e) => update(i, { note: e.target.value })} />}
                  </td>
                  {!readOnly && (
                    <td><button type="button" className="icon-btn" title="Hiq rreshtin" onClick={() => remove(i)}><X size={16} /></button></td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {priceField && lines.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={(available ? 3 : 2) + 1} data-label="">Totali</td>
                <td className="r" data-label="Totali">{money(total)}</td>
                <td colSpan={(showCondition ? 1 : 0) + 1 + (readOnly ? 0 : 1)} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {!readOnly && (
        <button type="button" className="btn" style={{ marginTop: 8 }} onClick={add}><Plus size={16} /> Shto artikull</button>
      )}
    </div>
  );
}

/** Kthen rreshtat e vlefshëm për dërgim te funksionet. */
export const cleanLines = (lines, priceField) => lines
  .filter((l) => l.productId && toNumber(l.qty) > 0)
  .map((l) => ({
    productId: l.productId,
    qty: toNumber(l.qty),
    condition: l.condition || 'good',
    note: l.note || '',
    ...(priceField ? { [priceField]: toNumber(l[priceField]) } : {}),
  }));
