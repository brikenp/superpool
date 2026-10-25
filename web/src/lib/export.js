// Eksport në Excel dhe PDF. Libraritë ngarkohen vetëm kur nevojiten (lazy import).

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const safeName = (s) => String(s || 'raport').replace(/[^\w\-ëçËÇ ]+/g, '').trim().replace(/\s+/g, '_');

/**
 * columns: [{ label, value: (row) => any, type?: 'number'|'money'|'text' }]
 */
export async function exportExcel({ title, columns, rows, filters = [] }) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SuperPool';
  const ws = wb.addWorksheet(String(title).slice(0, 30) || 'Raport');
  ws.addRow([title]).font = { bold: true, size: 14 };
  filters.forEach((f) => ws.addRow([f]));
  ws.addRow([]);
  const header = ws.addRow(columns.map((c) => c.label));
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B6FA4' } }; });
  for (const row of rows) {
    const r = ws.addRow(columns.map((c) => {
      const v = c.value(row);
      if (c.type === 'number' || c.type === 'money') return v === '' || v === null || v === undefined ? null : Number(v);
      return v ?? '';
    }));
    columns.forEach((c, i) => {
      if (c.type === 'money') r.getCell(i + 1).numFmt = '#,##0.00';
      if (c.type === 'number') r.getCell(i + 1).numFmt = '#,##0.###';
    });
  }
  columns.forEach((c, i) => {
    const width = Math.max(c.label.length, ...rows.slice(0, 200).map((r) => String(c.value(r) ?? '').length));
    ws.getColumn(i + 1).width = Math.min(60, Math.max(10, width + 2));
  });
  const buffer = await wb.xlsx.writeBuffer();
  download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeName(title)}.xlsx`);
}

export async function loadPdf() {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  return { jsPDF, autoTable };
}

const fmtCell = (c, v) => {
  if (v === null || v === undefined || v === '') return '';
  if (c.type === 'money') return new Intl.NumberFormat('sq-AL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
  if (c.type === 'number') return new Intl.NumberFormat('sq-AL', { maximumFractionDigits: 3 }).format(Number(v));
  return String(v);
};

export async function exportPdf({ title, columns, rows, filters = [], company = {}, totals }) {
  const { jsPDF, autoTable } = await loadPdf();
  const landscape = columns.length > 6;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(company.name || 'SuperPool', 14, 12);
  doc.text(new Date().toLocaleString('sq-AL'), doc.internal.pageSize.getWidth() - 14, 12, { align: 'right' });
  doc.setTextColor(20);
  doc.setFontSize(14);
  doc.text(title, 14, 21);
  doc.setFontSize(9);
  let y = 27;
  filters.forEach((f) => { doc.text(f, 14, y); y += 5; });
  autoTable(doc, {
    startY: y + 1,
    head: [columns.map((c) => c.label)],
    body: rows.map((r) => columns.map((c) => fmtCell(c, c.value(r)))),
    foot: totals ? [columns.map((c, i) => (i === 0 ? 'Totali' : totals[c.label] !== undefined ? fmtCell(c, totals[c.label]) : ''))] : undefined,
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: [11, 111, 164] },
    footStyles: { fillColor: [235, 242, 247], textColor: 20 },
    columnStyles: Object.fromEntries(columns.map((c, i) => [i, c.type === 'money' || c.type === 'number' ? { halign: 'right' } : {}])),
    didDrawPage: () => {
      const page = doc.internal.getNumberOfPages();
      doc.setFontSize(8);
      doc.text(`Faqe ${page}`, doc.internal.pageSize.getWidth() - 14, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
    },
  });
  doc.save(`${safeName(title)}.pdf`);
}

/** Lexon CSV ose Excel dhe kthen rreshtat si objekte (çelësat = titujt e kolonave). */
export async function readTable(file) {
  return (await readTableWithImages(file)).rows;
}

/**
 * Si readTable, por për Excel kthen edhe fotot e futura në fletë:
 * images[i] = { buffer, extension } për rreshtin e të dhënave me indeks i.
 */
export async function readTableWithImages(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return { rows: parseCsv(await file.text()), images: {} };
  }
  const { default: ExcelJS } = await import('exceljs');
  const { readInCellImages } = await import('./xlsxCellImages.js');
  const buffer = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const rows = [];
  const rowIndexBySheetRow = {};
  let headers = null;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values.slice(1).map((v) => {
      if (v && typeof v === 'object') {
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (v.error) return ''; // p.sh. qeliza me foto "Place in Cell" lexohet si #VALUE!
        return v.result ?? v.text ?? v.hyperlink ?? v.richText?.map((t) => t.text).join('') ?? '';
      }
      return v;
    });
    if (!headers) { headers = values.map((h) => String(h ?? '').trim()); return; }
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = values[i] ?? ''; });
    rowIndexBySheetRow[row.number] = rows.length;
    rows.push(obj);
  });
  // Fotot brenda qelizave ("Place in Cell").
  const images = {};
  try {
    const inCell = await readInCellImages(buffer);
    for (const [sheetRow, img] of Object.entries(inCell)) {
      const idx = rowIndexBySheetRow[sheetRow];
      if (idx !== undefined) images[idx] = img;
    }
  } catch (err) {
    console.warn('Fotot brenda qelizave nuk u lexuan:', err);
  }
  // Fotot e ankoruara mbi fletë: rreshti përcaktohet nga cepi i sipërm-majtas (0-based).
  for (const img of ws.getImages()) {
    const sheetRow = Math.floor(img.range?.tl?.nativeRow ?? img.range?.tl?.row ?? -1) + 1;
    const idx = rowIndexBySheetRow[sheetRow];
    if (idx === undefined || images[idx]) continue;
    const media = wb.getImage(Number(img.imageId));
    if (media?.buffer) images[idx] = { buffer: media.buffer, extension: media.extension || 'png' };
  }
  const filled = rows.map((r, i) => ({ r, i })).filter(({ r, i }) => images[i] || Object.values(r).some((v) => v !== '' && v !== null));
  const remap = {};
  filled.forEach(({ i }, j) => { if (images[i]) remap[j] = images[i]; });
  return { rows: filled.map(({ r }) => r), images: remap };
}

export function parseCsv(text) {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const records = [];
  let field = '';
  let record = [];
  let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { field += '"'; i += 1; } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { record.push(field); field = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i += 1;
      record.push(field); records.push(record); record = []; field = '';
    } else field += ch;
  }
  if (field || record.length) { record.push(field); records.push(record); }
  const [headers, ...rest] = records.filter((r) => r.some((c) => c.trim() !== ''));
  if (!headers) return [];
  return rest.map((r) => Object.fromEntries(headers.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

export function downloadCsv(filename, columns, rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [columns.map((c) => esc(c.label)).join(';'), ...rows.map((r) => columns.map((c) => esc(c.value(r))).join(';'))].join('\r\n');
  download(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }), filename);
}

/**
 * Shkarkon një model Excel për import: fleta e të dhënave (titujt + shembuj) dhe fleta "Udhëzime".
 * columns: [{ key, help, required, width, list? }]
 */
export async function downloadTemplate({ filename, sheetName, columns, rows, notes = [], photoColumn }) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SuperPool';
  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.key, key: c.key, width: c.width || Math.max(14, c.key.length + 4) }));
  const header = ws.getRow(1);
  header.height = 22;
  header.eachCell((cell, i) => {
    const col = columns[i - 1];
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.required ? 'FF075985' : 'FF0284C7' } };
    cell.alignment = { vertical: 'middle' };
    cell.note = `${col.required ? '(e detyrueshme) ' : ''}${col.help || ''}`;
  });
  rows.forEach((r) => {
    const row = ws.addRow(r);
    if (photoColumn) row.height = 48;
  });
  columns.forEach((c, i) => {
    if (c.list) {
      for (let r = 2; r <= 500; r += 1) {
        ws.getCell(r, i + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${c.list.join(',')}"`] };
      }
    }
  });
  const help = wb.addWorksheet('Udhëzime');
  help.columns = [{ header: 'Kolona', key: 'k', width: 22 }, { header: 'E detyrueshme', key: 'r', width: 14 }, { header: 'Përshkrimi', key: 'h', width: 90 }];
  help.getRow(1).font = { bold: true };
  columns.forEach((c) => help.addRow({ k: c.key, r: c.required ? 'Po' : '', h: c.help || '' }));
  if (notes.length) {
    help.addRow({});
    notes.forEach((n) => { const row = help.addRow({ k: '', r: '', h: n }); row.getCell(3).alignment = { wrapText: true }; });
  }
  const buffer = await wb.xlsx.writeBuffer();
  download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}
