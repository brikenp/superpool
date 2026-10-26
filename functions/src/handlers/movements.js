import { onCall } from 'firebase-functions/v2/https';

import { MOVEMENT_KINDS } from '../shared/constants.js';
import { CAPS } from '../shared/roles.js';
import { validateMovement } from '../shared/stock.js';
import { FieldValue, REGION, audit, db, fail, requireCap, reserveNumber, userContext } from '../lib/context.js';
import {
  applyPlanToContext, loadContext, participantsFor, planOrFail, sanitizeMovement, shareContexts, writeEffects,
} from '../lib/movements.js';

// Llojet që mund t'i regjistrojë një punonjës në terren (pa të drejta magazine).
const FIELD_KINDS = new Set(['issue', 'delivery', 'consumption', 'return', 'loss']);
// Llojet që kërkojnë të drejta magazine edhe për t'u regjistruar.
const WAREHOUSE_KINDS = new Set(['purchase', 'adjustment', 'agent_issue', 'customer_return', 'supplier_return', 'transfer']);

function assertCanCreate(user, kind) {
  requireCap(user, CAPS.MOVEMENTS_CREATE);
  if (kind === 'sale') fail('Shitjet regjistrohen nga moduli i shitjeve.', 'invalid-argument');
  if (kind === 'production') fail('Prodhimi regjistrohet nga «Fletë prodhimi».', 'invalid-argument');
  if (WAREHOUSE_KINDS.has(kind)) requireCap(user, CAPS.INVENTORY_MANAGE, CAPS.MOVEMENTS_APPROVE);
  if (!user.caps.has(CAPS.MOVEMENTS_APPROVE) && !user.caps.has(CAPS.INVENTORY_MANAGE) && !FIELD_KINDS.has(kind)) {
    fail('Nuk keni të drejtë për këtë lloj lëvizjeje.', 'permission-denied');
  }
}

/** Punonjësi në terren mund të lëvizë mall vetëm nga/drejt automjeteve ku është përgjegjës ose projekteve ku punon. */
async function assertFieldScope(tx, user, movement, locations) {
  if (user.caps.has(CAPS.MOVEMENTS_APPROVE) || user.caps.has(CAPS.INVENTORY_MANAGE)) return;
  for (const id of [movement.sourceId, movement.destId]) {
    const loc = locations[id];
    if (!loc) continue;
    if (loc.kind === 'vehicle') {
      const v = await tx.get(db.doc(`vehicles/${loc.vehicleId}`));
      if (!user.employeeId || v.get('responsibleId') !== user.employeeId) {
        if (movement.employeeId !== user.employeeId || !user.employeeId) {
          fail(`Nuk jeni përgjegjës për ${loc.name}.`, 'permission-denied');
        }
      }
    }
  }
  if (movement.projectId) {
    const p = await tx.get(db.doc(`projects/${movement.projectId}`));
    if (!(p.get('teamUids') || []).includes(user.uid)) fail('Nuk jeni pjesë e ekipit të këtij projekti.', 'permission-denied');
  }
}

/**
 * Krijon ose përditëson një lëvizje.
 * data: { id?, movement: {...}, submit: boolean }
 *  - submit=false → ruhet si draft
 *  - submit=true  → konfirmohet menjëherë, ose kalon "në pritje" nëse kërkon miratim
 */
export const submitMovement = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  const movement = sanitizeMovement(request.data?.movement || {});
  const submit = Boolean(request.data?.submit);
  const existingId = request.data?.id || null;
  assertCanCreate(user, movement.kind);

  const def = MOVEMENT_KINDS[movement.kind];
  const canApprove = user.caps.has(CAPS.MOVEMENTS_APPROVE);
  if (movement.kind === 'issue' && !movement.authorizedBy && canApprove) movement.authorizedBy = user.uid;
  if (movement.kind === 'issue' && !movement.employeeId && user.employeeId) movement.employeeId = user.employeeId;

  return db.runTransaction(async (tx) => {
    const ref = existingId ? db.doc(`movements/${existingId}`) : db.collection('movements').doc();
    let existing = null;
    if (existingId) {
      const snap = await tx.get(ref);
      if (!snap.exists) fail('Lëvizja nuk ekziston.', 'not-found');
      existing = snap.data();
      if (!['draft', 'pending'].includes(existing.status)) fail('Vetëm dokumentet draft ose në pritje mund të ndryshohen.');
      if (existing.createdBy !== user.uid && !canApprove) fail('Nuk mund të ndryshoni dokumentin e dikujt tjetër.', 'permission-denied');
      if (existing.kind !== movement.kind) fail('Lloji i dokumentit nuk mund të ndryshohet.');
    }
    const numbering = existing ? null : await reserveNumber(tx, def.prefix, movement.date);
    const ctx = await loadContext(tx, movement);
    const errors = validateMovement(movement, ctx.locations);
    if (errors.length) fail(errors.join('\n'), 'invalid-argument');
    await assertFieldScope(tx, user, movement, ctx.locations);
    const participants = await participantsFor(tx, movement, [user.uid, existing?.createdBy], ctx.locations);

    let status = 'draft';
    if (submit) status = def.approval && !canApprove ? 'pending' : 'confirmed';
    const plan = status === 'confirmed' ? planOrFail(movement, ctx, 1) : null;

    // --- shkrimet ---
    numbering?.commit();
    const doc = {
      ...movement,
      productIds: [...new Set(movement.lines.map((l) => l.productId))],
      lines: movement.lines.map((l) => ({
        ...l,
        code: ctx.products[l.productId].code || '',
        name: ctx.products[l.productId].name || '',
        unit: ctx.products[l.productId].unit || '',
      })),
      sourceName: ctx.locations[movement.sourceId]?.name || '',
      destName: ctx.locations[movement.destId]?.name || '',
      status,
      participants,
      updatedAt: FieldValue.serverTimestamp(),
    };
    // Kostot nuk ruhen në dokumentin e lëvizjes (e lexojnë edhe punonjësit) por te movementCosts.
    doc.lines.forEach((l) => { delete l.unitCost; });
    if (!existing) {
      doc.number = numbering.number;
      doc.createdBy = user.uid;
      doc.createdByName = user.name;
      doc.createdAt = FieldValue.serverTimestamp();
    }
    if (status === 'confirmed') {
      doc.confirmedBy = user.uid;
      doc.confirmedByName = user.name;
      doc.confirmedAt = FieldValue.serverTimestamp();
      writeEffects(tx, ref.id, movement, ctx, plan, 1);
    } else if (movement.kind === 'purchase' || movement.kind === 'customer_return') {
      tx.set(db.doc(`movementCosts/${ref.id}`), {
        kind: movement.kind, date: movement.date, draft: true, lineCosts: movement.lines.map((l) => l.unitCost),
      });
    }
    tx.set(ref, doc, { merge: true });
    audit(tx, {
      user,
      action: status === 'confirmed' ? 'confirm' : existing ? 'update' : 'create',
      collection: 'movements',
      id: ref.id,
      label: `${existing?.number || numbering.number} · ${def.label}`,
      changes: { status, lines: movement.lines.length },
    });
    return { id: ref.id, number: existing?.number || numbering.number, status };
  });
});

/**
 * Miraton një lëvizje në pritje (ose draft) dhe e zbaton mbi stokun.
 * Për kthimet, magazinieri mund të korrigjojë gjendjen e çdo rreshti: data.conditions = ['good','damaged',...]
 */
export const approveMovement = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.MOVEMENTS_APPROVE);
  const { id, conditions } = request.data || {};
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`movements/${id}`);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('Lëvizja nuk ekziston.', 'not-found');
    const existing = snap.data();
    if (!['pending', 'draft'].includes(existing.status)) fail('Kjo lëvizje nuk është në pritje.');
    const movement = sanitizeMovement(existing);
    if (Array.isArray(conditions) && movement.kind === 'return') {
      movement.lines.forEach((l, i) => {
        if (['good', 'damaged', 'lost'].includes(conditions[i])) l.condition = conditions[i];
      });
    }
    // Kosto e blerjes nuk ruhet te dokumenti (e lexojnë edhe punonjësit) por te movementCosts.
    if (movement.kind === 'purchase' || movement.kind === 'customer_return') {
      const draftCosts = await tx.get(db.doc(`movementCosts/${id}`));
      const lineCosts = draftCosts.exists ? draftCosts.get('lineCosts') || [] : [];
      movement.lines.forEach((l, i) => { l.unitCost = Number(lineCosts[i] ?? 0); });
    }
    const ctx = await loadContext(tx, movement);
    const errors = validateMovement(movement, ctx.locations);
    if (errors.length) fail(errors.join('\n'), 'invalid-argument');
    const plan = planOrFail(movement, ctx, 1);

    writeEffects(tx, id, movement, ctx, plan, 1);
    tx.update(ref, {
      status: 'confirmed',
      lines: existing.lines.map((l, i) => ({ ...l, condition: movement.lines[i].condition })),
      projectId: movement.projectId,
      vehicleId: movement.vehicleId,
      confirmedBy: user.uid,
      confirmedByName: user.name,
      confirmedAt: FieldValue.serverTimestamp(),
      participants: FieldValue.arrayUnion(user.uid),
      updatedAt: FieldValue.serverTimestamp(),
    });
    audit(tx, { user, action: 'approve', collection: 'movements', id, label: existing.number });
    return { id, status: 'confirmed' };
  });
});

export const rejectMovement = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.MOVEMENTS_APPROVE);
  const { id, reason = '' } = request.data || {};
  if (!String(reason).trim()) fail('Shkruani arsyen e refuzimit.', 'invalid-argument');
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`movements/${id}`);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('Lëvizja nuk ekziston.', 'not-found');
    if (snap.get('status') !== 'pending') fail('Vetëm lëvizjet në pritje mund të refuzohen.');
    tx.update(ref, {
      status: 'rejected',
      rejectReason: String(reason).slice(0, 500),
      rejectedBy: user.uid,
      rejectedByName: user.name,
      rejectedAt: FieldValue.serverTimestamp(),
    });
    audit(tx, { user, action: 'reject', collection: 'movements', id, label: snap.get('number'), note: reason });
    return { id, status: 'rejected' };
  });
});

/** Anulon një lëvizje. Nëse ishte e konfirmuar, efekti mbi stokun kthehet mbrapsht. */
export async function cancelMovementTx(tx, user, id, reason, opts = {}) {
  const [existing] = await cancelMovementsTx(tx, user, [id], reason, opts);
  return existing;
}

/**
 * Anulon disa lëvizje në të njëjtin transaksion (p.sh. shitjen dhe fletëdaljen e prodhimit).
 * Të gjitha leximet bëhen para shkrimeve, dhe lëvizjet ndajnë të njëjtat gjendje stoku.
 */
export async function cancelMovementsTx(tx, user, ids, reason, { allowSale = false } = {}) {
  const items = [];
  for (const id of ids.filter(Boolean)) {
    const ref = db.doc(`movements/${id}`);
    const snap = await tx.get(ref);
    if (!snap.exists) fail('Lëvizja nuk ekziston.', 'not-found');
    const existing = snap.data();
    if (existing.status === 'cancelled') fail('Lëvizja është anuluar më parë.');
    if ((existing.kind === 'sale' || (existing.kind === 'production' && existing.saleId)) && !allowSale) {
      fail('Shitjet (dhe prodhimi i krijuar nga shitja) anulohen nga moduli i shitjeve.');
    }
    const item = { id, ref, existing };
    if (existing.status === 'confirmed') {
      item.movement = sanitizeMovement(existing, { trusted: true });
      const costs = await tx.get(db.doc(`movementCosts/${id}`));
      const lineCosts = costs.exists ? costs.get('lineCosts') || [] : [];
      item.movement.lines.forEach((l, i) => { l.unitCost = lineCosts[i] ?? 0; });
      item.ctx = await loadContext(tx, item.movement);
    }
    items.push(item);
  }
  const confirmed = items.filter((i) => i.ctx);
  shareContexts(confirmed.map((i) => i.ctx));
  // Leximet mbaruan: tani planifikohet dhe shkruhet secila me radhë mbi gjendjen e përbashkët.
  for (const i of confirmed) {
    const plan = planOrFail(i.movement, i.ctx, -1);
    writeEffects(tx, i.id, i.movement, i.ctx, plan, -1);
    applyPlanToContext(i.ctx, plan);
  }
  for (const { ref, id, existing } of items) {
    tx.update(ref, {
      status: 'cancelled',
      cancelReason: String(reason).slice(0, 500),
      cancelledBy: user.uid,
      cancelledByName: user.name,
      cancelledAt: FieldValue.serverTimestamp(),
    });
    audit(tx, { user, action: 'cancel', collection: 'movements', id, label: existing.number, note: reason });
  }
  return items.map((i) => i.existing);
}

export const cancelMovement = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  const { id, reason = '' } = request.data || {};
  if (!String(reason).trim()) fail('Shkruani arsyen e anulimit.', 'invalid-argument');
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(db.doc(`movements/${id}`));
    const isOwnDraft = snap.exists && ['draft', 'pending'].includes(snap.get('status')) && snap.get('createdBy') === user.uid;
    if (!isOwnDraft) requireCap(user, CAPS.MOVEMENTS_APPROVE);
    await cancelMovementTx(tx, user, id, reason);
    return { id, status: 'cancelled' };
  });
});
