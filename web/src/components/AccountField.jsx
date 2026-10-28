import { Link } from 'react-router-dom';

import { ACCOUNT_KINDS, accountLabel } from '../lib/accounts.js';
import { useData } from '../lib/data.jsx';
import { Field } from './ui.jsx';

/** Fushat e llogarisë që ruhen te pagesa (id dhe emri për listat). */
export const accountFields = (accountId, accountsById) => ({
  accountId: accountId || null,
  accountName: accountId ? accountLabel(accountsById[accountId]) : '',
});

/** Zgjedhja e bankës / arkës ku hyn ose nga ku del pagesa. */
export function AccountField({ value, onChange, label = 'Banka / arka', className }) {
  const { accounts } = useData();
  const active = accounts.filter((a) => a.active !== false || a.id === value);
  return (
    <Field label={label} className={className} hint={!active.length ? <Link to="/financa/bankat">Shtoni llogaritë bankare dhe arkën</Link> : undefined}>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">— pa llogari —</option>
        {Object.entries(ACCOUNT_KINDS).map(([k, l]) => {
          const list = active.filter((a) => a.kind === k);
          return list.length ? <optgroup key={k} label={l}>{list.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}{a.iban ? ` · ${a.iban.slice(-6)}` : ''}</option>)}</optgroup> : null;
        })}
      </select>
    </Field>
  );
}
