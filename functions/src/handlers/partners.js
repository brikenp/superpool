// Fshirja e klientëve dhe e furnitorëve: lejohet vetëm kur nuk kanë dokumente të lidhura (fatura, pagesa,
// oferta, porosi, fletëhyrje…), që kartelat dhe raportet të mbeten të sakta.

import { getStorage } from 'firebase-admin/storage';
import { onCall } from 'firebase-functions/v2/https';

import { CAPS } from '../shared/roles.js';
import { REGION, audit, db, fail, requireCap, userContext } from '../lib/context.js';

// Koleksionet që lidhen me klientin (fusha clientId) dhe si quhen te mesazhi.
const LINKED = {
  invoices: 'fatura', payments: 'pagesa', offers: 'oferta', projects: 'projekte', sales: 'shitje', contracts: 'kontrata', movements: 'lëvizje malli',
};

export const deleteClient = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.CLIENTS_MANAGE, CAPS.USERS);
  const id = String(request.data?.id || '');
  const ref = db.doc(`clients/${id}`);
  const snap = await ref.get();
  if (!id || !snap.exists) fail('Klienti nuk ekziston.', 'not-found');

  const linked = [];
  for (const [col, label] of Object.entries(LINKED)) {
    const n = (await db.collection(col).where('clientId', '==', id).count().get()).data().count;
    if (n) linked.push(`${n} ${label}`);
  }
  if (linked.length) {
    fail(`Klienti «${snap.get('name')}» nuk fshihet sepse ka ${linked.join(', ')}. Anulojini ose kalojini te një klient tjetër, pastaj provoni sërish.`, 'failed-precondition');
  }

  await db.recursiveDelete(ref); // bashkë me dokumentet dhe shënimet e klientit
  try {
    await getStorage().bucket().deleteFiles({ prefix: `clients/${id}/` });
  } catch (err) {
    console.warn('Skedarët e klientit nuk u fshinë', id, err.message);
  }
  await audit(null, { user, action: 'delete', collection: 'clients', id, label: snap.get('name') || id, changes: { nipt: snap.get('nipt') || '' } });
  return { ok: true };
});

// Dokumentet që lidhen me furnitorin (fusha supplierId).
const SUPPLIER_LINKED = {
  supplierInvoices: 'fatura blerjeje', supplierPayments: 'pagesa', purchaseOrders: 'porosi', movements: 'fletëhyrje / lëvizje',
};

export const deleteSupplier = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.SUPPLIERS, CAPS.USERS);
  const id = String(request.data?.id || '');
  const ref = db.doc(`suppliers/${id}`);
  const snap = await ref.get();
  if (!id || !snap.exists) fail('Furnitori nuk ekziston.', 'not-found');

  const linked = [];
  for (const [col, label] of Object.entries(SUPPLIER_LINKED)) {
    const n = (await db.collection(col).where('supplierId', '==', id).count().get()).data().count;
    if (n) linked.push(`${n} ${label}`);
  }
  if (linked.length) {
    fail(`Furnitori «${snap.get('name')}» nuk fshihet sepse ka ${linked.join(', ')}. Anulojini ose kalojini te një furnitor tjetër, pastaj provoni sërish.`, 'failed-precondition');
  }

  // Çmimet/ofertat e tij fshihen; artikujt që e kishin furnitor kryesor mbeten pa furnitor.
  const writer = db.bulkWriter();
  const prices = await db.collection('supplierPrices').where('supplierId', '==', id).get();
  prices.forEach((d) => writer.delete(d.ref));
  const products = await db.collection('products').where('supplierId', '==', id).get();
  products.forEach((d) => writer.update(d.ref, { supplierId: null, supplierName: '' }));
  writer.delete(ref);
  await writer.close();
  await audit(null, {
    user, action: 'delete', collection: 'suppliers', id, label: snap.get('name') || id,
    changes: { nipt: snap.get('nipt') || '', prices: prices.size, productsUnlinked: products.size },
  });
  return { ok: true, prices: prices.size, productsUnlinked: products.size };
});

/**
 * Fshirja e një artikulli: vetëm kur nuk ka gjendje dhe nuk është përdorur askund (lëvizje, porosi të hapura,
 * receta, modele pishinash, oferta të hapura). Përndryshe sugjerohet çaktivizimi, që ruan historikun.
 */
export const deleteProduct = onCall({ region: REGION, timeoutSeconds: 120 }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.INVENTORY_MANAGE, CAPS.USERS);
  const id = String(request.data?.id || '');
  const ref = db.doc(`products/${id}`);
  const snap = await ref.get();
  if (!id || !snap.exists) fail('Artikulli nuk ekziston.', 'not-found');
  const p = snap.data();
  const label = `${p.code || ''} ${p.name || ''}`.trim();

  const reasons = [];
  if (Number(p.qtyTotal || 0) !== 0 || Number(p.qtyMain || 0) !== 0) reasons.push(`ka gjendje në stok (${Number(p.qtyTotal || 0)})`);
  if (Number(p.qtyReserved || 0) !== 0) reasons.push('është i rezervuar për projekte');
  const moves = (await db.collection('movements').where('productIds', 'array-contains', id).count().get()).data().count;
  if (moves) reasons.push(`përdoret në ${moves} fletëhyrje/dalje/shitje`);
  const hasLine = (d, key = 'lines') => (d.get(key) || []).some((l) => l.productId === id);
  const orders = (await db.collection('purchaseOrders').get()).docs.filter((d) => d.get('status') !== 'cancelled' && hasLine(d));
  if (orders.length) reasons.push(`është në ${orders.length} porosi furnitori`);
  const recipes = (await db.collection('products').get()).docs.filter((d) => d.id !== id && hasLine(d, 'recipe'));
  if (recipes.length) reasons.push(`është material në recetën e ${recipes.map((d) => d.get('code') || d.get('name')).slice(0, 5).join(', ')}`);
  const models = (await db.collection('poolModels').get()).docs.filter((d) => hasLine(d, 'items'));
  if (models.length) reasons.push(`përdoret te modelet e pishinave: ${models.map((d) => d.get('name')).slice(0, 5).join(', ')}`);
  const offers = (await db.collection('offers').where('status', 'in', ['draft', 'sent']).get()).docs.filter((d) => hasLine(d));
  if (offers.length) reasons.push(`është në ${offers.length} oferta të hapura`);
  if (reasons.length) {
    fail(`Artikulli «${label}» nuk fshihet sepse ${reasons.join('; ')}. Për ta hequr nga listat, çaktivizojeni (Ndrysho → hiqni «Aktiv»).`, 'failed-precondition');
  }

  const writer = db.bulkWriter();
  writer.delete(db.doc(`productCosts/${id}`));
  writer.delete(db.doc(`fiscalStock/${id}`));
  for (const col of ['supplierPrices', 'stock']) {
    (await db.collection(col).where('productId', '==', id).get()).forEach((d) => writer.delete(d.ref));
  }
  writer.delete(ref);
  await writer.close();
  try {
    await getStorage().bucket().deleteFiles({ prefix: `products/${id}/` });
  } catch (err) {
    console.warn('Fotot e artikullit nuk u fshinë', id, err.message);
  }
  await audit(null, { user, action: 'delete', collection: 'products', id, label });
  return { ok: true };
});
