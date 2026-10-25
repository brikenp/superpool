import { collection, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { CAPS } from '@shared/roles.js';

import { useAuth } from '../lib/auth.jsx';
import { useQuery } from '../lib/data.jsx';
import { db } from '../lib/firebase.js';

const C = CAPS;

export const NAV = [
  { title: null, items: [
    { to: '/', label: 'Paneli', icon: '🏠', end: true },
    { to: '/terren', label: 'Terreni (telefon)', icon: '📱', caps: [C.FIELD] },
  ] },
  { title: 'Magazina', items: [
    { to: '/artikuj', label: 'Artikujt', icon: '📦', caps: [C.INVENTORY_VIEW] },
    { to: '/stoku', label: 'Gjendja e stokut', icon: '📊', caps: [C.INVENTORY_VIEW] },
    { to: '/levizjet', label: 'Lëvizjet', icon: '🔁', caps: [C.INVENTORY_VIEW, C.MOVEMENTS_APPROVE], badge: 'pending' },
    { to: '/inventarizim', label: 'Inventarizimi', icon: '📋', caps: [C.INVENTORY_MANAGE] },
    { to: '/rakordimi', label: 'Rakordimi fiskal', icon: '⚖️', caps: [C.INVENTORY_MANAGE] },
    { to: '/vendet', label: 'Magazinat', icon: '🏬', caps: [C.INVENTORY_MANAGE] },
  ] },
  { title: 'Flota', items: [
    { to: '/automjetet', label: 'Automjetet', icon: '🚚', caps: [C.INVENTORY_VIEW, C.FLEET] },
    { to: '/punonjesit', label: 'Punonjësit', icon: '👷', caps: [C.FLEET] },
  ] },
  { title: 'Tregtia', items: [
    { to: '/klientet', label: 'Klientët', icon: '🤝', caps: [C.CLIENTS_VIEW] },
    { to: '/kimikate', label: 'Shitjet e kimikateve', icon: '🧪', caps: [C.CHEM_SALES] },
    { to: '/ofertat', label: 'Ofertat', icon: '📝', caps: [C.OFFERS] },
    { to: '/modelet', label: 'Modelet e pishinave', icon: '🏊', caps: [C.POOL_MODELS] },
    { to: '/financa', label: 'Faturat & pagesat', icon: '💶', caps: [C.FINANCE, C.REPORTS] },
  ] },
  { title: 'Furnizimi', items: [
    { to: '/furnitoret', label: 'Furnitorët', icon: '🏭', caps: [C.SUPPLIERS] },
    { to: '/porosite', label: 'Porositë', icon: '🛒', caps: [C.SUPPLIERS] },
    { to: '/porosite/nevojat', label: 'Lista e nevojave', icon: '📌', caps: [C.SUPPLIERS] },
  ] },
  { title: 'Projektet', items: [
    { to: '/projektet', label: 'Projektet', icon: '🏗️', caps: [C.PROJECTS_VIEW, C.FIELD] },
  ] },
  { title: 'Analiza', items: [
    { to: '/raportet', label: 'Raportet', icon: '📈', caps: [C.REPORTS] },
  ] },
  { title: 'Administrimi', items: [
    { to: '/integrimi', label: 'Integrimi / importi', icon: '🔌', caps: [C.INTEGRATION] },
    { to: '/perdoruesit', label: 'Përdoruesit', icon: '🔐', caps: [C.USERS] },
    { to: '/cilesimet', label: 'Të dhënat e kompanisë', icon: '⚙️', caps: [C.USERS] },
    { to: '/gjurmet', label: 'Gjurmët e veprimeve', icon: '🕓', caps: [C.AUDIT] },
  ] },
];

export function Layout() {
  const { profile, roleLabel, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  const canApprove = can(C.MOVEMENTS_APPROVE);
  const pending = useQuery(
    () => (canApprove ? query(collection(db, 'movements'), where('status', '==', 'pending')) : null),
    [canApprove],
  );
  const badges = { pending: pending.data.length };

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand"><img src="/icon.svg" alt="" />SuperPool</div>
        {NAV.map((group) => {
          const items = group.items.filter((i) => !i.caps || can(...i.caps));
          if (!items.length) return null;
          return (
            <div className="nav-group" key={group.title || 'main'}>
              {group.title && <div className="nav-group-title">{group.title}</div>}
              {items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end || i.to === '/porosite'}>
                  <span>{i.icon}</span>
                  {i.label}
                  {i.badge && badges[i.badge] > 0 && <span className="badge warn">{badges[i.badge]}</span>}
                </NavLink>
              ))}
            </div>
          );
        })}
      </aside>
      <div className={`backdrop ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button type="button" className="btn small menu-btn" onClick={() => setOpen(true)} aria-label="Menyja">☰</button>
          <div className="spacer" />
          <div className="user">
            <div className="bold">{profile?.name}</div>
            <div className="muted role">{roleLabel}</div>
          </div>
          <button type="button" className="btn small" onClick={logout}>Dil</button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
