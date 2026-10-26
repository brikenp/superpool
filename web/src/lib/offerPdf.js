// PDF-të e ofertës: (A) oferta për klientin, (B) preventivi i brendshëm me kosto dhe marzh.

import { POOL_SECTIONS, POOL_TYPES, UNITS } from '@shared/constants.js';

import { BRAND_NAVY, brandHeader } from './brand.js';
import { loadPdf } from './export.js';
import { date, money, qty } from './format.js';
import { offerTotals, offerVariables } from './offerCalc.js';

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

/** (A) Oferta për klientin — pa kosto, pa marzh. */
export async function clientOfferPdf(offer, company, client) {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const t = offerTotals(offer);
  const v = offerVariables(offer);
  let y = header(doc, company, 'OFERTË', `Nr. ${offer.number} · ${date(offer.date)}`);

  autoTable(doc, {
    startY: y,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 0.9 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 34 }, 2: { fontStyle: 'bold', cellWidth: 34 } },
    body: [
      ['Klienti', offer.clientName || '', 'Projekti', offer.projectName || ''],
      ['NIPT / ID', client?.nipt || '', 'Vendndodhja', offer.location || ''],
      ['Telefoni', client?.phone || '', 'Vlefshmëria', offer.validUntil ? `deri më ${date(offer.validUntil)}` : ''],
    ],
  });
  y = doc.lastAutoTable.finalY + 5;

  doc.setFontSize(10.5);
  doc.setTextColor(...BRAND_NAVY);
  doc.text('Të dhënat e pishinës', 14, y);
  doc.setTextColor(20);
  autoTable(doc, {
    startY: y + 2,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 1.6 },
    headStyles: { fillColor: BRAND_NAVY },
    head: [['Lloji', 'Përmasat (G × Gj)', 'Thellësia', 'Sipërfaqja', 'Vëllimi i ujit', 'Qarkullimi']],
    body: [[
      POOL_TYPES[offer.poolType] || offer.poolType || '',
      `${qty(offer.length)} × ${qty(offer.width)} m`,
      Number(offer.depthMax) && Number(offer.depthMax) !== Number(offer.depthMin) ? `${qty(offer.depthMin)} – ${qty(offer.depthMax)} m` : `${qty(offer.depthMin)} m`,
      `${qty(v.A)} m²`,
      `${qty(offer.volumeManual ? offer.volume : v.V)} m³`,
      offer.circulation || '',
    ]],
  });
  y = doc.lastAutoTable.finalY + 6;

  y = paragraph(doc, 'Zgjidhja teknike', offer.technicalText, y);
  y = paragraph(doc, 'Sistemi i qarkullimit dhe filtrimit', offer.filtration, y);

  const visible = (offer.lines || []).filter((l) => l.showOnClient !== false && Number(l.qty) > 0);
  const body = [];
  for (const s of sectionsOf(visible)) {
    body.push([{ content: POOL_SECTIONS[s], colSpan: offer.showLinePrices ? 5 : 3, styles: { fontStyle: 'bold', fillColor: [234, 243, 250] } }]);
    for (const l of visible.filter((x) => (x.section || 'other') === s)) {
      const row = [l.description, qty(l.qty), UNITS[l.unit] || l.unit];
      if (offer.showLinePrices) row.push(money(l.unitPrice), money(Number(l.qty) * Number(l.unitPrice)));
      body.push(row);
    }
  }
  y = ensureSpace(doc, y, 20);
  doc.setFontSize(10.5);
  doc.setTextColor(...BRAND_NAVY);
  doc.text('Pajisjet, materialet dhe shërbimet që përfshihen', 14, y);
  doc.setTextColor(20);
  autoTable(doc, {
    startY: y + 2,
    head: [offer.showLinePrices ? ['Përshkrimi', 'Sasia', 'Njësia', 'Çmimi', 'Vlera'] : ['Përshkrimi', 'Sasia', 'Njësia']],
    body,
    styles: { fontSize: 8.5, cellPadding: 1.4 },
    headStyles: { fillColor: BRAND_NAVY },
    columnStyles: { 1: { halign: 'right', cellWidth: 20 }, 2: { cellWidth: 18 }, 3: { halign: 'right', cellWidth: 28 }, 4: { halign: 'right', cellWidth: 30 } },
  });
  y = doc.lastAutoTable.finalY + 4;

  y = paragraph(doc, 'Pajisje të tjera', offer.equipmentText, y);
  y = paragraph(doc, 'Shërbimet', offer.servicesText, y);

  y = ensureSpace(doc, y, 40);
  const w = doc.internal.pageSize.getWidth();
  const totals = [['Vlera', money(t.subtotal)]];
  if (t.discount) totals.push([`Zbritje (${offer.discountPct}%)`, `- ${money(t.discount)}`], ['Vlera pas zbritjes', money(t.net)]);
  totals.push([`TVSH (${offer.vatPct}%)`, money(t.vat)], ['VLERA TOTALE', money(t.total)]);
  autoTable(doc, {
    startY: y,
    margin: { left: w - 14 - 90 },
    tableWidth: 90,
    theme: 'plain',
    body: totals,
    styles: { fontSize: 10, cellPadding: 1.4 },
    columnStyles: { 1: { halign: 'right' } },
    didParseCell: (data) => {
      if (data.row.index === totals.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = BRAND_NAVY;
        data.cell.styles.textColor = 255;
      }
    },
  });
  y = doc.lastAutoTable.finalY + 6;

  y = paragraph(doc, 'Kushtet e pagesës', offer.paymentTerms, y);
  y = paragraph(doc, 'Afati i realizimit', offer.deliveryTerm, y);
  y = paragraph(doc, 'Shënime', offer.clientNotes, y);

  y = ensureSpace(doc, y, 30);
  doc.setFontSize(9);
  doc.line(14, y + 16, 80, y + 16);
  doc.text(`Për ${company.name || 'SuperPool'}`, 14, y + 21);
  doc.line(w - 80, y + 16, w - 14, y + 16);
  doc.text('Pranoi klienti', w - 80, y + 21);

  footer(doc, company);
  doc.save(`Oferta_${offer.number}.pdf`);
}

/** (B) Preventivi i brendshëm — kosto, furnitorë, nevojat për porosi dhe marzhi. */
export async function internalEstimatePdf(offer, company, { productsById, suppliersById, freeQtyOf }) {
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
