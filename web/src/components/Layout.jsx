import { collection, query, where } from 'firebase/firestore';
import {
  ArrowLeftRight, Banknote, BookOpen, Boxes, Building2, ChevronDown, ClipboardCheck, ClipboardList, Factory, FileText, FlaskConical, FlaskRound,
  FileCheck, FilePen, FileSignature, FilePlus, FileX, Handshake, HardHat, History, House, List, LogOut, Menu, Moon, Package, PackageMinus, PackagePlus, Pin, Plug, Receipt,
  Scale, Search, Send, Settings, ShieldCheck, ShoppingCart, Smartphone, Sun, TrendingUp, TriangleAlert, Truck, Undo2, Wallet,
  Warehouse, Waves, Wrench,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

import { CAPS } from '@shared/roles.js';

import { useAuth } from '../lib/auth.jsx';
import { useQuery } from '../lib/data.jsx';
import { db } from '../lib/firebase.js';
import { useTheme } from '../lib/theme.js';
import { OutboxIndicator } from './Outbox.jsx';
import { CommandPalette } from './CommandPalette.jsx';

const C = CAPS;

// Çdo hyrje mund të ketë `to` me ?seksioni=… (p.sh. llojet e lëvizjeve); aktivizimi krahason edhe seksionin.
export const NAV = [
  { title: null, items: [
    { to: '/', label: 'Paneli', icon: House, end: true },
    { to: '/terren', label: 'Terreni (telefon)', icon: Smartphone, caps: [C.FIELD] },
  ] },
  { title: 'Magazina', items: [
    { to: '/artikuj', label: 'Artikujt', icon: Package, caps: [C.INVENTORY_VIEW] },
    { to: '/stoku', label: 'Gjendja e stokut', icon: Boxes, caps: [C.INVENTORY_VIEW] },
    { to: '/inventarizim', label: 'Inventarizimi', icon: ClipboardList, caps: [C.INVENTORY_MANAGE] },
    { to: '/rakordimi', label: 'Rakordimi fiskal', icon: Scale, caps: [C.INVENTORY_MANAGE] },
    { to: '/vendet', label: 'Magazinat', icon: Warehouse, caps: [C.INVENTORY_MANAGE] },
  ] },
  { title: 'Lëvizjet e mallit', items: [
    { to: '/levizjet?seksioni=miratim', label: 'Për miratim', icon: ClipboardCheck, caps: [C.MOVEMENTS_APPROVE], badge: 'pending' },
    { to: '/levizjet?seksioni=hyrjet', label: 'Hyrjet nga blerja', icon: PackagePlus, caps: [C.INVENTORY_VIEW, C.MOVEMENTS_APPROVE] },
    { to: '/levizjet?seksioni=daljet', label: 'Daljet', icon: PackageMinus, caps: [C.INVENTORY_VIEW, C.MOVEMENTS_APPROVE] },
    { to: '/levizjet?seksioni=dorezimet', label: 'Dorëzimet në kantier', icon: Truck, caps: [C.INVENTORY_VIEW, C.MOVEMENTS_APPROVE] },
    { to: '/levizjet?seksioni=perdorimi', label: 'Përdorimi në projekte', icon: Wrench, caps: [C.INVENTORY_VIEW, C.MOVEMENTS_APPROVE] },
    { to: '/levizjet?seksioni=kthimet', label: 'Kthimet', icon: Undo2, caps: [C.INVENTORY_VIEW, C.MOVEMENTS_APPROVE] },
    { to: '/levizjet?seksioni=transferimet', label: 'Transferimet', icon: ArrowLeftRight, caps: [C.INVENTORY_VIEW, C.MOVEMENTS_APPROVE] },
    { to: '/levizjet?seksioni=prodhimi', label: 'Fletët e prodhimit', icon: FlaskRound, caps: [C.INVENTORY_VIEW, C.MOVEMENTS_APPROVE] },
    { to: '/levizjet?seksioni=humbjet', label: 'Dëmtime & rregullime', icon: TriangleAlert, caps: [C.INVENTORY_VIEW, C.MOVEMENTS_APPROVE] },
    { to: '/levizjet', label: 'Të gjitha lëvizjet', icon: List, caps: [C.INVENTORY_VIEW, C.MOVEMENTS_APPROVE] },
  ] },
  { title: 'Flota', items: [
    { to: '/automjetet', label: 'Automjetet', icon: Truck, caps: [C.INVENTORY_VIEW, C.FLEET] },
    { to: '/punonjesit', label: 'Punonjësit', icon: HardHat, caps: [C.FLEET] },
  ] },
  { title: 'Klientët', items: [
    { to: '/klientet', label: 'Klientët', icon: Handshake, caps: [C.CLIENTS_VIEW] },
  ] },
  { title: 'Ofertat', items: [
    { to: '/ofertat/re', label: 'Ofertë e re', icon: FilePlus, caps: [C.OFFERS], end: true },
    { to: '/ofertat?seksioni=draft', label: 'Draft', icon: FilePen, caps: [C.OFFERS], end: true },
    { to: '/ofertat?seksioni=derguara', label: 'Të dërguara', icon: Send, caps: [C.OFFERS], end: true },
    { to: '/ofertat?seksioni=pranuara', label: 'Të pranuara', icon: FileCheck, caps: [C.OFFERS], end: true },
    { to: '/ofertat?seksioni=refuzuara', label: 'Të refuzuara / skaduara', icon: FileX, caps: [C.OFFERS], end: true },
    { to: '/ofertat', label: 'Të gjitha ofertat', icon: FileText, caps: [C.OFFERS], end: true },
    { to: '/modelet', label: 'Modelet e pishinave', icon: Waves, caps: [C.POOL_MODELS] },
  ] },
  { title: 'Kimikatet', items: [
    { to: '/kimikate', label: 'Shitjet e kimikateve', icon: FlaskConical, caps: [C.CHEM_SALES], end: true },
    { to: '/kimikate/nenmagazina', label: 'Nënmagazina e shitësit', icon: Warehouse, caps: [C.CHEM_SALES] },
  ] },
  { title: 'Financa', items: [
    { to: '/kontratat', label: 'Kontratat', icon: FileSignature, caps: [C.FINANCE, C.PROJECTS_MANAGE, C.REPORTS] },
    { to: '/financa/detyrimet', label: 'Detyrimet e klientëve', icon: Wallet, caps: [C.FINANCE, C.REPORTS] },
    { to: '/financa/kartela', label: 'Kartela e klientit', icon: BookOpen, caps: [C.FINANCE, C.REPORTS] },
    { to: '/financa/faturat', label: 'Faturat', icon: Receipt, caps: [C.FINANCE, C.REPORTS] },
    { to: '/financa/pagesat', label: 'Pagesat', icon: Banknote, caps: [C.FINANCE, C.REPORTS] },
  ] },
  { title: 'Furnizimi', items: [
    { to: '/furnitoret', label: 'Furnitorët', icon: Factory, caps: [C.SUPPLIERS] },
    { to: '/porosite', label: 'Porositë', icon: ShoppingCart, caps: [C.SUPPLIERS], end: true },
    { to: '/porosite/nevojat', label: 'Lista e nevojave', icon: Pin, caps: [C.SUPPLIERS] },
  ] },
  { title: 'Projektet', items: [
    { to: '/projektet', label: 'Projektet', icon: Building2, caps: [C.PROJECTS_VIEW, C.FIELD] },
  ] },
  { title: 'Raportet', items: [
    { to: '/raportet/stock', label: 'Gjendja e magazinës', icon: Boxes, caps: [C.REPORTS], end: true },
    { to: '/raportet/movements', label: 'Hyrjet dhe daljet', icon: ArrowLeftRight, caps: [C.REPORTS], end: true },
    { to: '/raportet/vehicles', label: 'Materialet në automjete', icon: Truck, caps: [C.REPORTS], end: true },
    { to: '/raportet/sites', label: 'Materialet në kantiere', icon: Building2, caps: [C.REPORTS], end: true },
    { to: '/raportet/returns', label: 'Kthimet dhe diferencat', icon: Undo2, caps: [C.REPORTS], end: true },
    { to: '/raportet/chem', label: 'Shitjet e kimikateve', icon: FlaskConical, caps: [C.REPORTS], end: true },
    { to: '/raportet/orders', label: 'Porositë e furnitorëve', icon: ShoppingCart, caps: [C.REPORTS], end: true },
    { to: '/raportet/offers', label: 'Ofertat dhe statusi', icon: FileText, caps: [C.REPORTS], end: true },
    { to: '/raportet/projects', label: 'Kostot e projekteve', icon: TrendingUp, caps: [C.VIEW_COSTS], requires: [C.REPORTS], end: true },
    { to: '/raportet/invoices', label: 'Faturat dhe pagesat', icon: Receipt, caps: [C.REPORTS], end: true },
  ] },
  { title: 'Administrimi', items: [
    { to: '/integrimi', label: 'Integrimi / importi', icon: Plug, caps: [C.INTEGRATION] },
    { to: '/perdoruesit', label: 'Përdoruesit', icon: ShieldCheck, caps: [C.USERS] },
    { to: '/cilesimet', label: 'Të dhënat e kompanisë', icon: Settings, caps: [C.USERS] },
    { to: '/gjurmet', label: 'Gjurmët e veprimeve', icon: History, caps: [C.AUDIT] },
  ] },
];

/** `caps`: mjafton njëra nga lejet; `requires`: duhen të gjitha. */
export const navAllowed = (can) => (i) => (!i.caps || can(...i.caps)) && (!i.requires || i.requires.every((c) => can(c)));

const sectionOf = (search) => new URLSearchParams(search).get('seksioni') || '';

/** Hyrja është aktive kur përputhet rruga dhe seksioni (?seksioni=…). */
function isItemActive(item, location) {
  const [path, search = ''] = item.to.split('?');
  const pathOk = item.end || path === '/'
    ? location.pathname === path
    : location.pathname === path || location.pathname.startsWith(`${path}/`);
  return pathOk && sectionOf(search) === sectionOf(location.search);
}

const NAV_STATE_KEY = 'superpool-nav-collapsed';
function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem(NAV_STATE_KEY)) || {}; } catch { return {}; }
}

export const initials = (name = '') => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export function Layout() {
  const { profile, roleLabel, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname, location.search]);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const toggleGroup = (title) => setCollapsed((c) => {
    const next = { ...c, [title]: !c[title] };
    try { localStorage.setItem(NAV_STATE_KEY, JSON.stringify(next)); } catch { /* pa localStorage */ }
    return next;
  });

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
          <img className="brand-logo" src="/logo-superpool.jpg" alt="SuperPool — Pools · Wellness · Aquaparks · Chemicals" />
        </div>
        {NAV.map((group) => {
          const items = group.items.filter(navAllowed(can));
          if (!items.length) return null;
          const hasActive = items.some((i) => isItemActive(i, location));
          const isCollapsed = group.title && collapsed[group.title] && !hasActive;
          return (
            <nav className={`nav-group ${isCollapsed ? 'collapsed' : ''}`} key={group.title || 'main'} aria-label={group.title || 'Kryesore'}>
              {group.title && (
                <button type="button" className="nav-group-title" aria-expanded={!isCollapsed} onClick={() => toggleGroup(group.title)}>
                  {group.title}
                  <ChevronDown size={14} className="chev" />
                </button>
              )}
              {!isCollapsed && items.map((i) => (
                <Link key={i.to} to={i.to} className={isItemActive(i, location) ? 'active' : ''} aria-current={isItemActive(i, location) ? 'page' : undefined}>
                  <i.icon size={18} strokeWidth={1.9} aria-hidden="true" />
                  {i.label}
                  {i.badge && badges[i.badge] > 0 && <span className="badge">{badges[i.badge]}</span>}
                </Link>
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
          <Link to="/" className="logo-plate topbar-logo" aria-label="SuperPool — kreu"><img src="/logo-superpool.jpg" alt="SuperPool" /></Link>
          <button type="button" className="search-trigger" onClick={() => setPalette(true)} aria-label="Kërko">
            <Search size={16} />
            <span className="label">Kërko faqe, artikuj, klientë…</span>
            <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
          <div className="spacer" />
          <OutboxIndicator />
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
          <footer className="app-footer">
            <span className="logo-plate"><img src="/logo-superpool.jpg" alt="SuperPool" /></span>
            <span>© {new Date().getFullYear()} SuperPool · Sistemi i menaxhimit</span>
          </footer>
        </main>
      </div>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </div>
  );
}
