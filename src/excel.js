// Lectura / escritura del Excel de control de gastos con ExcelJS.
import ExcelJS from 'exceljs';
import { norm } from './extract.js';

export const TITLE = 'GASTOS REALIZADOS EN OBRA SECHURA';
export const HEADERS = [
  'ÍTEM', 'FECHA', 'N° RECIBO/FACTURA/BOLETA O MOVIMIENTO', 'BENEFICIARIO/PROVEEDOR',
  'CONCEPTO/DETALLE DEL GASTO', 'INGRESOS (+)', 'EGRESOS (-)',
];
const MONEY = '#,##0.00';
const DATE_FMT = 'dd/mm/yyyy';

function headerKey(text) {
  const n = norm(text);
  if (!n) return null;
  if (/^ITEM\b|^N[°ºO]?\s*ITEM|^NRO\.?$|^N[°º]$/.test(n)) return 'item';
  if (/^FECHA/.test(n)) return 'fecha';
  if (/RECIBO|FACTURA|BOLETA|MOVIMIENTO|COMPROBANTE/.test(n)) return 'numero';
  if (/BENEFICIARIO|PROVEEDOR/.test(n)) return 'proveedor';
  if (/CONCEPTO|DETALLE|DESCRIPCION/.test(n)) return 'concepto';
  if (/INGRESO/.test(n)) return 'ingresos';
  if (/EGRESO|GASTO/.test(n)) return 'egresos';
  return null;
}

function cellText(cell) {
  const v = cell?.value;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (v.text != null) return String(v.text);
    if ('result' in v) return v.result instanceof Date ? v.result.toISOString() : String(v.result ?? '');
    return '';
  }
  return String(v);
}
function cellNumber(cell) {
  const v = cell?.value;
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && typeof v.result === 'number') return v.result;
  const t = cellText(cell).replace(/[^\d.,-]/g, '').replace(/,/g, '');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}
function cellIsoDate(cell) {
  const v = cell?.value;
  const d = v instanceof Date ? v : v && typeof v === 'object' && v.result instanceof Date ? v.result : null;
  if (d) return d.toISOString().slice(0, 10);
  const m = cellText(cell).match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return `${y}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
  }
  return '';
}

/** Ubica hoja, fila de encabezados y columnas. No usa números de fila fijos. */
export function locateTable(wb) {
  for (const ws of wb.worksheets) {
    const limit = Math.min(ws.rowCount, 60);
    for (let r = 1; r <= limit; r++) {
      const cols = {};
      ws.getRow(r).eachCell({ includeEmpty: false }, (cell, c) => {
        const k = headerKey(cellText(cell));
        if (k && !cols[k]) cols[k] = c;
      });
      if (cols.fecha && cols.numero && cols.proveedor && cols.egresos) return { ws, headerRow: r, cols };
    }
  }
  return null;
}

const isTotalsRow = (row, cols) => {
  let hit = false;
  row.eachCell({ includeEmpty: false }, (cell) => {
    const t = norm(cellText(cell)).trim();
    if (/^(SUB)?TOTAL(ES)?\b|^SALDO\b|^SUMA\b|^RESUMEN\b/.test(t) && !(typeof cell.value === 'number')) hit = true;
  });
  void cols;
  return hit;
};
const dataCols = (cols) => ['fecha', 'numero', 'proveedor', 'concepto', 'ingresos', 'egresos'].map((k) => cols[k]).filter(Boolean);
const rowHasData = (row, cols) => dataCols(cols).some((c) => cellText(row.getCell(c)).trim() !== '');

function scan(ws, headerRow, cols) {
  const records = [];
  let lastData = headerRow;
  let totalsRow = null;
  let maxItem = 0;
  let sumEgreso = 0;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (isTotalsRow(row, cols)) { totalsRow = r; break; }
    if (!rowHasData(row, cols)) continue;
    lastData = r;
    const eg = cellNumber(row.getCell(cols.egresos));
    if (eg != null) sumEgreso += eg;
    const it = cols.item ? parseInt(cellText(row.getCell(cols.item)).replace(/\D/g, ''), 10) : NaN;
    if (Number.isFinite(it)) maxItem = Math.max(maxItem, it);
    records.push({
      origen: `Excel, fila ${r}`,
      fecha: cellIsoDate(row.getCell(cols.fecha)),
      numero: cellText(row.getCell(cols.numero)).trim(),
      proveedor: cellText(row.getCell(cols.proveedor)).trim(),
      concepto: cols.concepto ? cellText(row.getCell(cols.concepto)).trim() : '',
      egreso: eg == null ? '' : String(eg),
    });
  }
  return { records, lastData, totalsRow, maxItem, sumEgreso };
}

/** Lee un Excel existente: registros previos (para duplicados) y totales. */
export async function readExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const loc = locateTable(wb);
  if (!loc) throw new Error('No se encontraron los encabezados (FECHA, N° RECIBO…, BENEFICIARIO…, EGRESOS) en este Excel.');
  const s = scan(loc.ws, loc.headerRow, loc.cols);
  return { records: s.records, nextItem: s.maxItem + 1, total: s.sumEgreso, sheet: loc.ws.name, headerRow: loc.headerRow, count: s.records.length };
}

function newWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Gastos', { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.mergeCells('A1:G1');
  const t = ws.getCell('A1');
  t.value = TITLE;
  t.font = { bold: true, size: 14, color: { argb: 'FF0B2A5B' }, name: 'Calibri' };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 26;
  const h = ws.getRow(3);
  HEADERS.forEach((txt, i) => {
    const c = h.getCell(i + 1);
    c.value = txt;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2A5B' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = thin();
  });
  h.height = 32;
  [7, 12, 24, 34, 48, 15, 15].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return { wb, ws, headerRow: 3, cols: { item: 1, fecha: 2, numero: 3, proveedor: 4, concepto: 5, ingresos: 6, egresos: 7 } };
}
const thin = () => ({ top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } });

/** Ajusta una fórmula cuando se inserta una fila en `at` (extiende rangos que terminan en at-1). */
export function shiftFormula(f, at) {
  return f.replace(/(\$?[A-Z]{1,3}\$?)(\d+)(?::(\$?[A-Z]{1,3}\$?)(\d+))?/g, (all, c1, r1, c2, r2) => {
    const a = +r1;
    if (c2 === undefined) return `${c1}${a >= at ? a + 1 : a}`;
    const b = +r2;
    return `${c1}${a >= at ? a + 1 : a}:${c2}${b >= at - 1 ? b + 1 : b}`;
  });
}

function insertRowAt(ws, at) {
  ws.spliceRows(at, 0, []);
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn <= at) return;
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      if (v && typeof v === 'object' && typeof v.formula === 'string') cell.value = { ...v, formula: shiftFormula(v.formula, at) };
    });
  });
}

const PHOTO_SHEET = 'COMPROBANTES';
const colLetter = (n) => {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

/** Ancho/alto de un JPEG (data URL) leyendo su cabecera. */
export function jpegSize(dataUrl) {
  try {
    const b = atob(dataUrl.split(',')[1]);
    let i = 2;
    while (i < b.length) {
      if (b.charCodeAt(i) !== 0xff) { i++; continue; }
      const m = b.charCodeAt(i + 1);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: (b.charCodeAt(i + 5) << 8) | b.charCodeAt(i + 6), w: (b.charCodeAt(i + 7) << 8) | b.charCodeAt(i + 8) };
      }
      i += 2 + ((b.charCodeAt(i + 2) << 8) | b.charCodeAt(i + 3));
    }
  } catch { /* sin medidas */ }
  return null;
}

/**
 * Pone la foto del comprobante en la hoja COMPROBANTES y convierte el N° de la fila en un
 * enlace que lleva directo a esa foto (y la foto trae un enlace de vuelta a la fila).
 */
function attachPhoto(wb, ws, cols, row, rec, itemLabel) {
  if (!rec.img) return;
  let cs = wb.getWorksheet(PHOTO_SHEET);
  if (!cs) {
    cs = wb.addWorksheet(PHOTO_SHEET);
    [14, 52, 18, 26].forEach((w, i) => { cs.getColumn(i + 1).width = w; });
  }
  const start = cs.rowCount ? cs.rowCount + 2 : 1;
  const size = jpegSize(rec.img) || { w: 800, h: 1000 };
  const w = Math.min(640, size.w);
  const h = Math.round((w * size.h) / size.w);
  const hdr = cs.getRow(start);
  hdr.getCell(1).value = `Ítem ${itemLabel}`;
  hdr.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF0B2A5B' } };
  hdr.getCell(2).value = [rec.numero, rec.proveedor].filter(Boolean).join(' · ');
  hdr.getCell(2).font = { bold: true };
  hdr.getCell(4).value = { text: '← Volver al registro', hyperlink: `#'${ws.name}'!${colLetter(cols.numero)}${row.number}` };
  hdr.getCell(4).font = { color: { argb: 'FF0563C1' }, underline: true };
  const id = wb.addImage({ base64: rec.img, extension: 'jpeg' });
  cs.addImage(id, { tl: { col: 0, row: start }, ext: { width: w, height: h } });
  cs.getRow(start + Math.ceil(h / 20) + 1).getCell(1).value = ' '; // reserva el espacio ocupado por la foto
  const c = row.getCell(cols.numero);
  c.value = { text: rec.numero || 'Ver foto', hyperlink: `#'${PHOTO_SHEET}'!A${start}` };
  c.font = { ...(c.font || {}), color: { argb: 'FF0563C1' }, underline: true };
}

const padItem = (n, width) => String(n).padStart(width, '0');

/**
 * Agrega `records` al final de la tabla. Parte de `baseBuffer` (Excel original) o crea uno nuevo.
 * Nunca modifica filas existentes. Devuelve { buffer, added, firstRow }.
 */
export async function appendRecords(baseBuffer, records) {
  let wb, ws, headerRow, cols;
  if (baseBuffer) {
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(baseBuffer);
    const loc = locateTable(wb);
    if (!loc) throw new Error('No se encontraron los encabezados en el Excel importado.');
    ({ ws, headerRow, cols } = loc);
  } else {
    ({ wb, ws, headerRow, cols } = newWorkbook());
  }
  const s = scan(ws, headerRow, cols);
  const refRow = s.lastData > headerRow ? ws.getRow(s.lastData) : null;
  const refCell = (k) => (refRow && cols[k] ? refRow.getCell(cols[k]) : null);
  const itemRef = refCell('item');
  const itemIsNumber = itemRef && typeof itemRef.value === 'number';
  const itemText = itemRef ? cellText(itemRef) : '';
  const width = Math.max(2, /^0\d/.test(itemText) ? itemText.length : 2);
  const dateIsText = refCell('fecha') && typeof refCell('fecha').value === 'string';
  const maxCol = Math.max(...Object.values(cols));

  let next = s.maxItem + 1;
  let target = s.lastData + 1;
  let firstRow = target;
  for (const rec of records) {
    let row = ws.getRow(target);
    if (isTotalsRow(row, cols)) { insertRowAt(ws, target); row = ws.getRow(target); }
    else if (rowHasData(row, cols)) { insertRowAt(ws, target); row = ws.getRow(target); }
    if (refRow) {
      for (let c = 1; c <= maxCol; c++) row.getCell(c).style = structuredClone(refRow.getCell(c).style || {});
      if (refRow.height) row.height = refRow.height;
    } else {
      for (let c = 1; c <= maxCol; c++) row.getCell(c).border = thin();
    }
    if (cols.item) {
      const c = row.getCell(cols.item);
      c.value = itemIsNumber ? next : padItem(next, width);
      if (!itemRef) c.alignment = { horizontal: 'center' };
    }
    const fc = row.getCell(cols.fecha);
    const [y, m, d] = (rec.fecha || '').split('-').map(Number);
    if (y && m && d) {
      if (dateIsText) fc.value = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
      else {
        fc.value = new Date(Date.UTC(y, m - 1, d));
        if (!fc.numFmt || fc.numFmt === 'General' || !/[dmy]/i.test(fc.numFmt)) fc.numFmt = DATE_FMT;
      }
    } else fc.value = null;
    row.getCell(cols.numero).value = rec.numero || null;
    row.getCell(cols.numero).numFmt = '@';
    row.getCell(cols.proveedor).value = rec.proveedor || null;
    if (cols.concepto) {
      const cc = row.getCell(cols.concepto);
      cc.value = rec.concepto || null;
      cc.alignment = { ...(cc.alignment || {}), wrapText: true, vertical: 'top' };
      const w = ws.getColumn(cols.concepto).width || 40;
      const nLines = (rec.concepto || '').split('\n').reduce((s, l) => s + Math.max(1, Math.ceil(l.length / (w * 0.78))), 0);
      if (nLines > 1) row.height = Math.max(row.height || 15, 15 * nLines + 6);
    }
    if (cols.ingresos) row.getCell(cols.ingresos).value = null;
    const eg = row.getCell(cols.egresos);
    const n = parseFloat(rec.egreso);
    eg.value = Number.isFinite(n) ? n : null;
    eg.numFmt = MONEY;
    attachPhoto(wb, ws, cols, row, rec, itemIsNumber ? String(next) : padItem(next, width));
    row.commit?.();
    next++;
    target++;
  }
  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, added: records.length, firstRow };
}


