// PDF për dokumentet e magazinës (fletëhyrje, fletëdalje, kthim...) me vend për firma.

import { CONDITIONS, MOVEMENT_KINDS, MOVEMENT_STATUS, UNITS } from '@shared/constants.js';

import { loadPdf } from './export.js';
import { date, money, qty } from './format.js';

export function companyHeader(doc, company, title, subtitle) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(11, 111, 164);
  doc.rect(0, 0, w, 4, 'F');
  doc.setFontSize(15);
  doc.setTextColor(11, 84, 125);
  doc.text(company.name || 'SuperPool', 14, 16);
  doc.setFontSize(8);
  doc.setTextColor(90);
  const info = [company.tagline, company.address, [company.phone, company.email].filter(Boolean).join(' · '), company.nipt ? `NIPT: ${company.nipt}` : '']
    .filter(Boolean);
  info.forEach((line, i) => doc.text(line, 14, 21 + i * 3.8));
  doc.setFontSize(14);
  doc.setTextColor(20);
  doc.text(title, w - 14, 16, { align: 'right' });
  if (subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(subtitle, w - 14, 21, { align: 'right' });
  }
  doc.setTextColor(20);
  return 21 + info.length * 3.8 + 4;
}

export async function movementPdf({ movement, company, costs, extra = {} }) {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const def = MOVEMENT_KINDS[movement.kind];
  let y = companyHeader(doc, company, def?.label || 'Dokument', `${movement.number} · ${date(movement.date)}`);

  const meta = [
    ['Nga', movement.sourceName],
    ['Drejt', movement.destName],
    extra.project && ['Projekti', extra.project],
    extra.vehicle && ['Automjeti', extra.vehicle],
    extra.employee && ['Punonjësi përgjegjës', extra.employee],
    extra.authorizedBy && ['Autorizuar nga', extra.authorizedBy],
    extra.supplier && ['Furnitori', extra.supplier],
    extra.client && ['Klienti', extra.client],
    movement.fiscalRef && ['Nr. fature / dok. fiskal', movement.fiscalRef],
    ['Statusi', MOVEMENT_STATUS[movement.status]],
    ['Regjistruar nga', movement.createdByName],
    movement.confirmedByName && ['Konfirmuar nga', movement.confirmedByName],
  ].filter(Boolean);
  autoTable(doc, {
    startY: y,
    body: meta,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 0.8 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 48 } },
  });
  y = doc.lastAutoTable.finalY + 4;

  const showCond = movement.kind === 'return';
  const showCost = Boolean(costs);
  const head = ['#', 'Kodi', 'Artikulli', 'Njësia', 'Sasia', showCond && 'Gjendja', showCost && 'Kosto', showCost && 'Vlera', 'Shënim'].filter(Boolean);
  const body = (movement.lines || []).map((l, i) => [
    i + 1, l.code, l.name, UNITS[l.unit] || l.unit, qty(l.qty),
    showCond && CONDITIONS[l.condition || 'good'],
    showCost && money(costs[i] || 0),
    showCost && money((costs[i] || 0) * l.qty),
    l.note || '',
  ].filter((v) => v !== false));
  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    styles: { fontSize: 8.5, cellPadding: 1.5 },
    headStyles: { fillColor: [11, 111, 164] },
  });
  y = doc.lastAutoTable.finalY + 6;
  if (movement.notes) {
    doc.setFontSize(9);
    doc.text(doc.splitTextToSize(`Shënime: ${movement.notes}`, 180), 14, y);
    y += 10;
  }
  const h = doc.internal.pageSize.getHeight();
  if (y > h - 40) { doc.addPage(); y = 30; }
  doc.setFontSize(9);
  const sig = ['Dorëzoi', 'Mori në dorëzim', 'Autorizoi'];
  sig.forEach((label, i) => {
    const x = 14 + i * 64;
    doc.line(x, y + 18, x + 54, y + 18);
    doc.text(label, x, y + 23);
  });
  doc.save(`${movement.number}.pdf`);
}
