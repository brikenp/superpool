import { CloudOff, CloudUpload, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';

import { flushOutbox, removeFromOutbox, useOutbox } from '../lib/outbox.js';
import { Modal, useAction } from './ui.jsx';

/** Treguesi në shiritin e sipërm: pa internet / dokumente që presin të dërgohen. */
export function OutboxIndicator() {
  const { items, online } = useOutbox();
  const [open, setOpen] = useState(false);
  const [run, busy] = useAction();
  if (online && !items.length) return null;
  const failed = items.filter((i) => i.error).length;
  return (
    <>
      <button type="button" className={`btn small ${failed ? 'danger' : online ? '' : 'warn'}`} onClick={() => setOpen(true)} title="Dokumentet që presin të dërgohen">
        {online ? <CloudUpload size={16} /> : <CloudOff size={16} />}
        <span className="hide-sm">{online ? '' : 'Pa internet'}{items.length ? `${online ? '' : ' · '}${items.length} në pritje` : ''}</span>
        {items.length > 0 && <span className="show-sm">{items.length}</span>}
      </button>
      {open && createPortal(
        <Modal title="Dokumentet në telefon" onClose={() => setOpen(false)}
          footer={(
            <>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Mbyll</button>
              <button type="button" className="btn primary" disabled={busy || !online || !items.length}
                onClick={() => run(() => flushOutbox(), (n) => (n ? `U dërguan ${n} dokumente.` : 'Asnjë dokument nuk u dërgua.'))}>
                Dërgo tani
              </button>
            </>
          )}>
          <p className="muted" style={{ marginTop: 0 }}>
            {online
              ? 'Dokumentet e regjistruara pa internet dërgohen automatikisht. Nëse njëri ka gabim (p.sh. stoku nuk mjafton), korrigjojeni dhe regjistrojeni përsëri, pastaj fshijeni nga lista.'
              : 'Jeni pa internet. Mund të vazhdoni të regjistroni daljet, dorëzimet, përdorimin dhe kthimet — ruhen në telefon dhe dërgohen vetë kur kthehet lidhja.'}
          </p>
          <ul className="list-plain">
            {items.map((i) => (
              <li key={i.id}>
                <span style={{ flex: 1 }}>
                  {i.label || i.name}
                  <br /><small className={i.error ? 'text-danger' : 'muted'}>{i.error || `Regjistruar ${new Date(i.createdAt).toLocaleString('sq-AL')} · ${i.data?.movement?.lines?.length || 0} artikuj`}</small>
                </span>
                <button type="button" className="icon-btn" aria-label="Fshi" title="Fshi nga telefoni" onClick={() => removeFromOutbox(i.id)}><Trash2 size={16} /></button>
              </li>
            ))}
            {!items.length && <li className="muted">Nuk ka dokumente në pritje.</li>}
          </ul>
        </Modal>,
        document.body, // jashtë shiritit të sipërm, që dritarja të mos pritet
      )}
    </>
  );
}
