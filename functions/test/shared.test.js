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
