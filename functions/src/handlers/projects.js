import { onCall } from 'firebase-functions/v2/https';

import { CAPS } from '../shared/roles.js';
import { openReserved } from '../shared/stock.js';
import { FieldValue, REGION, audit, db, fail, requireCap, reserveNumber, round2, round3, userContext } from '../lib/context.js';

/**
 * Rezervon (ose liron) materialet e planifikuara të projektit nga stoku i lirë i magazinës kryesore.
 * Kthen listën e mungesave që duhen porositur.
 * data: { projectId, release?: boolean }
 */
export const reserveProjectMaterials = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.PROJECTS_MANAGE, CAPS.INVENTORY_MANAGE);
  const { projectId, release = false } = request.data || {};
  return db.runTransaction(async (tx) => {
    const project = await tx.get(db.doc(`projects/${projectId}`));
    if (!project.exists) fail('Projekti nuk ekziston.', 'not-found');
    const mats = await tx.get(db.collection(`projects/${projectId}/materials`));
    const withPlan = mats.docs.filter((d) => Number(d.get('plannedQty') || 0) > 0 || Number(d.get('reservedQty') || 0) > 0);
    if (!withPlan.length) return { reserved: 0, shortages: [] };
    const productSnaps = await tx.getAll(...withPlan.map((d) => db.doc(`products/${d.id}`)));
    const products = Object.fromEntries(productSnaps.map((s) => [s.id, s.exists ? s.data() : null]));

    const shortages = [];
    const writes = [];
    for (const m of withPlan) {
      const p = products[m.id];
      if (!p) continue;
      const planned = Number(m.get('plannedQty') || 0);
      const issued = Number(m.get('issued') || 0);
      const currentOpen = openReserved(m.get('reservedQty'), issued);
      const need = release ? 0 : Math.max(0, round3(planned - issued));
      const freeForUs = Math.max(0, round3(Number(p.qtyMain || 0) - Number(p.qtyReserved || 0) + currentOpen));
      const newOpen = Math.min(need, freeForUs);
      if (need > newOpen) {
        shortages.push({ productId: m.id, code: p.code, name: p.name, unit: p.unit, missing: round3(need - newOpen), supplierId: p.supplierId || null });
      }
      writes.push({ ref: m.ref, reservedQty: round3(issued + newOpen), productId: m.id, delta: round3(newOpen - currentOpen), product: p });
    }

    let reservedCount = 0;
    for (const w of writes) {
      tx.update(w.ref, { reservedQty: w.reservedQty, updatedAt: FieldValue.serverTimestamp() });
      if (w.delta) {
        tx.update(db.doc(`products/${w.productId}`), {
          qtyReserved: round3(Math.max(0, Number(w.product.qtyReserved || 0) + w.delta)),
        });
      }
      if (w.reservedQty > 0) reservedCount += 1;
    }
    tx.update(project.ref, { shortages, reservationUpdatedAt: FieldValue.serverTimestamp() });
    audit(tx, { user, action: 'other', collection: 'projects', id: projectId, label: project.get('code'), note: release ? 'Lirim rezervimesh' : 'Rezervim materialesh', changes: { shortages: shortages.length } });
    return { reserved: reservedCount, shortages };
  });
});

/**
 * Kthen një ofertë të pranuar në projekt aktiv: kartela e projektit, kantieri, materialet e planifikuara
 * dhe pasqyra financiare me kostot e preventivit.
 */
export const acceptOffer = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.OFFERS, CAPS.PROJECTS_MANAGE);
  const { offerId } = request.data || {};
  return db.runTransaction(async (tx) => {
    const offerRef = db.doc(`offers/${offerId}`);
    const offer = await tx.get(offerRef);
    if (!offer.exists) fail('Oferta nuk ekziston.', 'not-found');
    const o = offer.data();
    if (o.projectId) fail('Oferta është kthyer tashmë në projekt.');
    if (!['draft', 'sent'].includes(o.status)) fail('Vetëm ofertat draft ose të dërguara mund të pranohen.');
    if (!o.clientId) fail('Oferta nuk ka klient.');
    const numbering = await reserveNumber(tx, 'PRJ');
    // Ofertat në euro: financat e projektit mbahen në lekë, me kursin e ofertës.
    const rate = o.currency === 'EUR' ? Number(o.exchangeRate) || 0 : 1;
    if (!(rate > 0)) fail('Oferta në euro nuk ka kursin e këmbimit.');

    const planned = {};
    let plannedMaterialCost = 0;
    let plannedOtherCost = 0;
    for (const l of o.lines || []) {
      const qty = Number(l.qty || 0);
      const cost = qty * Number(l.unitCost || 0) * rate;
      if (l.productId) {
        const p = (planned[l.productId] ||= { qty: 0, cost: 0, code: l.code || '', name: l.description || '', unit: l.unit || '' });
        p.qty = round3(p.qty + qty);
        p.cost += cost;
        plannedMaterialCost += cost;
      } else {
        plannedOtherCost += cost;
      }
    }

    const projectRef = db.collection('projects').doc();
    numbering.commit();
    tx.set(projectRef, {
      code: numbering.number,
      name: o.projectName || `Pishinë ${o.clientName}`,
      clientId: o.clientId,
      clientName: o.clientName || '',
      offerId,
      offerNumber: o.number || '',
      address: o.location || '',
      status: 'active',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: '',
      managerUid: user.uid,
      managerName: user.name,
      teamEmployeeIds: [],
      teamUids: [],
      pool: {
        type: o.poolType || '', length: o.length || 0, width: o.width || 0,
        depthMin: o.depthMin || 0, depthMax: o.depthMax || 0, volume: o.volume || 0,
      },
      notes: '',
      createdBy: user.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    for (const [productId, p] of Object.entries(planned)) {
      tx.set(db.doc(`projects/${projectRef.id}/materials/${productId}`), {
        productId, code: p.code, name: p.name, unit: p.unit, plannedQty: p.qty, reservedQty: 0,
      });
    }
    const net = Number(o.totals?.net ?? o.totals?.subtotal ?? 0) * rate;
    tx.set(db.doc(`projectFinance/${projectRef.id}`), {
      contractValue: round2(net),
      offerValue: round2(net),
      offerValueWithVat: round2(Number(o.totals?.total || 0) * rate),
      offerCurrency: o.currency === 'EUR' ? 'EUR' : 'ALL',
      offerExchangeRate: rate,
      offerValueOriginal: round2(Number(o.totals?.net ?? o.totals?.subtotal ?? 0)),
      plannedMaterialCost: round2(plannedMaterialCost),
      plannedOtherCost: round2(plannedOtherCost),
      plannedCosts: Object.fromEntries(Object.entries(planned).map(([id, p]) => [id, p.qty ? round2(p.cost / p.qty) : 0])),
      realMaterialCost: 0,
    }, { merge: true });
    tx.update(offerRef, { status: 'accepted', projectId: projectRef.id, acceptedAt: FieldValue.serverTimestamp() });
    audit(tx, { user, action: 'confirm', collection: 'offers', id: offerId, label: o.number, note: `Kthyer në projektin ${numbering.number}` });
    return { projectId: projectRef.id, code: numbering.number };
  });
});
