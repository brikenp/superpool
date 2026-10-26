import { onCall } from 'firebase-functions/v2/https';

import { LOC, PAYMENT_METHODS } from '../shared/constants.js';
import { CAPS } from '../shared/roles.js';
import { isComposite, stockKey, validateMovement } from '../shared/stock.js';
import { FieldValue, REGION, audit, db, fail, requireCap, reserveNumber, round2, round3, userContext } from '../lib/context.js';
import { loadContext, planOrFail, sanitizeLines, shareContexts, writeEffects } from '../lib/movements.js';
import { cancelMovementsTx } from './movements.js';
import { prepareProduction, writeProduction } from './production.js';

/**
 * Regjistron dhe konfirmon një shitje (kimikate / pajisje).
 * Krijon: dokumentin e shitjes, lëvizjen e stokut drejt klientit, faturën në pritje të numrit fiskal
 * dhe pagesën (nëse nuk është me afat).
 * Për artikujt me recetë (p.sh. Aditivi) pa gjendje të mjaftueshme krijon edhe fletën e prodhimit (PRO-…),
 * që shkarkon materialet përbërëse nga i njëjti vend ku bëhet shitja.
 */
export const confirmSale = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.CHEM_SALES);
  const input = request.data?.sale || {};
  const seesAll = user.caps.has(CAPS.CHEM_SALES_ALL);
  const paymentMethod = PAYMENT_METHODS[input.paymentMethod] ? input.paymentMethod : 'cash';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : new Date().toISOString().slice(0, 10);

  const movement = {
    kind: 'sale',
    date,
    sourceId: String(input.locationId || ''),
    destId: LOC.CUSTOMER,
    clientId: input.clientId ? String(input.clientId) : null,
    projectId: null,
    lines: sanitizeLines(input.lines, 'sale'),
    notes: String(input.notes || '').slice(0, 2000),
  };

  return db.runTransaction(async (tx) => {
    const numbering = await reserveNumber(tx, 'SHT', date);
    const invNumbering = await reserveNumber(tx, 'FAT', date);
    const payNumbering = paymentMethod !== 'credit' ? await reserveNumber(tx, 'MA', date) : null;
    const clientSnap = movement.clientId ? await tx.get(db.doc(`clients/${movement.clientId}`)) : null;
    if (!clientSnap?.exists) fail('Zgjidhni klientin.', 'invalid-argument');

    const ctx = await loadContext(tx, movement);
    const errors = validateMovement(movement, ctx.locations);
    if (errors.length) fail(errors.join('\n'), 'invalid-argument');
    const source = ctx.locations[movement.sourceId];
    if (!seesAll && !(source.kind === 'agent' && source.agentUid === user.uid) && source.kind !== 'main') {
      fail('Mund të shisni vetëm nga nënmagazina juaj ose nga magazina kryesore.', 'permission-denied');
    }
    if (!seesAll) {
      const nonChem = movement.lines.find((l) => !ctx.products[l.productId].isChemical);
      if (nonChem) fail(`"${ctx.products[nonChem.productId].name}" nuk është kimikat.`, 'permission-denied');
    }

    // Artikujt me recetë (p.sh. Aditivi): shitet fillimisht gjendja e prodhuar më parë;
    // për sasinë që mungon krijohet automatikisht fletë prodhimi që shkarkon materialet.
    const needed = {};
    for (const l of movement.lines) {
      if (isComposite(ctx.products[l.productId])) needed[l.productId] = round3((needed[l.productId] || 0) + l.qty);
    }
    const shortfall = Object.entries(needed)
      .map(([productId, qty]) => ({ productId, qty: round3(qty - Math.max(0, ctx.stock[stockKey(movement.sourceId, productId)] || 0)) }))
      .filter((i) => i.qty > 0);
    let production = null;
    if (shortfall.length) {
      production = await prepareProduction(tx, {
        items: shortfall, locationId: movement.sourceId, date, extra: { clientId: movement.clientId },
      });
      shareContexts([ctx, production.ctx]);
    }
    const client = clientSnap.data();
    const saleRef = db.collection('sales').doc();
    const movRef = db.collection('movements').doc();
    const invRef = db.collection('invoices').doc();

    // Leximet mbaruan. Fillimisht prodhimi (shton artikullin në stok), pastaj shitja e zbret.
    if (production) {
      Object.assign(production.movement, {
        saleId: saleRef.id,
        saleNumber: numbering.number,
        invoiceId: invRef.id,
        invoiceNumber: invNumbering.number,
        notes: `Prodhim për shitjen ${numbering.number} · fatura ${invNumbering.number} · ${client.name}`,
      });
      writeProduction(tx, production, user);
    }
    const plan = planOrFail(movement, ctx, 1);

    const total = round2(movement.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));

    numbering.commit();
    invNumbering.commit();
    payNumbering?.commit();
    const lines = movement.lines.map((l) => ({
      productId: l.productId,
      code: ctx.products[l.productId].code || '',
      name: ctx.products[l.productId].name || '',
      unit: ctx.products[l.productId].unit || '',
      qty: l.qty,
      unitPrice: l.unitPrice,
      total: round2(l.qty * l.unitPrice),
    }));
    writeEffects(tx, movRef.id, movement, ctx, plan, 1);
    tx.set(movRef, {
      ...movement,
      number: numbering.number,
      lines,
      productIds: [...new Set(lines.map((l) => l.productId))],
      sourceName: source.name,
      destName: client.name,
      saleId: saleRef.id,
      invoiceNumber: invNumbering.number,
      productionId: production?.ref.id || null,
      status: 'confirmed',
      participants: [user.uid],
      createdBy: user.uid,
      createdByName: user.name,
      createdAt: FieldValue.serverTimestamp(),
      confirmedBy: user.uid,
      confirmedByName: user.name,
      confirmedAt: FieldValue.serverTimestamp(),
    });
    tx.set(saleRef, {
      number: numbering.number,
      date,
      clientId: movement.clientId,
      clientName: client.name,
      clientNipt: client.nipt || '',
      sellerUid: user.uid,
      sellerName: user.name,
      locationId: movement.sourceId,
      locationName: source.name,
      paymentMethod,
      lines,
      productIds: [...new Set(lines.map((l) => l.productId))],
      total,
      status: 'confirmed',
      movementId: movRef.id,
      productionId: production?.ref.id || null,
      productionNumber: production?.numbering.number || null,
      invoiceId: invRef.id,
      invoiceNumber: invNumbering.number,
      notes: movement.notes,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(invRef, {
      internalNumber: invNumbering.number,
      fiscalNumber: '',
      status: 'pending_fiscal',
      kind: 'sale',
      date,
      dueDate: date,
      clientId: movement.clientId,
      clientName: client.name,
      amount: total,
      saleId: saleRef.id,
      saleNumber: numbering.number,
      productionNumber: production?.numbering.number || null,
      projectId: null,
      source: 'superpool',
      createdBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (paymentMethod !== 'credit') {
      tx.set(db.collection('payments').doc(), {
        number: payNumbering.number,
        date,
        clientId: movement.clientId,
        clientName: client.name,
        invoiceId: invRef.id,
        saleId: saleRef.id,
        amount: total,
        method: paymentMethod,
        reference: numbering.number,
        status: 'active',
        createdBy: user.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    audit(tx, { user, action: 'confirm', collection: 'sales', id: saleRef.id, label: `${numbering.number} · ${client.name}`, changes: { total } });
    return { id: saleRef.id, number: numbering.number, total, productionNumber: production?.numbering.number || null };
  });
});

export const cancelSale = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.CHEM_SALES_ALL, CAPS.MOVEMENTS_APPROVE);
  const { id, reason = '' } = request.data || {};
  if (!String(reason).trim()) fail('Shkruani arsyen e anulimit.', 'invalid-argument');
  return db.runTransaction(async (tx) => {
    const saleRef = db.doc(`sales/${id}`);
    const sale = await tx.get(saleRef);
    if (!sale.exists) fail('Shitja nuk ekziston.', 'not-found');
    if (sale.get('status') !== 'confirmed') fail('Shitja është anuluar më parë.');
    const invRef = sale.get('invoiceId') ? db.doc(`invoices/${sale.get('invoiceId')}`) : null;
    const inv = invRef ? await tx.get(invRef) : null;
    if (inv?.exists && inv.get('fiscalNumber') && !inv.get('correction')) {
      fail('Fatura është fiskalizuar. Anulojeni fillimisht në programin e faturimit dhe regjistroni kthimin nga klienti.');
    }
    const payments = await tx.get(db.collection('payments').where('saleId', '==', id));
    await cancelMovementsTx(tx, user, [sale.get('movementId'), sale.get('productionId')], reason, { allowSale: true });
    tx.update(saleRef, { status: 'cancelled', cancelReason: reason, cancelledBy: user.uid, cancelledAt: FieldValue.serverTimestamp() });
    if (inv?.exists) tx.update(invRef, { status: 'cancelled' });
    payments.forEach((p) => tx.update(p.ref, { status: 'cancelled' }));
    audit(tx, { user, action: 'cancel', collection: 'sales', id, label: sale.get('number'), note: reason });
    return { id, status: 'cancelled' };
  });
});
