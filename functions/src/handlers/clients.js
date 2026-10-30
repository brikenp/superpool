// Fshirja e një klienti: lejohet vetëm kur nuk ka dokumente të lidhura (fatura, pagesa, oferta, projekte…),
// që kartelat dhe raportet të mbeten të sakta. Fshihen edhe dokumentet/shënimet e klientit dhe skedarët e tij.

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
