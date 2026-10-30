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
