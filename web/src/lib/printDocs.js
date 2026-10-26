// PDF për printim direkt nga listat: faturat, mandatet e arkëtimit dhe fletëhyrjet/fletëdaljet.

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

import { PAYMENT_METHODS, UNITS } from '@shared/constants.js';

import { brandHeader } from './brand.js';
import { movementPdf } from './docPdf.js';
import { loadPdf } from './export.js';
import { db } from './firebase.js';
import { date, money, qty } from './format.js';

const NAVY = [25, 46, 65];
const INVOICE_TYPES = { advance: 'Paradhënie', partial: 'Situacion / faturë e pjesshme', final: 'Faturë përfundimtare', other: 'Faturë' };

const safeGet = async (path) => {
  try { const s = await getDoc(doc(db, path)); return s.exists() ? { id: s.id, ...s.data() } : null; } catch { return null; }
};

// --- Shuma me fjalë (shqip) ---
const ONES = ['', 'një', 'dy', 'tre', 'katër', 'pesë', 'gjashtë', 'shtatë', 'tetë', 'nëntë'];
const TEENS = ['dhjetë', 'njëmbëdhjetë', 'dymbëdhjetë', 'trembëdhjetë', 'katërmbëdhjetë', 'pesëmbëdhjetë', 'gjashtëmbëdhjetë', 'shtatëmbëdhjetë', 'tetëmbëdhjetë', 'nëntëmbëdhjetë'];
const TENS = ['', '', 'njëzet', 'tridhjetë', 'dyzet', 'pesëdhjetë', 'gjashtëdhjetë', 'shtatëdhjetë', 'tetëdhjetë', 'nëntëdhjetë'];

function under1000(n) {
  const parts = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(`${ONES[h]}qind`);
  if (r >= 10 && r < 20) parts.push(TEENS[r - 10]);
  else if (r >= 20) parts.push(r % 10 ? `${TENS[Math.floor(r / 10)]} e ${ONES[r % 10]}` : TENS[Math.floor(r / 10)]);
  else if (r) parts.push(ONES[r]);
  return parts.join(' e ');
}

/** 1250 → "një mijë e dyqind e pesëdhjetë". */
export function numberToWords(value) {
  let n = Math.floor(Math.abs(Number(value) || 0));
  if (!n) return 'zero';
  const groups = [];
  const mil = Math.floor(n / 1e6); n %= 1e6;
  const th = Math.floor(n / 1000); n %= 1000;
  if (mil) groups.push(`${under1000(mil)} ${mil === 1 ? 'milion' : 'milionë'}`);
  if (th) groups.push(`${under1000(th)} mijë`);
  if (n) groups.push(under1000(n));
  return groups.join(' e ');
}

export function amountInWords(amount) {
  const v = Math.round(Math.abs(Number(amount) || 0) * 100);
  const lek = Math.floor(v / 100);
  const q = v % 100;
  return `${numberToWords(lek)} lekë${q ? ` e ${q} qindarka` : ''}`;
}

function clientLines(client, fallbackName) {
  if (!client) return [fallbackName || ''];
  return [
    client.name || fallbackName,
    client.nipt ? `NIPT: ${client.nipt}` : '',
    [client.address, client.city].filter(Boolean).join(', '),
    [client.phone, client.email].filter(Boolean).join(' · '),
  ].filter(Boolean);
}

function signatures(doc, y, labels) {
  doc.setFontSize(9);
  doc.setTextColor(20);
  const w = doc.internal.pageSize.getWidth();
  const span = (w - 28) / labels.length;
  labels.forEach((label, i) => {
    const x = 14 + i * span;
    doc.line(x, y + 16, x + span - 12, y + 16);
    doc.text(label, x, y + 21);
  });
}

/** Faturë / paradhënie për printim (dokument shoqërues; fatura fiskale lëshohet nga programi i faturimit). */
export async function invoicePdf(invoice, { company, clientsById = {} }) {
  const [sale, project, contract, paymentsSnap] = await Promise.all([
    invoice.saleId ? safeGet(`sales/${invoice.saleId}`) : null,
    invoice.projectId ? safeGet(`projects/${invoice.projectId}`) : null,
    invoice.contractId ? safeGet(`contracts/${invoice.contractId}`) : null,
    getDocs(query(collection(db, 'payments'), where('invoiceId', '==', invoice.id))).catch(() => null),
  ]);
  const payments = paymentsSnap ? paymentsSnap.docs.map((d) => d.data()).filter((p) => p.status !== 'cancelled') : [];
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);

  const { jsPDF, autoTable } = await loadPdf();
  const d = new jsPDF({ unit: 'mm', format: 'a4' });
  const kind = invoice.saleId ? 'Faturë shitjeje' : INVOICE_TYPES[invoice.type] || 'Faturë';
  const number = invoice.fiscalNumber || invoice.internalNumber || invoice.saleNumber || '';
  let y = brandHeader(d, company, kind.toUpperCase(), `${number ? `Nr. ${number}` : 'Nr. në pritje'} · ${date(invoice.date)}`);

  // Klienti majtas, të dhënat e dokumentit djathtas.
  d.setFontSize(8);
  d.setTextColor(110);
  d.text('KLIENTI', 14, y + 2);
  d.text('DOKUMENTI', 120, y + 2);
  d.setFontSize(10);
  d.setTextColor(20);
  d.text(clientLines(clientsById[invoice.clientId], invoice.clientName), 14, y + 8);
  const meta = [
    invoice.fiscalNumber ? `Nr. fiskal: ${invoice.fiscalNumber}` : 'Nr. fiskal: në pritje',
    invoice.internalNumber ? `Nr. i brendshëm: ${invoice.internalNumber}` : '',
    `Data: ${date(invoice.date)}`,
    invoice.dueDate ? `Afati i pagesës: ${date(invoice.dueDate)}` : '',
    project ? `Projekti: ${project.code} · ${project.name}` : '',
    contract ? `Kontrata: ${contract.number}` : '',
  ].filter(Boolean);
  d.text(meta, 120, y + 8);
  y += 10 + Math.max(4, meta.length) * 5;

  // Fatura përfundimtare: rreshtat pa TVSH, TVSH, totali dhe zbritja e paradhënieve.
  const detailed = Array.isArray(invoice.lines) && invoice.lines.length > 0;
  const body = detailed
    ? invoice.lines.map((l, i) => [i + 1, '', l.description, `${qty(l.qty)} ${UNITS[l.unit] || l.unit || ''}`, money(l.unitPrice), money(Number(l.qty) * Number(l.unitPrice))])
    : sale?.lines?.length
      ? sale.lines.map((l, i) => [i + 1, l.code || '', l.name, `${qty(l.qty)} ${UNITS[l.unit] || l.unit || ''}`, money(l.unitPrice), money(l.total)])
      : [[1, '', (invoice.notes || kind) + (project && !invoice.notes ? ` — ${project.name}` : ''), '1', money(invoice.amount), money(invoice.amount)]];
  const foot = detailed
    ? [
      ['', '', '', '', 'Vlera pa TVSH', money(invoice.net)],
      ['', '', '', '', `TVSH ${invoice.vatPct ?? ''}%`, money(invoice.vat)],
      ['', '', '', '', 'Totali me TVSH', money(invoice.gross)],
      ...(invoice.deductions || []).map((x) => ['', '', `Minus: ${x.label}${x.date ? ` · ${date(x.date)}` : ''}`, '', '', `-${money(x.amount)}`]),
      ['', '', '', '', "PËR T'U PAGUAR", money(invoice.amount)],
    ]
    : [['', '', '', '', 'TOTALI', money(invoice.amount)]];
  autoTable(d, {
    startY: y,
    head: [['#', 'Kodi', 'Përshkrimi', 'Sasia', detailed ? 'Çmimi pa TVSH' : 'Çmimi', 'Vlera']],
    body,
    foot,
    didParseCell: (c) => {
      if (c.section === 'foot' && c.row.index < foot.length - 1) Object.assign(c.cell.styles, { fillColor: [235, 242, 247], textColor: 20, fontStyle: 'normal' });
    },
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: NAVY },
    footStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 8 }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
  });
  y = d.lastAutoTable.finalY + 6;
  d.setFontSize(9);
  d.text(`Shuma me fjalë: ${amountInWords(invoice.amount)}`, 14, y);
  y += 6;
  if (payments.length) {
    d.text(`Paguar: ${money(paid)}   ·   Mbetet për t'u paguar: ${money(Number(invoice.amount || 0) - paid)}`, 14, y);
    y += 6;
  }
  if (invoice.notes && (sale?.lines?.length || detailed)) { d.text(d.splitTextToSize(`Shënime: ${invoice.notes}`, 180), 14, y); y += 8; }
  if (invoice.status === 'cancelled') {
    d.setTextColor(200, 30, 30);
    d.setFontSize(28);
    d.text('ANULUAR', 105, y + 10, { align: 'center' });
    d.setTextColor(20);
    y += 16;
  }
  d.setFontSize(7.5);
  d.setTextColor(110);
  if (!invoice.fiscalNumber) d.text('Dokument shoqërues — fatura tatimore lëshohet nga programi i faturimit.', 14, y + 2);
  signatures(d, y + 6, ['Lëshoi', 'Mori klienti']);
  d.brandFooterText = company.invoiceFooter || company.offerFooter || '';
  d.save(`${number || 'Fatura'}.pdf`.replace(/[\\/:*?"<>|]/g, '-'));
}

/** Mandat arkëtimi: dy kopje në një fletë A4 (origjinali për klientin, kopja për arkivin). */
export async function paymentPdf(payment, { company, clientsById = {} }) {
  const invoice = payment.invoiceId ? await safeGet(`invoices/${payment.invoiceId}`) : null;
  const { jsPDF, autoTable } = await loadPdf();
  const d = new jsPDF({ unit: 'mm', format: 'a4' });
  const ref = payment.reference || '';
  const head = [payment.number, date(payment.date)].filter(Boolean).join(' · ');
  const half = d.internal.pageSize.getHeight() / 2;

  const copy = (offset, label) => {
    const top = offset;
    if (offset === 0) brandHeader(d, company, 'MANDAT ARKËTIMI', head);
    else {
      d.setFillColor(...NAVY);
      d.rect(0, top, d.internal.pageSize.getWidth(), 12, 'F');
      d.setTextColor(255);
      d.setFontSize(12);
      d.text('MANDAT ARKËTIMI', 14, top + 8);
      d.setFontSize(8.5);
      d.text(`${company.name || 'SuperPool'} · ${head}`, d.internal.pageSize.getWidth() - 12, top + 8, { align: 'right' });
    }
    const y = top + (offset === 0 ? 36 : 18);
    d.setTextColor(110);
    d.setFontSize(7.5);
    d.text(label, d.internal.pageSize.getWidth() - 14, y - 4, { align: 'right' });
    autoTable(d, {
      startY: y,
      theme: 'plain',
      styles: { fontSize: 10, cellPadding: 1.6 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 52 } },
      body: [
        ['U arkëtua nga', clientLines(clientsById[payment.clientId], payment.clientName).join('\n')],
        ['Shuma', money(payment.amount)],
        ['Shuma me fjalë', amountInWords(payment.amount)],
        ['Mënyra e pagesës', PAYMENT_METHODS[payment.method] || payment.method || ''],
        invoice ? ['Për faturën', [invoice.fiscalNumber || invoice.internalNumber, date(invoice.date), money(invoice.amount)].filter(Boolean).join(' · ')] : null,
        ref ? ['Referenca', ref] : null,
        payment.status === 'cancelled' ? ['Statusi', 'ANULUAR'] : null,
      ].filter(Boolean),
    });
    signatures(d, d.lastAutoTable.finalY + 2, ['Arkëtoi', 'Pagoi']);
  };

  copy(0, 'Origjinali');
  d.setDrawColor(150);
  d.setLineDashPattern([2, 2], 0);
  d.line(8, half, d.internal.pageSize.getWidth() - 8, half);
  d.setLineDashPattern([], 0);
  copy(half + 4, 'Kopja');
  d.save(`${payment.number || `Mandat_${date(payment.date)}`}_${(payment.clientName || '').slice(0, 30)}.pdf`.replace(/[\\/:*?"<>|]/g, '-'));
}

/** Fletëhyrje / fletëdalje direkt nga lista: lexon projektin dhe kostot vetëm kur duhen. */
export async function printMovement(m, { company, employeesById = {}, usersById = {}, suppliersById = {}, clientsById = {}, vehiclesById = {}, showCosts = false }) {
  const [project, costs] = await Promise.all([
    m.projectId ? safeGet(`projects/${m.projectId}`) : null,
    showCosts ? safeGet(`movementCosts/${m.id}`) : null,
  ]);
  const extra = {
    project: project ? `${project.code} · ${project.name}` : '',
    vehicle: m.vehicleId ? vehiclesById[m.vehicleId]?.plate : '',
    employee: employeesById[m.employeeId]?.name,
    authorizedBy: usersById[m.authorizedBy]?.name,
    supplier: suppliersById[m.supplierId]?.name,
    client: clientsById[m.clientId]?.name || (m.kind === 'sale' ? m.destName : ''),
  };
  await movementPdf({ movement: m, company, costs: costs && !costs.draft ? costs.lineCosts : null, extra });
}
