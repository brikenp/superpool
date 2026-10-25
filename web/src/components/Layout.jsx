import { collection, query, where } from 'firebase/firestore';
import {
  ArrowLeftRight, Boxes, Building2, ClipboardList, Factory, FileText, FlaskConical, Handshake, HardHat, History,
  House, LogOut, Menu, Moon, Package, Pin, Plug, Receipt, Scale, Search, Settings, ShieldCheck, ShoppingCart, Smartphone,
  Sun, TrendingUp, Truck, Warehouse, Waves,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { CAPS } from '@shared/roles.js';

import { useAuth } from '../lib/auth.jsx';
import { useQuery } from '../lib/data.jsx';
import { db } from '../lib/firebase.js';
import { useTheme } from '../lib/theme.js';
import { CommandPalette } from './CommandPalette.jsx';

const C = CAPS;

export const NAV = [
  { title: null, items: [
    { to: '/', label: 'Paneli', icon: House, end: true },
    { to: '/terren', label: 'Terreni (telefon)', icon: Smartphone, caps: [C.FIELD] },
  ] },
  { title: 'Magazina', items: [
    { to: '/artikuj', label: 'Artikujt', icon: Package, caps: [C.INVENTORY_VIEW] },
    { to: '/stoku', label: 'Gjendja e stokut', icon: Boxes, caps: [C.INVENTORY_VIEW] },
    { to: '/levizjet', label: 'Lëvizjet', icon: ArrowLeftRight, caps: [C.INVENTORY_VIEW, C.MOVEMENTS_APPROVE], badge: 'pending' },
    { to: '/inventarizim', label: 'Inventarizimi', icon: ClipboardList, caps: [C.INVENTORY_MANAGE] },
    { to: '/rakordimi', label: 'Rakordimi fiskal', icon: Scale, caps: [C.INVENTORY_MANAGE] },
    { to: '/vendet', label: 'Magazinat', icon: Warehouse, caps: [C.INVENTORY_MANAGE] },
  ] },
  { title: 'Flota', items: [
    { to: '/automjetet', label: 'Automjetet', icon: Truck, caps: [C.INVENTORY_VIEW, C.FLEET] },
    { to: '/punonjesit', label: 'Punonjësit', icon: HardHat, caps: [C.FLEET] },
  ] },
  { title: 'Tregtia', items: [
    { to: '/klientet', label: 'Klientët', icon: Handshake, caps: [C.CLIENTS_VIEW] },
    { to: '/kimikate', label: 'Shitjet e kimikateve', icon: FlaskConical, caps: [C.CHEM_SALES] },
    { to: '/ofertat', label: 'Ofertat', icon: FileText, caps: [C.OFFERS] },
    { to: '/modelet', label: 'Modelet e pishinave', icon: Waves, caps: [C.POOL_MODELS] },
    { to: '/financa', label: 'Faturat & pagesat', icon: Receipt, caps: [C.FINANCE, C.REPORTS] },
  ] },
  { title: 'Furnizimi', items: [
    { to: '/furnitoret', label: 'Furnitorët', icon: Factory, caps: [C.SUPPLIERS] },
    { to: '/porosite', label: 'Porositë', icon: ShoppingCart, caps: [C.SUPPLIERS] },
    { to: '/porosite/nevojat', label: 'Lista e nevojave', icon: Pin, caps: [C.SUPPLIERS] },
  ] },
  { title: 'Projektet', items: [
    { to: '/projektet', label: 'Projektet', icon: Building2, caps: [C.PROJECTS_VIEW, C.FIELD] },
  ] },
  { title: 'Analiza', items: [
    { to: '/raportet', label: 'Raportet', icon: TrendingUp, caps: [C.REPORTS] },
  ] },
  { title: 'Administrimi', items: [
    { to: '/integrimi', label: 'Integrimi / importi', icon: Plug, caps: [C.INTEGRATION] },
    { to: '/perdoruesit', label: 'Përdoruesit', icon: ShieldCheck, caps: [C.USERS] },
    { to: '/cilesimet', label: 'Të dhënat e kompanisë', icon: Settings, caps: [C.USERS] },
    { to: '/gjurmet', label: 'Gjurmët e veprimeve', icon: History, caps: [C.AUDIT] },
  ] },
];

export const initials = (name = '') => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export function Layout() {
  const { profile, roleLabel, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const canApprove = can(C.MOVEMENTS_APPROVE);
  const pending = useQuery(
    () => (canApprove ? query(collection(db, 'movements'), where('status', '==', 'pending')) : null),
    [canApprove],
  );
  const badges = { pending: pending.data.length };
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <img src="/icon.svg" alt="" />
          <div>
            <div className="name">SuperPool</div>
            <div className="tag">Menaxhimi i biznesit</div>
          </div>
        </div>
        {NAV.map((group) => {
          const items = group.items.filter((i) => !i.caps || can(...i.caps));
          if (!items.length) return null;
          return (
            <nav className="nav-group" key={group.title || 'main'} aria-label={group.title || 'Kryesore'}>
              {group.title && <div className="nav-group-title">{group.title}</div>}
              {items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end || i.to === '/porosite'}>
                  <i.icon size={18} strokeWidth={1.9} aria-hidden="true" />
                  {i.label}
                  {i.badge && badges[i.badge] > 0 && <span className="badge">{badges[i.badge]}</span>}
                </NavLink>
              ))}
            </nav>
          );
        })}
        <div className="sidebar-foot">© {new Date().getFullYear()} SuperPool</div>
      </aside>
      <div className={`backdrop ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button type="button" className="btn small menu-btn" onClick={() => setOpen(true)} aria-label="Hap menynë"><Menu size={18} /></button>
          <button type="button" className="search-trigger" onClick={() => setPalette(true)} aria-label="Kërko">
            <Search size={16} />
            <span className="label">Kërko faqe, artikuj, klientë…</span>
            <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
          <div className="spacer" />
          <button type="button" className="icon-btn neutral" onClick={toggleTheme} aria-label="Ndrysho temën" title={theme === 'dark' ? 'Tema e çelur' : 'Tema e errët'}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">{initials(profile?.name)}</span>
            <div className="who">
              <div className="n">{profile?.name}</div>
              <div className="r">{roleLabel}</div>
            </div>
          </div>
          <button type="button" className="icon-btn neutral" onClick={logout} aria-label="Dil" title="Dil"><LogOut size={18} /></button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </div>
  );
}
