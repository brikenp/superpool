// Integrimi me programin ekzistues të faturimit.
//
// Deri sa të verifikohet API-ja e programit të faturimit, shkëmbimi bëhet me skedarë CSV/Excel:
//  - nga programi i faturimit → SuperPool: klientë, artikuj, fatura (me numrin fiskal), pagesa, gjendje fiskale
//  - nga SuperPool → programi i faturimit: shitjet në pritje të faturës (eksport nga aplikacioni web)
// Kur të ketë API, mjafton të shtohet një "adapter" që thërret të njëjtat funksione importi (importRows).

import { onCall } from 'firebase-functions/v2/https';

import { LOC, UNITS } from '../shared/constants.js';
import { parseCurrency, priceFields } from '../shared/prices.js';
import { CAPS } from '../shared/roles.js';
import { FieldValue, REGION, audit, db, fail, requireCap, reserveNumber, round2, round3, userContext } from '../lib/context.js';
import { loadContext, planOrFail, writeEffects } from '../lib/movements.js';

const MAX_ROWS = 3000;
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const date = (v) => {
  const s = str(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return new Date().toISOString().slice(0, 10);
};

async function indexBy(collection, field) {
  const snap = await db.collection(collection).get();
  const map = new Map();
  snap.forEach((d) => { const k = str(d.get(field)).toLowerCase(); if (k) map.set(k, d); });
  return map;
}

class Writer {
  constructor() { this.batch = db.batch(); this.count = 0; this.commits = []; }
  set(ref, data, opts) { this.batch.set(ref, data, opts || {}); this.bump(); }
  bump() {
    this.count += 1;
    if (this.count >= 400) { this.commits.push(this.batch.commit()); this.batch = db.batch(); this.count = 0; }
  }
  async flush() { if (this.count) this.commits.push(this.batch.commit()); await Promise.all(this.commits); }
}

/** Stoku fillestar: lëvizje rregullimi drejt vendit `destId` (në pjesë, që transaksioni të mos kalojë kufirin). */
async function postOpeningStock(lines, destId, user) {
  let count = 0;
  // Çdo rresht shkruan deri në 3 dokumente; ndajmë në pjesë që transaksioni të mos kalojë kufirin.
  for (let start = 0; start < lines.length; start += 120) {
    const chunk = lines.slice(start, start + 120);
    const merged = Object.values(chunk.reduce((acc, l) => {
      (acc[l.productId] ||= { ...l, qty: 0 }).qty = round3(acc[l.productId].qty + l.qty);
      return acc;
    }, {}));
    const movement = { kind: 'adjustment', date: new Date().toISOString().slice(0, 10), sourceId: LOC.ADJUST, destId, lines: merged, notes: 'Stok fillestar (import)' };
    await db.runTransaction(async (tx) => {
      const n = await reserveNumber(tx, 'INV');
      const ctx = await loadContext(tx, movement);
      const plan = planOrFail(movement, ctx, 1);
      const ref = db.collection('movements').doc();
      n.commit();
      writeEffects(tx, ref.id, movement, ctx, plan, 1);
      tx.set(ref, {
        ...movement,
        number: n.number,
        lines: merged.map((l) => ({ ...l, code: ctx.products[l.productId].code, name: ctx.products[l.productId].name, unit: ctx.products[l.productId].unit || '' })),
        productIds: merged.map((l) => l.productId),
        sourceName: ctx.locations[LOC.ADJUST].name,
        destName: ctx.locations[destId].name,
        status: 'confirmed',
        participants: [user.uid],
        createdBy: user.uid, createdByName: user.name, createdAt: FieldValue.serverTimestamp(),
        confirmedBy: user.uid, confirmedByName: user.name, confirmedAt: FieldValue.serverTimestamp(),
      });
    });
    count += merged.length;
  }
  return count;
}

const importers = {
  // Gjendjet fillestare të klientëve: shuma pozitive = klienti na detyrohet, negative = ka paguar më shumë.
  async clientBalances(rows, result, user, options = {}) {
    const clientsSnap = await db.collection('clients').get();
    const byKey = new Map();
    clientsSnap.forEach((d) => {
      for (const k of [d.get('nipt'), d.get('name'), d.get('tradeName')]) if (str(k)) byKey.set(str(k).toLowerCase(), d);
    });
    const withOpening = new Set();
    for (const c of ['invoices', 'payments']) {
      (await db.collection(c).where('type', '==', 'opening').get()).forEach((d) => { if (d.get('status') !== 'cancelled') withOpening.add(d.get('clientId')); });
    }
    let eurRate = Number(options.eurRate) > 1 ? Number(options.eurRate) : 0;
    if (!eurRate) eurRate = Number((await db.doc('settings/company').get()).get('eurRate')) || 0;
    const docs = [];
    const w = new Writer();
    rows.forEach((r, i) => {
      const nipt = str(r.nipt).toUpperCase();
      const name = str(r.client || r.klienti || r.name || r.emri);
      const amount = num(r.amount ?? r.shuma ?? r.gjendja);
      if (!nipt && !name) { result.errors.push(`Rreshti ${i + 2}: mungon klienti (emri ose NIPT).`); return; }
      if (amount === null || amount === 0) { result.errors.push(`Rreshti ${i + 2} (${name || nipt}): mungon shuma.`); return; }
      const currency = parseCurrency(r.currency ?? r.monedha) || 'ALL';
      const rate = currency === 'EUR' ? num(r.exchangeRate ?? r.kursi) || eurRate : 1;
      if (currency === 'EUR' && !(rate > 1)) { result.errors.push(`Rreshti ${i + 2} (${name || nipt}): vendosni kursin e euros.`); return; }
      let client = (nipt && byKey.get(nipt.toLowerCase())) || (name && byKey.get(name.toLowerCase()));
      if (!client) {
        const ref = db.collection('clients').doc();
        const data = { name: name || nipt, nipt, type: nipt ? 'business' : 'individual', tradeName: '', createdAt: FieldValue.serverTimestamp() };
        w.set(ref, data);
        client = { id: ref.id, get: (f) => data[f] };
        for (const k of [nipt, data.name]) if (k) byKey.set(k.toLowerCase(), client);
        result.created += 1;
      }
      if (withOpening.has(client.id)) { result.errors.push(`Rreshti ${i + 2} (${client.get('name')}): ka tashmë gjendje fillestare — ndryshojeni te Financa → Kartela e klientit.`); return; }
      withOpening.add(client.id);
      const value = Math.abs(amount);
      docs.push({
        debit: amount > 0,
        data: {
          type: 'opening', date: date(r.date || r.data), clientId: client.id, clientName: client.get('name'),
          amount: value, currency, exchangeRate: rate, amountAll: round2(value * rate),
          notes: str(r.notes || r.shenime), source: 'superpool', createdBy: user.uid, createdAt: FieldValue.serverTimestamp(),
        },
      });
    });
    if (docs.length) {
      const { numbers } = await db.runTransaction(async (tx) => {
        const n = await reserveNumber(tx, 'GJF', new Date(), docs.length);
        n.commit();
        return n;
      });
      docs.forEach(({ debit, data }, k) => {
        if (debit) {
          w.set(db.collection('invoices').doc(), { ...data, kind: 'opening', status: 'issued', internalNumber: numbers[k], fiscalNumber: '', dueDate: data.date, projectId: null });
        } else {
          w.set(db.collection('payments').doc(), { ...data, status: 'active', number: numbers[k], invoiceId: null, method: 'opening', reference: 'Gjendje fillestare' });
        }
      });
    }
    await w.flush();
    result.balances = docs.length;
  },
  async clients(rows, result) {
    const byNipt = await indexBy('clients', 'nipt');
    const byName = await indexBy('clients', 'name');
    const w = new Writer();
    rows.forEach((r, i) => {
      const name = str(r.name || r.emri);
      if (!name) { result.errors.push(`Rreshti ${i + 2}: mungon emri.`); return; }
      const nipt = str(r.nipt).toUpperCase();
      const existing = (nipt && byNipt.get(nipt.toLowerCase())) || byName.get(name.toLowerCase());
      const data = {
        name, nipt, type: nipt ? 'business' : 'individual', tradeName: str(r.tradeName || r.emri_tregtar),
        phone: str(r.phone || r.telefon), email: str(r.email), address: str(r.address || r.adresa), city: str(r.city || r.qyteti),
        billingId: str(r.billingId || r.id_faturimi),
        updatedAt: FieldValue.serverTimestamp(),
      };
      Object.keys(data).forEach((k) => { if (data[k] === '' && existing) delete data[k]; });
      w.set(existing ? existing.ref : db.collection('clients').doc(), existing ? data : { ...data, createdAt: FieldValue.serverTimestamp() }, { merge: true });
      result[existing ? 'updated' : 'created'] += 1;
    });
    await w.flush();
  },

  async suppliers(rows, result) {
    const byName = await indexBy('suppliers', 'name');
    const w = new Writer();
    rows.forEach((r, i) => {
      const name = str(r.name || r.emri);
      if (!name) { result.errors.push(`Rreshti ${i + 2}: mungon emri.`); return; }
      const existing = byName.get(name.toLowerCase());
      w.set(existing ? existing.ref : db.collection('suppliers').doc(), {
        name, nipt: str(r.nipt).toUpperCase(), contactPerson: str(r.contactPerson || r.kontakt), phone: str(r.phone || r.telefon),
        email: str(r.email), address: str(r.address || r.adresa), active: true, updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      result[existing ? 'updated' : 'created'] += 1;
    });
    await w.flush();
  },

  async products(rows, result, user, options = {}) {
    const byCode = await indexBy('products', 'code');
    // Kursi i euros: nga ekrani i importit, ose nga Cilësimet e kompanisë.
    let eurRate = Number(options.eurRate) > 1 ? Number(options.eurRate) : 0;
    if (!eurRate) eurRate = Number((await db.doc('settings/company').get()).get('eurRate')) || 0;
    const opening = [];
    const seenStock = new Set();
    const categories = await indexBy('categories', 'name');
    const suppliers = await indexBy('suppliers', 'name');
    const w = new Writer();
    for (const [i, r] of rows.entries()) {
      const code = str(r.code || r.kodi);
      const name = str(r.name || r.emri);
      if (!code || !name) { result.errors.push(`Rreshti ${i + 2}: kodi dhe emri janë të detyrueshëm.`); continue; }
      let category = null;
      const catName = str(r.category || r.kategoria);
      if (catName) {
        category = categories.get(catName.toLowerCase());
        if (!category) {
          const ref = db.collection('categories').doc();
          const isChemical = /kimik/i.test(catName);
          w.set(ref, { name: catName, isChemical });
          category = { id: ref.id, get: (f) => ({ name: catName, isChemical }[f]), ref };
          categories.set(catName.toLowerCase(), category);
        }
      }
      // Furnitori që nuk ekziston krijohet (si kategoritë), që artikulli të lidhet me të.
      const supName = str(r.supplier || r.furnitori);
      let supplier = supName ? suppliers.get(supName.toLowerCase()) : null;
      if (supName && !supplier) {
        const ref = db.collection('suppliers').doc();
        const sup = { name: supName, nipt: '', contactPerson: '', phone: '', email: '', address: '', active: true, createdAt: FieldValue.serverTimestamp() };
        w.set(ref, sup);
        supplier = { id: ref.id, get: (f) => sup[f], ref };
        suppliers.set(supName.toLowerCase(), supplier);
        result.suppliers = (result.suppliers || 0) + 1;
      }
      const unitRaw = str(r.unit || r.njesia).toLowerCase();
      const unit = UNITS[unitRaw] ? unitRaw : Object.keys(UNITS).find((k) => UNITS[k] === unitRaw) || 'cope';
      const existing = byCode.get(code.toLowerCase());
      const data = {
        code, name,
        description: str(r.description || r.pershkrimi), brand: str(r.brand || r.marka), model: str(r.model || r.modeli), unit,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (category) { data.categoryId = category.id; data.categoryName = category.get('name'); data.isChemical = Boolean(category.get('isChemical')); }
      if (supplier) { data.supplierId = supplier.id; data.supplierName = supplier.get('name'); }
      // Monedha e çmimeve: kolona e veçantë për blerjen/shitjen, ose një kolonë "currency" për të dyja.
      const anyCur = r.currency ?? r.monedha;
      const saleCur = parseCurrency(r.saleCurrency ?? r.monedha_shitjes ?? anyCur);
      const purchaseCur = parseCurrency(r.purchaseCurrency ?? r.monedha_blerjes ?? anyCur);
      if (saleCur === undefined || purchaseCur === undefined) { result.errors.push(`Rreshti ${i + 2} (${code}): monedha duhet të jetë ALL ose EUR.`); continue; }
      const salePrice = num(r.salePrice ?? r.cmimi_shitjes);
      const purchasePrice = num(r.purchasePrice ?? r.cmimi_blerjes);
      if (((saleCur === 'EUR' && salePrice !== null) || (purchaseCur === 'EUR' && purchasePrice !== null)) && !eurRate) {
        result.errors.push(`Rreshti ${i + 2} (${code}): vendosni kursin e euros (te importi ose te Cilësimet).`);
        continue;
      }
      if (salePrice !== null) {
        const f = priceFields(salePrice, saleCur || 'ALL', eurRate);
        Object.assign(data, { salePrice: f.all, salePriceCurrency: saleCur || 'ALL', salePriceEur: f.eur });
      }
      const minStock = num(r.minStock ?? r.stoku_minimal);
      if (minStock !== null) data.minStock = minStock;
      if (!existing) Object.assign(data, { active: true, qtyTotal: 0, qtyMain: 0, qtyReserved: 0, createdAt: FieldValue.serverTimestamp() });
      Object.keys(data).forEach((k) => { if (data[k] === '' && existing) delete data[k]; });
      const ref = existing ? existing.ref : db.collection('products').doc();
      w.set(ref, data, { merge: true });
      if (purchasePrice !== null) {
        const f = priceFields(purchasePrice, purchaseCur || 'ALL', eurRate);
        const costs = { purchasePrice: f.all, purchaseCurrency: purchaseCur || 'ALL', purchasePriceEur: f.eur };
        if (!existing || !(Number(existing.get('qtyTotal')) > 0)) costs.avgCost = f.all;
        w.set(db.doc(`productCosts/${ref.id}`), costs, { merge: true });
      }
      // Gjendja fillestare: vetëm për artikujt pa stok, që një import i përsëritur të mos e dyfishojë.
      const qty = num(r.qty ?? r.quantity ?? r.sasia ?? r.gjendja);
      if (qty !== null && qty !== 0) {
        if (!(qty > 0)) result.errors.push(`Rreshti ${i + 2} (${code}): sasia duhet të jetë pozitive.`);
        else if (Number(existing?.get('qtyTotal') || 0) !== 0 || seenStock.has(ref.id)) result.errors.push(`Rreshti ${i + 2} (${code}): ka tashmë gjendje — sasia nuk u shtua (përdorni inventarizimin).`);
        else { opening.push({ productId: ref.id, qty: round3(qty), condition: 'good', note: 'Stok fillestar' }); seenStock.add(ref.id); }
      }
      result[existing ? 'updated' : 'created'] += 1;
    }
    await w.flush();
    // Pas ruajtjes së artikujve dhe kostove, që gjendja të vlerësohet me koston e importuar.
    if (opening.length) result.stock = await postOpeningStock(opening, options.locationId || LOC.MAIN, user);
  },

  async invoices(rows, result) {
    const clientsByNipt = await indexBy('clients', 'nipt');
    const clientsByName = await indexBy('clients', 'name');
    const byFiscal = await indexBy('invoices', 'fiscalNumber');
    const pendingBySale = await indexBy('invoices', 'saleNumber');
    const w = new Writer();
    rows.forEach((r, i) => {
      const number = str(r.number || r.numri);
      const amount = num(r.amount ?? r.vlera);
      if (!number || amount === null) { result.errors.push(`Rreshti ${i + 2}: numri dhe vlera janë të detyrueshme.`); return; }
      const client = clientsByNipt.get(str(r.nipt).toLowerCase()) || clientsByName.get(str(r.client || r.klienti).toLowerCase());
      if (!client) { result.errors.push(`Rreshti ${i + 2}: klienti nuk u gjet (NIPT ${str(r.nipt)}).`); return; }
      const saleNumber = str(r.saleNumber || r.nr_shitjes);
      const pending = saleNumber ? pendingBySale.get(saleNumber.toLowerCase()) : null;
      const existing = byFiscal.get(number.toLowerCase()) || (pending && !pending.get('fiscalNumber') ? pending : null);
      w.set(existing ? existing.ref : db.collection('invoices').doc(), {
        fiscalNumber: number,
        status: 'issued',
        kind: existing?.get('kind') || 'sale',
        date: date(r.date || r.data),
        dueDate: date(r.dueDate || r.afati || r.date || r.data),
        clientId: client.id,
        clientName: client.get('name'),
        amount: round2(amount),
        source: existing?.get('source') || 'import',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      result[existing ? 'updated' : 'created'] += 1;
    });
    await w.flush();
  },

  async payments(rows, result) {
    const clientsByNipt = await indexBy('clients', 'nipt');
    const clientsByName = await indexBy('clients', 'name');
    const invoices = await indexBy('invoices', 'fiscalNumber');
    const existingRefs = await indexBy('payments', 'importKey');
    const w = new Writer();
    rows.forEach((r, i) => {
      const amount = num(r.amount ?? r.vlera);
      const invoice = invoices.get(str(r.invoiceNumber || r.nr_fatures).toLowerCase());
      const client = invoice
        ? { id: invoice.get('clientId'), name: invoice.get('clientName') }
        : (() => { const c = clientsByNipt.get(str(r.nipt).toLowerCase()) || clientsByName.get(str(r.client || r.klienti).toLowerCase()); return c ? { id: c.id, name: c.get('name') } : null; })();
      if (amount === null || !client) { result.errors.push(`Rreshti ${i + 2}: mungon vlera ose klienti.`); return; }
      const d = date(r.date || r.data);
      const reference = str(r.reference || r.referenca);
      const importKey = `${client.id}|${d}|${amount}|${reference}`.toLowerCase();
      const existing = existingRefs.get(importKey);
      w.set(existing ? existing.ref : db.collection('payments').doc(), {
        date: d, clientId: client.id, clientName: client.name, invoiceId: invoice?.id || null,
        amount: round2(amount), method: ['cash', 'bank', 'card'].includes(str(r.method || r.menyra).toLowerCase()) ? str(r.method || r.menyra).toLowerCase() : 'bank',
        reference, importKey, status: 'active', source: 'import', updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      result[existing ? 'updated' : 'created'] += 1;
    });
    await w.flush();
  },

  async fiscalStock(rows, result) {
    const byCode = await indexBy('products', 'code');
    const w = new Writer();
    rows.forEach((r, i) => {
      const p = byCode.get(str(r.code || r.kodi).toLowerCase());
      const qty = num(r.quantity ?? r.sasia);
      if (!p || qty === null) { result.errors.push(`Rreshti ${i + 2}: artikulli ose sasia mungon.`); return; }
      w.set(db.doc(`fiscalStock/${p.id}`), {
        productId: p.id, code: p.get('code'), name: p.get('name'), quantity: round3(qty),
        value: num(r.value ?? r.vlera), asOf: date(r.asOf || r.data), importedAt: FieldValue.serverTimestamp(),
      });
      result.updated += 1;
    });
    await w.flush();
  },

  /** Stoku fillestar: krijon lëvizje rregullimi drejt magazinës kryesore (ose vendit të dhënë). */
  async openingStock(rows, result, user, options) {
    const byCode = await indexBy('products', 'code');
    const destId = options.locationId || LOC.MAIN;
    const lines = [];
    const costs = new Writer();
    rows.forEach((r, i) => {
      const p = byCode.get(str(r.code || r.kodi).toLowerCase());
      const qty = num(r.qty ?? r.quantity ?? r.sasia);
      if (!p || !(qty > 0)) { result.errors.push(`Rreshti ${i + 2}: artikulli ose sasia mungon.`); return; }
      const unitCost = num(r.unitCost ?? r.kosto);
      if (unitCost !== null) costs.set(db.doc(`productCosts/${p.id}`), { avgCost: unitCost, purchasePrice: unitCost }, { merge: true });
      lines.push({ productId: p.id, qty: round3(qty), condition: 'good', note: 'Stok fillestar' });
    });
    await costs.flush();
    result.created += await postOpeningStock(lines, destId, user);
  },
};

export const importData = onCall({ region: REGION, timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.INTEGRATION);
  const { type, rows, options = {} } = request.data || {};
  if (!importers[type]) fail('Lloj importi i panjohur.', 'invalid-argument');
  if (!Array.isArray(rows) || !rows.length) fail('Skedari nuk ka rreshta.', 'invalid-argument');
  if (rows.length > MAX_ROWS) fail(`Maksimumi ${MAX_ROWS} rreshta për import.`, 'invalid-argument');
  const result = { created: 0, updated: 0, errors: [] };
  await importers[type](rows, result, user, options);
  await audit(null, { user, action: 'import', collection: type, label: `Import ${type}`, changes: { created: result.created, updated: result.updated, errors: result.errors.length } });
  result.errors = result.errors.slice(0, 200);
  return result;
});
