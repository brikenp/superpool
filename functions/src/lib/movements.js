// Zbatimi i lëvizjeve të mallit mbi Firestore, brenda transaksioneve.
// Rregull: në një transaksion Firestore të gjitha leximet bëhen para shkrimeve —
// prandaj loadContext() (lexime) dhe writeEffects() (shkrime) janë të ndara.

import { LOC, MOVEMENT_KINDS, VIRTUAL_LOCATIONS, isVirtualLocation } from '../shared/constants.js';
import { openReserved, planMovement, stockKey, isPhysicalKind, lineDestination } from '../shared/stock.js';
import { FieldValue, db, fail, round2, round3 } from './context.js';

const COST_KINDS = new Set(['consumption', 'loss']);

export function sanitizeLines(lines, kind) {
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((l) => l && l.productId)
    .map((l) => {
      const line = {
        productId: String(l.productId),
        qty: round3(Number(l.qty)),
        condition: ['good', 'damaged', 'lost'].includes(l.condition) ? l.condition : 'good',
        note: String(l.note || '').slice(0, 255),
      };
      if (kind === 'purchase' || kind === 'customer_return') line.unitCost = round2(Number(l.unitCost) || 0);
      if (kind === 'sale' || l.unitPrice != null) line.unitPrice = round2(Number(l.unitPrice) || 0);
      return line;
    });
}

const STR_FIELDS = ['projectId', 'vehicleId', 'employeeId', 'authorizedBy', 'supplierId', 'clientId',
  'purchaseOrderId', 'saleId', 'fiscalRef', 'notes'];

/** Ndërton fushat e dokumentit të lëvizjes nga të dhënat e klientit. */
export function sanitizeMovement(input) {
  const kind = String(input.kind || '');
  if (!MOVEMENT_KINDS[kind]) fail(`Lloj lëvizjeje i panjohur: ${kind}`, 'invalid-argument');
  const m = {
    kind,
    date: /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : new Date().toISOString().slice(0, 10),
    sourceId: String(input.sourceId || ''),
    destId: String(input.destId || ''),
    lines: sanitizeLines(input.lines, kind),
  };
  for (const f of STR_FIELDS) m[f] = input[f] ? String(input[f]).slice(0, 2000) : null;
  return m;
}

async function readLocations(tx, ids) {
  const locations = {};
  const physicalIds = [];
  for (const id of ids) {
    if (!id) continue;
    if (isVirtualLocation(id)) locations[id] = { ...VIRTUAL_LOCATIONS[id] };
    else physicalIds.push(id);
  }
  const snaps = physicalIds.length ? await tx.getAll(...physicalIds.map((id) => db.doc(`locations/${id}`))) : [];
  for (const s of snaps) if (s.exists) locations[s.id] = s.data();
  return locations;
}

/** Faza e leximeve: gjithçka që duhet për të planifikuar dhe shkruar efektet e lëvizjes. */
export async function loadContext(tx, movement) {
  const locIds = new Set([movement.sourceId, movement.destId]);
  if (movement.kind === 'return') locIds.add(LOC.LOSS);
  const locations = await readLocations(tx, locIds);

  // Plotësim automatik: kantieri tregon projektin, nënmagazina e automjetit tregon automjetin.
  for (const id of [movement.destId, movement.sourceId]) {
    const loc = locations[id];
    if (!loc) continue;
    if (loc.kind === 'site' && loc.projectId) {
      if (movement.projectId && movement.projectId !== loc.projectId) {
        fail('Kantieri i zgjedhur i përket një projekti tjetër.');
      }
      movement.projectId = loc.projectId;
    }
    if (loc.kind === 'vehicle' && loc.vehicleId && !movement.vehicleId) movement.vehicleId = loc.vehicleId;
  }

  const productIds = [...new Set(movement.lines.map((l) => l.productId))];
  const productRefs = productIds.map((id) => db.doc(`products/${id}`));
  const costRefs = productIds.map((id) => db.doc(`productCosts/${id}`));
  const [productSnaps, costSnaps] = productIds.length
    ? await Promise.all([tx.getAll(...productRefs), tx.getAll(...costRefs)])
    : [[], []];

  const products = {};
  productSnaps.forEach((s, i) => {
    if (!s.exists) fail(`Artikulli ${productIds[i]} nuk ekziston.`);
    const c = costSnaps[i].exists ? costSnaps[i].data() : {};
    products[s.id] = {
      ...s.data(),
      avgCost: Number(c.avgCost || 0),
      purchasePrice: Number(c.purchasePrice || 0),
    };
  });

  const stockRefs = [];
  for (const locId of Object.keys(locations)) {
    if (!isPhysicalKind(locations[locId].kind)) continue;
    for (const pid of productIds) stockRefs.push(db.doc(`stock/${stockKey(locId, pid)}`));
  }
  const stock = {};
  const stockSnaps = stockRefs.length ? await tx.getAll(...stockRefs) : [];
  for (const s of stockSnaps) stock[s.id] = s.exists ? Number(s.get('qty') || 0) : 0;

  let materials = {};
  let finance = null;
  let project = null;
  if (movement.projectId) {
    const projectSnap = await tx.get(db.doc(`projects/${movement.projectId}`));
    if (!projectSnap.exists) fail('Projekti nuk ekziston.');
    project = projectSnap.data();
    const matSnaps = productIds.length
      ? await tx.getAll(...productIds.map((id) => db.doc(`projects/${movement.projectId}/materials/${id}`)))
      : [];
    materials = Object.fromEntries(matSnaps.map((s) => [s.id, s.exists ? s.data() : null]));
    const finSnap = await tx.get(db.doc(`projectFinance/${movement.projectId}`));
    finance = finSnap.exists ? finSnap.data() : {};
  }
  return { locations, products, stock, materials, finance, project };
}

/** Planifikon dhe hedh gabim nëse lëvizja nuk mund të zbatohet. */
export function planOrFail(movement, ctx, direction) {
  const plan = planMovement(movement, ctx, direction);
  if (plan.errors.length) fail(plan.errors.join('\n'));
  return plan;
}

/** Faza e shkrimeve: stoku, produktet, kostot, materialet dhe financat e projektit. */
export function writeEffects(tx, movementId, movement, ctx, plan, direction) {
  const now = FieldValue.serverTimestamp();

  for (const [key, delta] of Object.entries(plan.stockDeltas)) {
    if (!delta) continue;
    const [locationId, productId] = key.split('__');
    tx.set(db.doc(`stock/${key}`), {
      locationId,
      productId,
      locationKind: ctx.locations[locationId].kind,
      qty: round3((ctx.stock[key] || 0) + delta),
      updatedAt: now,
    }, { merge: true });
  }

  // Rezervimet e hapura ndryshojnë kur del malli për projektin.
  const reservedDelta = {};
  if (movement.projectId) {
    for (const [productId, deltas] of Object.entries(plan.projectDeltas)) {
      const before = ctx.materials[productId] || {};
      const after = { ...before };
      for (const [field, d] of Object.entries(deltas)) after[field] = round3(Number(before[field] || 0) + d);
      const p = ctx.products[productId];
      tx.set(db.doc(`projects/${movement.projectId}/materials/${productId}`), {
        productId,
        code: p.code || '',
        name: p.name || '',
        unit: p.unit || '',
        ...Object.fromEntries(Object.keys(deltas).map((f) => [f, after[f]])),
        updatedAt: now,
      }, { merge: true });
      if (deltas.issued) {
        reservedDelta[productId] = openReserved(after.reservedQty, after.issued)
          - openReserved(before.reservedQty, before.issued);
      }
    }
  }

  for (const [productId, p] of Object.entries(ctx.products)) {
    const d = plan.productDeltas[productId] || { qtyTotal: 0, qtyMain: 0 };
    const rd = reservedDelta[productId] || 0;
    if (d.qtyTotal || d.qtyMain || rd) {
      tx.update(db.doc(`products/${productId}`), {
        qtyTotal: round3(Number(p.qtyTotal || 0) + d.qtyTotal),
        qtyMain: round3(Number(p.qtyMain || 0) + d.qtyMain),
        qtyReserved: round3(Math.max(0, Number(p.qtyReserved || 0) + rd)),
      });
    }
  }

  for (const [productId, avgCost] of Object.entries(plan.avgCosts)) {
    const update = { avgCost, updatedAt: now };
    if (movement.kind === 'purchase' && direction === 1) {
      const idx = movement.lines.map((l) => l.productId).lastIndexOf(productId);
      update.purchasePrice = plan.lineCosts[idx];
      update.lastSupplierId = movement.supplierId || null;
      update.lastPurchaseDate = movement.date;
    }
    tx.set(db.doc(`productCosts/${productId}`), update, { merge: true });
  }

  const total = round2(movement.lines.reduce((s, l, i) => s + l.qty * plan.lineCosts[i], 0));
  if (direction === 1) {
    tx.set(db.doc(`movementCosts/${movementId}`), {
      kind: movement.kind,
      date: movement.date,
      projectId: movement.projectId || null,
      lineCosts: plan.lineCosts,
      total,
    });
  }

  // Kosto reale e materialeve të projektit: konsumi + humbjet (përfshirë mallin e dëmtuar në kthim).
  if (movement.projectId) {
    let materialCost = 0;
    movement.lines.forEach((l, i) => {
      const isCost = COST_KINDS.has(movement.kind)
        || (movement.kind === 'return' && lineDestination(movement, l) === LOC.LOSS);
      if (isCost) materialCost += l.qty * plan.lineCosts[i];
    });
    if (materialCost) {
      tx.set(db.doc(`projectFinance/${movement.projectId}`), {
        realMaterialCost: round2(Number(ctx.finance?.realMaterialCost || 0) + direction * materialCost),
        updatedAt: now,
      }, { merge: true });
    }
  }
  return { total };
}

/** Lista e përdoruesve që duhet ta shohin lëvizjen (për rregullat e leximit). */
export async function participantsFor(tx, movement, extraUids = [], locations = {}) {
  const uids = new Set(extraUids.filter(Boolean));
  for (const id of [movement.sourceId, movement.destId]) {
    if (locations[id]?.agentUid) uids.add(locations[id].agentUid);
  }
  if (movement.authorizedBy) uids.add(movement.authorizedBy);
  const employeeIds = new Set([movement.employeeId].filter(Boolean));
  if (movement.vehicleId) {
    const v = await tx.get(db.doc(`vehicles/${movement.vehicleId}`));
    if (v.exists && v.get('responsibleId')) employeeIds.add(v.get('responsibleId'));
  }
  if (employeeIds.size) {
    const snaps = await tx.getAll(...[...employeeIds].map((id) => db.doc(`employees/${id}`)));
    for (const s of snaps) if (s.exists && s.get('userId')) uids.add(s.get('userId'));
  }
  return [...uids];
}
