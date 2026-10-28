// "Zona e rrezikut": fshin të dhënat e punës dhe lë konfigurimin (përdoruesit, cilësimet, POS.AL,
// magazinën kryesore dhe vendet virtuale). Vetëm administratori, me konfirmim të shkruar.

import { onCall } from 'firebase-functions/v2/https';

import { LOC, VIRTUAL_LOCATIONS } from '../shared/constants.js';
import { audit, db, fail, REGION, userContext } from '../lib/context.js';
import { ensureBaseData } from './admin.js';

// Grupet që mund të zgjidhen. Koleksionet fshihen bashkë me nënkoleksionet (materiale, detyra, dokumente…).
export const RESET_GROUPS = {
  transactions: {
    label: 'Lëvizjet dhe dokumentet',
    collections: ['movements', 'movementCosts', 'stock', 'sales', 'invoices', 'payments', 'offers', 'projects', 'projectFinance',
      'contracts', 'purchaseOrders', 'inventoryCounts', 'fiscalStock', 'counters', 'supplierInvoices', 'supplierPayments', 'bankTransactions'],
  },
  clients: { label: 'Klientët', collections: ['clients'] },
  products: { label: 'Artikujt dhe kategoritë', collections: ['products', 'productCosts', 'categories', 'supplierPrices'] },
  suppliers: { label: 'Furnitorët', collections: ['suppliers'] },
  poolModels: { label: 'Modelet e pishinave', collections: ['poolModels'] },
  fleet: { label: 'Automjetet, punonjësit dhe nënmagazinat', collections: ['vehicles', 'employees'] },
  audit: { label: 'Gjurmët e veprimeve', collections: ['auditLog'] },
};
const KEEP_LOCATIONS = new Set([LOC.MAIN, ...Object.keys(VIRTUAL_LOCATIONS)]);

async function count(name) {
  return (await db.collection(name).count().get()).data().count;
}

export const resetData = onCall({ region: REGION, timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
  const user = await userContext(request);
  if (user.role !== 'admin') fail('Vetëm administratori mund të fshijë të dhënat.', 'permission-denied');
  const { groups = [], confirm = '' } = request.data || {};
  if (String(confirm).trim().toUpperCase() !== 'FSHI') fail('Shkruani FSHI për të konfirmuar.', 'invalid-argument');
  const chosen = [...new Set(groups)].filter((g) => RESET_GROUPS[g]);
  if (!chosen.length) fail('Zgjidhni çfarë do të fshihet.', 'invalid-argument');

  const deleted = {};
  for (const g of chosen) {
    for (const name of RESET_GROUPS[g].collections) {
      deleted[name] = await count(name);
      await db.recursiveDelete(db.collection(name));
    }
  }

  // Vendet: kantieret ikin me projektet; automjetet/nënmagazinat me flotën; magazina kryesore mbetet gjithmonë.
  const dropKinds = new Set([...(chosen.includes('transactions') ? ['site'] : []), ...(chosen.includes('fleet') ? ['vehicle', 'agent'] : [])]);
  if (dropKinds.size) {
    const locs = await db.collection('locations').get();
    const writer = db.bulkWriter();
    let n = 0;
    locs.forEach((d) => { if (!KEEP_LOCATIONS.has(d.id) && dropKinds.has(d.get('kind'))) { writer.delete(d.ref); n += 1; } });
    await writer.close();
    deleted.locations = n;
  }

  // Pa lëvizje, sasitë e artikujve kthehen në zero (artikujt mbeten nëse nuk u fshinë).
  if (chosen.includes('transactions') && !chosen.includes('products')) {
    const products = await db.collection('products').get();
    const writer = db.bulkWriter();
    products.forEach((d) => writer.update(d.ref, { qtyTotal: 0, qtyMain: 0, qtyReserved: 0 }));
    await writer.close();
  }
  if (chosen.includes('fleet')) {
    // Përdoruesit mbeten, por lidhja me kartelën e punonjësit të fshirë hiqet.
    const users = await db.collection('users').where('employeeId', '!=', null).get();
    const writer = db.bulkWriter();
    users.forEach((d) => writer.update(d.ref, { employeeId: null }));
    await writer.close();
  }
  await ensureBaseData();
  await audit(null, {
    user, action: 'delete', collection: 'system', id: 'reset',
    label: `Fshirje e të dhënave: ${chosen.map((g) => RESET_GROUPS[g].label).join(', ')}`, changes: deleted,
  });
  return { deleted };
});
