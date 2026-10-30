// Importi i një oferte Excel (vetëm fleta e parë): qelizat, fotot e kolonës FOTO dhe krijimi i ofertës.

import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';

import { parseOfferSheet } from '@shared/offerExcel.js';
import { drawingPathOf, firstSheetPaths, parseDrawingImages, parseSharedStrings, parseSheetCells } from '@shared/xlsxLite.js';

import { call, db, storage } from './firebase.js';
import { addDays, todayISO } from './format.js';
import { resizeImage } from './images.js';
import { newKey, offerTotals } from './offerCalc.js';
import { OFFER_TEXT_DEFAULTS } from './offerTexts.js';

const MAX_PHOTOS_PER_LINE = 3;

/** Lexon fletën e parë të skedarit: oferta e analizuar + fotot për çdo rresht artikulli. */
export async function readOfferExcel(file) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const txt = async (p) => (p && zip.file(p) ? zip.file(p).async('string') : '');
  const { sheetPath, sheetRelsPath, name } = firstSheetPaths(await txt('xl/workbook.xml'), await txt('xl/_rels/workbook.xml.rels'));
  const cells = parseSheetCells(await txt(sheetPath), parseSharedStrings(await txt('xl/sharedStrings.xml')));
  const offer = parseOfferSheet(cells);
  const drawing = drawingPathOf(sheetPath, await txt(sheetRelsPath));
  const anchors = drawing ? parseDrawingImages(drawing, await txt(drawing), await txt(drawing.replace(/([^/]+)$/, '_rels/$1.rels'))) : [];
  // Fotot e kolonës FOTO, sipas rreshtit ku fillojnë (pa dyfishime).
  const photos = {};
  for (const a of anchors) {
    if (a.col !== offer.photoCol) continue;
    const list = (photos[a.row] ||= []);
    if (!list.includes(a.media) && list.length < MAX_PHOTOS_PER_LINE) list.push(a.media);
  }
  const loadPhoto = async (media) => {
    const bytes = await zip.file(media)?.async('uint8array');
    if (!bytes) return null;
    const ext = media.split('.').pop().toLowerCase();
    return new Blob([bytes], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
  };
  return { sheetName: name, offer, photos, loadPhoto };
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Krijon ofertën nga skedari i lexuar: gjen ose krijon klientin, ruan rreshtat me sasi, totalin, tekstet
 * dhe ngarkon fotot. Kthen id-në e ofertës.
 */
export async function createOfferFromExcel(parsed, { clients, company, uid, userName, currency = 'EUR', exchangeRate = 1, includeZero = false, onProgress = () => {} }) {
  const { offer: x, photos, loadPhoto } = parsed;
  // Klienti: me emër ose emër tregtar; përndryshe krijohet.
  let clientId = clients.find((c) => norm(c.name) === norm(x.client.name) || (c.tradeName && norm(c.tradeName) === norm(x.client.name)))?.id;
  if (!clientId && x.client.name) {
    clientId = (await addDoc(collection(db, 'clients'), {
      name: x.client.name, tradeName: '', type: 'individual', city: x.client.city || '', nipt: '', phone: '', email: '',
      notes: 'Krijuar nga importi i ofertës Excel', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })).id;
  }
  if (!clientId) throw new Error('Te skedari nuk u gjet emri i klientit (poshtë «Oferte per klientin»).');

  const items = x.items.filter((i) => includeZero || i.qty > 0);
  const lines = items.map((i) => ({
    key: newKey(), section: 'other', productId: null, code: '', description: i.title, details: i.details, unit: i.unit,
    formula: '', qty: i.qty, unitCost: 0, unitPrice: i.unitPrice || 0, showOnClient: true, images: [], excelRow: i.row,
  }));
  const d = x.dims;
  const depth = d.depthMin || 1.5;
  const calcVolume = (d.length || 0) * (d.width || 0) * depth;
  const days = x.validDays || Number(company.offerValidityDays || 30);
  const data = {
    status: 'draft', date: todayISO(), validUntil: addDays(todayISO(), days),
    clientId, clientName: x.client.name, projectName: '', location: [x.client.city, x.client.country].filter(Boolean).join(', '),
    poolType: 'skimmer', circulation: '', length: d.length || 0, width: d.width || 0, depthMin: depth, depthMax: d.depthMax || depth,
    volume: d.volume || '', volumeManual: Boolean(d.volume && Math.abs(d.volume - calcVolume) > 0.5),
    tankPct: d.tank && d.volume ? Math.round((d.tank / d.volume) * 10000) / 100 : 0, turnoverHours: d.turnoverHours || 4,
    technicalText: '', filtration: '', equipmentText: '', servicesText: '',
    paymentTerms: x.texts.payment || company.defaultPaymentTerms || OFFER_TEXT_DEFAULTS.payment,
    deliveryTerm: company.defaultDeliveryTerm || '', clientNotes: '',
    texts: {
      standard: x.texts.standard ?? OFFER_TEXT_DEFAULTS.standard,
      company: x.texts.company ?? OFFER_TEXT_DEFAULTS.company,
      intro: x.texts.intro ?? OFFER_TEXT_DEFAULTS.intro,
      bank: x.texts.bank ?? (company.bankInfo || OFFER_TEXT_DEFAULTS.bank),
      contact: company.offerTexts?.contact ?? OFFER_TEXT_DEFAULTS.contact,
      terms: x.texts.terms ?? OFFER_TEXT_DEFAULTS.terms,
      manual: x.texts.manual ?? OFFER_TEXT_DEFAULTS.manual,
    },
    discountPct: 0, vatPct: x.vatPct ?? 20, showLinePrices: false, notesInternal: `Importuar nga Excel: ${parsed.fileName || ''}`.trim(),
    manualSubtotal: x.subtotal || '', currency, exchangeRate: currency === 'EUR' ? exchangeRate : 1,
    lines, includeTerms: true, includeManual: true,
  };
  data.totals = offerTotals(data);
  const { number } = await call('allocateNumber', { prefix: 'OF' });
  const ref = await addDoc(collection(db, 'offers'), { ...data, number, source: 'excel', createdBy: uid, createdByName: userName || '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });

  // Fotot: zvogëlohen dhe ngarkohen te offers/<id>/, pastaj lidhen me rreshtat.
  const jobs = lines.flatMap((l, li) => (photos[l.excelRow] || []).map((media, k) => ({ li, k, media })));
  let done = 0;
  for (const j of jobs) {
    onProgress(`Duke ngarkuar fotot: ${done + 1} / ${jobs.length}`);
    try {
      const blob = await loadPhoto(j.media);
      if (blob) {
        const small = await resizeImage(blob, 700, 0.85);
        const path = `offers/${ref.id}/r${lines[j.li].excelRow}-${j.k + 1}.jpg`;
        await uploadBytes(storageRef(storage, path), small, { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000' });
        lines[j.li].images.push({ path, url: await getDownloadURL(storageRef(storage, path)) });
      }
    } catch (err) {
      console.warn('Fotoja nuk u ngarkua', j.media, err);
    }
    done += 1;
  }
  if (jobs.length) await updateDoc(doc(db, 'offers', ref.id), { lines, updatedAt: serverTimestamp() });
  onProgress('');
  return { id: ref.id, number, photos: done, lines: lines.length };
}
