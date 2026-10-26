import { useState } from 'react';

import { useAuth } from '../lib/auth.jsx';
import { call } from '../lib/firebase.js';
import { AuthHero } from './Login.jsx';

/** Shfaqet kur përdoruesi i identifikuar nuk ka profil aktiv. */
export default function Setup() {
  const { firebaseUser, profile, logout } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const bootstrap = async () => {
    setBusy(true);
    setError('');
    try {
      await call('bootstrap');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <AuthHero />
      <div className="auth-side">
      <div className="auth-card">
        <div className="logo"><span className="logo-plate"><img src="/logo-superpool.jpg" alt="SuperPool" /></span></div>
        <h1>Konfigurimi</h1>
        {profile && profile.active === false ? (
          <div className="alert warn">Llogaria juaj është çaktivizuar. Kontaktoni administratorin.</div>
        ) : (
          <>
            <p>Llogaria <b>{firebaseUser?.email}</b> nuk ka ende një rol në sistem.</p>
            <p className="muted">
              Nëse jeni duke e konfiguruar programin për herë të parë, mund të bëheni administrator.
              Përndryshe kërkojini administratorit t'ju caktojë një rol.
            </p>
            {error && <div className="alert error">{error}</div>}
            <button type="button" className="btn primary" style={{ width: '100%' }} disabled={busy} onClick={bootstrap}>
              Konfigurimi fillestar (administratori i parë)
            </button>
          </>
        )}
        <button type="button" className="btn ghost small" style={{ marginTop: 12 }} onClick={logout}>Dil</button>
      </div>
      </div>
    </div>
  );
}
