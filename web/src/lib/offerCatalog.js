// Katalogu i ofertës: artikujt standardë të pishinës me përshkrim teknik dhe foto.
//  - bazë (basic: true): dalin vetë në çdo ofertë të re
//  - opsionalë: shtohen në ofertë kur klienti i kërkon (shkallë inox, hidromasazh, pompë nxehtësie…)
// Sasia është fikse (defaultQty) ose me formulë sipas përmasave të pishinës (p.sh. ceil(A / 12)).

import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';

import { evaluateFormula } from '@shared/formula.js';

import { db, storage } from './firebase.js';
import { round3, toNumber } from './format.js';
import { resizeImage } from './images.js';
import { newKey, offerVariables } from './offerCalc.js';

export const MAX_CATALOG_PHOTOS = 3;

export const sortCatalog = (items) => [...items].sort((a, b) => (toNumber(a.order) - toNumber(b.order)) || String(a.title).localeCompare(String(b.title), 'sq'));

/** Rreshti i ofertës nga një artikull katalogu (sasia me formulë llogaritet me përmasat e ofertës). */
export function catalogLine(item, offer) {
  let qty = toNumber(item.defaultQty) || 1;
  let autoQty;
  if (item.formula) {
    try { autoQty = round3(evaluateFormula(item.formula, offerVariables(offer))); qty = autoQty; } catch { /* formula e gabuar: sasia fikse */ }
  }
  return {
    key: newKey(), section: item.section || 'other', catalogId: item.id, productId: item.productId || null, code: item.code || '',
    description: item.title || '', details: item.details || '', unit: item.unit || 'cope',
    formula: item.formula || '', ...(autoQty !== undefined ? { autoQty } : {}), qty,
    unitCost: toNumber(item.unitCost), unitPrice: toNumber(item.unitPrice), showOnClient: true,
    images: (item.images || []).slice(0, MAX_CATALOG_PHOTOS),
  };
}

/** Rreshtat bazë për një ofertë të re. */
export const basicLines = (catalog, offer) => sortCatalog(catalog).filter((i) => i.basic && i.active !== false).map((i) => catalogLine(i, offer));

/** Ngarkon një foto (zvogëluar) te katalogu dhe kthen { path, url }. */
export async function uploadCatalogPhoto(itemId, blob, n = Date.now()) {
  const small = await resizeImage(blob, 700, 0.85);
  const path = `catalog/${itemId}/${n}.jpg`;
  await uploadBytes(storageRef(storage, path), small, { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000' });
  return { path, url: await getDownloadURL(storageRef(storage, path)) };
}

export const removeCatalogPhoto = (path) => deleteObject(storageRef(storage, path)).catch(() => {});

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Mbush katalogun nga oferta Excel (fleta e parë): çdo rresht i tabelës bëhet artikull katalogu
 * (bazë nëse ka sasi në Excel, opsional nëse sasia është 0), me përshkrimin dhe fotot e tij.
 * Artikujt ekzistues (me të njëjtin titull) përditësohen; fotot zëvendësohen.
 */
export async function importCatalogFromExcel(parsed, existing, { onProgress = () => {} } = {}) {
  const { offer, photos, loadPhoto } = parsed;
  const byTitle = new Map(existing.map((i) => [norm(i.title), i]));
  const seen = new Set();
  const result = { created: 0, updated: 0, photos: 0 };
  let order = 0;
  const items = offer.items.filter((i) => {
    const k = `${norm(i.title)}|${norm(i.details).slice(0, 60)}`;
    if (!i.title || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  for (const [n, it] of items.entries()) {
    onProgress(`Artikulli ${n + 1} / ${items.length}: ${it.title.slice(0, 40)}`);
    order += 10;
    const data = {
      title: it.title, details: it.details, unit: it.unit, defaultQty: it.qty > 0 ? it.qty : 1, basic: it.qty > 0,
      order, active: true, updatedAt: serverTimestamp(),
    };
    const prev = byTitle.get(norm(it.title));
    let id = prev?.id;
    if (prev) {
      await updateDoc(doc(db, 'offerCatalog', id), data);
      result.updated += 1;
    } else {
      id = (await addDoc(collection(db, 'offerCatalog'), { ...data, formula: '', images: [], createdAt: serverTimestamp() })).id;
      byTitle.set(norm(it.title), { id, ...data });
      result.created += 1;
    }
    const media = photos[it.row] || [];
    if (media.length) {
      const images = [];
      for (const [k, m] of media.slice(0, MAX_CATALOG_PHOTOS).entries()) {
        const blob = await loadPhoto(m);
        if (blob) images.push(await uploadCatalogPhoto(id, blob, `${Date.now()}_${k + 1}`));
      }
      for (const old of prev?.images || []) await removeCatalogPhoto(old.path);
      await updateDoc(doc(db, 'offerCatalog', id), { images });
      result.photos += images.length;
    }
  }
  onProgress('');
  return result;
}
