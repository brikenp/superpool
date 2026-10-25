import { onCall } from 'firebase-functions/v2/https';

import { LOC } from '../shared/constants.js';
import { CAPS } from '../shared/roles.js';
import { stockKey, validateMovement } from '../shared/stock.js';
import { FieldValue, REGION, audit, db, fail, requireCap, reserveNumber, round3, userContext } from '../lib/context.js';
import { loadContext, planOrFail, sanitizeLines, writeEffects } from '../lib/movements.js';

/**
 * Pranon mallin e një porosie (plotësisht ose pjesërisht): krijon fletëhyrjen e konfirmuar
 * dhe përditëson sasitë e pranuara dhe statusin e porosisë.
 * data: { poId, destId, date, fiscalRef, lines: [{productId, qty, unitCost}] }
 */
export const receivePurchaseOrder = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.INVENTORY_MANAGE);
  const { poId, destId = LOC.MAIN, fiscalRef = '', notes = '' } = request.data || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(request.data?.date || '') ? request.data.date : new Date().toISOString().slice(0, 10);

  return db.runTransaction(async (tx) => {
    const poRef = db.doc(`purchaseOrders/${poId}`);
    const po = await tx.get(poRef);
    if (!po.exists) fail('Porosia nuk ekziston.', 'not-found');
    if (['received', 'cancelled'].includes(po.get('status'))) fail('Porosia është mbyllur.');
    const movement = {
      kind: 'purchase',
      date,
      sourceId: LOC.SUPPLIER,
      destId,
      supplierId: po.get('supplierId'),
      projectId: po.get('projectId') || null,
      purchaseOrderId: poId,
      fiscalRef: String(fiscalRef).slice(0, 60),
      notes: String(notes).slice(0, 2000),
      lines: sanitizeLines(request.data?.lines, 'purchase').filter((l) => l.qty > 0),
    };
    const numbering = await reserveNumber(tx, 'HYR', date);
    const ctx = await loadContext(tx, movement);
    const errors = validateMovement(movement, ctx.locations);
    if (errors.length) fail(errors.join('\n'), 'invalid-argument');
    const plan = planOrFail(movement, ctx, 1);

    const received = {};
    movement.lines.forEach((l) => { received[l.productId] = round3((received[l.productId] || 0) + l.qty); });
    const poLines = (po.get('lines') || []).map((l) => {
      const add = received[l.productId] || 0;
      delete received[l.productId];
      return { ...l, receivedQty: round3(Number(l.receivedQty || 0) + add) };
    });
    const complete = poLines.every((l) => l.receivedQty >= Number(l.qty));

    const movRef = db.collection('movements').doc();
    numbering.commit();
    writeEffects(tx, movRef.id, movement, ctx, plan, 1);
    tx.set(movRef, {
      ...movement,
      number: numbering.number,
      lines: movement.lines.map(({ unitCost, ...l }) => ({
        ...l, code: ctx.products[l.productId].code, name: ctx.products[l.productId].name, unit: ctx.products[l.productId].unit || '',
      })),
      productIds: Object.keys(ctx.products),
      sourceName: po.get('supplierName') || 'Furnitor',
      destName: ctx.locations[destId].name,
      status: 'confirmed',
      participants: [user.uid],
      createdBy: user.uid,
      createdByName: user.name,
      createdAt: FieldValue.serverTimestamp(),
      confirmedBy: user.uid,
      confirmedByName: user.name,
      confirmedAt: FieldValue.serverTimestamp(),
    });
    tx.update(poRef, {
      lines: poLines,
      status: complete ? 'received' : 'partial',
      receiptIds: FieldValue.arrayUnion(movRef.id),
      updatedAt: FieldValue.serverTimestamp(),
    });
    audit(tx, { user, action: 'confirm', collection: 'purchaseOrders', id: poId, label: po.get('number'), note: `Pranim ${numbering.number}` });
    return { movementId: movRef.id, number: numbering.number, status: complete ? 'received' : 'partial' };
  });
});

/**
 * Konfirmon inventarizimin: krahason sasitë e numëruara me stokun aktual dhe krijon
 * lëvizjet e rregullimit (tepricë / mungesë).
 */
export const confirmInventoryCount = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.INVENTORY_MANAGE);
  const { id } = request.data || {};
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`inventoryCounts/${id}`);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('Inventarizimi nuk ekziston.', 'not-found');
    const count = snap.data();
    if (count.status !== 'draft') fail('Inventarizimi është mbyllur.');
    const lines = (count.lines || []).filter((l) => l.productId && l.countedQty !== null && l.countedQty !== '' && l.countedQty !== undefined);
    if (!lines.length) fail('Nuk ka asnjë sasi të numëruar.');

    const stockSnaps = await tx.getAll(...lines.map((l) => db.doc(`stock/${stockKey(count.locationId, l.productId)}`)));
    const current = Object.fromEntries(stockSnaps.map((s, i) => [lines[i].productId, s.exists ? Number(s.get('qty') || 0) : 0]));
    const plus = [];
    const minus = [];
    const resultLines = lines.map((l) => {
      const systemQty = current[l.productId];
      const diff = round3(Number(l.countedQty) - systemQty);
      if (diff > 0) plus.push({ productId: l.productId, qty: diff, condition: 'good', note: 'Tepricë nga inventarizimi' });
      if (diff < 0) minus.push({ productId: l.productId, qty: -diff, condition: 'good', note: 'Mungesë nga inventarizimi' });
      return { ...l, systemQty, difference: diff };
    });

    const movements = [];
    if (plus.length) movements.push({ kind: 'adjustment', date: count.date, sourceId: LOC.ADJUST, destId: count.locationId, lines: plus, notes: `Inventarizimi ${count.number}` });
    if (minus.length) movements.push({ kind: 'adjustment', date: count.date, sourceId: count.locationId, destId: LOC.ADJUST, lines: minus, notes: `Inventarizimi ${count.number}` });
    const numbering = movements.length ? await reserveNumber(tx, 'INV', count.date, movements.length) : null;
    const contexts = [];
    for (const m of movements) contexts.push(await loadContext(tx, m));
    const plans = movements.map((m, i) => planOrFail(m, contexts[i], 1));

    numbering?.commit();
    const ids = [];
    movements.forEach((m, i) => {
      const movRef = db.collection('movements').doc();
      ids.push(movRef.id);
      writeEffects(tx, movRef.id, m, contexts[i], plans[i], 1);
      const ctx = contexts[i];
      tx.set(movRef, {
        ...m,
        number: numbering.numbers[i],
        lines: m.lines.map((l) => ({ ...l, code: ctx.products[l.productId].code, name: ctx.products[l.productId].name, unit: ctx.products[l.productId].unit || '' })),
        productIds: m.lines.map((l) => l.productId),
        sourceName: ctx.locations[m.sourceId].name,
        destName: ctx.locations[m.destId].name,
        inventoryCountId: id,
        status: 'confirmed',
        participants: [user.uid],
        createdBy: user.uid,
        createdByName: user.name,
        createdAt: FieldValue.serverTimestamp(),
        confirmedBy: user.uid,
        confirmedByName: user.name,
        confirmedAt: FieldValue.serverTimestamp(),
      });
    });
    tx.update(ref, {
      lines: resultLines,
      status: 'confirmed',
      movementIds: ids,
      confirmedBy: user.uid,
      confirmedByName: user.name,
      confirmedAt: FieldValue.serverTimestamp(),
    });
    audit(tx, { user, action: 'confirm', collection: 'inventoryCounts', id, label: count.number, changes: { surplus: plus.length, shortage: minus.length } });
    return { movementIds: ids, surplus: plus.length, shortage: minus.length };
  });
});
