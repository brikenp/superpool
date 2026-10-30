import { Mail, Phone, Plus, X } from 'lucide-react';

// Kontaktet e një klienti / furnitori: { name, role, phone, email }.
// Kontakti kryesor mbetet te fushat "Personi i kontaktit", "Telefoni", "Email"; këtu shtohen të tjerët.

const empty = () => ({ name: '', role: '', phone: '', email: '' });

/** Kontaktet e plotësuara (rreshtat bosh hiqen). */
export const cleanContacts = (list) => (Array.isArray(list) ? list : [])
  .map((c) => ({ name: String(c.name || '').trim(), role: String(c.role || '').trim(), phone: String(c.phone || '').trim(), email: String(c.email || '').trim() }))
  .filter((c) => c.name || c.phone || c.email);

/** Teksti i kontakteve për kërkim (emra, telefona, email). */
export const contactsText = (list) => (Array.isArray(list) ? list : []).map((c) => [c.name, c.phone, c.email].filter(Boolean).join(' ')).join(' ');

/** Redaktori i kontakteve (përdoret nga EntityForm me type: 'contacts'). */
export function ContactsEditor({ value, onChange }) {
  const list = Array.isArray(value) ? value : [];
  const set = (i, patch) => onChange(list.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  return (
    <div className="contacts-editor">
      {list.map((c, i) => (
        <div key={i} className="contacts-row">
          <input placeholder="Emri e mbiemri" value={c.name} onChange={(e) => set(i, { name: e.target.value })} />
          <input placeholder="Roli (p.sh. Kontabiliste)" value={c.role} onChange={(e) => set(i, { role: e.target.value })} />
          <input type="tel" placeholder="Telefoni" value={c.phone} onChange={(e) => set(i, { phone: e.target.value })} />
          <input type="email" placeholder="Email" value={c.email} onChange={(e) => set(i, { email: e.target.value })} />
          <button type="button" className="icon-btn" title="Hiq kontaktin" onClick={() => onChange(list.filter((_, k) => k !== i))}><X size={16} /></button>
        </div>
      ))}
      <button type="button" className="btn small" onClick={() => onChange([...list, empty()])}><Plus size={14} /> Shto kontakt</button>
    </div>
  );
}

/** Lista e kontakteve me lidhje për telefonim dhe email. */
export function ContactsList({ primary, contacts }) {
  const all = [...(primary && (primary.name || primary.phone || primary.email) ? [{ ...primary, role: primary.role || 'Kontakti kryesor' }] : []), ...cleanContacts(contacts)];
  if (!all.length) return <p className="muted" style={{ margin: 0 }}>Nuk ka kontakte.</p>;
  return (
    <ul className="list-plain contacts-list">
      {all.map((c, i) => (
        <li key={i}>
          <span style={{ flex: 1 }}><b>{c.name || '—'}</b>{c.role && <small className="muted"> · {c.role}</small>}</span>
          {c.phone && <a href={`tel:${c.phone.replace(/\s+/g, '')}`}><Phone size={14} /> {c.phone}</a>}
          {c.email && <a href={`mailto:${c.email}`}><Mail size={14} /> {c.email}</a>}
        </li>
      ))}
    </ul>
  );
}
