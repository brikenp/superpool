import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { Boxes, Building2, FileText, Smartphone } from 'lucide-react';
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
      <AuthHero />
      <div className="auth-side">
        <form className="auth-card" onSubmit={submit}>
          <div className="logo"><img src="/icon.svg" alt="" />SuperPool</div>
          <h1>Mirë se vini</h1>
          <p className="muted" style={{ marginTop: 0, marginBottom: 22 }}>Hyni me llogarinë që ju ka krijuar administratori.</p>
          {error && <div className="alert error">{error}</div>}
          {info && <div className="alert ok">{info}</div>}
          <div className="stack">
            <Field label="Email">
              <input type="email" autoComplete="username" placeholder="emri@superpool.al" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Fjalëkalimi">
              <input type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <button type="submit" className="btn primary big" style={{ width: '100%' }} disabled={busy}>{busy ? 'Duke hyrë…' : 'Hyr'}</button>
            <button type="button" className="btn ghost small" style={{ width: '100%' }} onClick={reset}>Keni harruar fjalëkalimin?</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Paneli i majtë i faqeve të hyrjes. */
export function AuthHero() {
  return (
    <div className="auth-hero">
      <div className="brand"><img src="/icon.svg" alt="" />SuperPool</div>
      <div>
        <h2>Magazina, projektet dhe ofertat në një vend.</h2>
        <p>Ndiqni çdo material nga hyrja në magazinë deri te përdorimi në kantier ose shitja te klienti.</p>
        <ul>
          <li><Boxes size={18} /> Stoku në magazinë, automjete dhe kantiere në kohë reale</li>
          <li><FileText size={18} /> Oferta me llogaritje automatike të materialeve</li>
          <li><Building2 size={18} /> Kostoja e planifikuar kundrejt asaj reale për çdo projekt</li>
          <li><Smartphone size={18} /> Dalje dhe kthime direkt nga telefoni në terren</li>
        </ul>
      </div>
      <svg className="waves" viewBox="0 0 1200 200" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 120 C150 60 300 180 450 120 S750 60 900 120 S1100 180 1200 120 V200 H0Z" fill="#22d3ee" opacity="0.5" />
        <path d="M0 150 C200 100 350 200 550 150 S850 100 1000 150 S1150 190 1200 160 V200 H0Z" fill="#0ea5e9" opacity="0.6" />
      </svg>
    </div>
  );
}
