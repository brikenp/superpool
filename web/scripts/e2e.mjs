// Test end-to-end kundrejt emulatorëve të Firebase.
//   firebase emulators:start --only auth,firestore,functions,storage --project demo-superpool
//   node web/scripts/e2e.mjs
// Kalon rrjedhën e plotë: blerje → ofertë → projekt → rezervim → dalje → dorëzim → përdorim → kthim
// → shitje kimikatesh → inventarizim → porosi, dhe kontrollon rregullat e aksesit për çdo rol.

import assert from 'node:assert/strict';

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
  await denied(getDocs(collection(gerti.db, 'sales')), 'Gerti lexon të gjitha shitjet');
  ok('Gerti merr kimikate, shet nga nënmagazina; fatura në pritje të nr. fiskal; s\'sheh kosto as shitje të të tjerëve');

  const imp = await admin.call('importData', { type: 'invoices', rows: [{ number: 'FIS-77/2026', date: '05.10.2026', client: 'Vila Golem', amount: 7500, saleNumber: sale.number }] });
  assert.equal(imp.updated, 1);
  const inv2 = (await getDoc(doc(admin.db, 'invoices', inv.docs[0].id))).data();
  assert.equal(inv2.fiscalNumber, 'FIS-77/2026');
  assert.equal(inv2.date, '2026-10-05');
  ok('importi i faturave lidh numrin fiskal me shitjen');

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
  const short = await denied(admin.call('confirmSale', { sale: { clientId: client.id, locationId: 'main', paymentMethod: 'credit', lines: [{ productId: adt, qty: 100, unitPrice: 900 }] } }), 'prodhim pa materiale');
  assert.match(short.message, /pamjaftueshëm/);
  const adSale = await admin.call('confirmSale', { sale: { clientId: client.id, locationId: 'main', paymentMethod: 'credit', lines: [{ productId: adt, qty: 4, unitPrice: 900 }, { productId: chlor, qty: 1, unitPrice: 2500 }] } });
  assert.match(adSale.productionNumber, /^PRO-/);
  assert.equal(await stockOf(mag.db, 'main', pipe), pipe0 - 8);
  assert.equal(await stockOf(mag.db, 'main', chlor), chlor0 - 2 - 1);
  assert.equal(await stockOf(mag.db, 'main', adt), 0);
  const adSaleDoc = (await getDoc(doc(admin.db, 'sales', adSale.id))).data();
  const prodMov = (await getDoc(doc(admin.db, 'movements', adSaleDoc.productionId))).data();
  assert.equal(prodMov.kind, 'production');
  assert.equal(prodMov.invoiceNumber, adSaleDoc.invoiceNumber);
  assert.equal((await getDoc(doc(admin.db, 'products', chlor))).data().qtyMain, chlor0 - 3);
  await denied(mag.call('cancelMovement', { id: adSaleDoc.productionId, reason: 'x' }), 'anulim i prodhimit veç shitjes');
  await mag.call('cancelSale', { id: adSale.id, reason: 'test' });
  assert.equal(await stockOf(mag.db, 'main', pipe), pipe0);
  assert.equal(await stockOf(mag.db, 'main', chlor), chlor0);
  assert.equal((await getDoc(doc(admin.db, 'movements', adSaleDoc.productionId))).data().status, 'cancelled');
  ok(`artikulli me recetë: shitja krijon ${adSale.productionNumber} që shkarkon materialet; anulimi i kthen`);

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

  for (const s of [admin, mag, gerti, worker, ofer]) await deleteApp(s.app);
  console.log(`\nTë gjitha ${step} kontrollet kaluan.`);
}

main().catch((err) => {
  console.error('\n✘ DËSHTOI:', err);
  process.exit(1);
});
