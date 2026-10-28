// PDF për printim direkt nga listat: faturat, mandatet e arkëtimit dhe fletëhyrjet/fletëdaljet.

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

import { PAYMENT_METHOD_LABELS, UNITS } from '@shared/constants.js';

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

export function amountInWords(amount, currency = 'ALL') {
  const v = Math.round(Math.abs(Number(amount) || 0) * 100);
  const main = Math.floor(v / 100);
  const q = v % 100;
  const [unit, sub] = currency === 'EUR' ? ['euro', 'cent'] : ['lekë', 'qindarka'];
  return `${numberToWords(main)} ${unit}${q ? ` e ${q} ${sub}` : ''}`;
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

/**
 * Rreshtat e faturës për printim: kodi, emri, njësia, sasia, çmimi pa TVSH, TVSH, vlera pa / me TVSH.
 *  - rreshtat e faturës (manuale ose përfundimtare) janë pa TVSH
 *  - shitjet kanë çmim me TVSH
 *  - faturat e vjetra pa rreshta: një rresht me vlerën totale
 */
export function invoiceRows(invoice, sale, defaultVat = 20) {
  const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  if (Array.isArray(invoice.lines) && invoice.lines.length) {
    return invoice.lines.map((l) => {
      const vat = Number(l.vatPct ?? invoice.vatPct ?? defaultVat);
      const net = r2(Number(l.qty) * Number(l.unitPrice));
      return { code: l.code || '', name: l.description || l.name || '', unit: l.unit, qty: Number(l.qty), price: Number(l.unitPrice), vat, net, gross: r2(net * (1 + vat / 100)) };
    });
  }
  if (sale?.lines?.length) {
    return sale.lines.map((l) => {
      const gross = Number(l.total ?? Number(l.qty) * Number(l.unitPrice));
      const net = r2(gross / (1 + defaultVat / 100));
      return { code: l.code || '', name: l.name, unit: l.unit, qty: Number(l.qty), price: Number(l.qty) ? net / Number(l.qty) : 0, vat: defaultVat, net, gross: r2(gross) };
    });
  }
  const gross = Number(invoice.amount || 0);
  const net = r2(gross / (1 + defaultVat / 100));
  const label = invoice.notes || ({ advance: 'Paradhënie', partial: 'Situacion punimesh', final: 'Punime sipas kontratës' }[invoice.type] || 'Shërbim');
  return [{ code: '', name: label, unit: 'set', qty: 1, price: net, vat: defaultVat, net, gross }];
}

const LIGHT = [244, 247, 250];
const BORDER = [222, 228, 235];
const MUTED = [110, 120, 132];

function card(d, x, y, w, h, title) {
  d.setFillColor(...LIGHT);
  d.setDrawColor(...BORDER);
  d.roundedRect(x, y, w, h, 2, 2, 'FD');
  d.setFontSize(7.5);
  d.setTextColor(...MUTED);
  d.text(title, x + 4, y + 5.5);
  d.setTextColor(20);
}

/** Fatura për printim / për klientin, me të dhënat fiskale (NIVF, NSLF, QR) kur është fiskalizuar. */
export async function invoicePdf(invoice, { company, clientsById = {} }) {
  const [sale, project, contract, paymentsSnap] = await Promise.all([
    invoice.saleId ? safeGet(`sales/${invoice.saleId}`) : null,
    invoice.projectId ? safeGet(`projects/${invoice.projectId}`) : null,
    invoice.contractId ? safeGet(`contracts/${invoice.contractId}`) : null,
    getDocs(query(collection(db, 'payments'), where('invoiceId', '==', invoice.id))).catch(() => null),
  ]);
  const payments = paymentsSnap ? paymentsSnap.docs.map((x) => x.data()).filter((p) => p.status !== 'cancelled') : [];
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);

  const { jsPDF, autoTable } = await loadPdf();
  const d = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = d.internal.pageSize.getWidth();
  const H = d.internal.pageSize.getHeight();
  const cur = invoice.currency === 'EUR' ? 'EUR' : 'ALL';
  const m = (v) => money(v, cur);
  const fiscal = invoice.fiscal?.fic || invoice.fiscal?.iic ? invoice.fiscal : null;
  const title = fiscal?.invoiceType === 'EINVOICE' ? 'E-FATURË' : 'FATURË';
  const number = invoice.fiscalNumber || invoice.internalNumber || invoice.saleNumber || '';
  let y = brandHeader(d, company, title, `${number ? `Nr. ${number}` : 'Nr. në pritje'}  ·  ${date(invoice.date)}`);

  // --- Klienti dhe detajet e dokumentit (dy kartela) ---
  const client = clientsById[invoice.clientId];
  const clientText = d.splitTextToSize(clientLines(client, invoice.clientName).slice(1).join('\n'), 92);
  const details = [
    ['Nr. fiskal', invoice.fiscalNumber || 'në pritje'],
    invoice.internalNumber ? ['Nr. i brendshëm', invoice.internalNumber] : null,
    ['Data e lëshimit', date(invoice.date)],
    invoice.dueDate ? ['Afati i pagesës', date(invoice.dueDate)] : null,
    ['Lloji', invoice.saleId ? 'Shitje' : INVOICE_TYPES[invoice.type] || 'Faturë'],
    cur === 'EUR' ? ['Monedha', `EUR · 1 € = ${invoice.exchangeRate} L`] : null,
    project ? ['Projekti', `${project.code} · ${project.name}`] : null,
    contract ? ['Kontrata', contract.number] : null,
  ].filter(Boolean);
  const clientH = 14 + clientText.length * 4.4;
  const detailsH = 9 + details.length * 5;
  const boxH = Math.max(clientH, detailsH, 30);
  card(d, 14, y, 102, boxH, 'FATURUAR PËR');
  d.setFontSize(11);
  d.setFont(undefined, 'bold');
  d.text(d.splitTextToSize(client?.name || invoice.clientName || '', 94)[0], 18, y + 12);
  d.setFont(undefined, 'normal');
  d.setFontSize(8.5);
  d.text(clientText, 18, y + 17.5);
  card(d, 120, y, 76, boxH, 'DETAJET E FATURËS');
  d.setFontSize(8.5);
  details.forEach(([k, v], i) => {
    d.setTextColor(...MUTED);
    d.text(k, 124, y + 11 + i * 5);
    d.setTextColor(20);
    d.text(d.splitTextToSize(String(v), 42)[0], 192, y + 11 + i * 5, { align: 'right' });
  });
  y += boxH + 6;

  // --- Artikujt ---
  const rows = invoiceRows(invoice, sale, Number(company.vatPct ?? 20));
  autoTable(d, {
    startY: y,
    margin: { left: 14, right: 14 },
    head: [['#', 'Kodi', 'Përshkrimi', 'Njësia', 'Sasia', 'Çmimi pa TVSH', 'TVSH', 'Vlera pa TVSH', 'Vlera me TVSH']],
    body: rows.map((r, i) => [i + 1, r.code, r.name, UNITS[r.unit] || r.unit || '', qty(r.qty), m(r.price), `${r.vat}%`, m(r.net), m(r.gross)]),
    styles: { fontSize: 8, cellPadding: { top: 2.2, bottom: 2.2, left: 1.6, right: 1.6 }, lineColor: BORDER, lineWidth: 0.1, textColor: 30 },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: [250, 251, 253] },
    columnStyles: {
      0: { cellWidth: 7, halign: 'center' }, 1: { cellWidth: 18 }, 2: { cellWidth: 'auto' }, 3: { cellWidth: 13 },
      4: { cellWidth: 13, halign: 'right' }, 5: { cellWidth: 24, halign: 'right' }, 6: { cellWidth: 12, halign: 'right' },
      7: { cellWidth: 25, halign: 'right' }, 8: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
    },
  });
  y = d.lastAutoTable.finalY + 6;
  if (y > H - 95) { d.addPage(); y = 20; }

  // --- Totalet (djathtas) ---
  const net = rows.reduce((s, r) => s + r.net, 0);
  const gross = invoice.gross ?? rows.reduce((s, r) => s + r.gross, 0);
  const byVat = {};
  rows.forEach((r) => { byVat[r.vat] = (byVat[r.vat] || 0) + (r.gross - r.net); });
  const totals = [
    ['Vlera pa TVSH', m(invoice.net ?? net)],
    ...Object.entries(byVat).map(([v, a]) => [`TVSH ${v}%`, m(invoice.vat ?? a)]),
    ['Totali me TVSH', m(gross), true],
    ...(invoice.deductions || []).map((x) => [`Parapagim · ${x.label}`, `-${m(x.amount)}`]),
  ];
  const tx = 120;
  const tw = 76;
  let ty = y;
  d.setFontSize(9);
  totals.forEach(([k, v, bold]) => {
    if (bold) { d.setDrawColor(...BORDER); d.line(tx, ty - 3.5, tx + tw, ty - 3.5); d.setFont(undefined, 'bold'); }
    d.setTextColor(bold ? 20 : 70);
    d.text(d.splitTextToSize(k, 44)[0], tx + 2, ty + 1);
    d.text(v, tx + tw - 2, ty + 1, { align: 'right' });
    d.setFont(undefined, 'normal');
    ty += 6;
  });
  d.setFillColor(...NAVY);
  d.roundedRect(tx, ty - 2, tw, 11, 1.5, 1.5, 'F');
  d.setTextColor(255);
  d.setFontSize(9);
  d.text("PËR T'U PAGUAR", tx + 3, ty + 5);
  d.setFontSize(12);
  d.setFont(undefined, 'bold');
  d.text(m(invoice.amount), tx + tw - 3, ty + 5.3, { align: 'right' });
  d.setFont(undefined, 'normal');
  ty += 13;
  if (cur === 'EUR' && Number(invoice.exchangeRate) > 0) {
    d.setFontSize(8);
    d.setTextColor(...MUTED);
    d.text(`Në lekë: ${money(Number(invoice.amount) * Number(invoice.exchangeRate))}`, tx + tw - 2, ty + 1, { align: 'right' });
    ty += 5;
  }

  // --- Majtas: shuma me fjalë, pagesa, llogaritë bankare ---
  let ly = y;
  d.setTextColor(...MUTED);
  d.setFontSize(7.5);
  d.text('SHUMA ME FJALË', 14, ly);
  d.setTextColor(20);
  d.setFontSize(9);
  const words = d.splitTextToSize(amountInWords(invoice.amount, cur), 100);
  d.text(words, 14, ly + 5);
  ly += 7 + words.length * 4.5;
  if (payments.length) {
    d.setTextColor(...MUTED);
    d.setFontSize(7.5);
    d.text('PAGESA', 14, ly);
    d.setTextColor(20);
    d.setFontSize(9);
    d.text(`Paguar: ${m(paid)}   ·   Mbetet: ${m(Number(invoice.amount || 0) - paid)}`, 14, ly + 5);
    ly += 11;
  }
  if (company.bankInfo) {
    d.setTextColor(...MUTED);
    d.setFontSize(7.5);
    d.text('LLOGARITË BANKARE', 14, ly);
    d.setTextColor(20);
    d.setFontSize(8.5);
    const bank = d.splitTextToSize(company.bankInfo, 100);
    d.text(bank, 14, ly + 5);
    ly += 6 + bank.length * 4.2;
  }
  y = Math.max(ty, ly) + 4;

  if (invoice.notes && rows.length && !(rows.length === 1 && rows[0].name === invoice.notes)) {
    d.setFontSize(8.5);
    d.setTextColor(70);
    const n = d.splitTextToSize(`Shënime: ${invoice.notes}`, 182);
    d.text(n, 14, y);
    y += n.length * 4.3 + 3;
  }

  // --- Të dhënat fiskale: QR dhe kodet ---
  if (fiscal) {
    if (y > H - 70) { d.addPage(); y = 20; }
    card(d, 14, y, 182, 40, 'TË DHËNAT FISKALE');
    if (fiscal.url) {
      try {
        const { default: QRCode } = await import('qrcode');
        d.addImage(await QRCode.toDataURL(fiscal.url, { margin: 0, width: 300 }), 'PNG', 17, y + 8, 30, 30);
      } catch { /* pa QR */ }
    }
    const t = String(fiscal.issueDateTime || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})/);
    const issued = t ? `${t[3]}.${t[2]}.${t[1]} ${t[4]}` : fiscal.issueDateTime || '';
    const fRows = [
      ['Nr. i faturës', fiscal.invNum || invoice.fiscalNumber || ''],
      ['NIVF', fiscal.iic || ''],
      ['NSLF', fiscal.fic || ''],
      fiscal.eic ? ['NIVE', fiscal.eic] : null,
      ['Lëshuar më', issued],
      ['Njësia / TCR / Operatori', [fiscal.businessUnitCode, fiscal.tcrCode, fiscal.operatorCode].filter(Boolean).join(' · ')],
    ].filter(Boolean);
    d.setFontSize(8);
    fRows.forEach(([k, v], i) => {
      d.setTextColor(...MUTED);
      d.text(k, 52, y + 11 + i * 4.8);
      d.setTextColor(20);
      d.text(String(v), 92, y + 11 + i * 4.8);
    });
    if (fiscal.env === 'test') { d.setTextColor(200, 30, 30); d.text('MJEDIS TESTI — pa vlerë tatimore', 192, y + 37, { align: 'right' }); }
    y += 45;
    if (invoice.correction?.invNum) {
      d.setFontSize(9);
      d.setTextColor(200, 30, 30);
      d.text(`Anuluar me faturën korrigjuese ${invoice.correction.invNum} (NIVF ${invoice.correction.iic})`, 14, y);
      y += 6;
    }
  }
  d.setTextColor(20);
  if (invoice.status === 'cancelled') {
    d.setTextColor(200, 30, 30);
    d.setFontSize(26);
    d.text('ANULUAR', W / 2, y + 8, { align: 'center' });
    d.setTextColor(20);
    y += 14;
  }
  if (!invoice.fiscalNumber && !fiscal) {
    d.setFontSize(7.5);
    d.setTextColor(...MUTED);
    d.text('Dokument shoqërues — pa numër fiskal ende.', 14, y);
    y += 4;
  }
  if (y > H - 40) { d.addPage(); y = 20; }
  signatures(d, Math.max(y, H - 62), ['Lëshoi (firma dhe vula)', 'Mori klienti']);
  d.brandFooterText = company.invoiceFooter || company.offerFooter || '';
  d.save(`${number || 'Fatura'}.pdf`.replace(/[\\/:*?"<>|]/g, '-'));
}

/** Mandat arkëtimi: dy kopje në një fletë A4 (origjinali për klientin, kopja për arkivin). */
export async function paymentPdf(payment, { company, clientsById = {} }) {
  const invoice = payment.invoiceId ? await safeGet(`invoices/${payment.invoiceId}`) : null;
  const { jsPDF, autoTable } = await loadPdf();
  const d = new jsPDF({ unit: 'mm', format: 'a4' });
  const ref = payment.reference || '';
  const cur = payment.currency === 'EUR' ? 'EUR' : 'ALL';
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
        ['Shuma', money(payment.amount, cur)],
        ['Shuma me fjalë', amountInWords(payment.amount, cur)],
        cur === 'EUR' && Number(payment.exchangeRate) > 0 ? ['Kursi', `1 € = ${payment.exchangeRate} L  ·  ${money(Number(payment.amount) * Number(payment.exchangeRate))}`] : null,
        ['Mënyra e pagesës', PAYMENT_METHOD_LABELS[payment.method] || payment.method || ''],
        invoice ? ['Për faturën', [invoice.fiscalNumber || invoice.internalNumber, date(invoice.date), money(invoice.amount, invoice.currency)].filter(Boolean).join(' · ')] : null,
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
