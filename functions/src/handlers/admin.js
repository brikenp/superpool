import { onCall } from 'firebase-functions/v2/https';

import { LOC, VIRTUAL_LOCATIONS } from '../shared/constants.js';
import { CAPS, CUSTOM_ROLE, ROLES, sanitizeCaps } from '../shared/roles.js';
import { FieldValue, REGION, audit, auth, db, fail, requireCap, reserveNumber, userContext } from '../lib/context.js';

async function ensureBaseData() {
  const batch = db.batch();
  for (const [id, loc] of Object.entries(VIRTUAL_LOCATIONS)) {
    batch.set(db.doc(`locations/${id}`), { ...loc, active: true, virtual: true }, { merge: true });
  }
  const main = await db.doc(`locations/${LOC.MAIN}`).get();
  if (!main.exists) batch.set(db.doc(`locations/${LOC.MAIN}`), { kind: 'main', name: 'Magazina kryesore', active: true });
  const company = await db.doc('settings/company').get();
  if (!company.exists) {
    batch.set(db.doc('settings/company'), {
      name: 'SuperPool',
      tagline: 'Ndërtim pishinash · Pajisje · Kimikate',
      nipt: '', address: 'Tiranë, Shqipëri', phone: '', email: '', web: '',
      vatPct: 20,
      currency: 'ALL',
      offerValidityDays: 30,
      defaultPaymentTerms: '50% paradhënie në nënshkrimin e kontratës, 40% gjatë punimeve, 10% në dorëzim.',
      defaultDeliveryTerm: '45 ditë pune nga marrja e paradhënies.',
      offerFooter: 'Faleminderit për besimin te SuperPool.',
    });
  }
  await batch.commit();
}

/**
 * Konfigurimi fillestar. Nëse nuk ka asnjë administrator, përdoruesi që e thërret bëhet administrator.
 * Krijon gjithashtu vendet virtuale, magazinën kryesore dhe të dhënat e kompanisë.
 */
export const bootstrap = onCall({ region: REGION }, async (request) => {
  if (!request.auth) fail('Duhet të identifikoheni.', 'unauthenticated');
  const admins = await db.collection('users').where('role', '==', 'admin').limit(1).get();
  if (!admins.empty) {
    const me = await db.doc(`users/${request.auth.uid}`).get();
    if (me.get('role') !== 'admin') fail('Sistemi është konfiguruar tashmë.', 'permission-denied');
    await ensureBaseData();
    return { ok: true, admin: false };
  }
  const record = await auth.getUser(request.auth.uid);
  await db.doc(`users/${record.uid}`).set({
    name: record.displayName || record.email,
    email: record.email || '',
    role: 'admin',
    active: true,
    employeeId: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  await ensureBaseData();
  await audit(null, { user: { uid: record.uid, name: record.email }, action: 'create', collection: 'users', id: record.uid, label: record.email, note: 'Administratori i parë' });
  return { ok: true, admin: true };
});

function checkRole(role) {
  if (!ROLES[role]) fail('Rol i pavlefshëm.', 'invalid-argument');
}

async function linkEmployee(uid, employeeId, previousEmployeeId) {
  if (previousEmployeeId && previousEmployeeId !== employeeId) {
    await db.doc(`employees/${previousEmployeeId}`).set({ userId: null }, { merge: true });
  }
  if (employeeId) await db.doc(`employees/${employeeId}`).set({ userId: uid }, { merge: true });
}

export const createUser = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.USERS);
  const { email, password, name, role, employeeId = null, caps } = request.data || {};
  checkRole(role);
  const customCaps = role === CUSTOM_ROLE ? sanitizeCaps(caps) : [];
  if (role === CUSTOM_ROLE && !customCaps.length) fail('Zgjidhni të paktën një leje për rolin e personalizuar.', 'invalid-argument');
  if (!email || !password || String(password).length < 8) fail('Email-i dhe fjalëkalimi (min. 8 karaktere) janë të detyrueshëm.', 'invalid-argument');
  let record;
  try {
    record = await auth.createUser({ email: String(email).trim(), password: String(password), displayName: name || '' });
  } catch (err) {
    fail(err.code === 'auth/email-already-exists' ? 'Ky email ekziston.' : `Krijimi dështoi: ${err.message}`, 'already-exists');
  }
  await db.doc(`users/${record.uid}`).set({
    name: name || email,
    email: record.email,
    role,
    caps: customCaps,
    active: true,
    employeeId: employeeId || null,
    createdAt: FieldValue.serverTimestamp(),
  });
  await linkEmployee(record.uid, employeeId, null);
  await audit(null, { user, action: 'create', collection: 'users', id: record.uid, label: record.email, changes: { role, caps: customCaps } });
  return { uid: record.uid };
});

export const updateUser = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.USERS);
  const { uid, name, role, active, employeeId, password, caps } = request.data || {};
  const ref = db.doc(`users/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) fail('Përdoruesi nuk ekziston.', 'not-found');
  if (uid === user.uid && (active === false || (role && role !== 'admin' && role !== CUSTOM_ROLE))) {
    fail('Nuk mund të çaktivizoni ose të hiqni rolin e administratorit nga vetja.');
  }
  const update = {};
  if (name !== undefined) update.name = String(name);
  if (role !== undefined) { checkRole(role); update.role = role; }
  const effectiveRole = role ?? snap.get('role');
  if (role !== undefined || caps !== undefined) {
    update.caps = effectiveRole === CUSTOM_ROLE ? sanitizeCaps(caps ?? snap.get('caps')) : [];
    if (effectiveRole === CUSTOM_ROLE && !update.caps.length) fail('Zgjidhni të paktën një leje për rolin e personalizuar.', 'invalid-argument');
    if (uid === user.uid && effectiveRole === CUSTOM_ROLE && !update.caps.includes(CAPS.USERS)) {
      fail('Nuk mund t\'i hiqni vetes të drejtën e menaxhimit të përdoruesve.');
    }
  }
  if (active !== undefined) update.active = Boolean(active);
  if (employeeId !== undefined) update.employeeId = employeeId || null;
  await ref.update(update);
  const authUpdate = {};
  if (password) {
    if (String(password).length < 8) fail('Fjalëkalimi duhet të ketë të paktën 8 karaktere.', 'invalid-argument');
    authUpdate.password = String(password);
  }
  if (active !== undefined) authUpdate.disabled = !active;
  if (name !== undefined) authUpdate.displayName = String(name);
  if (Object.keys(authUpdate).length) await auth.updateUser(uid, authUpdate);
  if (active === false) await auth.revokeRefreshTokens(uid);
  if (employeeId !== undefined) await linkEmployee(uid, employeeId || null, snap.get('employeeId'));
  await audit(null, { user, action: 'update', collection: 'users', id: uid, label: snap.get('email'), changes: { ...update, ...(password ? { password: '***' } : {}) } });
  return { ok: true };
});

const NUMBER_PREFIXES = {
  OF: CAPS.OFFERS,
  POR: CAPS.SUPPLIERS,
  PRJ: CAPS.PROJECTS_MANAGE,
  NUM: CAPS.INVENTORY_MANAGE,
  FAT: CAPS.FINANCE,
};

/** Jep numrin e radhës për dokumentet që krijohen nga aplikacioni (oferta, porosi, projekte...). */
export const allocateNumber = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  const { prefix } = request.data || {};
  if (!NUMBER_PREFIXES[prefix]) fail('Prefiks i panjohur.', 'invalid-argument');
  requireCap(user, NUMBER_PREFIXES[prefix]);
  return db.runTransaction(async (tx) => {
    const n = await reserveNumber(tx, prefix);
    n.commit();
    return { number: n.number };
  });
});
