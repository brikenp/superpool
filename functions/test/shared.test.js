import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateFormula, formulaError, poolVariables } from '../src/shared/formula.js';
import { hasCap } from '../src/shared/roles.js';
import {
  openReserved, planMovement, projectMaterialSummary, projectResult, stockKey, validateMovement,
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
