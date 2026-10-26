import { onCall } from 'firebase-functions/v2/https';

import { LOC } from '../shared/constants.js';
import { CAPS } from '../shared/roles.js';
import { isComposite, productionLines, validateMovement } from '../shared/stock.js';
import { FieldValue, REGION, audit, db, fail, requireCap, reserveNumber, round3, userContext } from '../lib/context.js';
import { applyPlanToContext, loadContext, planOrFail, writeEffects } from '../lib/movements.js';

/**
 * Lexon recetat dhe ndërton lëvizjen e prodhimit (vetëm lexime — thirret para çdo shkrimi).
 * items: [{ productId, qty }] — artikuj me recetë që prodhohen në vendin locationId.
 */
export async function prepareProduction(tx, { items, locationId, date, extra = {} }) {
  const ids = [...new Set(items.map((i) => i.productId))];
  const snaps = ids.length ? await tx.getAll(...ids.map((id) => db.doc(`products/${id}`))) : [];
  const recipes = {};
  for (const s of snaps) {
    if (!s.exists) fail(`Artikulli ${s.id} nuk ekziston.`);
    if (!isComposite(s.data())) fail(`"${s.get('name')}" nuk ka recetë (materialet përbërëse).`, 'invalid-argument');
    recipes[s.id] = s.data();
  }
  const numbering = await reserveNumber(tx, 'PRO', date);
  const movement = {
    kind: 'production',
    date,
    sourceId: locationId,
    destId: LOC.PRODUCTION,
    projectId: null,
    clientId: null,
    lines: productionLines(items, recipes, locationId),
    notes: '',
    ...extra,
  };
  const ctx = await loadContext(tx, movement);
  const errors = validateMovement(movement, ctx.locations);
  if (errors.length) fail(errors.join('\n'), 'invalid-argument');
  // Kosto e artikujve të prodhuar llogaritet me kostot aktuale të materialeve.
  const withCosts = productionLines(items, ctx.products, locationId);
  movement.lines.forEach((l, i) => { if (withCosts[i].unitCost != null) l.unitCost = withCosts[i].unitCost; });
  return { movement, ctx, numbering, ref: db.collection('movements').doc() };
}

/** Planifikon dhe shkruan prodhimin; përditëson kontekstin që një shitje pas tij të shohë gjendjen e re. */
export function writeProduction(tx, p, user) {
  const plan = planOrFail(p.movement, p.ctx, 1);
  writeEffects(tx, p.ref.id, p.movement, p.ctx, plan, 1);
  applyPlanToContext(p.ctx, plan);
  for (const [pid, avg] of Object.entries(plan.avgCosts)) if (p.ctx.products[pid]) p.ctx.products[pid].avgCost = avg;
  p.numbering.commit();
  const outputs = p.movement.lines.filter((l) => l.sourceId === LOC.PRODUCTION);
  // Kostot nuk ruhen te lëvizja (ajo lexohet edhe nga punonjës pa të drejtë kostosh) — vetëm te movementCosts.
  const named = ({ unitCost, ...l }) => ({
    ...l,
    code: p.ctx.products[l.productId].code || '',
    name: p.ctx.products[l.productId].name || '',
    unit: p.ctx.products[l.productId].unit || '',
  });
  tx.set(p.ref, {
    ...p.movement,
    number: p.numbering.number,
    lines: p.movement.lines.map(named),
    productIds: [...new Set(p.movement.lines.map((l) => l.productId))],
    produced: outputs.map((l) => ({ productId: l.productId, name: p.ctx.products[l.productId].name || '', unit: p.ctx.products[l.productId].unit || '', qty: l.qty })),
    sourceName: p.ctx.locations[p.movement.sourceId].name,
    destName: p.ctx.locations[LOC.PRODUCTION].name,
    status: 'confirmed',
    participants: [user.uid],
    createdBy: user.uid,
    createdByName: user.name,
    createdAt: FieldValue.serverTimestamp(),
    confirmedBy: user.uid,
    confirmedByName: user.name,
    confirmedAt: FieldValue.serverTimestamp(),
  });
  return plan;
}

/** Fletë prodhimi: prodhon artikuj me recetë dhe i shton në stok, duke shkarkuar materialet. */
export const confirmProduction = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.INVENTORY_MANAGE, CAPS.MOVEMENTS_APPROVE);
  const input = request.data?.production || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : new Date().toISOString().slice(0, 10);
  const byProduct = {};
  for (const i of Array.isArray(input.items) ? input.items : []) {
    if (!i?.productId || !(Number(i.qty) > 0)) continue;
    byProduct[i.productId] = round3((byProduct[i.productId] || 0) + Number(i.qty));
  }
  const items = Object.entries(byProduct).map(([productId, qty]) => ({ productId: String(productId), qty }));
  if (!items.length) fail('Shtoni të paktën një artikull për prodhim.', 'invalid-argument');

  return db.runTransaction(async (tx) => {
    const p = await prepareProduction(tx, {
      items,
      locationId: String(input.locationId || LOC.MAIN),
      date,
      extra: { notes: String(input.notes || '').slice(0, 2000) },
    });
    writeProduction(tx, p, user);
    audit(tx, { user, action: 'confirm', collection: 'movements', id: p.ref.id, label: p.numbering.number, changes: { items } });
    return { id: p.ref.id, number: p.numbering.number };
  });
});
