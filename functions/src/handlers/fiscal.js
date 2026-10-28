// Integrimi me programin fiskal POS.AL: fiskalizimi i faturave, PDF e e-faturës, faturat korrigjuese
// dhe kërkimi i tatimpaguesve sipas NIPT.
// Çelësi API ruhet vetëm këtu në server (private/posal), nuk lexohet kurrë nga shfletuesi.

import { onCall } from 'firebase-functions/v2/https';

import { buildCorrectionRequest, buildFiscalRequest, defaultFiscalOptions } from '../shared/fiscal.js';
import { CAPS } from '../shared/roles.js';
import { FieldValue, HttpsError, REGION, audit, db, fail, requireCap, userContext } from '../lib/context.js';

const CONFIG_DOC = 'private/posal';
export const POSAL_URLS = { prod: 'https://pos-al.ew.r.appspot.com', test: 'https://pos-al-dev.ew.r.appspot.com' };

async function loadConfig() {
  const snap = await db.doc(CONFIG_DOC).get();
  return snap.exists ? snap.data() : {};
}

function baseUrl(config) {
  if (config.env === 'custom' && config.baseUrl) return config.baseUrl.replace(/\/+$/, '');
  return POSAL_URLS[config.env] || POSAL_URLS.prod;
}

/** Thirrja te POS.AL; kthen JSON-in ose hedh gabim me mesazhin e tyre. */
async function posal(config, method, path, body) {
  if (!config.apiKey || !config.shopId) fail('Programi fiskal nuk është konfiguruar. Plotësoni Shop ID dhe çelësin API te Integrimi → POS.AL.');
  let res;
  try {
    res = await fetch(`${baseUrl(config)}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-auth-type': 'API_KEY',
        'x-timeout': '5000',
        'x-api-key': config.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) {
    fail(`Programi fiskal nuk u arrit (${err.name === 'TimeoutError' ? 'koha mbaroi' : err.message}). Provoni përsëri.`, 'unavailable');
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text.slice(0, 300) }; }
  if (!res.ok || json?.status === 'FAILED' || json?.status === 'ERROR') {
    const msg = json?.message || json?.error?.message || json?.code || `HTTP ${res.status}`;
    // Detajet (nëse POS.AL i kthen) ndihmojnë të kuptohet pse u refuzua fatura.
    const detail = [json?.data, json?.errors, json?.error?.details, json?.details]
      .filter((d) => d && (typeof d === 'string' || Object.keys(d).length))
      .map((d) => (typeof d === 'string' ? d : JSON.stringify(d))).join(' · ');
    console.error('POS.AL refuzoi', method, path, res.status, text.slice(0, 2000), body ? JSON.stringify(body).slice(0, 4000) : '');
    const err = new HttpsError('failed-precondition', `POS.AL: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}${detail ? ` — ${detail}` : ''}`.slice(0, 900));
    err.posal = { status: res.status, response: text.slice(0, 3000), request: body || null };
    throw err;
  }
  return json;
}

const masked = (key) => (key ? `••••••${String(key).slice(-6)}` : '');

export const getFiscalConfig = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.INTEGRATION);
  const c = await loadConfig();
  return {
    enabled: Boolean(c.enabled), env: c.env || 'test', baseUrl: c.baseUrl || '', shopId: c.shopId || '',
    apiKeyMasked: masked(c.apiKey), vatPayer: c.vatPayer !== false, vatPct: c.vatPct ?? 20,
    bankAccounts: c.bankAccounts || [], urls: POSAL_URLS,
  };
});

export const saveFiscalConfig = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.INTEGRATION);
  const d = request.data || {};
  const update = {
    enabled: Boolean(d.enabled),
    env: ['prod', 'test', 'custom'].includes(d.env) ? d.env : 'test',
    baseUrl: String(d.baseUrl || '').slice(0, 300),
    shopId: String(d.shopId || '').trim().slice(0, 100),
    vatPayer: d.vatPayer !== false,
    vatPct: [0, 6, 10, 20].includes(Number(d.vatPct)) ? Number(d.vatPct) : 20,
    bankAccounts: (Array.isArray(d.bankAccounts) ? d.bankAccounts : []).slice(0, 5).map((b, i) => ({
      bank: String(b.bank || '').slice(0, 100), iban: String(b.iban || '').replace(/\s/g, '').slice(0, 40),
      swift: String(b.swift || '').slice(0, 20), description: String(b.description || b.bank || '').slice(0, 100), principal: i === 0,
    })).filter((b) => b.iban),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid,
  };
  if (d.apiKey && String(d.apiKey).trim()) update.apiKey = String(d.apiKey).trim();
  await db.doc(CONFIG_DOC).set(update, { merge: true });
  // Flamuri publik (pa sekrete) që aplikacioni të shfaqë butonat e fiskalizimit.
  await db.doc('settings/company').set({ fiscalEnabled: update.enabled, fiscalEnv: update.env }, { merge: true });
  await audit(null, { user, action: 'update', collection: 'settings', id: 'posal', label: 'Programi fiskal POS.AL', changes: { enabled: update.enabled, env: update.env, shopId: update.shopId, apiKey: update.apiKey ? 'ndryshuar' : 'pa ndryshim' } });
  return { ok: true };
});

/** Kërkim tatimpaguesi sipas NIPT ose emrit (përdoret edhe si provë e lidhjes). */
export const lookupTaxpayer = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.CLIENTS_VIEW, CAPS.INTEGRATION);
  const { nipt, name } = request.data || {};
  const config = await loadConfig();
  const searchType = nipt ? 'nuis' : 'name';
  const value = String(nipt || name || '').trim();
  if (value.length < 3) fail('Shkruani NIPT-in ose të paktën 3 shkronja të emrit.', 'invalid-argument');
  const q = new URLSearchParams({ shopId: config.shopId || '', searchType, value });
  const res = await posal(config, 'GET', `/integrations/tax-payer?${q}`);
  const data = res.data || {};
  const list = data.taxpayers || (data.Tin ? [data] : []);
  return {
    taxpayers: list.slice(0, 20).map((t) => ({ nipt: t.Tin || '', name: t.Name || '', address: t.Address || '', town: t.Town || '', country: t.Country || 'ALB' })),
  };
});

function canFiscalize(user, invoice) {
  if (user.caps.has(CAPS.FINANCE)) return true;
  return Boolean(invoice.saleId) && user.caps.has(CAPS.CHEM_SALES) && invoice.createdBy === user.uid;
}

/** Fiskalizon një faturë: dërgon te POS.AL dhe ruan NIVF/NSLF/NIVE, numrin fiskal dhe lidhjen e verifikimit. */
export const fiscalizeInvoice = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  const { invoiceId, invoiceType, paymentMethod } = request.data || {};
  const ref = db.doc(`invoices/${String(invoiceId || '')}`);
  const config = await loadConfig();
  if (!config.enabled) fail('Fiskalizimi nga SuperPool nuk është aktivizuar (Integrimi → POS.AL).');

  // Rezervim: dy përdorues (ose dy klikime) nuk e fiskalizojnë dy herë të njëjtën faturë.
  const invoice = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail('Fatura nuk ekziston.', 'not-found');
    const inv = { id: snap.id, ...snap.data() };
    if (!canFiscalize(user, inv)) fail('Nuk keni të drejtë të fiskalizoni këtë faturë.', 'permission-denied');
    if (inv.status === 'cancelled') fail('Fatura është anuluar.');
    if (inv.type === 'opening') fail('Gjendja fillestare e klientit nuk fiskalizohet.');
    if (inv.fiscal?.fic) fail(`Fatura është fiskalizuar më parë (${inv.fiscalNumber}).`, 'already-exists');
    const started = inv.fiscalizing?.toMillis?.() || 0;
    if (started && Date.now() - started < 120000) fail('Fatura po fiskalizohet nga dikush tjetër. Prisni pak dhe rifreskoni.');
    tx.update(ref, { fiscalizing: FieldValue.serverTimestamp() });
    return inv;
  });

  try {
    const [saleSnap, clientSnap] = await Promise.all([
      invoice.saleId ? db.doc(`sales/${invoice.saleId}`).get() : null,
      invoice.clientId ? db.doc(`clients/${invoice.clientId}`).get() : null,
    ]);
    const sale = saleSnap?.exists ? saleSnap.data() : null;
    const client = clientSnap?.exists ? clientSnap.data() : { name: invoice.clientName };
    const defaults = defaultFiscalOptions({ client, sale, invoice });
    const options = { invoiceType: invoiceType || defaults.invoiceType, paymentMethod: paymentMethod || defaults.paymentMethod };
    if (options.invoiceType === 'EINVOICE' && !client.nipt) fail('E-fatura kërkon NIPT-in e klientit. Plotësojeni te kartela e klientit.', 'invalid-argument');
    if (options.invoiceType !== 'CASH' && !(config.bankAccounts || []).length) {
      fail('Faturat jo-cash dhe e-faturat kërkojnë llogarinë bankare të SuperPool. Plotësoni IBAN-in te Integrimi → POS.AL dhe ruani.', 'invalid-argument');
    }
    const body = buildFiscalRequest({ config, invoice, sale, client, options });
    // Pas një prove të dërguar që dështoi, POS.AL mund ta ketë regjistruar porosinë: prova e radhës merr ID të re.
    const sent = Number(invoice.fiscalAttempts || 0);
    if (sent > 0) body.orderId = `${body.orderId}-${sent + 1}`;
    await ref.update({ fiscalAttempts: FieldValue.increment(1) });
    const res = await posal(config, 'POST', '/integrations/invoice', body);
    const fisc = res.fisc || res.data?.fisc || {};
    if (!fisc.iic && !fisc.fic) fail('POS.AL nuk ktheu kodet fiskale (NIVF/NSLF). Kontrolloni faturën te POS.AL para se të provoni sërish.');
    const fiscal = {
      iic: fisc.iic || '', fic: fisc.fic || '', eic: fisc.eic || '', invNum: fisc.invNum || '', url: fisc.url || '',
      issueDateTime: fisc.issueDateTime || '', tcrCode: fisc.tcrCode || '', operatorCode: fisc.operatorCode || '',
      businessUnitCode: fisc.businessUnitCode || '', invoiceType: options.invoiceType, paymentMethod: options.paymentMethod,
      env: config.env || 'prod', request: body, fiscalizedBy: user.uid, fiscalizedByName: user.name,
    };
    const totals = { totPriceWoVAT: fisc.totPriceWoVAT ?? null, totVATAmt: fisc.totVATAmt ?? null, totPrice: fisc.totPrice ?? null };
    await ref.update({
      fiscal: { ...fiscal, ...totals }, fiscalNumber: fiscal.invNum || invoice.fiscalNumber || '', status: 'issued',
      fiscalizing: FieldValue.delete(), fiscalError: FieldValue.delete(), fiscalizedAt: FieldValue.serverTimestamp(),
    });
    await audit(null, { user, action: 'fiscalize', collection: 'invoices', id: invoice.id, label: `${invoice.internalNumber || ''} → ${fiscal.invNum}`, changes: { iic: fiscal.iic, fic: fiscal.fic, type: options.invoiceType } });
    const { request: _request, ...publicFiscal } = fiscal;
    return { fiscalNumber: fiscal.invNum, iic: fiscal.iic, fic: fiscal.fic, eic: fiscal.eic, url: fiscal.url, fiscal: publicFiscal };
  } catch (err) {
    await ref.update({
      fiscalizing: FieldValue.delete(),
      fiscalError: String(err.message || err).slice(0, 900),
      // Kërkesa dhe përgjigja e fundit (pa çelësin API), për të parë pse u refuzua.
      fiscalDebug: err.posal ? JSON.parse(JSON.stringify({ at: new Date().toISOString(), ...err.posal })) : FieldValue.delete(),
    }).catch(() => {});
    throw err;
  }
});

/** PDF-ja zyrtare e e-faturës nga sistemi i tatimeve (base64). */
export const fiscalInvoicePdf = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  const snap = await db.doc(`invoices/${String(request.data?.invoiceId || '')}`).get();
  if (!snap.exists) fail('Fatura nuk ekziston.', 'not-found');
  const inv = snap.data();
  if (!user.caps.has(CAPS.FINANCE) && !user.caps.has(CAPS.REPORTS) && inv.createdBy !== user.uid) fail('Nuk keni akses.', 'permission-denied');
  if (!inv.fiscal?.eic) fail('Kjo faturë nuk është e-faturë (nuk ka NIVE).');
  const config = await loadConfig();
  const res = await posal(config, 'GET', `/integrations/invoice/einvoice/${encodeURIComponent(config.shopId)}/${encodeURIComponent(inv.fiscal.eic)}`);
  const e = res.data?.invoice?.data?.eInvoices?.[0] || res.data?.eInvoices?.[0];
  if (!e?.PDF) fail('Sistemi i tatimeve nuk ktheu PDF-në e e-faturës.');
  return { pdf: e.PDF, status: e.Status || '', docNumber: e.DocNumber || inv.fiscalNumber };
});

/** Anulim me faturë korrigjuese (sasi negative, me referencë te NIVF-ja origjinale). */
export const correctFiscalInvoice = onCall({ region: REGION }, async (request) => {
  const user = await userContext(request);
  requireCap(user, CAPS.FINANCE, CAPS.CHEM_SALES_ALL);
  const { invoiceId, reason = '' } = request.data || {};
  if (!String(reason).trim()) fail('Shkruani arsyen e anulimit.', 'invalid-argument');
  const ref = db.doc(`invoices/${String(invoiceId || '')}`);
  const snap = await ref.get();
  if (!snap.exists) fail('Fatura nuk ekziston.', 'not-found');
  const invoice = { id: snap.id, ...snap.data() };
  if (!invoice.fiscal?.iic || !invoice.fiscal.request) fail('Fatura nuk është fiskalizuar nga SuperPool.');
  if (invoice.correction?.fic) fail('Fatura është korrigjuar më parë.');
  const config = await loadConfig();
  const body = buildCorrectionRequest({ config, invoice, original: invoice.fiscal.request });
  const res = await posal(config, 'POST', '/integrations/invoice', body);
  const fisc = res.fisc || res.data?.fisc || {};
  const correction = {
    iic: fisc.iic || '', fic: fisc.fic || '', eic: fisc.eic || '', invNum: fisc.invNum || '', url: fisc.url || '',
    issueDateTime: fisc.issueDateTime || '', reason: String(reason).slice(0, 500), by: user.uid, byName: user.name,
  };
  await ref.update({ correction, status: 'cancelled', cancelReason: correction.reason, cancelledAt: FieldValue.serverTimestamp() });
  await audit(null, { user, action: 'cancel', collection: 'invoices', id: invoice.id, label: `${invoice.fiscalNumber} → korrigjuese ${correction.invNum}`, note: reason });
  return { fiscalNumber: correction.invNum, iic: correction.iic };
});
