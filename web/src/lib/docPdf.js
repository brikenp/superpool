// PDF për dokumentet e magazinës (fletëhyrje, fletëdalje, kthim...) me vend për firma.

import { CONDITIONS, MOVEMENT_KINDS, MOVEMENT_STATUS, UNITS } from '@shared/constants.js';

import { brandHeader } from './brand.js';
import { loadPdf } from './export.js';
import { date, money, qty } from './format.js';

/** Koka e dokumenteve (me logon SuperPool). */
export function companyHeader(doc, company, title, subtitle) {
  return brandHeader(doc, company, title, subtitle);
}

export async function movementPdf({ movement, company, costs, extra = {} }) {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const def = MOVEMENT_KINDS[movement.kind];
  // Emri i dokumentit siç printohet: fletëhyrje për çdo hyrje në magazinë, fletëdalje për çdo dalje.
  const title = { purchase: 'FLETËHYRJE', customer_return: 'FLETËHYRJE', return: 'FLETËHYRJE (KTHIM)', issue: 'FLETËDALJE', agent_issue: 'FLETËDALJE', production: 'FLETË PRODHIMI', supplier_return: 'FLETËDALJE (KTHIM TE FURNITORI)', transfer: 'FLETË TRANSFERIMI' }[movement.kind];
  let y = companyHeader(doc, company, title || def?.label || 'Dokument', `${title ? `${def?.label} · ` : ''}${movement.number} · ${date(movement.date)}`);

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
  const isProd = movement.kind === 'production';
  const head = ['#', 'Kodi', 'Artikulli', 'Njësia', 'Sasia', isProd && 'Lëvizja', showCond && 'Gjendja', showCost && 'Kosto', showCost && 'Vlera', 'Shënim'].filter(Boolean);
  const body = (movement.lines || []).map((l, i) => [
    i + 1, l.code, l.name, UNITS[l.unit] || l.unit, qty(l.qty),
    isProd && (l.sourceId === 'v_production' ? 'Prodhuar (hyn)' : 'Material (del)'),
    showCond && CONDITIONS[l.condition || 'good'],
    showCost && money(costs[i] || 0),
    showCost && money((costs[i] || 0) * l.qty),
    l.note || '',
  ].filter((v) => v !== false));
  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    foot: showCost ? [head.map((h, i) => (i === 0 ? 'Totali' : h === 'Vlera' ? money((movement.lines || []).reduce((s, l, k) => s + (costs[k] || 0) * l.qty, 0)) : ''))] : undefined,
    footStyles: { fillColor: [235, 242, 247], textColor: 20, fontStyle: 'bold' },
    styles: { fontSize: 8.5, cellPadding: 1.5 },
    headStyles: { fillColor: [25, 46, 65] },
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
