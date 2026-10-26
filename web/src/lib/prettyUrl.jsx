// Lidhje të lexueshme: /projektet/PRJ-2026-0001-vila-brikenit në vend të /projektet/rEtfAUae6kYB5AbI43Wu.
// Lidhjet brenda aplikacionit mund të mbeten me ID; faqja e detajeve e gjen dokumentin dhe e zëvendëson
// adresën me versionin me emër. Adresa me emër funksionon edhe kur hapet direkt ose rifreskohet.

import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { Loading } from '../components/ui.jsx';
import { auth, db } from './firebase.js';
import { useData } from './data.jsx';

export const slugify = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  .slice(0, 60).replace(/-+$/, '');

const isDocId = (s) => /^[A-Za-z0-9]{20}$/.test(s);
const CODE_RE = /^([A-Za-z]{2,4}-\d{4}-\d{3,})/;

// Dokumentet me numër (kodi në fillim të adresës, pastaj emri për lexim).
const NUMBERED = {
  projects: { field: 'code', label: (d) => d.name, scope: (uid) => where('teamUids', 'array-contains', uid) },
  offers: { field: 'number', label: (d) => d.clientName },
  movements: { field: 'number', label: () => '', scope: (uid) => where('participants', 'array-contains', uid) },
  sales: { field: 'number', label: (d) => d.clientName, scope: (uid) => where('sellerUid', '==', uid) },
  contracts: { field: 'number', label: (d) => d.clientName },
  purchaseOrders: { field: 'number', label: (d) => d.supplierName },
  inventoryCounts: { field: 'number', label: (d) => d.locationName },
};

// Të dhënat që aplikacioni i ka gjithmonë në memorie: adresa = emri (me pjesë të ID-së nëse emri përsëritet).
const LISTED = {
  clients: { list: 'clients', label: (d) => d.name },
  suppliers: { list: 'suppliers', label: (d) => d.name },
  products: { list: 'products', label: (d) => `${d.code || ''} ${d.name || ''}` },
  locations: { list: 'locations', label: (d) => d.name },
};

function listedSlug(type, d, list) {
  const base = slugify(LISTED[type].label(d)) || d.id;
  const dup = list.some((x) => x.id !== d.id && slugify(LISTED[type].label(x)) === base);
  return dup ? `${base}-${d.id.slice(0, 5).toLowerCase()}` : base;
}

export function prettySegment(type, d, lists = {}) {
  if (!d) return null;
  if (NUMBERED[type]) {
    const code = d[NUMBERED[type].field];
    if (!code) return d.id;
    const label = slugify(NUMBERED[type].label(d));
    return label ? `${code}-${label}` : code;
  }
  if (LISTED[type]) return listedSlug(type, d, lists[LISTED[type].list] || []);
  return d.id;
}

async function findByCode(type, code) {
  const { field, scope } = NUMBERED[type];
  const run = async (...extra) => {
    const snap = await getDocs(query(collection(db, type), where(field, '==', code), ...extra, limit(1)));
    return snap.docs[0] || null;
  };
  try {
    return await run();
  } catch {
    // Përdoruesit me akses të kufizuar (terreni, Gerti) lexojnë vetëm dokumentet e veta.
    const uid = auth.currentUser?.uid;
    if (!scope || !uid) return null;
    try { return await run(scope(uid)); } catch { return null; }
  }
}

const RouteIdContext = createContext(null);

/** ID-ja e dokumentit të faqes (e gjetur nga adresa me emër ose me ID). */
export function useRouteId() {
  const fromContext = useContext(RouteIdContext);
  const { id } = useParams();
  return fromContext ?? id;
}

/** Mbështjell faqen e detajeve: gjen ID-në nga adresa dhe e kthen adresën në formën me emër. */
export function entityPage(type, Page) {
  function EntityPage() {
    const { id: param } = useParams();
    const lists = useData();
    const location = useLocation();
    const navigate = useNavigate();
    const [resolved, setResolved] = useState(() => ({ param: null, id: null, doc: null }));
    const current = useRef(resolved);
    current.current = resolved;
    const listName = LISTED[type]?.list;
    const listReady = !listName || !lists.listsLoading?.[listName];

    useEffect(() => {
      // Pas kalimit në adresën me emër, dokumenti është tashmë i njohur — mos e kërko sërish.
      if (current.current.param === param && current.current.doc) return undefined;
      let alive = true;
      (async () => {
        let id = param;
        let found = null;
        if (LISTED[type]) {
          const list = lists[listName] || [];
          found = list.find((d) => d.id === param) || list.find((d) => listedSlug(type, d, list) === param) || null;
          if (!found && !listReady) return; // lista ende po ngarkohet
          id = found?.id || param;
        } else if (NUMBERED[type] && !isDocId(param) && CODE_RE.test(param)) {
          const snap = await findByCode(type, param.match(CODE_RE)[1].toUpperCase());
          if (snap) { id = snap.id; found = { id: snap.id, ...snap.data() }; }
        } else if (NUMBERED[type] && isDocId(param)) {
          try {
            const snap = await getDoc(doc(db, type, param));
            if (snap.exists()) found = { id: snap.id, ...snap.data() };
          } catch { /* pa akses — faqja tregon vetë mesazhin */ }
        }
        if (alive) setResolved({ param, id, doc: found });
      })();
      return () => { alive = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [param, listName ? lists[listName] : null, listReady]);

    // Adresa me emër, pa ndryshuar pjesën tjetër (p.sh. /ndrysho) dhe pa shtuar hap në historik.
    useEffect(() => {
      if (resolved.param !== param || !resolved.doc) return;
      const seg = prettySegment(type, resolved.doc, lists);
      if (!seg || seg === param) return;
      const parts = location.pathname.split('/');
      const i = parts.indexOf(param);
      if (i < 0) return;
      parts[i] = seg;
      setResolved({ param: seg, id: resolved.id, doc: resolved.doc });
      navigate(`${parts.join('/')}${location.search}${location.hash}`, { replace: true, state: location.state });
    }, [resolved, param, lists, location, navigate]);

    if (resolved.param !== param) return <Loading />;
    return (
      <RouteIdContext.Provider value={resolved.id}>
        <Page key={resolved.id} />
      </RouteIdContext.Provider>
    );
  }
  EntityPage.displayName = `Entity(${type})`;
  return EntityPage;
}
