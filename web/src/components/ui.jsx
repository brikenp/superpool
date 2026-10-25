import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, Inbox, Package, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';

export function PageHeader({ title, subtitle, breadcrumb, actions, children }) {
  return (
    <div className="page-header">
      <div className="titles">
        {breadcrumb && <div className="breadcrumb">{breadcrumb}</div>}
        <h1>{title}</h1>
        {subtitle && <div className="muted">{subtitle}</div>}
        {children}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-header">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, required, className = '', children }) {
  return (
    <div className={`field ${required ? 'required' : ''} ${className}`}>
      {label && <label>{label}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Stat({ label, value, sub, tone, to, icon: Icon }) {
  const body = (
    <>
      <div className="top">
        <span className="label">{label}</span>
        {Icon && <span className="ico"><Icon size={18} strokeWidth={2} /></span>}
      </div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </>
  );
  return to
    ? <Link to={to} className={`stat ${tone || ''}`}>{body}</Link>
    : <div className={`stat ${tone || ''}`}>{body}</div>;
}

export function Loading({ text = 'Duke ngarkuar…' }) {
  return <div className="loading"><div className="spinner" />{text}</div>;
}

export function Empty({ children = 'Nuk ka të dhëna.', icon: Icon = Inbox }) {
  return <div className="empty"><span className="empty-ico"><Icon size={22} /></span><div>{children}</div></div>;
}

export function Badge({ tone = '', children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

const STATUS_TONES = {
  confirmed: 'ok', accepted: 'ok', received: 'ok', active: 'info', issued: 'ok', completed: 'ok',
  pending: 'warn', sent: 'info', partial: 'warn', draft: '', planned: '', pending_fiscal: 'warn',
  rejected: 'danger', cancelled: 'danger', expired: 'danger',
};

export function StatusBadge({ status, labels }) {
  return <Badge tone={STATUS_TONES[status] || ''}>{labels?.[status] || status}</Badge>;
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.filter(Boolean).map((t) => (
        <button key={t.key} type="button" className={active === t.key ? 'active' : ''} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-btn neutral" onClick={onClose} aria-label="Mbyll"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Zgjedhje me kërkim (artikuj, klientë, projekte…). options: [{ value, label, sub, search, image }]
 * Lista hapet mbi faqe (portal, position: fixed), që të mos pritet brenda tabelave ose dritareve me scroll.
 */
export function SearchSelect({ options, value, onChange, placeholder = 'Kërko…', disabled, autoFocus, allowEmpty = true }) {
  const selected = options.find((o) => o.value === value);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Mbyll kur klikohet jashtë fushës dhe listës.
  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, []);

  // Pozicioni i listës: poshtë fushës, ose lart nëse nuk ka vend; ndjek scroll-in dhe ndryshimin e madhësisë.
  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(Math.max(r.width, 300), window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 220 && above > below;
      const maxHeight = Math.max(160, Math.min(340, up ? above : below));
      setPos(up ? { left, width, bottom: window.innerHeight - r.top + 4, maxHeight } : { left, width, top: r.bottom + 4, maxHeight });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector('.ss-item.hl')?.scrollIntoView({ block: 'nearest' });
  }, [hl]);

  const filtered = useMemo(() => {
    const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const words = norm(text).split(/\s+/).filter(Boolean);
    const list = words.length
      ? options.filter((o) => {
        const hay = norm(`${o.label} ${o.sub || ''} ${o.search || ''}`);
        return words.every((w) => hay.includes(w));
      })
      : options;
    return list.slice(0, 100);
  }, [options, text]);

  const pick = (o) => {
    onChange(o ? o.value : '');
    setText('');
    setOpen(false);
  };

  const list = open && pos && createPortal(
    <div
      className="ss-list"
      ref={listRef}
      role="listbox"
      style={{ position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
    >
      {allowEmpty && value && <div className="ss-item muted" onMouseDown={(e) => { e.preventDefault(); pick(null); }}>— Pastro zgjedhjen —</div>}
      {filtered.map((o, i) => (
        <div
          key={o.value}
          role="option"
          aria-selected={o.value === value}
          className={`ss-item ${i === hl ? 'hl' : ''} ${o.image !== undefined ? 'with-img' : ''}`}
          onMouseEnter={() => setHl(i)}
          onMouseDown={(e) => { e.preventDefault(); pick(o); }}
        >
          {o.image !== undefined && (o.image
            ? <img className="thumb" src={o.image} alt="" loading="lazy" style={{ width: 40, height: 40 }} />
            : <span className="thumb placeholder" style={{ width: 40, height: 40 }}><Package size={18} /></span>)}
          <span className="ss-text">
            {o.label}
            {o.sub && <small className="muted">{o.sub}</small>}
          </span>
        </div>
      ))}
      {!filtered.length && <div className="ss-item muted">Asnjë rezultat për “{text}”</div>}
      {options.length > 100 && filtered.length === 100 && <div className="ss-item muted">Shkruani më shumë për të ngushtuar kërkimin…</div>}
    </div>,
    document.body,
  );

  return (
    <div className="ss" ref={ref}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        autoFocus={autoFocus}
        value={open ? text : selected?.label || ''}
        placeholder={selected ? selected.label : placeholder}
        onFocus={() => { setOpen(true); setText(''); setHl(0); }}
        onClick={() => setOpen(true)}
        onChange={(e) => { setText(e.target.value); setOpen(true); setHl(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHl((h) => Math.min(h + 1, filtered.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
          if (e.key === 'Enter' && open) { e.preventDefault(); if (filtered[hl]) pick(filtered[hl]); }
          if (e.key === 'Escape' || e.key === 'Tab') setOpen(false);
        }}
      />
      {list}
    </div>
  );
}

// ---------- Njoftime (toast) dhe dritare konfirmimi ----------

const UiContext = createContext(null);

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [prompt, setPrompt] = useState(null);

  const toast = useCallback((message, tone = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 8000 : 3500);
  }, []);

  /** Pyet përdoruesin; kthen tekstin (ose true) ose null nëse anulon. */
  const ask = useCallback((options) => new Promise((resolve) => {
    setPrompt({ ...options, resolve });
  }), []);

  const value = useMemo(() => ({ toast, ask }), [toast, ask]);

  return (
    <UiContext.Provider value={value}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} role="status">
            {t.tone === 'error' ? <CircleAlert size={18} /> : <CircleCheck size={18} />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
      {prompt && <PromptDialog prompt={prompt} onDone={(v) => { prompt.resolve(v); setPrompt(null); }} />}
    </UiContext.Provider>
  );
}

function PromptDialog({ prompt, onDone }) {
  const [text, setText] = useState(prompt.defaultValue || '');
  const needsText = Boolean(prompt.input);
  return (
    <Modal
      title={prompt.title || 'Konfirmim'}
      onClose={() => onDone(null)}
      footer={(
        <>
          <button type="button" className="btn" onClick={() => onDone(null)}>Anulo</button>
          <button
            type="button"
            className={`btn ${prompt.danger ? 'danger solid' : 'primary'}`}
            disabled={needsText && prompt.required !== false && !text.trim()}
            onClick={() => onDone(needsText ? text.trim() : true)}
          >
            {prompt.confirmLabel || 'Vazhdo'}
          </button>
        </>
      )}
    >
      {prompt.message && <p style={{ marginTop: 0, whiteSpace: 'pre-line' }}>{prompt.message}</p>}
      {needsText && (
        <Field label={prompt.input}>
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      )}
    </Modal>
  );
}

export const useUi = () => useContext(UiContext);

/** Ekzekuton një veprim asinkron me gjendje "busy" dhe njoftim gabimi. */
export function useAction() {
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, successMessage) => {
    setBusy(true);
    try {
      const result = await fn();
      if (successMessage) toast(typeof successMessage === 'function' ? successMessage(result) : successMessage);
      return result;
    } catch (err) {
      console.error(err);
      toast(err.message || String(err), 'error');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return [run, busy];
}
