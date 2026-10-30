// PDF-të e ofertës: (A) oferta për klientin, (B) preventivi i brendshëm me kosto dhe marzh.

import { POOL_SECTIONS, POOL_TYPES, UNITS } from '@shared/constants.js';

import { BRAND_NAVY, brandHeader } from './brand.js';
import { loadPdf } from './export.js';
import { date, money as fmtMoney, qty } from './format.js';
import { offerTotals, offerVariables } from './offerCalc.js';
import { offerTextsOf } from './offerTexts.js';
import { call } from './firebase.js';

// Koka dhe fundi me logon SuperPool; fundi vizatohet automatikisht te doc.save().
const header = (doc, company, title, subtitle) => Math.max(32, brandHeader(doc, company, title, subtitle));
const footer = (doc, company) => { doc.brandFooterText = company.offerFooter || ''; };

function ensureSpace(doc, y, needed) {
  if (y + needed > doc.internal.pageSize.getHeight() - 20) {
    doc.addPage();
    return 20;
  }
  return y;
}

function paragraph(doc, title, text, y) {
  if (!text) return y;
  y = ensureSpace(doc, y, 14);
  doc.setFontSize(10.5);
  doc.setTextColor(...BRAND_NAVY);
  doc.text(title, 14, y);
  doc.setTextColor(20);
  doc.setFontSize(9);
  const lines = doc.splitTextToSize(text, doc.internal.pageSize.getWidth() - 28);
  y += 5;
  for (const line of lines) {
    y = ensureSpace(doc, y, 5);
    doc.text(line, 14, y);
    y += 4.3;
  }
  return y + 3;
}

const sectionsOf = (lines) => Object.keys(POOL_SECTIONS).filter((s) => lines.some((l) => (l.section || 'other') === s));

/** Blloku "Përmasat": G × Gj × Th, pastaj sipërfaqja, vëllimi, depoja, totali dhe qarkullimi (VT / orët). */
function poolCalcBlock(doc, offer, v, y, { x = 14, width } = {}) {
  const w = width ?? doc.internal.pageSize.getWidth() - 28;
  const cx = x + w / 2;
  const depth = Number(offer.depthMax) && Number(offer.depthMax) !== Number(offer.depthMin)
    ? `${qty(offer.depthMin)}–${qty(offer.depthMax)}` : qty(offer.depthMin || offer.depthMax);
  const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  doc.setFillColor(143, 179, 222);
  doc.rect(x, y, w, 8, 'F');
  doc.setFont(undefined, 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...BRAND_NAVY);
  doc.text(`Përmasat: ${qty(offer.length)} × ${qty(offer.width)} × ${depth} m`, cx, y + 5.7, { align: 'center' });
  y += 13;
  doc.setTextColor(20);
  doc.setFontSize(10);
  const lines = [
    `Sipërfaqja = ${qty(r2(v.A))} m²`,
    `Vëllimi = ${qty(r2(v.V))} m³`,
    ...(v.D > 0 ? [`Depo = ${qty(r2(v.D))} m³`, `Totali = ${qty(r2(v.VT))} m³`] : []),
    `Qarkullimi = ${qty(r2(v.VT))} m³ / ${qty(v.TH)} orë = ${qty(r2(v.Q))} m³/h`,
  ];
  for (const line of lines) { doc.text(line, cx, y, { align: 'center' }); y += 5.2; }
  doc.setFont(undefined, 'normal');
  const info = [POOL_TYPES[offer.poolType] || '', offer.circulation || ''].filter(Boolean).join(' · ');
  if (info) {
    doc.setFontSize(8.5);
    doc.setTextColor(90);
    doc.text(doc.splitTextToSize(info, w), cx, y + 0.5, { align: 'center' });
    doc.setTextColor(20);
    y += 5;
  }
  return y + 2;
}

// Fonti standard i PDF-së njeh vetëm shkronjat latine (WinAnsi): hapësirat e veçanta dhe emoji-t pastrohen.
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export const pdfText = (s) => String(s ?? '')
  .replace(/[  -​  　]/g, ' ')
  .replace(/μ/g, 'µ')
  .replace(/[−]/g, '-')
  .replace(/[^\n\r\t\x20-\xff]/g, (ch) => (WIN_ANSI_EXTRA.includes(ch) ? ch : ''))
  .replace(/[ \t]+\n/g, '\n')
  .replace(/^[ \t]+/gm, (m) => (m.length > 2 ? '  ' : ''));

/** Fotot e rreshtave (Storage) → dataURL me përmasat, përmes serverit (pa CORS). */
async function loadLineImages(paths) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  // Fotot kërkohen në grupe të vogla: një përgjigje e vetme me dhjetëra foto kalon kufirin e serverit.
  const chunks = [];
  for (let i = 0; i < unique.length; i += 8) chunks.push(unique.slice(i, i + 8));
  const res = {};
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, async () => {
    while (next < chunks.length) {
      const chunk = chunks[next];
      next += 1;
      try {
        Object.assign(res, await call('loadImages', { paths: chunk }));
      } catch (err) {
        console.warn('Fotot nuk u lexuan', chunk, err);
      }
    }
  }));
  // Çdo foto zvogëlohet (maks. 600 px) që PDF-ja të mbetet e lehtë edhe me shumë artikuj.
  const out = {};
  await Promise.all(Object.entries(res).map(([p, { type, data }]) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 600 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      out[p] = { url: canvas.toDataURL('image/jpeg', 0.82), w: canvas.width, h: canvas.height, format: 'JPEG' };
      resolve();
    };
    img.onerror = () => resolve();
    img.src = `data:${type};base64,${data}`;
  })));
  return out;
}

const imagePathsOf = (line, product) => {
  const own = (line.images || []).map((im) => im.path).filter(Boolean);
  if (own.length) return own.slice(0, 3);
  const p = product?.imagePaths;
  return p?.length ? [p[1] || p[0]] : [];
};

/** Paragraf me titull (opsional) dhe tekst; rreshti i parë mund të jetë titull i theksuar. */
function textBlock(doc, text, y, { title, firstLineTitle = false, size = 9, color = 20 } = {}) {
  const t = pdfText(text).trim();
  if (!t) return y;
  const w = doc.internal.pageSize.getWidth() - 28;
  let body = t;
  if (title || firstLineTitle) {
    const head = title || t.split('\n')[0];
    if (firstLineTitle) body = t.split('\n').slice(1).join('\n');
    y = ensureSpace(doc, y, 14);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...BRAND_NAVY);
    doc.text(head, 14, y);
    doc.setFont(undefined, 'normal');
    y += 5;
  }
  doc.setFontSize(size);
  doc.setTextColor(color);
  for (const para of body.split('\n')) {
    for (const line of doc.splitTextToSize(para, w)) {
      y = ensureSpace(doc, y, 5);
      doc.text(line, 14, y);
      y += size * 0.47;
    }
  }
  doc.setTextColor(20);
  return y + 3;
}

/** Termat / manuali: rreshtat-titull (me shkronja të mëdha ose "1. …") theksohen. */
function headedText(doc, title, text, y) {
  const t = pdfText(text).trim();
  if (!t) return y;
  const w = doc.internal.pageSize.getWidth() - 28;
  y = ensureSpace(doc, y, 20);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...BRAND_NAVY);
  doc.text(title, 14, y);
  y += 7;
  for (const raw of t.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const isHead = (line === line.toUpperCase() && /[A-ZËÇ]{3}/.test(line) && line.length < 80) || /^\d+\.\s+\S/.test(line);
    doc.setFont(undefined, isHead ? 'bold' : 'normal');
    doc.setFontSize(isHead ? 9.5 : 8.8);
    doc.setTextColor(...(isHead ? BRAND_NAVY : [30, 30, 30]));
    if (isHead) y += 1.5;
    for (const part of doc.splitTextToSize(line, w - (isHead ? 0 : 4))) {
      y = ensureSpace(doc, y, 5);
      doc.text(part, isHead ? 14 : 18, y);
      y += 4.3;
    }
  }
  doc.setFont(undefined, 'normal');
  doc.setTextColor(20);
  return y + 4;
}

/** (A) Oferta për klientin — sipas formatit të ofertave Excel të SuperPool (pa kosto, pa marzh). */
export async function clientOfferPdf(offer, company, client, { productsById = {} } = {}) {
  // Shumat në monedhën e ofertës (L ose €).
  const money = (v) => fmtMoney(v, offer.currency === 'EUR' ? 'EUR' : 'ALL');
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const t = offerTotals(offer);
  const v = offerVariables(offer);
  const texts = offerTextsOf(offer, company);
  const visible = (offer.lines || []).filter((l) => l.showOnClient !== false && Number(l.qty) > 0);
  const images = await loadLineImages(visible.flatMap((l) => imagePathsOf(l, productsById[l.productId])));
  let y = header(doc, company, 'OFERTË', `Nr. ${offer.number || ''} · ${date(offer.date)}`);

  // Majtas: kompania dhe klienti; djathtas: përmasat dhe llogaritjet e pishinës.
  const colW = (W - 28 - 8) / 2;
  let yl = y + 2;
  doc.setFontSize(9.5);
  doc.setFont(undefined, 'bold');
  doc.text(pdfText(company.name || 'SuperPool'), 14, yl);
  doc.setFont(undefined, 'normal');
  for (const line of [company.address, company.nipt && `NIPT ${company.nipt}`].filter(Boolean)) { yl += 4.6; doc.text(pdfText(line), 14, yl); }
  yl += 9;
  doc.setTextColor(...BRAND_NAVY);
  doc.setFont(undefined, 'bold');
  doc.text('Ofertë për klientin:', 14, yl);
  doc.setTextColor(20);
  doc.setFontSize(11);
  yl += 5.5;
  doc.text(doc.splitTextToSize(pdfText(offer.clientName || client?.name || ''), colW), 14, yl);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9.5);
  const clientLines = [client?.nipt && `NIPT ${client.nipt}`, offer.location || client?.city, client?.phone, offer.projectName && `Projekti: ${offer.projectName}`, offer.validUntil && `E vlefshme deri më ${date(offer.validUntil)}`].filter(Boolean);
  for (const line of clientLines) { yl += 4.8; doc.text(pdfText(line), 14, yl); }
  const yr = poolCalcBlock(doc, offer, v, y, { x: 14 + colW + 8, width: colW });
  y = Math.max(yl + 6, yr + 2);

  y = textBlock(doc, texts.standard, y, { firstLineTitle: true });
  y = textBlock(doc, texts.company, y, { size: 8.8, color: 60 });
  const days = offer.validUntil && offer.date ? Math.max(1, Math.round((Date.parse(offer.validUntil) - Date.parse(offer.date)) / 86400000)) : (company.offerValidityDays || 30);
  y = textBlock(doc, String(texts.intro || '').replace(/\{dit[eë]\}/gi, String(days)), y);
  y = paragraph(doc, 'Zgjidhja teknike', pdfText(offer.technicalText), y);
  y = paragraph(doc, 'Sistemi i qarkullimit dhe filtrimit', pdfText(offer.filtration), y);

  // Tabela: NR | PËRSHKRIMI (titulli + teksti teknik) | FOTO | NJËSIA | SASIA (+ çmimet nëse zgjidhen).
  const prices = Boolean(offer.showLinePrices) && !(Number(offer.manualSubtotal) > 0);
  const head = [['NR.', 'PËRSHKRIMI', 'FOTO', 'NJËSIA', 'SASIA', ...(prices ? ['ÇMIMI', 'VLERA'] : [])]];
  const body = [];
  const rowImages = [];
  visible.forEach((l, i) => {
    const product = productsById[l.productId];
    const imgs = imagePathsOf(l, product).map((p) => images[p]).filter(Boolean);
    const details = pdfText(l.details || '').trim();
    const titleText = pdfText(l.description || product?.name || '').trim();
    const span = details ? 2 : 1;
    const cell = (content, styles = {}) => ({ content, rowSpan: span, styles: { valign: 'middle', ...styles } });
    body.push([
      cell(String(i + 1), { halign: 'center' }),
      { content: titleText, styles: { fontStyle: 'bold' } },
      cell('', { minCellHeight: imgs.length ? 30 : 8 }),
      cell(UNITS[l.unit] || l.unit || '', { halign: 'center' }),
      cell(qty(l.qty), { halign: 'center' }),
      ...(prices ? [cell(money(l.unitPrice), { halign: 'right' }), cell(money(Number(l.qty) * Number(l.unitPrice)), { halign: 'right' })] : []),
    ]);
    rowImages.push(imgs);
    if (details) {
      body.push([{ content: details, styles: { fontSize: 7.6, textColor: [55, 55, 55] } }]);
      rowImages.push(null);
    }
  });
  y = ensureSpace(doc, y, 30);
  autoTable(doc, {
    startY: y,
    head,
    body,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 1.6, lineColor: [205, 214, 224], lineWidth: 0.2, overflow: 'linebreak' },
    headStyles: { fillColor: BRAND_NAVY, textColor: 255, halign: 'center' },
    columnStyles: {
      0: { cellWidth: 10 }, 2: { cellWidth: 36 }, 3: { cellWidth: 18 }, 4: { cellWidth: 15 },
      ...(prices ? { 5: { cellWidth: 24 }, 6: { cellWidth: 26 } } : {}),
    },
    didDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 2) return;
      const imgs = rowImages[data.row.index];
      if (!imgs?.length) return;
      const { x, y: cy, width, height } = data.cell;
      const n = imgs.length;
      const pad = 1.5;
      const slotW = (width - pad * (n + 1)) / n;
      const slotH = height - pad * 2;
      imgs.forEach((im, k) => {
        const scale = Math.min(slotW / im.w, slotH / im.h);
        const w = im.w * scale;
        const h = im.h * scale;
        try {
          doc.addImage(im.url, im.format, x + pad + k * (slotW + pad) + (slotW - w) / 2, cy + pad + (slotH - h) / 2, w, h);
        } catch { /* foto e palexueshme */ }
      });
    },
  });
  y = doc.lastAutoTable.finalY + 4;

  y = paragraph(doc, 'Pajisje të tjera', pdfText(offer.equipmentText), y);
  y = paragraph(doc, 'Shërbimet', pdfText(offer.servicesText), y);

  // Totalet si në Excel: TOTAL PA TVSH / TVSH / ME TVSH.
  y = ensureSpace(doc, y, 34);
  const totals = [['TOTAL PA TVSH', money(t.subtotal)]];
  if (t.discount) totals.push([`ZBRITJE (${offer.discountPct}%)`, `- ${money(t.discount)}`], ['PAS ZBRITJES', money(t.net)]);
  totals.push([`TOTAL TVSH (${offer.vatPct}%)`, money(t.vat)], ['TOTAL ME TVSH', money(t.total)]);
  autoTable(doc, {
    startY: y,
    margin: { left: W - 14 - 95 },
    tableWidth: 95,
    theme: 'grid',
    body: totals,
    styles: { fontSize: 10, cellPadding: 1.8, fontStyle: 'bold', lineColor: [205, 214, 224], lineWidth: 0.2 },
    columnStyles: { 1: { halign: 'right' } },
    didParseCell: (data) => {
      if (data.row.index === totals.length - 1) {
        data.cell.styles.fillColor = BRAND_NAVY;
        data.cell.styles.textColor = 255;
      }
    },
  });
  doc.setFont(undefined, 'bolditalic');
  doc.setFontSize(12);
  doc.setTextColor(...BRAND_NAVY);
  doc.text('Faleminderit!', 14, y + 8);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(20);
  y = doc.lastAutoTable.finalY + 7;

  // Kushtet e pagesës dhe të dhënat bankare krah për krah.
  y = ensureSpace(doc, y, 30);
  autoTable(doc, {
    startY: y,
    theme: 'plain',
    head: [['KUSHTET E PAGESËS', 'TË DHËNAT BANKARE']],
    body: [[pdfText(texts.payment), pdfText(texts.bank)]],
    styles: { fontSize: 8.8, cellPadding: 1.8 },
    headStyles: { fillColor: [143, 179, 222], textColor: BRAND_NAVY, fontStyle: 'bold' },
  });
  y = doc.lastAutoTable.finalY + 5;
  y = paragraph(doc, 'Afati i realizimit', pdfText(offer.deliveryTerm), y);
  y = paragraph(doc, 'Shënime', pdfText(offer.clientNotes), y);

  y = ensureSpace(doc, y, 24);
  doc.setFontSize(9);
  doc.line(14, y + 10, 80, y + 10);
  doc.text(pdfText(`Për ${company.name || 'SuperPool'}`), 14, y + 14.5);
  doc.line(W - 80, y + 10, W - 14, y + 10);
  doc.text('Pranoi klienti', W - 80, y + 14.5);
  y += 20;
  if (texts.contact) {
    doc.setFontSize(8.5);
    doc.setTextColor(...BRAND_NAVY);
    doc.text(doc.splitTextToSize(pdfText(texts.contact), W - 28), W / 2, y, { align: 'center' });
    doc.setTextColor(20);
  }

  // Termat e bashkëpunimit dhe manuali i pishinës, në faqe të veçantë.
  if (offer.includeTerms !== false && texts.terms) {
    doc.addPage();
    y = headedText(doc, 'Termat e Bashkëpunimit dhe Garancisë së Pajisjeve', texts.terms, 20);
  }
  if (offer.includeManual !== false && texts.manual) {
    if (offer.includeTerms === false || !texts.terms) { doc.addPage(); y = 20; }
    y = headedText(doc, 'MANUALI I PISHINËS', texts.manual, y + 2);
  }

  footer(doc, company);
  doc.save(`Oferta_${offer.number || 'e-re'}.pdf`);
}

/** (B) Preventivi i brendshëm — kosto, furnitorë, nevojat për porosi dhe marzhi. */
export async function internalEstimatePdf(offer, company, { productsById, suppliersById, freeQtyOf }) {
  // Shumat në monedhën e ofertës (L ose €).
  const money = (v) => fmtMoney(v, offer.currency === 'EUR' ? 'EUR' : 'ALL');
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const t = offerTotals(offer);
  let y = header(doc, company, 'PREVENTIV I BRENDSHËM', `${offer.number} · ${offer.clientName} · KONFIDENCIAL`);

  const body = [];
  const lines = offer.lines || [];
  for (const s of sectionsOf(lines)) {
    const sectionLines = lines.filter((x) => (x.section || 'other') === s);
    const sc = sectionLines.reduce((a, l) => a + l.qty * l.unitCost, 0);
    const sp = sectionLines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
    body.push([{ content: POOL_SECTIONS[s], colSpan: 6, styles: { fontStyle: 'bold', fillColor: [234, 243, 250] } },
      { content: money(sc), styles: { fontStyle: 'bold', halign: 'right', fillColor: [234, 243, 250] } },
      { content: '', styles: { fillColor: [234, 243, 250] } },
      { content: money(sp), styles: { fontStyle: 'bold', halign: 'right', fillColor: [234, 243, 250] } },
      { content: '', colSpan: 2, styles: { fillColor: [234, 243, 250] } }]);
    for (const l of sectionLines) {
      const p = l.productId ? productsById[l.productId] : null;
      const free = p ? freeQtyOf(p) : null;
      const toOrder = p ? Math.max(0, Number(l.qty) - Math.max(0, free)) : null;
      body.push([
        l.code || '', l.description, l.formula || '', qty(l.qty), UNITS[l.unit] || l.unit,
        money(l.unitCost), money(l.qty * l.unitCost), money(l.unitPrice), money(l.qty * l.unitPrice),
        p ? suppliersById[p.supplierId]?.name || p.supplierName || '' : '',
        p ? `${qty(free)} / ${toOrder ? qty(toOrder) : '–'}` : '',
      ]);
    }
  }
  autoTable(doc, {
    startY: y,
    head: [['Kodi', 'Përshkrimi', 'Formula', 'Sasia', 'Nj.', 'Kosto nj.', 'Kosto', 'Çmimi nj.', 'Vlera', 'Furnitori', 'E lirë / porosit']],
    body,
    styles: { fontSize: 7.5, cellPadding: 1.2 },
    headStyles: { fillColor: BRAND_NAVY },
    columnStyles: {
      3: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 10: { halign: 'right' },
    },
  });
  y = doc.lastAutoTable.finalY + 6;
  y = ensureSpace(doc, y, 45);
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    tableWidth: 120,
    styles: { fontSize: 9.5, cellPadding: 1.5 },
    columnStyles: { 1: { halign: 'right' } },
    body: [
      ['Kosto totale (materiale + shërbime)', money(t.cost)],
      ['Vlera e ofertës pa TVSH (pas zbritjes)', money(t.net)],
      ['Marzhi', money(t.margin)],
      ['Marzhi në %', `${t.marginPct}%`],
      ['Vlera me TVSH', money(t.total)],
    ],
  });
  if (offer.notesInternal) paragraph(doc, 'Shënime të brendshme', offer.notesInternal, doc.lastAutoTable.finalY + 8);
  footer(doc, { ...company, offerFooter: 'Dokument i brendshëm — mos ia dërgoni klientit.' });
  doc.save(`Preventiv_${offer.number}.pdf`);
}
