// Kopjet rezervë (backup) të gjithë platformës dhe rikthimi i tyre.
//
// Një kopje = një skedar i ngjeshur (gzip) në Cloud Storage: backups/<data>_<lloji>.spbak, me një rresht JSON për çdo:
//   meta  – kur, kush, lloji (manual / automatik / para rikthimit)
//   doc   – çdo dokument i Firestore (edhe nënkoleksionet: dokumentet e klientëve, materialet e projekteve…)
//   file  – çdo skedar i Storage (fotot e artikujve, dokumentet, logoja); përmbajtja ruhet një herë sipas hash-it
//           te backups/files/<hash>, që kopjet ditore të mos dyfishojnë fotot
//   user  – llogaritë e hyrjes (Firebase Auth), për t'i rikrijuar nëse fshihen
//   end   – përmbledhja; pa këtë rresht kopja konsiderohet e paplotë dhe nuk rikthehet
//
// Kopja e skedarit mund të shkarkohet në kompjuter dhe të ngarkohet sërish për rikthim.

import { createInterface } from 'node:readline';
import { createGunzip, createGzip } from 'node:zlib';
import { randomBytes, randomUUID } from 'node:crypto';

import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { decodeValue, encodeValue } from '../lib/backupCodec.js';
import { REGION, audit, db, fail, userContext } from '../lib/context.js';

const PREFIX = 'backups/';
const BLOBS = `${PREFIX}files/`;
const UPLOADS = `${PREFIX}uploads/`;
const EXT = '.spbak';
const FORMAT = 'superpool-backup';
const KEEP_AUTO = 30; // sa kopje automatike ditore mbahen
// Nënkoleksionet e njohura; të tjerat gjenden duke parë dokumentet e para të çdo koleksioni.
const KNOWN_SUBCOLLECTIONS = ['documents', 'materials', 'tasks', 'expenses'];
const KIND_LABELS = { manual: 'Manuale', auto: 'Automatike', safety: 'Para rikthimit', upload: 'E ngarkuar' };

const bucket = () => getStorage().bucket(process.env.BACKUP_BUCKET || undefined);

async function requireAdmin(request) {
  const user = await userContext(request);
  if (user.role !== 'admin') fail('Vetëm administratori menaxhon kopjet rezervë.', 'permission-denied');
  return user;
}

const backupName = (kind, date = new Date()) => `${PREFIX}${date.toISOString().replace(/[:.]/g, '-')}_${kind}${EXT}`;

/** Ekzekuton detyrat me disa njëkohësisht (kopjimi i skedarëve). */
async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const item = items[i]; i += 1; await fn(item); }
  }));
}

/** Të gjitha dokumentet: koleksionet kryesore + nënkoleksionet (me collectionGroup). */
async function* allDocuments() {
  const top = await db.listCollections();
  const subNames = new Set(KNOWN_SUBCOLLECTIONS);
  for (const col of top) {
    let n = 0;
    for await (const snap of col.stream()) {
      if (n < 5) for (const sub of await snap.ref.listCollections()) subNames.add(sub.id);
      n += 1;
      yield snap;
    }
  }
  for (const name of subNames) {
    for await (const snap of db.collectionGroup(name).stream()) {
      if (snap.ref.path.split('/').length > 2) yield snap; // vetëm ato brenda një dokumenti
    }
  }
}

/** Krijon një kopje rezervë dhe kthen përmbledhjen e saj. */
export async function createBackupFile({ kind = 'manual', note = '', user = null } = {}) {
  const b = bucket();
  const name = backupName(kind);
  const file = b.file(name);
  const gzip = createGzip();
  const out = file.createWriteStream({ contentType: 'application/gzip', resumable: false, metadata: { metadata: { kind, note: String(note).slice(0, 200) } } });
  const done = new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); gzip.on('error', reject); });
  gzip.pipe(out);
  const write = (obj) => new Promise((resolve) => { if (gzip.write(`${JSON.stringify(obj)}\n`)) resolve(); else gzip.once('drain', resolve); });

  const counts = {};
  let docs = 0;
  await write({ t: 'meta', format: FORMAT, version: 1, createdAt: new Date().toISOString(), kind, note, createdBy: user ? { uid: user.uid, name: user.name } : null, project: process.env.GCLOUD_PROJECT || '' });
  for await (const snap of allDocuments()) {
    await write({ t: 'doc', p: snap.ref.path, d: encodeValue(snap.data()) });
    const top = snap.ref.path.split('/')[0];
    counts[top] = (counts[top] || 0) + 1;
    docs += 1;
  }

  // Skedarët e Storage: përmbajtja kopjohet te backups/files/<hash> vetëm nëse nuk është aty.
  const [objects] = await b.getFiles();
  const files = objects.filter((f) => !f.name.startsWith(PREFIX) && !f.name.endsWith('/'));
  const [blobs] = await b.getFiles({ prefix: BLOBS });
  const haveBlob = new Set(blobs.map((f) => f.name.slice(BLOBS.length)));
  let fileBytes = 0;
  await pool(files, 8, async (f) => {
    const md = f.metadata || {};
    const hash = md.md5Hash ? Buffer.from(md.md5Hash, 'base64').toString('hex') : `${md.crc32c || 'x'}-${md.size}`.replace(/[^A-Za-z0-9-]/g, '');
    if (!haveBlob.has(hash)) { await f.copy(b.file(`${BLOBS}${hash}`)); haveBlob.add(hash); }
    fileBytes += Number(md.size || 0);
    await write({ t: 'file', p: f.name, h: hash, ct: md.contentType || '', m: md.metadata || {}, size: Number(md.size || 0) });
  });

  // Llogaritë e hyrjes.
  let users = 0;
  let pageToken;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    for (const u of page.users) {
      await write({ t: 'user', uid: u.uid, email: u.email || null, displayName: u.displayName || null, disabled: u.disabled, phoneNumber: u.phoneNumber || null });
      users += 1;
    }
    pageToken = page.pageToken;
  } while (pageToken);

  const summary = { docs, files: files.length, fileBytes, users, counts };
  await write({ t: 'end', ...summary });
  gzip.end();
  await done;
  await file.setMetadata({ metadata: { kind, note: String(note).slice(0, 200), docs: String(docs), files: String(files.length), users: String(users), createdBy: user?.name || 'Sistemi' } });
  return { name, ...summary };
}

/** Lexon rreshtat e një kopjeje (gzip + JSON për rresht). */
async function* readBackup(name) {
  const stream = bucket().file(name).createReadStream().pipe(createGunzip());
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}

/** Kontrollon që kopja është e plotë dhe kthen përmbledhjen pa e rikthyer. */
async function inspect(name) {
  let meta = null;
  let end = null;
  let docs = 0;
  for await (const r of readBackup(name)) {
    if (r.t === 'meta') meta = r;
    else if (r.t === 'doc') docs += 1;
    else if (r.t === 'end') end = r;
  }
  if (!meta || meta.format !== FORMAT) fail('Skedari nuk është kopje rezervë e SuperPool.', 'invalid-argument');
  if (!end || end.docs !== docs) fail('Kopja është e paplotë ose e dëmtuar; nuk mund të rikthehet.', 'data-loss');
  return { meta, end };
}

const safePath = (name) => {
  const n = String(name || '');
  if (!n.startsWith(PREFIX) || n.startsWith(BLOBS) || n.includes('..') || !n.endsWith(EXT)) fail('Kopje e panjohur.', 'invalid-argument');
  return n;
};

// ---------------------------------------------------------------- Funksionet e thirrura nga aplikacioni

export const createBackup = onCall({ region: REGION, timeoutSeconds: 540, memory: '1GiB' }, async (request) => {
  const user = await requireAdmin(request);
  const res = await createBackupFile({ kind: 'manual', note: request.data?.note || '', user });
  await audit(null, { user, action: 'create', collection: 'system', id: 'backup', label: `Kopje rezervë: ${res.docs} dokumente, ${res.files} skedarë`, changes: { name: res.name } });
  return res;
});

export const listBackups = onCall({ region: REGION, timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  await requireAdmin(request);
  const [files] = await bucket().getFiles({ prefix: PREFIX });
  const list = files.filter((f) => f.name.endsWith(EXT) && !f.name.startsWith(BLOBS));
  // Kopjet e ngarkuara nga kompjuteri lexohen një herë: kontrollohen dhe përmbledhja ruhet te skedari.
  for (const f of list) {
    if (!f.name.startsWith(UPLOADS) || f.metadata?.metadata?.docs) continue;
    let m;
    try {
      const { meta, end } = await inspect(f.name);
      m = { kind: 'upload', docs: String(end.docs), files: String(end.files), users: String(end.users), createdBy: meta.createdBy?.name || '', note: `Kopje e ${String(meta.createdAt || '').slice(0, 16).replace('T', ' ')} (UTC)${meta.note ? ` · ${meta.note}` : ''}` };
    } catch (err) {
      m = { kind: 'upload', docs: '0', note: `Skedar i pavlefshëm: ${err.message}`.slice(0, 200) };
    }
    await f.setMetadata({ metadata: m });
    f.metadata = { ...f.metadata, metadata: m };
  }
  return list
    .map((f) => {
      const m = f.metadata?.metadata || {};
      return {
        name: f.name, size: Number(f.metadata?.size || 0), createdAt: f.metadata?.timeCreated || null,
        kind: f.name.startsWith(UPLOADS) ? 'upload' : m.kind || 'manual', kindLabel: KIND_LABELS[f.name.startsWith(UPLOADS) ? 'upload' : m.kind] || '',
        note: m.note || '', docs: Number(m.docs || 0), files: Number(m.files || 0), users: Number(m.users || 0), createdBy: m.createdBy || '',
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
});

/**
 * Lidhja e shkarkimit të një kopjeje. Shfletuesi e hap si lidhje të zakonshme (pa CORS në bucket),
 * me një "token" të ri për çdo shkarkim dhe emrin e skedarit për ruajtje.
 */
export const backupDownloadUrl = onCall({ region: REGION }, async (request) => {
  const user = await requireAdmin(request);
  const name = safePath(request.data?.name);
  const file = bucket().file(name);
  const [exists] = await file.exists();
  if (!exists) fail('Kopja nuk ekziston më.', 'not-found');
  const token = randomUUID();
  const [md] = await file.getMetadata();
  const filename = `SuperPool_${name.replace(/^backups\/(uploads\/)?/, '')}`;
  await file.setMetadata({
    contentDisposition: `attachment; filename="${filename}"`,
    metadata: { ...(md.metadata || {}), firebaseStorageDownloadTokens: token },
  });
  const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}` : 'https://firebasestorage.googleapis.com';
  await audit(null, { user, action: 'read', collection: 'system', id: 'backup', label: `Shkarkim i kopjes ${name.slice(PREFIX.length)}` });
  return { url: `${host}/v0/b/${bucket().name}/o/${encodeURIComponent(name)}?alt=media&token=${token}`, filename };
});

export const deleteBackup = onCall({ region: REGION }, async (request) => {
  const user = await requireAdmin(request);
  const name = safePath(request.data?.name);
  await bucket().file(name).delete({ ignoreNotFound: true });
  await audit(null, { user, action: 'delete', collection: 'system', id: 'backup', label: `U fshi kopja rezervë ${name.slice(PREFIX.length)}` });
  return { ok: true };
});

/**
 * Rikthen një kopje. Para çdo rikthimi krijohet automatikisht një kopje e gjendjes aktuale ("Para rikthimit").
 *   mode 'replace' – të dhënat bëhen si në kopje (gjithçka tjetër fshihet)
 *   mode 'missing' – shtohen vetëm dokumentet që mungojnë (asgjë ekzistuese nuk ndryshohet)
 */
export const restoreBackup = onCall({ region: REGION, timeoutSeconds: 540, memory: '1GiB' }, async (request) => {
  const user = await requireAdmin(request);
  const name = safePath(request.data?.name);
  const mode = request.data?.mode === 'missing' ? 'missing' : 'replace';
  if (String(request.data?.confirm || '').trim().toUpperCase() !== 'RIKTHE') fail('Shkruani RIKTHE për të konfirmuar.', 'invalid-argument');
  const { meta, end } = await inspect(name);

  const safety = await createBackupFile({ kind: 'safety', note: `Para rikthimit të kopjes së ${String(meta.createdAt || '').slice(0, 16).replace('T', ' ')} (UTC)`, user });
  const me = (await db.doc(`users/${user.uid}`).get()).data();

  const result = { mode, docs: 0, skipped: 0, deleted: 0, files: 0, usersCreated: [], safety: safety.name, backupDate: meta.createdAt };
  if (mode === 'replace') {
    for (const col of await db.listCollections()) {
      result.deleted += (await col.count().get()).data().count;
      await db.recursiveDelete(col);
    }
  }

  const writer = db.bulkWriter();
  writer.onWriteError((err) => err.failedAttempts < 5);
  const b = bucket();
  const fileJobs = [];
  let pending = [];
  const flush = async () => {
    const batch = pending;
    pending = [];
    if (!batch.length) return;
    const exists = mode === 'missing' ? await db.getAll(...batch.map((r) => db.doc(r.p))) : [];
    batch.forEach((r, i) => {
      if (exists[i]?.exists) { result.skipped += 1; return; }
      writer.set(db.doc(r.p), decodeValue(r.d, db));
      result.docs += 1;
    });
  };
  for await (const r of readBackup(name)) {
    if (r.t === 'doc') {
      pending.push(r);
      if (pending.length >= 300) await flush();
    } else if (r.t === 'file') {
      fileJobs.push(r);
    } else if (r.t === 'user') {
      try {
        await getAuth().getUser(r.uid);
      } catch (err) {
        if (err.code !== 'auth/user-not-found') throw err;
        await getAuth().createUser({
          uid: r.uid, ...(r.email ? { email: r.email } : {}), ...(r.displayName ? { displayName: r.displayName } : {}),
          disabled: Boolean(r.disabled), password: randomBytes(12).toString('base64url'),
        });
        result.usersCreated.push(r.email || r.uid);
      }
    }
  }
  await flush();
  await writer.close();

  // Administratori që bën rikthimin nuk mbetet jashtë (p.sh. nëse llogaria u krijua pas kopjes).
  const meNow = await db.doc(`users/${user.uid}`).get();
  if (!meNow.exists && me) await db.doc(`users/${user.uid}`).set(me);

  // Skedarët që mungojnë kopjohen nga ruajtja e kopjeve, me të njëjtin "token" që lidhjet e vjetra të punojnë.
  await pool(fileJobs, 8, async (f) => {
    const dest = b.file(f.p);
    const [exists] = await dest.exists();
    if (exists) return;
    const blob = b.file(`${BLOBS}${f.h}`);
    const [has] = await blob.exists();
    if (!has) return;
    await blob.copy(dest, { contentType: f.ct || undefined, metadata: f.m || {} });
    result.files += 1;
  });

  await audit(null, {
    user, action: 'update', collection: 'system', id: 'restore',
    label: `Rikthim nga kopja e ${meta.createdAt?.slice(0, 16).replace('T', ' ')} (${mode === 'replace' ? 'i plotë' : 'vetëm që mungojnë'})`,
    changes: { docs: result.docs, skipped: result.skipped, files: result.files, users: result.usersCreated.length, totalInBackup: end.docs },
  });
  await db.doc('settings/backup').set({ lastRestoreAt: FieldValue.serverTimestamp(), lastRestoreBy: user.name, lastRestoreFrom: name }, { merge: true });
  return result;
});

/** Kopje automatike çdo natë; mbahen 30 të fundit (manualet dhe ato "para rikthimit" nuk fshihen). */
export const scheduledBackup = onSchedule({ schedule: '30 2 * * *', timeZone: 'Europe/Tirane', region: REGION, timeoutSeconds: 540, memory: '1GiB' }, async () => {
  const res = await createBackupFile({ kind: 'auto', note: 'Kopje automatike ditore' });
  await db.doc('settings/backup').set({ lastAutoAt: FieldValue.serverTimestamp(), lastAutoName: res.name, lastAutoDocs: res.docs }, { merge: true });
  const [files] = await bucket().getFiles({ prefix: PREFIX });
  const autos = files.filter((f) => f.name.endsWith(`_auto${EXT}`)).sort((a, b) => b.name.localeCompare(a.name));
  for (const f of autos.slice(KEEP_AUTO)) await f.delete({ ignoreNotFound: true });
});
