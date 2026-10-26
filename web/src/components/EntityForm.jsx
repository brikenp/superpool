import { addDoc, collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useState } from 'react';

import { db } from '../lib/firebase.js';
import { toNumber } from '../lib/format.js';
import { Field, Modal, SearchSelect, useAction } from './ui.jsx';

/**
 * Formular i thjeshtë për krijim/ndryshim dokumentesh.
 * fields: [{ key, label, type: text|number|textarea|select|search|checkbox|date|email|tel, options, required, span, hint }]
 * transform(values) → të dhënat që ruhen (p.sh. shtim fushash të derivuara)
 */
export function EntityForm({ title, collectionName, record, fields, onClose, onSaved, transform, defaults = {}, wide }) {
  const initial = { ...defaults, ...(record || {}) };
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.key, initial[f.key] ?? (f.type === 'checkbox' ? false : '')])));
  const [error, setError] = useState('');
  const [run, busy] = useAction();
  const set = (k, v) => setValues((s) => ({ ...s, [k]: v }));

  const submit = (e) => {
    e.preventDefault();
    const missing = fields.filter((f) => f.required && (values[f.key] === '' || values[f.key] === null || values[f.key] === undefined));
    if (missing.length) {
      setError(`Plotësoni: ${missing.map((f) => f.label).join(', ')}`);
      return;
    }
    setError('');
    run(async () => {
      let data = { ...values };
      fields.forEach((f) => { if (f.type === 'number') data[f.key] = toNumber(data[f.key]); });
      if (transform) data = await transform(data, record);
      data.updatedAt = serverTimestamp();
      let id = record?.id;
      if (id) {
        await setDoc(doc(db, collectionName, id), data, { merge: true });
      } else {
        data.createdAt = serverTimestamp();
        id = (await addDoc(collection(db, collectionName), data)).id;
      }
      onSaved?.({ id, ...data });
      onClose();
    }, 'U ruajt.');
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide={wide}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Anulo</button>
          <button type="submit" form="entity-form" className="btn primary" disabled={busy}>Ruaj</button>
        </>
      )}
    >
      {error && <div className="alert error">{error}</div>}
      <form id="entity-form" onSubmit={submit} className="form-grid">
        {fields.map((f) => (
          <Field key={f.key} label={f.type === 'checkbox' ? null : f.label} required={f.required} hint={f.hint}
            className={f.span === 'all' ? 'span-all' : f.span === 2 ? 'span-2' : ''}>
            <Input f={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />
            {/* Shtesë e fushës (p.sh. kërkimi i NIPT-it në tatime) që mund të plotësojë fusha të tjera. */}
            {f.extra && <f.extra values={values} record={record} patch={(obj) => setValues((s) => ({ ...s, ...obj }))} />}
          </Field>
        ))}
      </form>
    </Modal>
  );
}

function Input({ f, value, onChange }) {
  switch (f.type) {
    case 'textarea':
      return <textarea value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {!f.required && <option value="">—</option>}
          {f.required && !value && <option value="">Zgjidh…</option>}
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'search':
      return <SearchSelect options={f.options} value={value} onChange={onChange} />;
    case 'checkbox':
      return (
        <label className="checkbox">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          {f.label}
        </label>
      );
    case 'number':
      return <input className="num" type="number" step="any" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input type={f.type || 'text'} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
}

export const optionsFrom = (obj) => Object.entries(obj).map(([value, label]) => ({ value, label }));
