import { CURRENCIES } from '@shared/constants.js';

import { useData } from '../lib/data.jsx';
import { money, round2, toNumber } from '../lib/format.js';
import { Field } from './ui.jsx';

/** Monedha e dokumentit dhe kursi i euros (L për 1 €), me vlerën në lekë si informacion. */
export function CurrencyFields({ currency = 'ALL', rate, amount, onChange, disabled }) {
  const { company } = useData();
  return (
    <>
      <Field label="Monedha">
        <select value={currency} disabled={disabled}
          onChange={(e) => onChange({ currency: e.target.value, exchangeRate: e.target.value === 'EUR' ? (toNumber(rate) > 1 ? rate : company.eurRate || '') : 1 })}>
          {Object.entries(CURRENCIES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
        </select>
      </Field>
      {currency === 'EUR' && (
        <Field label="Kursi (L për 1 €)" required hint={toNumber(amount) > 0 && toNumber(rate) > 0 ? `≈ ${money(round2(toNumber(amount) * toNumber(rate)))}` : 'Kursi i ditës së faturës.'}>
          <input className="num" type="number" step="any" value={rate ?? ''} disabled={disabled} onChange={(e) => onChange({ exchangeRate: e.target.value })} />
        </Field>
      )}
    </>
  );
}

/** Fushat e monedhës që ruhen në dokument: currency, exchangeRate, amountAll (vlera në lekë). */
export function currencyData(currency, rate, amount) {
  const cur = CURRENCIES[currency] ? currency : 'ALL';
  const exchangeRate = cur === 'EUR' ? toNumber(rate) : 1;
  if (cur === 'EUR' && !(exchangeRate > 1)) throw new Error('Shkruani kursin e euros (sa lekë për 1 €, p.sh. 98.5).');
  return { currency: cur, exchangeRate, amountAll: round2(toNumber(amount) * exchangeRate) };
}
