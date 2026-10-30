import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateFormula, formulaError, poolVariables } from '../src/shared/formula.js';
import { hasCap } from '../src/shared/roles.js';
import {
  explodeRecipes, isComposite, openReserved, productionLines, planMovement, projectMaterialSummary, projectResult, stockKey, validateMovement,
} from '../src/shared/stock.js';

const locations = {
  main: { kind: 'main', name: 'Magazina kryesore' },
  veh1: { kind: 'vehicle', name: 'AA123BB' },
  site1: { kind: 'site', name: 'Kantier 1' },
  v_supplier: { kind: 'supplier', name: 'Furnitorë' },
  v_consumed: { kind: 'consumed', name: 'Përdorur' },
  v_loss: { kind: 'loss', name: 'Humbje' },
  v_customer: { kind: 'customer', name: 'Klientë' },
};

test('formula: variablat e pishinës', () => {
  const v = poolVariables({ length: 8, width: 4, depthMin: 1, depthMax: 2 });
  assert.equal(v.A, 32);
  assert.equal(v.P, 24);
  assert.equal(v.H, 1.5);
  assert.equal(v.V, 48);
  assert.equal(v.S, 32 + 24 * 1.5);
});

test('formula: aritmetikë, funksione dhe kushte', () => {
  const v = poolVariables({ length: 8, width: 4, depthMin: 1, depthMax: 2 });
  assert.equal(evaluateFormula('A * 1.1', v), 35.2);
  assert.equal(evaluateFormula('ceil(P / 6)', v), 4);
  assert.equal(evaluateFormula('max(2, ceil(V / 40))', v), 2);
  assert.equal(evaluateFormula('if(L > 6, 2, 1)', v), 2);
  assert.equal(evaluateFormula('if(L > 6 && W > 5, 2, 1)', v), 1);
  assert.equal(evaluateFormula('-2 + 3 * (1 + 1) ^ 2', v), 10);
  assert.equal(evaluateFormula('round(V / 7, 2)', v), 6.86);
  assert.equal(evaluateFormula('', v), 0);
});

test('formula: refuzon kodin e palejuar', () => {
  assert.match(formulaError('process.exit(1)'), /palejuar|panjohur/);
  assert.match(formulaError('foo(1)'), /Funksion i panjohur/);
  assert.match(formulaError('X + 1'), /Variabël e panjohur/);
  assert.match(formulaError('1 / 0'), /zero/);
  assert.match(formulaError('2 ^ 50'), /shumë e madhe/);
  assert.equal(formulaError('ceil(A/2)'), null);
});

test('rolet: Gerti nuk sheh kostot, magazinieri po', () => {
  assert.equal(hasCap('kimikate', 'view_costs'), false);
  assert.equal(hasCap('kimikate', 'chem_sales'), true);
  assert.equal(hasCap('magazine', 'view_costs'), true);
  assert.equal(hasCap('terren', 'movements_approve'), false);
  assert.equal(hasCap('admin', 'users'), true);
  assert.equal(hasCap(undefined, 'field'), false);
});

test('validim: dalja kërkon punonjës dhe autorizues', () => {
  const errors = validateMovement({ kind: 'issue', sourceId: 'main', destId: 'veh1', lines: [{ productId: 'p1', qty: 2 }] }, locations);
  assert.equal(errors.length, 2);
  const wrongDest = validateMovement({ kind: 'issue', sourceId: 'main', destId: 'v_customer', employeeId: 'e', authorizedBy: 'u', lines: [{ productId: 'p1', qty: 1 }] }, locations);
  assert.equal(wrongDest.length, 1);
  const noQty = validateMovement({ kind: 'delivery', sourceId: 'veh1', destId: 'site1', projectId: 'x', lines: [{ productId: 'p1', qty: 0 }] }, locations);
  assert.equal(noQty.length, 1);
});

test('blerja rrit stokun dhe llogarit koston mesatare', () => {
  const plan = planMovement(
    { kind: 'purchase', sourceId: 'v_supplier', destId: 'main', lines: [{ productId: 'p1', qty: 10, unitCost: 200 }] },
    { locations, stock: { [stockKey('main', 'p1')]: 10 }, products: { p1: { name: 'Pompë', avgCost: 100, qtyTotal: 10 } } },
  );
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.stockDeltas[stockKey('main', 'p1')], 10);
  assert.equal(plan.stockDeltas[stockKey('v_supplier', 'p1')], undefined);
  assert.equal(plan.avgCosts.p1, 150);
  assert.deepEqual(plan.productDeltas.p1, { qtyTotal: 10, qtyMain: 10 });
});

test('anulimi i blerjes rikthen koston mesatare', () => {
  const plan = planMovement(
    { kind: 'purchase', sourceId: 'v_supplier', destId: 'main', lines: [{ productId: 'p1', qty: 10, unitCost: 200 }] },
    { locations, stock: { [stockKey('main', 'p1')]: 20 }, products: { p1: { avgCost: 150, qtyTotal: 20 } } },
    -1,
  );
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.avgCosts.p1, 100);
  assert.equal(plan.stockDeltas[stockKey('main', 'p1')], -10);
});

test('dalja nuk lejon stok negativ', () => {
  const plan = planMovement(
    { kind: 'issue', sourceId: 'main', destId: 'veh1', projectId: 'pr1', lines: [{ productId: 'p1', qty: 5 }] },
    { locations, stock: { [stockKey('main', 'p1')]: 3 }, products: { p1: { name: 'Pompë', avgCost: 100 } } },
  );
  assert.equal(plan.errors.length, 1);
  assert.match(plan.errors[0], /pamjaftueshëm/);
});

test('dalja për projekt: lëvizja e stokut, kosto dhe gjurma e projektit', () => {
  const plan = planMovement(
    { kind: 'issue', sourceId: 'main', destId: 'veh1', projectId: 'pr1', lines: [{ productId: 'p1', qty: 2 }] },
    { locations, stock: { [stockKey('main', 'p1')]: 3 }, products: { p1: { avgCost: 100 } } },
  );
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.stockDeltas[stockKey('main', 'p1')], -2);
  assert.equal(plan.stockDeltas[stockKey('veh1', 'p1')], 2);
  assert.deepEqual(plan.productDeltas.p1, { qtyTotal: 0, qtyMain: -2 });
  assert.deepEqual(plan.projectDeltas.p1, { issued: 2 });
  assert.deepEqual(plan.lineCosts, [100]);
});

test('kthimi: malli i dëmtuar shkon te humbjet, jo në magazinë', () => {
  const plan = planMovement(
    {
      kind: 'return', sourceId: 'veh1', destId: 'main', projectId: 'pr1',
      lines: [{ productId: 'p1', qty: 3, condition: 'good' }, { productId: 'p1', qty: 1, condition: 'damaged' }],
    },
    { locations, stock: { [stockKey('veh1', 'p1')]: 4 }, products: { p1: { avgCost: 50 } } },
  );
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.stockDeltas[stockKey('veh1', 'p1')], -4);
  assert.equal(plan.stockDeltas[stockKey('main', 'p1')], 3);
  assert.deepEqual(plan.projectDeltas.p1, { returned: 3, loss: 1 });
  assert.deepEqual(plan.productDeltas.p1, { qtyTotal: -1, qtyMain: 3 });
});

test('rezervimet dhe pasqyra e materialeve të projektit', () => {
  assert.equal(openReserved(10, 4), 6);
  assert.equal(openReserved(3, 5), 0);
  const s = projectMaterialSummary({ plannedQty: 10, issued: 12, consumed: 9, returned: 1, loss: 1 }, 0.5);
  assert.equal(s.inVehicles, 0.5);
  assert.equal(s.onSite, 0.5);
  assert.equal(s.variance, 0);
  assert.equal(s.needsAttention, true);
});

test('rezultati financiar i projektit', () => {
  const r = projectResult({ contractValue: 1000, plannedMaterialCost: 500, plannedOtherCost: 100, realMaterialCost: 550, expenses: 150, invoiced: 800, paid: 500 });
  assert.equal(r.plannedCost, 600);
  assert.equal(r.realCost, 700);
  assert.equal(r.costVariance, 100);
  assert.equal(r.realMargin, 300);
  assert.equal(r.realMarginPct, 30);
  assert.equal(r.outstanding, 300);
  assert.equal(r.notInvoiced, 200);
});

test('firestore.rules është në sinkron me rolet', async () => {
  const { readFileSync } = await import('node:fs');
  const { syncedRules } = await import('../scripts/sync-rules.js');
  const text = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  assert.equal(syncedRules(text), text);
});

test('receta: materialet e artikullit të përbërë dalin nga magazina, artikulli vetë jo', () => {
  const products = {
    adit: { name: 'Aditivi', recipe: [{ productId: 'm1', qty: 0.5 }, { productId: 'm2', qty: 2 }, { productId: '', qty: 1 }] },
    m1: { name: 'Material 1', avgCost: 4 },
    m2: { name: 'Material 2', avgCost: 1 },
  };
  assert.ok(isComposite(products.adit));
  assert.ok(!isComposite(products.m1));
  const comps = explodeRecipes([{ productId: 'adit', qty: 10 }, { productId: 'adit', qty: 1 }], products);
  assert.deepEqual(comps, [{ productId: 'm1', qty: 5.5 }, { productId: 'm2', qty: 22 }]);

  const locs = { ...locations, v_production: { kind: 'production', name: 'Prodhim' } };
  const prod = planMovement({ kind: 'production', sourceId: 'main', destId: 'v_production', lines: comps },
    { locations: locs, stock: { [stockKey('main', 'm1')]: 6, [stockKey('main', 'm2')]: 20 }, products }, 1);
  assert.deepEqual(prod.errors.length, 1); // m2: 20 < 22
  assert.equal(prod.stockDeltas[stockKey('main', 'm1')], -5.5);

  // Fleta e prodhimit: materialet dalin, artikulli i prodhuar hyn në stok me koston e materialeve.
  const lines = productionLines([{ productId: 'adit', qty: 4 }], products, 'main');
  const pl = planMovement({ kind: 'production', sourceId: 'main', destId: 'v_production', lines },
    { locations: locs, stock: { [stockKey('main', 'm1')]: 6, [stockKey('main', 'm2')]: 20 }, products: { ...products, adit: { ...products.adit, qtyTotal: 2, avgCost: 5 } } }, 1);
  assert.equal(pl.errors.length, 0);
  assert.equal(pl.stockDeltas[stockKey('main', 'adit')], 4);
  assert.equal(pl.stockDeltas[stockKey('main', 'm2')], -8);
  assert.equal(lines.at(-1).unitCost, 0.5 * 4 + 2 * 1);
  assert.equal(pl.avgCosts.adit, round2((2 * 5 + 4 * 4) / 6));
});
const round2 = (n) => Math.round(n * 100) / 100;

test('fiskalizimi: kërkesa për POS.AL nga shitja, fatura përfundimtare dhe korrigjimi', async () => {
  const { buildFiscalRequest, buildCorrectionRequest, defaultFiscalOptions } = await import('../src/shared/fiscal.js');
  const config = { shopId: 'demo', vatPayer: true, vatPct: 20, bankAccounts: [{ bank: 'BKT', iban: 'AL1', swift: 'NCBA', description: 'BKT', principal: true }] };
  assert.deepEqual(defaultFiscalOptions({ client: { nipt: 'L12345678A' } }), { invoiceType: 'EINVOICE', paymentMethod: 'ACCOUNT' });
  assert.deepEqual(defaultFiscalOptions({ client: {}, sale: { paymentMethod: 'cash' } }), { invoiceType: 'CASH', paymentMethod: 'BANKNOTE' });

  // Shitje me çmim me TVSH: 3 × 120 L me TVSH → 100 L pa TVSH.
  const sale = { lines: [{ name: 'Klor', code: 'KLR', unit: 'pako', qty: 3, unitPrice: 120 }] };
  const b = buildFiscalRequest({ config, invoice: { internalNumber: 'FAT-1', clientName: 'X' }, sale, client: { name: 'Ana' }, options: { invoiceType: 'CASH', paymentMethod: 'BANKNOTE' } });
  assert.equal(b.shopId, 'demo');
  assert.equal(b.orderId, 'FAT-1');
  const it = b.order.items[0];
  assert.deepEqual([it.quantity, it.priceWithoutTax, it.taxRate, it.taxType, it.totalWithTax, it.unit], [3, 100, 20, '20', 360, 'XPK']);
  assert.equal(b.order.options.isEinvoice, false);
  assert.equal(b.order.options.bankAccounts, undefined);

  // Fatura përfundimtare si e-faturë: rreshtat pa TVSH, paradhëniet si prepaidAmount.
  const final = {
    internalNumber: 'FAT-9', type: 'final', vatPct: 20, dueDate: '2026-11-10', amount: 70000,
    lines: [{ description: 'Pishinë', unit: 'set', qty: 1, unitPrice: 100000 }], deductions: [{ label: 'Paradhënie', amount: 50000 }],
  };
  const e = buildFiscalRequest({ config, invoice: final, client: { name: 'Biz', nipt: 'L12345678A', address: 'Rr. 1', city: 'Tiranë' }, options: { invoiceType: 'EINVOICE', paymentMethod: 'ACCOUNT' } });
  assert.equal(e.order.items[0].totalWithTax, 120000);
  // Parapagimi si rresht −1: totali i faturës = 120.000 − 50.000.
  assert.deepEqual([e.order.items[1].quantity, e.order.items[1].totalWithTax, e.order.items[1].name], [-1, -50000, 'Parapagim — Paradhënie']);
  assert.equal(e.order.items.reduce((s, x) => s + x.totalWithTax, 0), 70000);
  assert.equal(e.order.options.eInvoiceOptions.prepaidAmount, 0);
  assert.equal(e.order.options.customer.typeOfId, 'NUIS');
  assert.equal(e.order.options.bankAccounts.length, 1);
  // E njëjta si jo-cash: paradhënia zbritet me rresht negativ.
  const n = buildFiscalRequest({ config, invoice: final, client: { name: 'Biz' }, options: { invoiceType: 'NONCASH', paymentMethod: 'ACCOUNT' } });
  assert.equal(n.order.items.reduce((s, x) => s + x.totalWithTax, 0), 70000);

  const corr = buildCorrectionRequest({ config, invoice: { internalNumber: 'FAT-1', fiscal: { iic: 'ABC', issueDateTime: 'T' } }, original: b });
  assert.equal(corr.order.items[0].quantity, -3);
  assert.equal(corr.order.items[0].totalWithTax, -360);
  assert.deepEqual(corr.order.options.correction, { iic: 'ABC', issueDateTime: 'T' });
});

test('fiskalizimi: faturë në euro dërgon monedhën dhe kursin', async () => {
  const { buildFiscalRequest, buildCorrectionRequest } = await import('../src/shared/fiscal.js');
  const config = { shopId: 'demo', vatPayer: true, vatPct: 20, bankAccounts: [{ iban: 'AL1' }] };
  const invoice = { internalNumber: 'FAT-E', amount: 1200, currency: 'EUR', exchangeRate: 98.5 };
  const b = buildFiscalRequest({ config, invoice, client: { name: 'Ana' }, options: { invoiceType: 'NONCASH', paymentMethod: 'ACCOUNT' } });
  assert.deepEqual([b.order.currency, b.order.exchangeRate, b.order.items[0].priceWithoutTax, b.order.items[0].totalWithTax], ['EUR', 98.5, 1000, 1200]);
  const c = buildCorrectionRequest({ config, invoice: { ...invoice, fiscal: { iic: 'X', issueDateTime: 'T' } }, original: b });
  assert.deepEqual([c.order.currency, c.order.exchangeRate], ['EUR', 98.5]);
});

test('fiskalizimi: rreshtat e faturës manuale (çmim me TVSH, TVSH për rresht, emri i artikullit)', async () => {
  const { buildFiscalRequest } = await import('../src/shared/fiscal.js');
  const invoice = {
    internalNumber: 'FAT-L', amount: 1300,
    lines: [
      { description: 'Pompë 1HP', code: 'PMP-1', unit: 'cope', qty: 1, unitPriceGross: 1200, unitPrice: 1000, vatPct: 20 },
      { description: 'Transport', unit: 'set', qty: 1, unitPriceGross: 100, unitPrice: 100, vatPct: 0 },
    ],
  };
  const b = buildFiscalRequest({ config: { shopId: 's', vatPayer: true }, invoice, client: { name: 'A' }, options: { invoiceType: 'CASH', paymentMethod: 'BANKNOTE' } });
  const [a, t] = b.order.items;
  assert.deepEqual([a.name, a.code, a.priceWithoutTax, a.totalWithTax, a.taxType], ['Pompë 1HP', 'PMP-1', 1000, 1200, '20']);
  assert.deepEqual([t.name, t.taxRate, t.totalWithTax, t.taxType], ['Transport', 0, 100, '0']);
});

test('çmimet: lekë dhe euro', async () => {
  const { parseCurrency, priceFields, salePriceIn, unitCostIn } = await import('../src/shared/prices.js');
  assert.deepEqual(['€', 'Euro', 'lekë', 'ALL', '', 'USD'].map(parseCurrency), ['EUR', 'EUR', 'ALL', 'ALL', null, undefined]);
  assert.deepEqual(priceFields(380, 'EUR', 100), { all: 38000, eur: 380 });
  assert.deepEqual(priceFields(250, 'ALL', 100), { all: 250, eur: null });
  const eur = { salePrice: 38000, salePriceCurrency: 'EUR', salePriceEur: 380 };
  assert.equal(salePriceIn(eur, 'EUR', 100), 380);
  assert.equal(salePriceIn(eur, 'ALL', 102), 38760); // rillogaritet me kursin aktual
  assert.equal(salePriceIn({ salePrice: 250 }, 'EUR', 100), 2.5);
  assert.equal(salePriceIn({ salePrice: 250 }, 'ALL', 100), 250);
  assert.equal(unitCostIn({ avgCost: 25500, purchasePrice: 25000, purchaseCurrency: 'EUR', purchasePriceEur: 250 }, 'EUR', 100), 250);
  assert.equal(unitCostIn({ avgCost: 25500, purchaseCurrency: 'EUR', purchasePriceEur: 250 }, 'ALL', 100), 25500);
  assert.equal(unitCostIn({ avgCost: 1200 }, 'EUR', 100), 12);
});

test('formula: depoja, vëllimi total dhe qarkullimi', () => {
  const v = poolVariables({ length: 16, width: 6.5, depthMin: 1.45, volume: 160, tankPct: 10, turnoverHours: 4 });
  assert.equal(v.A, 104);
  assert.equal(v.D, 16);
  assert.equal(v.VT, 176);
  assert.equal(v.Q, 44);
  assert.equal(poolVariables({ length: 10, width: 5, depthMin: 1.5 }).Q, 75 / 4); // pa depo, 4 orë
  assert.equal(evaluateFormula('ceil(Q / 20)', v), 3);
});

test('kartela: gjendja fillestare, gjendja pas çdo rreshti dhe vjetërsia FIFO', async () => {
  const { buildLedger, agingOf } = await import('../src/shared/ledger.js');
  const debits = [
    { id: 'gj', date: '2026-01-01', dueDate: '2026-01-01', amount: 250000 },
    { id: 'f1', date: '2026-03-05', dueDate: '2026-03-20', amount: 120000 },
    { id: 'f2', date: '2026-04-10', dueDate: '2026-05-10', amount: 50000 },
  ];
  const credits = [
    { id: 'p1', date: '2026-02-10', amount: 100000 },
    { id: 'p2', date: '2026-04-02', amount: 80000, linkId: 'f2' }, // 50.000 te f2, 30.000 FIFO
  ];
  const l = buildLedger(debits, credits, '2026-03-01', '2026-12-31');
  assert.equal(l.opening, 150000);
  assert.deepEqual(l.rows.map((r) => r.balance), [270000, 190000, 240000]);
  assert.deepEqual([l.debit, l.credit, l.closing], [170000, 80000, 240000]);
  const a = agingOf(debits, credits, '2026-05-15');
  assert.equal(a.total, 240000);
  assert.deepEqual(a.open.map((d) => [d.id, d.remaining, d.bucket]), [['gj', 120000, 'd90plus'], ['f1', 120000, 'd60']]);
  assert.equal(a.buckets.d90plus, 120000);
  const pre = agingOf(debits, [...credits, { id: 'p3', date: '2026-05-01', amount: 300000 }], '2026-05-15');
  assert.deepEqual([pre.total, pre.unapplied], [0, 60000]); // parapagim
});

test('ekstrakti bankar: shumat, datat, kolonat dhe sugjerimet', async () => {
  const { parseAmount, parseDate, detectColumns, statementRows, suggestMatch, findParty, txKey } = await import('../src/shared/bank.js');
  assert.deepEqual(['1.234,56', '1,234.56', '-500', '(250,00)', '12.500', '12,5', 980, ''].map(parseAmount), [1234.56, 1234.56, -500, -250, 12500, 12.5, 980, null]);
  assert.deepEqual(['05.10.2026', '2026-10-05', '5/1/26', 46300].map(parseDate), ['2026-10-05', '2026-10-05', '2026-01-05', '2026-10-05']);
  const matrix = [
    ['Banka Kombëtare Tregtare'], ['Ekstrakt llogarie', '', 'ALL'], [],
    ['Data e transaksionit', 'Përshkrimi', 'Debi', 'Kredi', 'Referenca'],
    ['01.10.2026', 'Pagese nga RIVIERA SHPK NIPT L11111111A fat 512', '', '120.000,00', 'TRX1'],
    ['02.10.2026', 'Komision mirembajtje', '500,00', '', 'TRX2'],
    ['03.10.2026', 'Transferte per Astral Pool fatura 245', '80.000,00', '', 'TRX3'],
    ['', 'Totali', '80.500,00', '120.000,00', ''],
  ];
  const { headerRow, map } = detectColumns(matrix);
  assert.equal(headerRow, 3);
  const rows = statementRows(matrix, headerRow, map);
  assert.deepEqual(rows.map((r) => r.amount), [120000, -500, -80000]);
  assert.notEqual(txKey('a', rows[0]), txKey('a', rows[1]));
  assert.equal(txKey('a', rows[0]), txKey('a', { ...rows[0] }));
  const clients = [{ id: 'c1', name: 'Riviera Sh.p.k.', nipt: 'L11111111A' }, { id: 'c2', name: 'Vila Golem' }];
  const suppliers = [{ id: 's1', name: 'Astral Pool' }];
  assert.equal(findParty('pagese nga vila golem', clients).id, 'c2');
  assert.deepEqual(suggestMatch(rows[0], { accountId: 'a', clients, suppliers }), { kind: 'client', party: clients[0] });
  assert.equal(suggestMatch(rows[2], { accountId: 'a', clients, suppliers }).party.id, 's1');
  assert.equal(suggestMatch(rows[1], { accountId: 'a', clients, suppliers }), null);
  const pay = { id: 'p1', clientId: 'c1', date: '2026-09-30', accountAmount: 120000, status: 'active' };
  const link = suggestMatch(rows[0], { accountId: 'a', clients, suppliers, payments: [pay] });
  assert.deepEqual([link.kind, link.payment.id], ['link', 'p1']);
  assert.equal(suggestMatch(rows[0], { accountId: 'a', clients, payments: [{ ...pay, bankTxId: 'x' }] }).kind, 'client');
});

test('kopja rezervë: llojet e Firestore ruhen dhe rikthehen pa humbje', async () => {
  const { Timestamp, GeoPoint } = await import('firebase-admin/firestore');
  const { encodeValue, decodeValue } = await import('../src/lib/backupCodec.js');
  const fakeDb = { doc: (p) => ({ path: p, isRef: true }) };
  const src = { at: new Timestamp(1790000000, 123000000), loc: new GeoPoint(41.3, 19.8), list: [1, 'a', { n: null, ok: true }], nested: { when: new Timestamp(5, 0) } };
  const json = JSON.parse(JSON.stringify(encodeValue(src)));
  const back = decodeValue(json, fakeDb);
  assert.ok(back.at instanceof Timestamp);
  assert.deepEqual([back.at.seconds, back.at.nanoseconds], [1790000000, 123000000]);
  assert.deepEqual([back.loc.latitude, back.loc.longitude], [41.3, 19.8]);
  assert.deepEqual(back.list, [1, 'a', { n: null, ok: true }]);
  assert.equal(back.nested.when.seconds, 5);
});

test('oferta Excel: qelizat, klienti, përmasat, rreshtat dhe tekstet', async () => {
  const { parseSheetCells, parseSharedStrings, parseDrawingImages, colNumber } = await import('../src/shared/xlsxLite.js');
  const { parseOfferSheet, splitDescription, unitOf } = await import('../src/shared/offerExcel.js');
  assert.equal(colNumber('VXH'), 15504);
  const shared = parseSharedStrings('<sst><si><t>Oferte per klientin: </t></si><si><r><t>ELTON </t></r><r><t>ISMAILI</t></r></si><si><t>Permasat: 8m x 4m x 1.5m</t></si><si><t>NR.</t></si><si><t>PERSHKRIMI</t></si><si><t>FOTO</t></si><si><t>NJESIA</t></si><si><t>SASIA</t></si><si><t xml:space="preserve">FILTER PISHINE ME QUARTZ\n• Diametri: 650 mm</t></si><si><t>Copë</t></si><si><t>TOTAL PA TVSH</t></si><si><t>TOTAL  TVSH</t></si><si><t>Përmet</t></si><si><t>Vëllimi = 48.00 m³</t></si><si><t>Depo =  3.00 m³</t></si><si><t>Qarkullimi = 51.00m³ / 3.00 ore = 17m³/h</t></si><si><t>SHKALLË</t></si></sst>');
  const sheet = '<sheetData><row r="6"><c r="B6" t="s"><v>0</v></c><c r="D6" t="s"><v>2</v></c></row><row r="7"><c r="B7" t="s"><v>1</v></c><c r="D7" t="s"><v>13</v></c><c r="XFD7" t="s"><v>0</v></c></row>'
    + '<row r="8"><c r="B8" t="s"><v>12</v></c><c r="D8" t="s"><v>14</v></c></row><row r="9"><c r="D9" t="s"><v>15</v></c></row>'
    + '<row r="16"><c r="A16" t="s"><v>3</v></c><c r="B16" t="s"><v>4</v></c><c r="C16" t="s"><v>5</v></c><c r="D16" t="s"><v>6</v></c><c r="E16" t="s"><v>7</v></c></row>'
    + '<row r="17"><c r="A17"><v>1</v></c><c r="B17" t="s"><v>8</v></c><c r="C17" s="3"/><c r="D17" t="s"><v>9</v></c><c r="E17"><v>1</v></c></row>'
    + '<row r="18"><c r="A18"><v>2</v></c><c r="B18" t="s"><v>16</v></c><c r="D18" t="s"><v>9</v></c><c r="E18"><v>0</v></c></row>'
    + '<row r="52"><c r="C52" t="s"><v>10</v></c><c r="E52"><v>6120</v></c></row><row r="53"><c r="C53" t="s"><v>11</v></c><c r="E53"><f>E52*20%</f><v>1224</v></c></row></sheetData>';
  const cells = parseSheetCells(sheet, shared);
  assert.equal(cells['7:2'], 'ELTON ISMAILI');
  assert.equal(cells['53:5#f'], 'E52*20%');
  assert.equal(Object.keys(cells).some((k) => k.endsWith(':16384')), false); // kolonat e largëta anashkalohen
  const o = parseOfferSheet(cells);
  assert.deepEqual(o.client, { name: 'ELTON ISMAILI', city: 'Përmet', country: '' });
  assert.deepEqual([o.dims.length, o.dims.width, o.dims.depthMin, o.dims.volume, o.dims.tank, o.dims.turnoverHours], [8, 4, 1.5, 48, 3, 3]);
  assert.deepEqual([o.subtotal, o.vatPct, o.photoCol], [6120, 20, 3]);
  assert.deepEqual(o.items.map((i) => [i.row, i.title, i.unit, i.qty]), [[17, 'FILTER PISHINE ME QUARTZ', 'cope', 1], [18, 'SHKALLË', 'cope', 0]]);
  assert.equal(o.items[0].details, '• Diametri: 650 mm');
  assert.deepEqual(splitDescription('  IMPLANTI NË SALLËN TEKNIKE      • Furnizimi i tubave'), { title: 'IMPLANTI NË SALLËN TEKNIKE', details: '• Furnizimi i tubave' });
  assert.deepEqual(['Komplet', 'KG', 'meter linear', 'Copë'].map(unitOf), ['set', 'kg', 'm', 'cope']);
  const imgs = parseDrawingImages('xl/drawings/drawing1.xml',
    '<xdr:wsDr><xdr:twoCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>16</xdr:row></xdr:from><xdr:pic><a:blip r:embed="rId1"/></xdr:pic></xdr:twoCellAnchor><xdr:twoCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:row>16</xdr:row></xdr:from><a:blip r:embed="rId2"/></xdr:twoCellAnchor></xdr:wsDr>',
    '<Relationships><Relationship Id="rId1" Type="x/image" Target="../media/image7.jpg"/><Relationship Id="rId2" Type="x/image" Target="../media/image8.svg"/></Relationships>');
  assert.deepEqual(imgs, [{ col: 3, row: 17, media: 'xl/media/image7.jpg' }]);
});
