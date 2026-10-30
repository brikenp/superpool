// Kthimi i vlerave të Firestore në JSON (dhe mbrapsht) për kopjet rezervë,
// pa humbur llojet e veçanta: data/ora (Timestamp), referencat, koordinatat, bajtet.

import { DocumentReference, GeoPoint, Timestamp } from 'firebase-admin/firestore';

export function encodeValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Timestamp) return { __t: 'ts', s: v.seconds, n: v.nanoseconds };
  if (v instanceof Date) return { __t: 'ts', s: Math.floor(v.getTime() / 1000), n: (v.getTime() % 1000) * 1e6 };
  if (v instanceof GeoPoint) return { __t: 'geo', lat: v.latitude, lng: v.longitude };
  if (v instanceof DocumentReference) return { __t: 'ref', p: v.path };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { __t: 'bytes', b: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(encodeValue);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = encodeValue(x);
    return out;
  }
  return v;
}

export function decodeValue(v, db) {
  if (v === null || v === undefined) return v ?? null;
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, db));
  if (typeof v === 'object') {
    switch (v.__t) {
      case 'ts': return new Timestamp(v.s, v.n || 0);
      case 'geo': return new GeoPoint(v.lat, v.lng);
      case 'ref': return db.doc(v.p);
      case 'bytes': return Buffer.from(v.b, 'base64');
      default: {
        const out = {};
        for (const [k, x] of Object.entries(v)) out[k] = decodeValue(x, db);
        return out;
      }
    }
  }
  return v;
}
