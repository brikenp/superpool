import { ArrowRight, Handshake, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { CAPS } from '@shared/roles.js';

import { useAuth } from '../lib/auth.jsx';
import { useData } from '../lib/data.jsx';
import { NAV, navAllowed } from './Layout.jsx';
import { ProductThumb } from './ProductImage.jsx';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Kërkimi global (Ctrl+K): faqet, artikujt dhe klientët, me tastierë. */
export function CommandPalette({ onClose }) {
  const { can } = useAuth();
  const { products, clients } = useData();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [hl, setHl] = useState(0);
  const listRef = useRef(null);

  const results = useMemo(() => {
    const words = norm(term).split(/\s+/).filter(Boolean);
    const match = (text) => words.every((w) => norm(text).includes(w));
    const pages = NAV.flatMap((g) => g.items)
      .filter((i) => navAllowed(can)(i) && (!words.length || match(i.label)))
      .map((i) => ({ group: 'Faqet', key: `p${i.to}`, to: i.to, label: i.label, icon: i.icon }));
    if (!words.length) return pages;
    const prods = can(CAPS.INVENTORY_VIEW)
      ? products.filter((p) => match(`${p.code} ${p.name} ${p.brand || ''} ${p.model || ''} ${p.barcode || ''}`)).slice(0, 8)
        .map((p) => ({ group: 'Artikujt', key: `a${p.id}`, to: `/artikuj/${p.id}`, label: `${p.code} · ${p.name}`, sub: [p.brand, p.categoryName].filter(Boolean).join(' · '), product: p }))
      : [];
    const cls = clients.filter((c) => match(`${c.name} ${c.nipt || ''} ${c.phone || ''} ${c.city || ''}`)).slice(0, 6)
      .map((c) => ({ group: 'Klientët', key: `k${c.id}`, to: `/klientet/${c.id}`, label: c.name, sub: [c.nipt, c.phone, c.city].filter(Boolean).join(' · '), icon: Handshake }));
    return [...pages.slice(0, 6), ...prods, ...cls];
  }, [term, products, clients, can]);

  useEffect(() => setHl(0), [term]);
  useEffect(() => {
    listRef.current?.querySelector('.p-item.hl')?.scrollIntoView({ block: 'nearest' });
  }, [hl]);

  const go = (r) => { if (r) { navigate(r.to); onClose(); } };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); go(results[hl]); }
    if (e.key === 'Escape') onClose();
  };

  let lastGroup = null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label="Kërkimi">
        <div className="p-input">
          <Search size={18} />
          <input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={onKey} placeholder="Kërko faqe, artikuj (kod, emër, barkod), klientë…" />
          <kbd>Esc</kbd>
        </div>
        <div className="p-list" ref={listRef}>
          {results.map((r, i) => {
            const header = r.group !== lastGroup ? <div className="p-group" key={`g${r.group}`}>{r.group}</div> : null;
            lastGroup = r.group;
            const Icon = r.icon;
            return [
              header,
              <div key={r.key} className={`p-item ${i === hl ? 'hl' : ''}`} onMouseEnter={() => setHl(i)} onMouseDown={() => go(r)}>
                {r.product ? <ProductThumb product={r.product} size={30} zoom={false} /> : <span className="p-ico">{Icon && <Icon size={16} />}</span>}
                <span>
                  <div>{r.label}</div>
                  {r.sub && <div className="sub">{r.sub}</div>}
                </span>
                <ArrowRight size={16} className="go" />
              </div>,
            ];
          })}
          {!results.length && <div className="empty">Asnjë rezultat për “{term}”.</div>}
        </div>
        <div className="p-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> lëviz</span><span><kbd>Enter</kbd> hap</span><span><kbd>Esc</kbd> mbyll</span></div>
      </div>
    </div>
  );
}
