import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { useState } from 'react';

import { Field } from '../components/ui.jsx';
import { auth } from '../lib/firebase.js';

const MESSAGES = {
  'auth/invalid-credential': 'Email-i ose fjalëkalimi është i gabuar.',
  'auth/user-disabled': 'Llogaria është çaktivizuar.',
  'auth/too-many-requests': 'Shumë përpjekje. Provoni pas pak minutash.',
  'auth/network-request-failed': 'Nuk ka lidhje me internetin.',
};

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setError(MESSAGES[err.code] || err.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!email.trim()) { setError('Shkruani email-in për të rivendosur fjalëkalimin.'); return; }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setInfo('U dërgua email-i për rivendosjen e fjalëkalimit.');
      setError('');
    } catch (err) {
      setError(MESSAGES[err.code] || err.message);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="logo"><img src="/icon.svg" alt="" />SuperPool</div>
        <p className="muted" style={{ marginTop: 0 }}>Programi i menaxhimit: magazina, projekte, oferta dhe shitje.</p>
        {error && <div className="alert error">{error}</div>}
        {info && <div className="alert ok">{info}</div>}
        <div className="stack">
          <Field label="Email">
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Fjalëkalimi">
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <button type="submit" className="btn primary big" style={{ width: '100%' }} disabled={busy}>Hyr</button>
          <button type="button" className="btn ghost small" onClick={reset}>Keni harruar fjalëkalimin?</button>
        </div>
      </form>
    </div>
  );
}
