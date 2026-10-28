// Test end-to-end kundrejt emulatorëve të Firebase.
//   firebase emulators:start --only auth,firestore,functions,storage --project demo-superpool
//   node web/scripts/e2e.mjs
// Kalon rrjedhën e plotë: blerje → ofertë → projekt → rezervim → dalje → dorëzim → përdorim → kthim
// → shitje kimikatesh → inventarizim → porosi, dhe kontrollon rregullat e aksesit për çdo rol.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  addDoc, collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, query, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

const PROJECT = 'demo-superpool';
const HOST = '127.0.0.1';
let appCount = 0;

async function clearEmulators() {
  await fetch(`http://${HOST}:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${HOST}:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

async function session(email, password, { create = false } = {}) {
  const app = initializeApp({ apiKey: 'demo', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com` }, `app${appCount += 1}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${HOST}:9099`, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, HOST, 8080);
  const fns = getFunctions(app, 'europe-west1');
  connectFunctionsEmulator(fns, HOST, 5001);
  const cred = create ? await createUserWithEmailAndPassword(auth, email, password) : await signInWithEmailAndPassword(auth, email, password);
  const call = async (name, data) => (await httpsCallable(fns, name)(data)).data;
  return { app, db, uid: cred.user.uid, call };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeout = 15000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error(`Timeout: ${label}`);
    await sleep(300);
  }
}
async function denied(promise, label) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error(`Pritej refuzim: ${label}`);
}
const stockOf = async (db, loc, pid) => {
  const s = await getDoc(doc(db, 'stock', `${loc}__${pid}`));
  return s.exists() ? s.data().qty : 0;
};

let step = 0;
const ok = (msg) => console.log(`  ✔ ${String(step += 1).padStart(2, '0')} ${msg}`);

async function main() {
  await clearEmulators();
  console.log('SuperPool e2e');

  // --- Konfigurimi fillestar ---
  const admin = await session('admin@superpool.al', 'Fjalekalim123', { create: true });
  const boot = await admin.call('bootstrap');
  assert.equal(boot.admin, true);
  await waitFor(async () => (await getDoc(doc(admin.db, 'users', admin.uid))).exists(), 'admin profile');
  assert.equal((await getDoc(doc(admin.db, 'locations', 'main'))).data().kind, 'main');
  ok('administratori i parë dhe vendet bazë');

  const empWorker = await addDoc(collection(admin.db, 'employees'), { name: 'Arben Puna', position: 'Montues', hourlyCost: 800, active: true });
  const users = {};
  for (const [key, role, extra] of [
    ['mag', 'magazine', {}], ['gerti', 'kimikate', {}], ['worker', 'terren', { employeeId: empWorker.id }], ['ofer', 'oferta', {}],
  ]) {
    const res = await admin.call('createUser', { email: `${key}@superpool.al`, password: 'Fjalekalim123', name: key, role, ...extra });
    users[key] = res.uid;
  }
  const mag = await session('mag@superpool.al', 'Fjalekalim123');
  const gerti = await session('gerti@superpool.al', 'Fjalekalim123');
  const worker = await session('worker@superpool.al', 'Fjalekalim123');
  const ofer = await session('ofer@superpool.al', 'Fjalekalim123');
  assert.equal((await getDoc(doc(admin.db, 'employees', empWorker.id))).data().userId, users.worker);
  ok('përdoruesit me role dhe lidhja punonjës ↔ llogari');

  // --- Të dhënat bazë ---
  const sup = await addDoc(collection(mag.db, 'suppliers'), { name: 'Hidro Furnizim', active: true });
  const catChem = await addDoc(collection(mag.db, 'categories'), { name: 'Kimikate', isChemical: true });
  const catPipe = await addDoc(collection(mag.db, 'categories'), { name: 'Tubacione', isChemical: false });
  const mk = async (code, name, unit, cat, isChemical, salePrice) => (await addDoc(collection(mag.db, 'products'), {
    code, name, unit, categoryId: cat.id, isChemical, supplierId: sup.id, supplierName: 'Hidro Furnizim', salePrice, minStock: 10,
    active: true, qtyTotal: 0, qtyMain: 0, qtyReserved: 0,
  })).id;
  const pipe = await mk('TUB-50', 'Tub PVC 50mm', 'm', catPipe, false, 400);
  const pump = await mk('PMP-1', 'Pompë 1HP', 'cope', catPipe, false, 45000);
  const chlor = await mk('KLR-5', 'Klor granular 5kg', 'pako', catChem, true, 2500);
  await denied(addDoc(collection(mag.db, 'products'), { code: 'X', name: 'X', qtyTotal: 5, qtyMain: 5, qtyReserved: 0 }), 'produkt me stok të shpikur');
  await denied(updateDoc(doc(mag.db, 'products', pipe), { qtyMain: 1000 }), 'ndryshim i sasisë direkt');
  ok('artikujt; sasitë nuk mund të ndryshohen direkt nga klienti');

  const veh = await addDoc(collection(mag.db, 'vehicles'), { plate: 'AA123BB', responsibleId: empWorker.id, active: true });
  const vehLoc = `veh_${veh.id}`;
  await waitFor(async () => (await getDoc(doc(mag.db, 'locations', vehLoc))).exists(), 'vehicle location');
  await setDoc(doc(mag.db, 'locations', 'agent_gerti'), { kind: 'agent', name: 'Nënmagazina e Gertit', agentUid: users.gerti, active: true });
  ok('automjeti krijon nënmagazinën e vet; nënmagazina e Gertit');

  // --- Blerjet dhe kosto mesatare ---
  const purchase = (lines, extra = {}) => mag.call('submitMovement', {
    submit: true,
    movement: { kind: 'purchase', sourceId: 'v_supplier', destId: 'main', supplierId: sup.id, fiscalRef: 'F-1', lines, ...extra },
  });
  const p1 = await purchase([{ productId: pipe, qty: 100, unitCost: 200 }, { productId: pump, qty: 5, unitCost: 30000 }, { productId: chlor, qty: 50, unitCost: 1000 }]);
  assert.equal(p1.status, 'confirmed');
  await purchase([{ productId: pipe, qty: 100, unitCost: 300 }]);
  assert.equal(await stockOf(mag.db, 'main', pipe), 200);
  assert.equal((await getDoc(doc(mag.db, 'productCosts', pipe))).data().avgCost, 250);
  assert.equal((await getDoc(doc(mag.db, 'products', pipe))).data().qtyMain, 200);
  ok('fletëhyrjet: stoku 200 m, kosto mesatare 250 L');

  // --- Oferta → projekt ---
  const model = await addDoc(collection(ofer.db, 'poolModels'), {
    name: 'Skimer standard', poolType: 'skimmer', markupPct: 40, active: true,
    items: [
      { section: 'piping', productId: pipe, formula: 'ceil(P * 2)', showOnClient: true },
      { section: 'filtration', productId: pump, formula: 'if(V > 40, 2, 1)', showOnClient: true },
      { section: 'services', productId: null, description: 'Montim', unit: 'ore', formula: '40', unitCost: 1000, showOnClient: true },
    ],
  });
  assert.ok(model.id);
  const { number: offerNumber } = await ofer.call('allocateNumber', { prefix: 'OF' });
  const client = await addDoc(collection(ofer.db, 'clients'), { name: 'Vila Golem', type: 'individual', nipt: '' });
  const offerLines = [
    { key: 'a', section: 'piping', productId: pipe, code: 'TUB-50', description: 'Tub PVC 50mm', unit: 'm', qty: 48, unitCost: 250, unitPrice: 350, showOnClient: true },
    { key: 'b', section: 'filtration', productId: pump, code: 'PMP-1', description: 'Pompë 1HP', unit: 'cope', qty: 2, unitCost: 30000, unitPrice: 42000, showOnClient: true },
    { key: 'c', section: 'services', productId: null, description: 'Montim', unit: 'ore', qty: 40, unitCost: 1000, unitPrice: 1400, showOnClient: true },
  ];
  const offer = await addDoc(collection(ofer.db, 'offers'), {
    number: offerNumber, status: 'draft', date: '2026-10-01', clientId: client.id, clientName: 'Vila Golem', projectName: 'Pishinë Vila Golem',
    length: 8, width: 4, depthMin: 1.2, depthMax: 1.8, lines: offerLines,
    totals: { subtotal: 156800, discount: 0, net: 156800, vat: 31360, total: 188160, cost: 112000 }, vatPct: 20,
  });
  await denied(getDoc(doc(gerti.db, 'offers', offer.id)), 'Gerti lexon ofertat');
  const { projectId, code } = await ofer.call('acceptOffer', { offerId: offer.id });
  assert.match(code, /^PRJ-/);
  const fin = (await getDoc(doc(admin.db, 'projectFinance', projectId))).data();
  assert.equal(fin.contractValue, 156800);
  assert.equal(fin.plannedMaterialCost, 48 * 250 + 2 * 30000);
  assert.equal(fin.plannedOtherCost, 40000);
  await waitFor(async () => (await getDoc(doc(admin.db, 'locations', `site_${projectId}`))).exists(), 'site location');
  ok(`oferta ${offerNumber} → projekti ${code} me materiale dhe kosto të planifikuar`);

  await updateDoc(doc(admin.db, 'projects', projectId), { teamEmployeeIds: [empWorker.id] });
  await waitFor(async () => ((await getDoc(doc(admin.db, 'projects', projectId))).data().teamUids || []).includes(users.worker), 'team uids');
  const res = await admin.call('reserveProjectMaterials', { projectId });
  assert.equal(res.shortages.length, 0);
  assert.equal((await getDoc(doc(mag.db, 'products', pump))).data().qtyReserved, 2);
  assert.equal((await getDoc(doc(mag.db, 'products', pipe))).data().qtyReserved, 48);
  ok('rezervimi i materialeve dhe ekipi i projektit');

  // --- Punonjësi në terren ---
  await denied(getDoc(doc(worker.db, 'projectFinance', projectId)), 'punonjësi lexon financat');
  await denied(getDoc(doc(worker.db, 'productCosts', pipe)), 'punonjësi lexon kostot');
  await denied(worker.call('submitMovement', { submit: true, movement: { kind: 'purchase', sourceId: 'v_supplier', destId: 'main', supplierId: sup.id, lines: [{ productId: pipe, qty: 1 }] } }), 'punonjësi bën blerje');
  const issue = await worker.call('submitMovement', {
    submit: true,
    movement: { kind: 'issue', sourceId: 'main', destId: vehLoc, projectId, employeeId: empWorker.id, authorizedBy: users.mag, lines: [{ productId: pipe, qty: 50 }, { productId: pump, qty: 2 }] },
  });
  assert.equal(issue.status, 'pending');
  assert.equal(await stockOf(mag.db, 'main', pipe), 200);
  const workerSeesIssue = await getDoc(doc(worker.db, 'movements', issue.id));
  assert.equal(workerSeesIssue.data().status, 'pending');
  await mag.call('approveMovement', { id: issue.id });
  assert.equal(await stockOf(mag.db, 'main', pipe), 150);
  assert.equal(await stockOf(mag.db, vehLoc, pipe), 50);
  assert.equal((await getDoc(doc(mag.db, 'products', pipe))).data().qtyReserved, 0);
  ok('dalja nga telefoni kalon "në pritje" → miratohet → stoku lëviz, rezervimi mbyllet');

  const big = await denied(worker.call('submitMovement', { submit: true, movement: { kind: 'delivery', sourceId: vehLoc, destId: `site_${projectId}`, projectId, lines: [{ productId: pipe, qty: 500 }] } }), 'stok negativ');
  assert.match(big.message, /pamjaftueshëm/);
  ok('stoku negativ refuzohet');

  await worker.call('submitMovement', { submit: true, movement: { kind: 'delivery', sourceId: vehLoc, destId: `site_${projectId}`, lines: [{ productId: pipe, qty: 45 }, { productId: pump, qty: 2 }] } });
  await worker.call('submitMovement', { submit: true, movement: { kind: 'consumption', sourceId: `site_${projectId}`, destId: 'v_consumed', projectId, lines: [{ productId: pipe, qty: 40 }, { productId: pump, qty: 2 }] } });
  const ret = await worker.call('submitMovement', {
    submit: true,
    movement: { kind: 'return', sourceId: vehLoc, destId: 'main', projectId, lines: [{ productId: pipe, qty: 4, condition: 'good' }, { productId: pipe, qty: 1, condition: 'damaged' }] },
  });
  assert.equal(ret.status, 'pending');
  await mag.call('approveMovement', { id: ret.id });
  assert.equal(await stockOf(mag.db, 'main', pipe), 154);
  assert.equal(await stockOf(mag.db, vehLoc, pipe), 0);
  assert.equal(await stockOf(mag.db, `site_${projectId}`, pipe), 5);
  const mat = (await getDoc(doc(mag.db, 'projects', projectId, 'materials', pipe))).data();
  assert.deepEqual([mat.issued, mat.delivered, mat.consumed, mat.returned, mat.loss], [50, 45, 40, 4, 1]);
  const fin2 = (await getDoc(doc(admin.db, 'projectFinance', projectId))).data();
  assert.equal(fin2.realMaterialCost, 41 * 250 + 2 * 30000);
  ok('dorëzim → përdorim → kthim (1 m i dëmtuar s\'hyn në stok); 5 m mbeten në kantier; kosto reale e saktë');

  // --- Kimikatet dhe Gerti ---
  await mag.call('submitMovement', { submit: true, movement: { kind: 'agent_issue', sourceId: 'main', destId: 'agent_gerti', lines: [{ productId: chlor, qty: 20 }] } });
  await denied(getDoc(doc(gerti.db, 'productCosts', chlor)), 'Gerti lexon kostot');
  await denied(gerti.call('confirmSale', { sale: { clientId: client.id, locationId: 'agent_gerti', paymentMethod: 'cash', lines: [{ productId: pump, qty: 1, unitPrice: 45000 }] } }), 'Gerti shet pompë');
  const sale = await gerti.call('confirmSale', { sale: { clientId: client.id, locationId: 'agent_gerti', paymentMethod: 'cash', lines: [{ productId: chlor, qty: 3, unitPrice: 2500 }] } });
  assert.equal(sale.total, 7500);
  assert.equal(await stockOf(mag.db, 'agent_gerti', chlor), 17);
  const mySales = await getDocs(query(collection(gerti.db, 'sales'), where('sellerUid', '==', users.gerti)));
  assert.equal(mySales.size, 1);
  const inv = await getDocs(query(collection(gerti.db, 'invoices'), where('createdBy', '==', users.gerti)));
  assert.equal(inv.docs[0].data().status, 'pending_fiscal');
  const salePay = await getDocs(query(collection(admin.db, 'payments'), where('saleId', '==', sale.id)));
  assert.match(salePay.docs[0].data().number, /^MA-/);
  await denied(getDocs(collection(gerti.db, 'sales')), 'Gerti lexon të gjitha shitjet');
  ok('Gerti merr kimikate, shet nga nënmagazina; fatura në pritje të nr. fiskal; s\'sheh kosto as shitje të të tjerëve');

  const imp = await admin.call('importData', { type: 'invoices', rows: [{ number: 'FIS-77/2026', date: '05.10.2026', client: 'Vila Golem', amount: 7500, saleNumber: sale.number }] });
  assert.equal(imp.updated, 1);
  const inv2 = (await getDoc(doc(admin.db, 'invoices', inv.docs[0].id))).data();
  assert.equal(inv2.fiscalNumber, 'FIS-77/2026');
  assert.equal(inv2.date, '2026-10-05');
  ok('importi i faturave lidh numrin fiskal me shitjen');

  const pimp = await admin.call('importData', { type: 'products', options: { eurRate: 100 }, rows: [
    { code: 'EUR-PMP', name: 'Pompë EUR', purchasePrice: 250, purchaseCurrency: 'EUR', salePrice: 380, saleCurrency: '€' },
    { code: 'MIX-FLT', name: 'Filtër', purchasePrice: 180, purchaseCurrency: 'EUR', salePrice: 32000, saleCurrency: 'ALL' },
    { code: 'BAD-CUR', name: 'Gabim', salePrice: 10, saleCurrency: 'USD' },
  ] });
  assert.equal(pimp.created, 2);
  assert.equal(pimp.errors.length, 1);
  const eurProd = (await getDocs(query(collection(admin.db, 'products'), where('code', '==', 'EUR-PMP')))).docs[0];
  assert.deepEqual([eurProd.data().salePrice, eurProd.data().salePriceCurrency, eurProd.data().salePriceEur], [38000, 'EUR', 380]);
  const eurCost = (await getDoc(doc(admin.db, 'productCosts', eurProd.id))).data();
  assert.deepEqual([eurCost.purchasePrice, eurCost.avgCost, eurCost.purchaseCurrency, eurCost.purchasePriceEur], [25000, 25000, 'EUR', 250]);
  const mixProd = (await getDocs(query(collection(admin.db, 'products'), where('code', '==', 'MIX-FLT')))).docs[0];
  assert.deepEqual([mixProd.data().salePrice, mixProd.data().salePriceCurrency, mixProd.data().salePriceEur], [32000, 'ALL', null]);
  assert.equal((await getDoc(doc(admin.db, 'productCosts', mixProd.id))).data().purchasePrice, 18000);
  ok('importi i artikujve me kosto dhe shitje në lekë ose euro');

  const simp = await admin.call('importData', { type: 'products', options: { eurRate: 100 }, rows: [
    { code: 'STK-1', name: 'Me gjendje', purchasePrice: 10, purchaseCurrency: 'EUR', qty: 7 },
    { code: 'EUR-PMP', name: 'Pompë EUR', qty: 3 },
  ] });
  assert.equal(simp.stock, 2);
  const stkProd = (await getDocs(query(collection(admin.db, 'products'), where('code', '==', 'STK-1')))).docs[0];
  assert.equal(await stockOf(admin.db, 'main', stkProd.id), 7);
  assert.equal(stkProd.data().qtyTotal, 7);
  const again = await admin.call('importData', { type: 'products', rows: [{ code: 'STK-1', name: 'Me gjendje', qty: 7 }] });
  assert.equal(again.stock, undefined);
  assert.match(again.errors[0], /ka tashmë gjendje/);
  assert.equal(await stockOf(admin.db, 'main', stkProd.id), 7);
  const stkMov = (await getDocs(query(collection(admin.db, 'movements'), where('productIds', 'array-contains', stkProd.id)))).docs[0];
  assert.equal((await getDoc(doc(admin.db, 'movementCosts', stkMov.id))).data().total, 82000); // 7 × 1.000 + 3 × 25.000
  ok('importi i artikujve vendos gjendjen fillestare (vetëm një herë), me koston e importuar');

  const cimp = await admin.call('importData', { type: 'clients', rows: [{ name: 'Riviera Sh.p.k.', tradeName: 'Hotel Riviera', nipt: 'L99999999A' }] });
  assert.equal(cimp.created, 1);
  const riv = (await getDocs(query(collection(admin.db, 'clients'), where('nipt', '==', 'L99999999A')))).docs[0].data();
  assert.deepEqual([riv.name, riv.tradeName], ['Riviera Sh.p.k.', 'Hotel Riviera']);
  ok('klientët me emër tregtar (import)');

  // --- Gjendjet fillestare të klientëve dhe likujdimet ---
  const bimp = await admin.call('importData', { type: 'clientBalances', options: { eurRate: 100 }, rows: [
    { client: 'Hotel Riviera', amount: 250000, date: '01.01.2026' },
    { client: 'Klient i Ri', amount: -20000, date: '01.01.2026' },
    { client: 'L99999999A', amount: 1000, currency: 'EUR', date: '01.01.2026' },
  ] });
  assert.equal(bimp.balances, 2);
  assert.equal(bimp.created, 1);
  assert.match(bimp.errors[0], /ka tashmë gjendje fillestare/);
  const rivId = (await getDocs(query(collection(admin.db, 'clients'), where('nipt', '==', 'L99999999A')))).docs[0].id;
  const rivOpen = (await getDocs(query(collection(admin.db, 'invoices'), where('clientId', '==', rivId), where('type', '==', 'opening')))).docs[0].data();
  assert.deepEqual([rivOpen.amount, rivOpen.status, rivOpen.date, rivOpen.kind], [250000, 'issued', '2026-01-01', 'opening']);
  assert.match(rivOpen.internalNumber, /^GJF-/);
  const newId = (await getDocs(query(collection(admin.db, 'clients'), where('name', '==', 'Klient i Ri')))).docs[0].id;
  const credit = (await getDocs(query(collection(admin.db, 'payments'), where('clientId', '==', newId)))).docs[0].data();
  assert.deepEqual([credit.type, credit.method, credit.amount], ['opening', 'opening', 20000]);
  // Likujdim nga aplikacioni (si te kartela) i lidhur me gjendjen fillestare.
  const rivOpenId = (await getDocs(query(collection(admin.db, 'invoices'), where('clientId', '==', rivId), where('type', '==', 'opening')))).docs[0].id;
  await addDoc(collection(admin.db, 'payments'), { clientId: rivId, invoiceId: rivOpenId, amount: 100000, method: 'bank', date: '2026-02-01', status: 'active', source: 'superpool' });
  await admin.call('fiscalizeInvoice', { invoiceId: rivOpenId }).then(() => { throw new Error('duhej refuzuar'); }, (e) => assert.match(e.message, /nuk fiskalizohet|aktivizuar/));
  ok('gjendjet fillestare të klientëve (import debi/kredi, një herë për klient) dhe likujdimet');

  // --- Anulimi i shitjes ---
  await mag.call('cancelSale', { id: sale.id, reason: 'test' }).then(() => { throw new Error('duhej refuzuar'); }, (e) => assert.match(e.message, /fiskalizuar/));
  ok('shitja e fiskalizuar nuk anulohet pa kaluar nga programi i faturimit');

  // --- Inventarizimi ---
  const count = await addDoc(collection(mag.db, 'inventoryCounts'), {
    number: 'NUM-T', locationId: 'main', locationName: 'Magazina kryesore', date: '2026-10-20', status: 'draft',
    lines: [{ productId: pipe, systemQty: 154, countedQty: 150 }, { productId: chlor, systemQty: 30, countedQty: 31 }],
  });
  const cres = await mag.call('confirmInventoryCount', { id: count.id });
  assert.deepEqual([cres.surplus, cres.shortage], [1, 1]);
  assert.equal(await stockOf(mag.db, 'main', pipe), 150);
  assert.equal(await stockOf(mag.db, 'main', chlor), 31);
  ok('inventarizimi krijon rregullimet (mungesë/tepricë)');

  // --- Anulimi i një lëvizjeje ---
  const t = await mag.call('submitMovement', { submit: true, movement: { kind: 'transfer', sourceId: 'main', destId: vehLoc, lines: [{ productId: pipe, qty: 10 }] } });
  await mag.call('cancelMovement', { id: t.id, reason: 'gabim' });
  assert.equal(await stockOf(mag.db, 'main', pipe), 150);
  assert.equal(await stockOf(mag.db, vehLoc, pipe), 0);
  ok('anulimi i një lëvizjeje të konfirmuar kthen stokun');

  // --- Porositë ---
  const { number: poNumber } = await mag.call('allocateNumber', { prefix: 'POR' });
  const po = await addDoc(collection(mag.db, 'purchaseOrders'), {
    number: poNumber, supplierId: sup.id, supplierName: 'Hidro Furnizim', status: 'sent', date: '2026-10-21',
    lines: [{ productId: pump, qty: 4, unitPrice: 29000, receivedQty: 0 }],
  });
  const r1 = await mag.call('receivePurchaseOrder', { poId: po.id, fiscalRef: 'FB-9', lines: [{ productId: pump, qty: 3, unitCost: 29000 }] });
  assert.equal(r1.status, 'partial');
  const r2 = await mag.call('receivePurchaseOrder', { poId: po.id, lines: [{ productId: pump, qty: 1, unitCost: 29000 }] });
  assert.equal(r2.status, 'received');
  assert.equal(await stockOf(mag.db, 'main', pump), 7);
  ok('porosia pranohet pjesërisht dhe plotësisht');

  // --- Artikull i përbërë (receta): shitja shkarkon materialet me fletëdalje prodhimi ---
  const adt = (await addDoc(collection(mag.db, 'products'), {
    code: 'ADT', name: 'Aditivi', unit: 'kg', categoryId: catChem.id, isChemical: true, salePrice: 900, active: true,
    qtyTotal: 0, qtyMain: 0, qtyReserved: 0,
    recipe: [{ productId: chlor, qty: 0.5 }, { productId: pipe, qty: 2 }],
  })).id;
  const [pipe0, chlor0] = [await stockOf(mag.db, 'main', pipe), await stockOf(mag.db, 'main', chlor)];
  // Fleta e prodhimit: 3 kg aditiv në magazinë.
  await denied(gerti.call('confirmProduction', { production: { locationId: 'main', items: [{ productId: adt, qty: 1 }] } }), 'Gerti prodhon');
  await denied(mag.call('confirmProduction', { production: { locationId: 'main', items: [{ productId: pipe, qty: 1 }] } }), 'prodhim i artikullit pa recetë');
  const pr = await mag.call('confirmProduction', { production: { locationId: 'main', items: [{ productId: adt, qty: 3 }] } });
  assert.equal(await stockOf(mag.db, 'main', adt), 3);
  assert.equal(await stockOf(mag.db, 'main', pipe), pipe0 - 6);
  assert.equal(await stockOf(mag.db, 'main', chlor), chlor0 - 1.5);
  const adtCost = (await getDoc(doc(admin.db, 'productCosts', adt))).data().avgCost;
  assert.ok(adtCost > 0);
  ok(`fleta e prodhimit ${pr.number}: materialet dalin, 3 kg aditiv hyjnë në stok (kosto ${adtCost} L/kg)`);

  // Shitja e 4 kg: 3 nga gjendja, 1 prodhohet automatikisht.
  const short = await denied(admin.call('confirmSale', { sale: { clientId: client.id, locationId: 'main', paymentMethod: 'credit', lines: [{ productId: adt, qty: 100, unitPrice: 900 }] } }), 'prodhim pa materiale');
  assert.match(short.message, /pamjaftueshëm/);
  const adSale = await admin.call('confirmSale', { sale: { clientId: client.id, locationId: 'main', paymentMethod: 'credit', lines: [{ productId: adt, qty: 4, unitPrice: 900 }, { productId: chlor, qty: 1, unitPrice: 2500 }] } });
  assert.match(adSale.productionNumber, /^PRO-/);
  assert.equal(await stockOf(mag.db, 'main', adt), 0);
  assert.equal(await stockOf(mag.db, 'main', pipe), pipe0 - 8);
  assert.equal(await stockOf(mag.db, 'main', chlor), chlor0 - 2 - 1);
  const adSaleDoc = (await getDoc(doc(admin.db, 'sales', adSale.id))).data();
  const prodMov = (await getDoc(doc(admin.db, 'movements', adSaleDoc.productionId))).data();
  assert.equal(prodMov.kind, 'production');
  assert.equal(prodMov.produced[0].qty, 1);
  assert.equal(prodMov.invoiceNumber, adSaleDoc.invoiceNumber);
  assert.equal((await getDoc(doc(admin.db, 'products', chlor))).data().qtyMain, chlor0 - 3);
  await denied(mag.call('cancelMovement', { id: adSaleDoc.productionId, reason: 'x' }), 'anulim i prodhimit veç shitjes');
  await mag.call('cancelSale', { id: adSale.id, reason: 'test' });
  assert.equal(await stockOf(mag.db, 'main', adt), 3);
  assert.equal(await stockOf(mag.db, 'main', pipe), pipe0 - 6);
  assert.equal((await getDoc(doc(admin.db, 'movements', adSaleDoc.productionId))).data().status, 'cancelled');
  await mag.call('cancelMovement', { id: pr.id, reason: 'test' });
  assert.equal(await stockOf(mag.db, 'main', adt), 0);
  assert.equal(await stockOf(mag.db, 'main', pipe), pipe0);
  assert.equal(await stockOf(mag.db, 'main', chlor), chlor0);
  ok(`shitja përdor gjendjen e aditivit dhe prodhon vetëm sasinë që mungon (${adSale.productionNumber}); anulimet kthejnë gjithçka`);

  // --- Faturë manuale: paradhënie e projektit ---
  const adv = await addDoc(collection(admin.db, 'invoices'), {
    type: 'advance', kind: 'project', projectId, clientId: client.id, clientName: 'Vila Golem', amount: 50000,
    date: '2026-10-22', dueDate: '2026-10-22', fiscalNumber: '', status: 'pending_fiscal', source: 'superpool', createdBy: admin.uid,
  });
  await addDoc(collection(admin.db, 'payments'), { invoiceId: adv.id, projectId, clientId: client.id, amount: 50000, method: 'bank', date: '2026-10-22', status: 'active', source: 'superpool' });
  await denied(addDoc(collection(mag.db, 'invoices'), { type: 'advance', amount: 1, source: 'superpool' }), 'magazinieri shton faturë');
  const projInv = await getDocs(query(collection(admin.db, 'invoices'), where('projectId', '==', projectId)));
  assert.equal(projInv.docs.find((d) => d.id === adv.id).data().type, 'advance');
  ok('fatura manuale (paradhënie) e lidhur me projektin, me pagesën e saj');

  // --- Puna pa internet: i njëjti dokument i dërguar dy herë nuk dyfishohet ---
  const before = await stockOf(mag.db, vehLoc, pipe);
  const off = { submit: true, requestId: 'offlineTest1234567890', movement: { kind: 'transfer', sourceId: 'main', destId: vehLoc, lines: [{ productId: pipe, qty: 2 }] } };
  const o1 = await mag.call('submitMovement', off);
  const o2 = await mag.call('submitMovement', off);
  assert.equal(o1.id, 'offlineTest1234567890');
  assert.equal(o2.duplicate, true);
  assert.equal(o2.number, o1.number);
  assert.equal(await stockOf(mag.db, vehLoc, pipe), before + 2);
  await denied(worker.call('submitMovement', { ...off, movement: { ...off.movement, kind: 'loss', destId: 'v_loss', notes: 'x' } }), 'requestId i dikujt tjetër');
  await mag.call('cancelMovement', { id: o1.id, reason: 'test' });
  ok('dokumenti i dërguar dy herë nga telefoni (pa internet) regjistrohet vetëm një herë');

  // --- Kontratat ---
  const { number: kon } = await admin.call('allocateNumber', { prefix: 'KON' });
  assert.match(kon, /^KON-/);
  const contract = await addDoc(collection(admin.db, 'contracts'), {
    number: kon, clientId: client.id, clientName: 'Vila Golem', projectId, value: 100000, vatPct: 20, total: 120000, status: 'signed',
    installments: [{ key: 'k1', label: 'Paradhënie', amount: 36000, dueDate: '2026-10-01' }, { key: 'k2', label: 'Fund', amount: 84000, dueDate: '2026-12-01' }],
  });
  await addDoc(collection(admin.db, 'invoices'), {
    type: 'advance', contractId: contract.id, installmentKey: 'k1', projectId, clientId: client.id, clientName: 'Vila Golem', amount: 36000,
    date: '2026-10-01', dueDate: '2026-10-01', fiscalNumber: '', status: 'pending_fiscal', source: 'superpool', createdBy: admin.uid,
  });
  const cInv = await getDocs(query(collection(admin.db, 'invoices'), where('contractId', '==', contract.id)));
  assert.equal(cInv.size, 1);
  await denied(getDoc(doc(gerti.db, 'contracts', contract.id)), 'Gerti lexon kontratat');
  await denied(addDoc(collection(mag.db, 'contracts'), { number: 'X' }), 'magazinieri krijon kontratë');
  await denied(gerti.call('allocateNumber', { prefix: 'KON' }), 'Gerti merr numër kontrate');
  assert.match((await admin.call('allocateNumber', { prefix: 'MA' })).number, /^MA-/);
  ok(`kontrata ${kon} me këste; fatura e këstit lidhet me kontratën; aksesi i kufizuar`);

  // --- Modelet e pishinave ---
  await addDoc(collection(ofer.db, 'poolModels'), { name: 'Import test', poolType: 'skimmer', items: [{ section: 'piping', description: 'Tub', unit: 'm', formula: 'ceil(P)' }] });
  await denied(addDoc(collection(mag.db, 'poolModels'), { name: 'x', items: [] }), 'magazinieri krijon model');
  ok('modelet e pishinave krijohen nga roli i ofertave');

  // --- Fiskalizimi me POS.AL (server i simuluar në vend të pos-al.ew.r.appspot.com) ---
  const posal = { requests: [] };
  const mock = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      posal.requests.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], body });
      res.setHeader('content-type', 'application/json');
      if (posal.reject && req.method === 'POST') {
        res.statusCode = 400;
        res.end(JSON.stringify({ status: 'FAILED', message: 'Error adding order', data: { error: 'customer.id is required' } }));
        return;
      }
      if (req.headers['x-api-key'] !== 'k123') { res.statusCode = 401; res.end(JSON.stringify({ status: 'FAILED', message: 'Unauthorized' })); return; }
      if (req.url.startsWith('/integrations/tax-payer')) {
        res.end(JSON.stringify({ status: 'SUCCESS', data: { Address: 'Tiranë, Rr. Kavajës', Country: 'ALB', Name: 'VILA GOLEM SHPK', Tin: 'L12345678A' } }));
        return;
      }
      if (req.url.startsWith('/integrations/invoice/einvoice/')) {
        res.end(JSON.stringify({ status: 'SUCCESS', data: { invoice: { data: { eInvoices: [{ DocNumber: '9/2026', Status: 'DELIVERED', PDF: Buffer.from('%PDF-1.4 test').toString('base64') }] } } } }));
        return;
      }
      const n = posal.requests.filter((r) => r.method === 'POST').length;
      const o = body.order.options;
      res.end(JSON.stringify({
        order: body.order,
        fisc: {
          iic: `IIC${n}`, fic: `fic-${n}`, eic: o.isEinvoice ? `eic-${n}` : undefined, invNum: `${n}/2026/tc001`,
          url: `https://efiskalizimi-app.tatime.gov.al/invoicecheck/#/verify?iic=IIC${n}`, issueDateTime: '2026-10-26T10:00:00+01:00', tcrCode: 'tc001',
          totPrice: body.order.items.reduce((s, i) => s + i.totalWithTax, 0),
        },
      }));
    });
  });
  await new Promise((r) => mock.listen(5055, '127.0.0.1', r));
  await admin.call('saveFiscalConfig', { enabled: true, env: 'custom', baseUrl: 'http://127.0.0.1:5055', shopId: 'demo', apiKey: 'k123', vatPayer: true, vatPct: 20, bankAccounts: [{ bank: 'BKT', iban: 'AL47 2121', swift: 'NCBAALTX' }] });
  const fc = await admin.call('getFiscalConfig');
  assert.equal(fc.apiKeyMasked, '••••••k123');
  await denied(getDoc(doc(admin.db, 'private', 'posal')), 'shfletuesi lexon çelësin API');
  await denied(gerti.call('saveFiscalConfig', { enabled: false }), 'Gerti ndryshon POS.AL');
  assert.equal((await getDoc(doc(admin.db, 'settings', 'company'))).data().fiscalEnabled, true);

  const tp = await admin.call('lookupTaxpayer', { nipt: 'L12345678A' });
  assert.equal(tp.taxpayers[0].name, 'VILA GOLEM SHPK');

  // Faturë jo-cash (klient pa NIPT): rreshti me TVSH ndahet saktë, kodet ruhen në faturë.
  const fInv = await addDoc(collection(admin.db, 'invoices'), {
    type: 'partial', internalNumber: 'FAT-T1', clientId: client.id, clientName: 'Vila Golem', amount: 12000, date: '2026-10-26', dueDate: '2026-11-05',
    fiscalNumber: '', status: 'pending_fiscal', source: 'superpool', createdBy: admin.uid,
  });
  await denied(admin.call('fiscalizeInvoice', { invoiceId: fInv.id, invoiceType: 'EINVOICE', paymentMethod: 'ACCOUNT' }), 'e-faturë pa NIPT');
  const fr = await admin.call('fiscalizeInvoice', { invoiceId: fInv.id, invoiceType: 'NONCASH', paymentMethod: 'ACCOUNT' });
  const sent = posal.requests.filter((r) => r.method === 'POST').at(-1);
  assert.equal(sent.key, 'k123');
  assert.equal(sent.body.shopId, 'demo');
  assert.equal(sent.body.orderId, 'FAT-T1');
  assert.deepEqual([sent.body.order.items[0].priceWithoutTax, sent.body.order.items[0].totalWithTax, sent.body.order.items[0].taxType], [10000, 12000, '20']);
  assert.equal(sent.body.order.options.bankAccounts[0].iban, 'AL472121');
  const fd = (await getDoc(doc(admin.db, 'invoices', fInv.id))).data();
  assert.deepEqual([fd.status, fd.fiscalNumber, fd.fiscal.iic, fd.fiscalizing], ['issued', fr.fiscalNumber, fr.iic, undefined]);
  await denied(admin.call('fiscalizeInvoice', { invoiceId: fInv.id }), 'fiskalizim i dyfishtë');
  await denied(updateDoc(doc(admin.db, 'invoices', fInv.id), { fiscal: { fic: 'x' } }), 'ndryshim me dorë i kodeve fiskale');

  // Faturë korrigjuese.
  const cr = await admin.call('correctFiscalInvoice', { invoiceId: fInv.id, reason: 'gabim' });
  const corr = posal.requests.filter((r) => r.method === 'POST').at(-1).body;
  assert.equal(corr.order.items[0].quantity, -1);
  assert.equal(corr.order.options.correction.iic, fr.iic);
  const cd = (await getDoc(doc(admin.db, 'invoices', fInv.id))).data();
  assert.deepEqual([cd.status, cd.correction.invNum], ['cancelled', cr.fiscalNumber]);

  // E-faturë për biznes me NIPT dhe PDF-ja nga tatimet.
  await updateDoc(doc(admin.db, 'clients', client.id), { nipt: 'L12345678A', type: 'business' });
  const eInv = await addDoc(collection(admin.db, 'invoices'), {
    type: 'final', internalNumber: 'FAT-T2', clientId: client.id, clientName: 'Vila Golem', amount: 70000, vatPct: 20, date: '2026-10-26', dueDate: '2026-11-10',
    lines: [{ description: 'Pishinë', unit: 'set', qty: 1, unitPrice: 100000 }], net: 100000, vat: 20000, gross: 120000, deductions: [{ label: 'Paradhënie', amount: 50000 }],
    fiscalNumber: '', status: 'pending_fiscal', source: 'superpool', createdBy: admin.uid,
  });
  const er = await admin.call('fiscalizeInvoice', { invoiceId: eInv.id });
  const eSent = posal.requests.filter((r) => r.method === 'POST').at(-1).body.order.options;
  assert.deepEqual([eSent.invoiceType, eSent.isEinvoice, eSent.customer.typeOfId, eSent.eInvoiceOptions.prepaidAmount], ['EINVOICE', true, 'NUIS', 0]);
  assert.equal(posal.requests.filter((r) => r.method === 'POST').at(-1).body.order.items.reduce((s, i) => s + i.totalWithTax, 0), 70000);
  assert.ok(er.eic);
  const ep = await admin.call('fiscalInvoicePdf', { invoiceId: eInv.id });
  assert.equal(Buffer.from(ep.pdf, 'base64').toString().slice(0, 8), '%PDF-1.4');

  // Gerti fiskalizon faturën e shitjes së vet (cash).
  await updateDoc(doc(admin.db, 'clients', client.id), { nipt: '', type: 'individual' });
  const gs = await gerti.call('confirmSale', { sale: { clientId: client.id, locationId: 'agent_gerti', paymentMethod: 'cash', lines: [{ productId: chlor, qty: 1, unitPrice: 2400 }] } });
  const gInv = (await getDoc(doc(gerti.db, 'sales', gs.id))).data().invoiceId;
  const gr = await gerti.call('fiscalizeInvoice', { invoiceId: gInv });
  const gSent = posal.requests.filter((r) => r.method === 'POST').at(-1).body;
  assert.deepEqual([gSent.order.options.invoiceType, gSent.order.options.paymentMethod, gSent.order.items[0].totalWithTax], ['CASH', 'BANKNOTE', 2400]);
  assert.ok(gr.fiscalNumber);
  // Jo-cash pa IBAN: mesazh i qartë para se të dërgohet; refuzim nga POS.AL: detajet ruhen te fatura.
  await admin.call('saveFiscalConfig', { enabled: true, env: 'custom', baseUrl: 'http://127.0.0.1:5055', shopId: 'demo', vatPayer: true, vatPct: 20, bankAccounts: [] });
  const nInv = await addDoc(collection(admin.db, 'invoices'), {
    type: 'other', internalNumber: 'FAT-T3', clientId: client.id, clientName: 'Vila Golem', amount: 1200, date: '2026-10-26', dueDate: '2026-10-26',
    fiscalNumber: '', status: 'pending_fiscal', source: 'superpool', createdBy: admin.uid,
  });
  const noIban = await denied(admin.call('fiscalizeInvoice', { invoiceId: nInv.id, invoiceType: 'NONCASH', paymentMethod: 'ACCOUNT' }), 'jo-cash pa IBAN');
  assert.match(noIban.message, /IBAN/);
  posal.reject = true;
  const rej = await denied(admin.call('fiscalizeInvoice', { invoiceId: nInv.id, invoiceType: 'CASH', paymentMethod: 'BANKNOTE' }), 'POS.AL refuzon');
  assert.match(rej.message, /Error adding order — .*customer/);
  const nd = (await getDoc(doc(admin.db, 'invoices', nInv.id))).data();
  assert.match(nd.fiscalDebug.response, /customer/);
  posal.reject = false;
  const okRetry = await admin.call('fiscalizeInvoice', { invoiceId: nInv.id, invoiceType: 'CASH', paymentMethod: 'BANKNOTE' });
  assert.ok(okRetry.fiscalNumber);
  assert.equal(posal.requests.filter((r) => r.method === 'POST').at(-1).body.orderId, 'FAT-T3-2');
  await new Promise((r) => mock.close(r));
  ok('fiskalizimi me POS.AL: jo-cash, e-faturë me paradhënie, PDF nga tatimet, korrigjim, NIPT; çelësi API mbetet në server');

  // --- Ofertë në euro → projekt me financa në lekë ---
  const { number: eurOffer } = await ofer.call('allocateNumber', { prefix: 'OF' });
  const eo = await addDoc(collection(ofer.db, 'offers'), {
    number: eurOffer, status: 'sent', date: '2026-10-26', clientId: client.id, clientName: 'Vila Golem', projectName: 'Pishinë në euro',
    currency: 'EUR', exchangeRate: 100, vatPct: 20,
    lines: [{ key: 'e1', section: 'piping', productId: pipe, code: 'TUB-50', description: 'Tub', unit: 'm', qty: 10, unitCost: 2.5, unitPrice: 4, showOnClient: true },
      { key: 'e2', section: 'services', productId: null, description: 'Montim', unit: 'ore', qty: 10, unitCost: 10, unitPrice: 96, showOnClient: true }],
    totals: { subtotal: 1000, discount: 0, net: 1000, vat: 200, total: 1200, cost: 125 },
  });
  const ep2 = await ofer.call('acceptOffer', { offerId: eo.id });
  const ef = (await getDoc(doc(admin.db, 'projectFinance', ep2.projectId))).data();
  assert.deepEqual([ef.contractValue, ef.offerValueWithVat, ef.plannedMaterialCost, ef.plannedOtherCost, ef.offerCurrency], [100000, 120000, 2500, 10000, 'EUR']);
  ok('oferta në euro (kurs 100) → projekti me kontratë 100.000 L dhe kosto të planifikuar në lekë');

  // --- Roli i personalizuar (leje të zgjedhura me dorë) ---
  const custom = await admin.call('createUser', {
    email: 'custom@superpool.al', password: 'Fjalekalim123', name: 'custom', role: 'custom', caps: ['inventory_view', 'movements_create', 'nuk_ekziston'],
  });
  const cu = await session('custom@superpool.al', 'Fjalekalim123');
  assert.deepEqual((await getDoc(doc(admin.db, 'users', custom.uid))).data().caps, ['inventory_view', 'movements_create']);
  assert.ok((await getDoc(doc(cu.db, 'products', pipe))).exists());
  await denied(getDoc(doc(cu.db, 'productCosts', pipe)), 'custom lexon kostot');
  await denied(getDocs(collection(cu.db, 'offers')), 'custom lexon ofertat');
  await denied(cu.call('submitMovement', { submit: true, movement: { kind: 'purchase', sourceId: 'v_supplier', destId: 'main', supplierId: sup.id, lines: [{ productId: pipe, qty: 1, unitCost: 1 }] } }), 'custom bën blerje');
  const cl = await cu.call('submitMovement', { submit: true, movement: { kind: 'loss', sourceId: 'main', destId: 'v_loss', notes: 'thyer', lines: [{ productId: pipe, qty: 1 }] } });
  assert.equal(cl.status, 'pending');
  await admin.call('updateUser', { uid: custom.uid, caps: ['inventory_view', 'offers', 'view_costs'] });
  await waitFor(async () => {
    try { await getDocs(collection(cu.db, 'offers')); return true; } catch { return false; }
  }, 'custom lexon ofertat pas ndryshimit');
  assert.ok((await getDoc(doc(cu.db, 'productCosts', pipe))).exists());
  await denied(admin.call('createUser', { email: 'x@superpool.al', password: 'Fjalekalim123', name: 'x', role: 'custom', caps: [] }), 'custom pa leje');
  await deleteApp(cu.app);
  ok('roli i personalizuar: lejet e zgjedhura zbatohen në rregulla dhe funksione; ndryshimi vlen menjëherë');

  // --- Gjurmët ---
  const audit = await getDocs(collection(admin.db, 'auditLog'));
  assert.ok(audit.size > 15);
  await denied(getDocs(collection(mag.db, 'auditLog')), 'magazinieri lexon gjurmët');
  ok(`gjurmët e veprimeve (${audit.size} regjistrime), të dukshme vetëm për administratorin`);

  // --- Zona e rrezikut: fshirja e të dhënave të punës, konfigurimi mbetet ---
  await denied(mag.call('resetData', { groups: ['transactions'], confirm: 'FSHI' }), 'magazinieri fshin të dhënat');
  await denied(admin.call('resetData', { groups: ['transactions'], confirm: 'po' }), 'pa konfirmim');
  const rr = await admin.call('resetData', { groups: ['transactions', 'clients'], confirm: 'fshi' });
  assert.ok(rr.deleted.movements > 0 && rr.deleted.invoices > 0);
  for (const c of ['movements', 'stock', 'invoices', 'payments', 'projects', 'offers', 'sales', 'clients']) {
    assert.equal((await getDocs(collection(admin.db, c))).size, 0, `${c} duhej fshirë`);
  }
  assert.equal((await getDoc(doc(admin.db, 'products', pipe))).data().qtyMain, 0);
  assert.ok((await getDoc(doc(admin.db, 'users', users.mag))).exists());
  assert.ok((await getDoc(doc(admin.db, 'settings', 'company'))).exists());
  assert.ok((await getDoc(doc(admin.db, 'locations', 'main'))).exists());
  assert.ok((await getDoc(doc(admin.db, 'locations', vehLoc))).exists());
  assert.equal((await admin.call('allocateNumber', { prefix: 'OF' })).number.slice(-4), '0001');
  ok('zona e rrezikut: lëvizjet, dokumentet dhe klientët u fshinë; përdoruesit, cilësimet, artikujt dhe magazinat mbetën');

  for (const s of [admin, mag, gerti, worker, ofer]) await deleteApp(s.app);
  console.log(`\nTë gjitha ${step} kontrollet kaluan.`);
}

main().catch((err) => {
  console.error('\n✘ DËSHTOI:', err);
  process.exit(1);
});
