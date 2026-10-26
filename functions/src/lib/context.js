import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { capsForRole } from '../shared/roles.js';

if (!getApps().length) initializeApp();

export const db = getFirestore();
export const auth = getAuth();
export { FieldValue, Timestamp, HttpsError };

export const REGION = process.env.FUNCTIONS_REGION || 'europe-west1';

/** Lexon përdoruesin që thërret funksionin dhe kontrollon që është aktiv. */
export async function userContext(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Duhet të identifikoheni.');
  const uid = request.auth.uid;
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists || snap.get('active') === false) {
    throw new HttpsError('permission-denied', 'Llogaria nuk është aktive.');
  }
  const data = snap.data();
  return {
    uid,
    name: data.name || request.auth.token.email || uid,
    role: data.role,
    employeeId: data.employeeId || null,
    caps: capsForRole(data.role, data.caps),
  };
}

export function requireCap(user, ...caps) {
  if (!caps.some((c) => user.caps.has(c))) {
    throw new HttpsError('permission-denied', 'Nuk keni të drejtë për këtë veprim.');
  }
}

export function fail(message, code = 'failed-precondition') {
  throw new HttpsError(code, message);
}

export function audit(target, { user, action, collection, id, label, note = '', changes = {} }) {
  const ref = db.collection('auditLog').doc();
  const entry = {
    at: FieldValue.serverTimestamp(),
    uid: user?.uid || null,
    userName: user?.name || 'sistemi',
    action,
    collection,
    docId: id || '',
    label: label || '',
    note,
    // Firestore nuk pranon `undefined`; JSON i heq vlerat bosh.
    changes: JSON.parse(JSON.stringify(changes ?? {})),
  };
  // target mund të jetë transaksion, batch ose null (shkrim i drejtpërdrejtë).
  if (target) target.set(ref, entry);
  else return ref.set(entry);
  return undefined;
}

/**
 * Rezervon numrin (ose numrat) e radhës brenda një transaksioni. Duhet thirrur në fazën e leximeve;
 * commit() thirret në fazën e shkrimeve.
 */
export async function reserveNumber(tx, prefix, date = new Date(), count = 1) {
  const year = new Date(date).getFullYear();
  const ref = db.doc(`counters/${prefix}-${year}`);
  const snap = await tx.get(ref);
  const start = (snap.exists ? snap.get('value') : 0) + 1;
  const numbers = Array.from({ length: count }, (_, i) => `${prefix}-${year}-${String(start + i).padStart(4, '0')}`);
  return {
    number: numbers[0],
    numbers,
    commit: () => tx.set(ref, { value: start + count - 1 }, { merge: true }),
  };
}

export const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
export const round3 = (n) => Math.round(Number(n || 0) * 1000) / 1000;
export const today = () => new Date().toISOString().slice(0, 10);
