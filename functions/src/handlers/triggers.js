import { onDocumentWritten, onDocumentWrittenWithAuthContext } from 'firebase-functions/v2/firestore';

import { FieldValue, REGION, db } from '../lib/context.js';

/** Çdo automjet ka nënmagazinën e vet (locations/veh_<id>). */
export const onVehicleWritten = onDocumentWritten({ document: 'vehicles/{id}', region: REGION }, async (event) => {
  const after = event.data?.after;
  const ref = db.doc(`locations/veh_${event.params.id}`);
  if (!after?.exists) {
    await ref.set({ active: false }, { merge: true });
    return;
  }
  await ref.set({
    kind: 'vehicle',
    vehicleId: event.params.id,
    name: `Automjeti ${after.get('plate')}`,
    responsibleId: after.get('responsibleId') || null,
    active: after.get('active') !== false,
  }, { merge: true });
});

/** Çdo projekt ka kantierin e vet (locations/site_<id>) dhe ekipin e lidhur me përdoruesit. */
export const onProjectWritten = onDocumentWritten({ document: 'projects/{id}', region: REGION }, async (event) => {
  const after = event.data?.after;
  const id = event.params.id;
  const ref = db.doc(`locations/site_${id}`);
  if (!after?.exists) {
    await ref.set({ active: false }, { merge: true });
    return;
  }
  const p = after.data();
  await ref.set({
    kind: 'site',
    projectId: id,
    name: `Kantieri ${p.code} · ${p.name}`,
    active: !['completed', 'cancelled'].includes(p.status),
  }, { merge: true });

  const fin = db.doc(`projectFinance/${id}`);
  if (!(await fin.get()).exists) await fin.set({ contractValue: 0, plannedMaterialCost: 0, plannedOtherCost: 0, realMaterialCost: 0 });

  // teamUids përdoret nga rregullat e sigurisë: punonjësit shohin vetëm projektet ku janë në ekip.
  const employeeIds = p.teamEmployeeIds || [];
  let uids = [];
  if (employeeIds.length) {
    const snaps = await db.getAll(...employeeIds.map((e) => db.doc(`employees/${e}`)));
    uids = snaps.map((s) => s.exists && s.get('userId')).filter(Boolean);
  }
  if (p.managerUid) uids.push(p.managerUid);
  uids = [...new Set(uids)].sort();
  if (JSON.stringify(uids) !== JSON.stringify([...(p.teamUids || [])].sort())) {
    await after.ref.update({ teamUids: uids });
  }
});

/** Kur lidhet një punonjës me përdorues, rifreskohen ekipet e projekteve të tij. */
export const onEmployeeWritten = onDocumentWritten({ document: 'employees/{id}', region: REGION }, async (event) => {
  const before = event.data?.before?.get('userId') || null;
  const after = event.data?.after?.exists ? event.data.after.get('userId') || null : null;
  if (before === after) return;
  const projects = await db.collection('projects').where('teamEmployeeIds', 'array-contains', event.params.id).get();
  await Promise.all(projects.docs.map((d) => d.ref.update({ teamRefreshedAt: FieldValue.serverTimestamp() })));
});

// Koleksionet që gjurmohen automatikisht kur ndryshohen direkt nga aplikacioni.
const AUDITED = new Set([
  'products', 'categories', 'productCosts', 'locations', 'employees', 'vehicles', 'suppliers', 'supplierPrices',
  'purchaseOrders', 'clients', 'invoices', 'payments', 'offers', 'poolModels', 'projects', 'projectFinance',
  'inventoryCounts', 'settings', 'users',
]);
const SKIP_FIELDS = new Set(['updatedAt', 'createdAt', 'teamRefreshedAt', 'reservationUpdatedAt']);

function diff(before = {}, after = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (SKIP_FIELDS.has(k)) continue;
    const a = JSON.stringify(before[k] ?? null);
    const b = JSON.stringify(after[k] ?? null);
    if (a !== b) out[k] = [before[k] ?? null, after[k] ?? null];
  }
  return out;
}

function shorten(changes) {
  const text = JSON.stringify(changes);
  return text.length > 8000 ? { truncated: text.slice(0, 8000) } : changes;
}

/** Gjurmët e veprimeve për shkrimet e drejtpërdrejta nga përdoruesit (jo ato nga vetë funksionet). */
export const auditWrites = onDocumentWrittenWithAuthContext({ document: '{collection}/{docId}', region: REGION }, async (event) => {
  const { collection, docId } = event.params;
  if (!AUDITED.has(collection)) return;
  if (event.authType === 'service_account' || event.authType === 'system') return;
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  const changes = diff(before || {}, after || {});
  if (!Object.keys(changes).length) return;
  const uid = event.authId || null;
  let userName = uid || 'i panjohur';
  if (uid) {
    const u = await db.doc(`users/${uid}`).get();
    if (u.exists) userName = u.get('name') || userName;
  }
  const doc = after || before;
  await db.collection('auditLog').add({
    at: FieldValue.serverTimestamp(),
    uid,
    userName,
    action: !before ? 'create' : !after ? 'delete' : 'update',
    collection,
    docId,
    label: String(doc.number || doc.code || doc.name || doc.plate || doc.email || docId).slice(0, 200),
    note: '',
    changes: shorten(changes),
  });
});
