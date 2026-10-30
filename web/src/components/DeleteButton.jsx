import { Trash2 } from 'lucide-react';

import { call } from '../lib/firebase.js';
import { useAction, useUi } from './ui.jsx';

/**
 * Butoni i fshirjes përmes një funksioni të serverit (që kontrollon nëse dokumenti lejohet të fshihet).
 * fn: emri i funksionit (p.sh. 'deleteEmployee'), id: dokumenti, title/message: konfirmimi.
 */
export function DeleteButton({ fn, id, title, message, done = 'U fshi.', small = true, label, onDone }) {
  const { ask } = useUi();
  const [run, busy] = useAction();
  const remove = async (e) => {
    e?.stopPropagation();
    const ok = await ask({ title, message, confirmLabel: 'Fshi', danger: true });
    if (!ok) return;
    run(async () => { await call(fn, { id }); onDone?.(); }, done);
  };
  return (
    <button type="button" className={`btn danger ${small ? 'small' : ''}`} disabled={busy} title={title} onClick={remove}>
      <Trash2 size={small ? 14 : 16} />{label ? ` ${label}` : ''}
    </button>
  );
}
