// Extracción de datos a partir del texto reconocido (OCR o capa de texto de PDF).
// Reglas puras, sin dependencias: se puede probar con `npm test`.

export const norm = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

const MESES = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, SEP: 9, OCT: 10, NOV: 11, DIC: 12 };

/** Convierte "1,234.50", "1.234,50", "S/ 50,00" en número. Devuelve null si no es válido. */
export function parseAmount(raw) {
  let s = String(raw).replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const lc = s.lastIndexOf(',');
  const ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) {
    s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lc > -1 || ld > -1) {
    const sep = lc > -1 ? ',' : '.';
    const parts = s.split(sep);
    if (parts.length > 2) s = parts.join('');
    else if (parts[1].length === 3 && parts[0].length >= 1 && parts[0].length <= 3 && parts[0] !== '0') s = parts.join('');
    else s = parts[0] + '.' + parts[1];
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Importes de una línea: con decimales, o enteros precedidos por S/ */
export function amountsInLine(line) {
  const l = String(line).replace(/(\d)\s+([.,])\s*(\d{2})(?!\d)/g, '$1$2$3');
  const out = [];
  const seen = new Set();
  const push = (idx, v) => { if (v != null && v > 0 && !seen.has(idx)) { seen.add(idx); out.push(v); } };
  for (const m of l.matchAll(/\d[\d.,]*\d|\d/g)) {
    const tok = m[0];
    const hasDec = /[.,]\d{2}$/.test(tok);
    const before = l.slice(Math.max(0, m.index - 4), m.index).toUpperCase();
    const prefixed = /S\s*\/\.?\s*$|S\/\.?\s*$|SOLES?\s*$/.test(before);
    if (hasDec || prefixed) push(m.index, parseAmount(tok));
  }
  return out;
}

const EXCLUDE_AMOUNT = /SUB\s*TOTAL|IGV|I\.G\.V|IMPUESTO|GRAVAD|EXONERAD|INAFECT|GRATUIT|VUELTO|CAMBIO|DESCUENTO|DSCTO|DCTO|ICBPER|REDONDEO|RECIBIDO|PAGO CON|SU PAGO|EFECTIVO|PERCEP|DETRAC|COMISION|ITF|SALDO|IMPONIBLE|FORMA DE PAGO/;

const KEYS = [
  { re: /TRANSFERENCIA EXITOSA|OPERACION EXITOSA|PAGO EXITOSO|TRANSFERENCIA REALIZADA|PAGO REALIZADO|DEPOSITO EXITOSO/, rank: 3, next: true },
  { re: /TOTAL A PAGAR|IMPORTE TOTAL|TOTAL PAGADO|MONTO TOTAL|TOTAL VENTA|TOTAL GENERAL|IMPORTE PAGADO|MONTO PAGADO|NETO A PAGAR|TOTAL COMPROBANTE|MONTO ENVIADO|MONTO TRANSFERIDO|MONTO DE (LA )?OPERACION|IMPORTE DE (LA )?OPERACION|IMPORTE ENVIADO|YAPEASTE|PLINEASTE|TE YAPEO|ENVIASTE|TOTAL PAGO|IMPORTE DEL PAGO|MONTO DEL PAGO|MONTO ABONADO|IMPORTE TRANSFERIDO/, rank: 3, next: true },
  { re: /\bTOTAL\b/, rank: 2, next: false },
  { re: /\bMONTO\b|\bIMPORTE\b|\bPAGO\b/, rank: 1, next: true },
];

/** Importe grande bajo '¡Yapeaste!': el OCR suele leer el 'S/' como '51', '5/' o 'S'. */
function yapeAmount(lines) {
  const i = lines.findIndex((l) => /YAPEASTE|PLINEASTE|ENVIASTE|TE YAPEO|TE PLINEO/.test(norm(l)));
  if (i < 0) return null;
  for (const l of lines.slice(i + 1, i + 4)) {
    const s = l.trim();
    let m = s.match(/^[S$§]\s*\/?\s*(\d{1,4}(?:[.,]\d{1,2})?)$/i);
    if (!m && /^\d{4,5}$/.test(s)) m = s.match(/^5\s*[1\/lI|]?\s*(\d{2,4})$/);
    if (m) { const v = parseAmount(m[1]); if (v > 0) return v; }
  }
  return null;
}

export function extractAmount(lines, warnings) {
  const cands = [];
  const ya = yapeAmount(lines);
  if (ya != null) cands.push({ v: ya, rank: 4, i: 0 });
  lines.forEach((line, i) => {
    const n = norm(line);
    if (EXCLUDE_AMOUNT.test(n)) return;
    for (const k of KEYS) {
      if (!k.re.test(n)) continue;
      let a = amountsInLine(line);
      if (!a.length && k.next && lines[i + 1] && !EXCLUDE_AMOUNT.test(norm(lines[i + 1])) && lines[i + 1].length < 40) a = amountsInLine(lines[i + 1]);
      if (a.length) cands.push({ v: a[a.length - 1], rank: k.rank, i });
      break;
    }
  });
  if (cands.length) {
    cands.sort((x, y) => y.rank - x.rank || y.i - x.i);
    const best = cands[0];
    const others = [...new Set(cands.filter((c) => c.rank >= 2 && c.v !== best.v).map((c) => c.v))];
    if (others.length) warnings.push(`Varios importes posibles (${[best.v, ...others].map((v) => v.toFixed(2)).join(' / ')}): verifique el total pagado.`);
    return best.v;
  }
  const loose = [];
  lines.forEach((line) => { if (!EXCLUDE_AMOUNT.test(norm(line))) loose.push(...amountsInLine(line)); });
  if (loose.length) {
    const uniq = [...new Set(loose)];
    const v = Math.max(...uniq);
    warnings.push(`No se halló la palabra TOTAL; se tomó el mayor importe (${v.toFixed(2)}). Verifique.`);
    if (uniq.length > 1) warnings.push(`Importes detectados: ${uniq.slice(0, 6).map((x) => x.toFixed(2)).join(', ')}.`);
    return v;
  }
  return null;
}

const iso = (y, m, d) => {
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

export function extractDate(lines) {
  const cands = [];
  lines.forEach((line, i) => {
    const n = norm(line);
    if (/VENC|NACIMIENTO|VALIDO HASTA/.test(n)) return;
    const bonus = /FECHA|EMISION|OPERACION|EMITID/.test(n) ? 2 : 0;
    const add = (v, extra = 0) => v && cands.push({ v, score: bonus + extra, i });
    for (const m of n.matchAll(/(?<!\d)(20\d{2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?!\d)/g)) add(iso(+m[1], +m[2], +m[3]), 1);
    for (const m of n.matchAll(/(?<![\d.])(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4}|\d{2})(?![\d])/g)) {
      let d = +m[1], mo = +m[2];
      if (mo > 12 && d <= 12) [d, mo] = [mo, d];
      add(iso(+m[3], mo, d), 1);
    }
    for (const m of n.matchAll(/(?<!\d)(\d{1,2})\s*(?:DE\s+)?([A-Z]{3,10})\.?,?\s*(?:DE\s+|DEL\s+)?(\d{4})(?!\d)/g)) {
      const mo = MESES[m[2].slice(0, 3)];
      if (mo) add(iso(+m[3], mo, +m[1]), 1);
    }
  });
  if (!cands.length) return '';
  cands.sort((a, b) => b.score - a.score || a.i - b.i);
  return cands[0].v;
}

const BLACK_NAME = /FACTURA|BOLETA|\bRUC\b|TICKET|DIRECCION|^AV\b|^JR\b|^CALLE|^PSJE|TELEF|DOCUMENTO|CLIENTE|SENOR|FECHA|HORA|REPRESENTACION|IMPRESA|SUNAT|GRACIAS|PAGINA|COMPROBANTE|NOTA DE|\bN[°ºO]\b|^LIMA|^PIURA|^PERU|^SECHURA|MATERIALES DE|DENOMINACION|MONEDA|VENCIMIENTO|DESCRIPCION|UNIDADES|^TEL|^CEL|WWW\.|@|VENTA|COPIA|ORIGINAL|OPERACION|YAPE|PLIN/;

function looksLikeName(s) {
  const letters = (s.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []).length;
  if (letters < 4) return false;
  if (letters / s.length < 0.55) return false;
  return !BLACK_NAME.test(norm(s));
}

const cleanName = (s) => {
  let r = s.replace(/^[\s:.\-|*•]+/, '').replace(/\s*[|]\s*/g, ' ').replace(/\s{2,}/g, ' ').replace(/[\s:|*•]+$/, '');
  if (!/(^|[\s.])[A-Za-z]\.$/.test(r)) r = r.replace(/[.\s]+$/, '');
  return r.trim();
};
function labeledValue(lines, labelRe, { requireName = true } = {}) {
  for (let i = 0; i < lines.length; i++) {
    const n = norm(lines[i]);
    const m = n.match(labelRe);
    if (!m) continue;
    let rest = lines[i].slice(m.index + m[0].length).replace(/^[\s:.\-]+/, '');
    if (rest && (!requireName || looksLikeName(rest) || /[A-Z]{3,}/i.test(rest))) return cleanName(rest);
    const nx = lines[i + 1];
    if (nx && nx.length > 2 && (!requireName || /[A-Za-zÁÉÍÓÚÑ]{3,}/.test(nx))) return cleanName(nx);
  }
  return '';
}

const SUFFIX_END = /^(.*?)\s+(S\.?\s?R\.?\s?L\.?|S\.?\s?A\.?\s?C\.?|E\.?\s?I\.?\s?R\.?\s?L\.?|S\.?\s?A\.?)$/;
const CLIENT_LINE = /DENOMINACION|CLIENTE|SENOR|ADQUIRIENTE|DESTINATARIO|DIRECCION|RAZON SOCIAL|NOMBRE|REPRESENTANTE/;
const GOOD_TOKEN = /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ&\-.]{2,}$/;

/** Nombre de empresa terminado en S.A.C. / S.R.L. / E.I.R.L. / S.A. (ignora la línea del cliente). */
export function companyBySuffix(lines) {
  for (const line of lines) {
    if (CLIENT_LINE.test(norm(line)) || /UNIDADES|\d[.,]\d{2}/.test(line)) continue;
    for (const seg of line.split(/\s{2,}|\|/)) {
      const m = seg.trim().replace(/[\s,;:]+$/, '').match(SUFFIX_END);
      if (!m) continue;
      const toks = m[1].split(/\s+/);
      while (toks.length && !GOOD_TOKEN.test(toks[0])) toks.shift();
      if (!toks.length || toks.join('').length < 3) continue;
      const name = cleanName(`${toks.join(' ')} ${m[2]}`);
      if (looksLikeName(name)) return name;
    }
  }
  return '';
}
/** Yape/Plin: el nombre del destinatario aparece justo bajo el importe, sin etiqueta. */
function yapeProvider(lines) {
  const i = lines.findIndex((l) => /YAPEASTE|PLINEASTE|ENVIASTE|TE YAPEO|TE PLINEO/.test(norm(l)));
  if (i < 0) return '';
  for (const l of lines.slice(i + 1, i + 6)) {
    if (/^(DESTINO|NRO|NUMERO|MENSAJE|CODIGO|DATOS|COMISION|ORIGEN)/.test(norm(l).trim())) continue;
    if (looksLikeName(l)) return l.trim().replace(/[\s|:]+$/, '');
  }
  return '';
}

export function extractProvider(lines) {
  const yp = yapeProvider(lines);
  if (yp) return yp;
  for (const re of [/NOMBRE DEL BENEFICIARIO|BENEFICIARIO|DESTINATARIO|PROVEEDOR/, /ENVIADO A|YAPEASTE A|PLINEASTE A|PAGADO A|TRANSFERIDO A|NOMBRE DE DESTINO/, /DESTINO/, /\bPARA\b/]) {
    const labeled = labeledValue(lines, re);
    if (labeled && looksLikeName(labeled) && !/:\s*\S/.test(labeled)) return labeled;
  }

  const byName = companyBySuffix(lines);
  if (byName) return byName;

  const rucIdx = [];
  lines.forEach((l, i) => { if (/\b(10|15|17|20)\d{9}\b/.test(l.replace(/[\s-]/g, '')) && /RUC/i.test(l)) rucIdx.push(i); });
  const isClientCtx = (i) =>
    lines.slice(Math.max(0, i - 3), i + 1).some((l) => /CLIENTE|SENOR|ADQUIRIENTE|DESTINATARIO/.test(norm(l))) ||
    lines.slice(i, i + 3).some((l) => /DENOMINACION|RAZON SOCIAL|NOMBRE|APELLIDOS/.test(norm(l)));
  for (const i of rucIdx) {
    if (isClientCtx(i)) continue;
    const pre = lines[i].split(/RUC/i)[0];
    if (looksLikeName(pre)) return cleanName(pre);
    for (let j = i - 1; j >= Math.max(0, i - 4); j--) if (looksLikeName(lines[j])) return cleanName(lines[j]);
    for (let j = i + 1; j <= Math.min(lines.length - 1, i + 2); j++) if (looksLikeName(lines[j]) && /S\.?A\.?C?|E\.?I\.?R\.?L|S\.?R\.?L|SOCIEDAD|\bCIA\b/i.test(lines[j])) return cleanName(lines[j]);
  }
  const top = lines.slice(0, 7).find((l) => looksLikeName(l) && /S\.?\s?A\.?\s?C|E\.?I\.?R\.?L|S\.?R\.?L|S\.?A\.?\b/i.test(l));
  if (top) return cleanName(top);
  const first = lines.slice(0, 5).find(looksLikeName);
  return first ? cleanName(first) : '';
}

const SERIE_RE = /(?<![A-Z0-9])((?:F|B|E|FF|BB|EB|EF|FA|BA)[A-Z0-9]{2,3})\s*[-–—]\s*(\d{1,9})(?!\d)/;

function fixSerie(s) {
  return s.split('').map((c, i) => (i >= 1 && c === 'O' ? '0' : i >= 2 && (c === 'I' || c === 'L') ? '1' : c)).join('');
}

export function extractNumber(lines) {
  // Puede haber varias lecturas del mismo número (dos pasadas de OCR): gana la más repetida y, si empatan, la más completa.
  const found = new Map();
  lines.forEach((line, idx) => {
    const n = norm(line).replace(/[–—]/g, '-');
    if (/\bRUC\b/.test(n) && !SERIE_RE.test(n)) return;
    const m = n.match(SERIE_RE);
    if (m && /\d/.test(m[1] + m[2])) {
      let corr = m[2];
      // El OCR a veces corta el correlativo y deja el resto en la línea siguiente: "FS01-842" / "-8428".
      const tail = (lines[idx + 1] || '').match(/(?:^|\s)-\s*(\d{3,9})\s*$/);
      if (tail && tail[1].startsWith(corr) && tail[1].length > corr.length) corr = tail[1];
      const v = `${fixSerie(m[1])}-${corr}`;
      const e = found.get(v) || { v, n: 0, idx };
      e.n++;
      found.set(v, e);
    }
  });
  if (found.size) {
    const all = [...found.values()];
    // una lectura que es prefijo de otra más larga (dígito perdido) cuenta a favor de la larga
    for (const a of all) for (const b of all) if (a !== b && b.v.startsWith(a.v) && b.v.length > a.v.length) b.n += a.n;
    all.sort((a, b) => b.n - a.n || b.v.length - a.v.length || a.idx - b.idx);
    return all[0].v;
  }
  for (let i = 0; i < lines.length; i++) {
    const n = norm(lines[i]);
    const same = n.match(/(?:NRO|NUMERO|N[°ºO])\.?\s*(?:DE\s*)?(?:OPERACION|TRANSACCION|MOVIMIENTO|SOLICITUD|REFERENCIA)\s*[:.]?\s*([A-Z0-9-]{4,})\s*$/);
    if (same && /\d{3}/.test(same[1])) return same[1];
    if (/(?:NRO|NUMERO|N[°ºO])\.?\s*(?:DE\s*)?(?:OPERACION|TRANSACCION|SOLICITUD|REFERENCIA)\s*[:.]?\s*$/.test(n)) {
      // valor en una línea aparte (las columnas del voucher se leen por separado)
      const v = lines.slice(i + 1, i + 14).find((l) => /^\d{6,12}$/.test(l.trim()) && !/^(10|20)\d{9}$/.test(l.trim()));
      if (v) return v.trim();
    }
  }
  const KEY = /OPERACION|TRANSACCION|MOVIMIENTO|RECIBO|COMPROBANTE|CONSTANCIA|REFERENCIA|N[°ºO]\.?\s*:?|NRO|NUMERO|CODIGO/;
  const tokenRe = /[A-Z0-9][A-Z0-9-]{2,}/g;
  const pick = (txt) => {
    txt = txt.replace(/\d{1,2}\s*[\/.-]\s*\d{1,2}\s*[\/.-]\s*\d{2,4}/g, ' ').replace(/\d{1,2}:\d{2}(:\d{2})?/g, ' ');
    for (const t of txt.match(tokenRe) || []) {
      const digits = (t.match(/\d/g) || []).length;
      if (digits < 3 || /^\d{11}$/.test(t) || /^\d{1,2}-\d{1,2}-\d{2,4}$/.test(t)) continue;
      if (/^(20|10)\d{9}$/.test(t)) continue;
      return t.replace(/^-+|-+$/g, '');
    }
    return '';
  };
  for (let i = 0; i < lines.length; i++) {
    const n = norm(lines[i]);
    if (/\bRUC\b|TELEF|CELULAR|FECHA|HORA/.test(n) && !/OPERACION|RECIBO|CODIGO/.test(n)) continue;
    const m = n.match(/(NUMERO DE OPERACION|NRO\.? DE OPERACION|N[°ºO]\.? DE OPERACION|CODIGO DE OPERACION|N[°ºO]\.? OPERACION|NRO\.? OPERACION|OPERACION|MOVIMIENTO|RECIBO|CONSTANCIA|COMPROBANTE|REFERENCIA|CODIGO)[^\dA-Z]*([A-Z0-9-]*)/);
    if (!m) continue;
    const after = n.slice(n.indexOf(m[1]) + m[1].length).replace(/^\s*(DE|N[°ºO]\.?|NRO\.?|NUMERO|:)+\s*/g, '');
    let v = pick(after);
    if (!v && !/[A-Z0-9]/.test(after) && lines[i + 1]) v = pick(norm(lines[i + 1]));
    if (v) return v;
  }
  void KEY;
  return '';
}

export function extractConcept(lines) {
  const lab = labeledValue(lines, /POR CONCEPTO DE|CONCEPTO|MOTIVO|MENSAJE|GLOSA|OBSERVACION(?:ES)?|DETALLE DEL PAGO|DETALLE:/, { requireName: true });
  if (lab && lab.length > 2 && !/^(DESCRIPCION|CANT)/.test(norm(lab))) return lab.slice(0, 160);
  const hi = lines.findIndex((l) => /DESCRIPCION|DETALLE|PRODUCTO|ARTICULO/.test(norm(l)) && /CANT|P\.?\s?UNIT|IMPORTE|PRECIO|UND|UNID|TOTAL/.test(norm(l)) || /^(DESCRIPCION|DETALLE)\s*$/.test(norm(l)));
  if (hi < 0) return '';
  const items = [];
  let qtyFirst = null; // ¿las filas empiezan con cantidad/código? Entonces las líneas sin cantidad continúan la fila anterior.
  for (let j = hi + 1; j < lines.length && items.length < 8; j++) {
    const n = norm(lines[j]);
    if (/SUB\s*TOTAL|\bTOTAL\b|^SON\b|OP\.? ?GRAVADA|\bIGV\b|IMPORTE|FORMA DE PAGO|MONTO EN LETRAS|BASE IMPONIBLE|OBSERV|VALOR (DE )?VENTA|OPERACIONES|ANTICIPO|DSCTO\.? S\/|INFORMACION|REPRESENTACION|RESUMEN/.test(n)) break;
    const start = rowStarts(lines[j]);
    if (qtyFirst === null) qtyFirst = start;
    const c = cleanItem(lines[j]);
    if (qtyFirst && !start && items.length) { if (c && !/^[\d.,\s-]+$/.test(c)) items[items.length - 1] += ' ' + c; continue; }
    if ((c.match(/[A-Za-zÁÉÍÓÚÑ]/g) || []).length >= 3) items.push(c);
  }
  // Varios productos: una lista con puntos, un producto por línea. Uno solo: texto simple.
  return items.length > 1 ? items.map((s) => '• ' + s.slice(0, 120)).join('\n') : (items[0] || '').slice(0, 160);
}

const UNITS = '(?:METROS?|UNIDADES|UNIDAD|UNDS?|UNID|NIU|ZZ|KGS?|KILOS?|M2|M3|ML|M|BLS|BOLSAS?|GLN|GALON(?:ES)?|PZAS?|PIEZAS?|SERV|SERVICIO|LTS?|LITROS?|CJA|CAJAS?|ROLLOS?|PAR|DOC|MLL|MILLAR|SACOS?|BALDES?|JGO|JUEGO)';
const isMoney = (s) => /^[S$§Ss5]\/?\d[\d.,]*$|^[S$§Ss]\/$|^-?\d+[.,]\d{2}$/.test(s);
const isCode = (s) => s.length >= 6 && /^[A-Z0-9-]+$/.test(s) && /\d/.test(s) && /[A-Z]/.test(s);

const rowStarts = (line) => {
  const c = line.replace(/[—–_|]+/g, ' ').trim();
  return new RegExp(`^\\d+(?:[.,]\\d{1,3})?\\s+${UNITS}\\b`, 'i').test(c) || new RegExp(`^${UNITS}\\b`, 'i').test(c) || isCode(c.split(/\s+/)[0] || '');
};

/** Deja solo la descripción de una fila de detalle (sin cantidad, unidad, código ni precios). */
export function cleanItem(line) {
  let c = line.replace(/[—–_|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const q = new RegExp(`^\\d+(?:[.,]\\d{1,3})?\\s+(?:${UNITS}\\b\\.?\\s+)?`, 'i');
  if (q.test(c)) c = c.replace(q, '');
  else {
    const u = new RegExp(`^${UNITS}\\b\\.?\\s+`, 'i');
    const rest = c.replace(u, '');
    if (u.test(c) && isCode(rest.split(' ')[0])) c = rest;
  }
  const t = c.split(' ');
  if (t.length > 1 && isCode(t[0])) t.shift();
  while (t.length > 1) {
    const last = t[t.length - 1], prev = t[t.length - 2];
    if (isMoney(last) || /^(?:UN|UND|NIU)\d{0,4}$/i.test(last) || (/^\d{3,}$/.test(last) && isMoney(prev))) t.pop();
    else break;
  }
  return t.join(' ').trim();
}

export function detectType(text) {
  const n = norm(text);
  if (/YAPE/.test(n)) return 'YAPE';
  if (/\bPLIN\b/.test(n)) return 'PLIN';
  if (/FACTURA/.test(n)) return 'FACTURA';
  if (/BOLETA/.test(n)) return 'BOLETA';
  if (/TRANSFERENCIA|OPERACION EXITOSA|CONSTANCIA|VOUCHER|DEPOSITO/.test(n)) return 'VOUCHER';
  if (/RECIBO/.test(n)) return 'RECIBO';
  return '';
}

/** Punto de entrada: texto → campos + advertencias + estado. */
export function extractFields(text, confidence = 100) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const warnings = [];
  const tipo = detectType(text);
  const fecha = extractDate(lines);
  const numero = extractNumber(lines);
  const proveedor = extractProvider(lines);
  const concepto = extractConcept(lines);
  const egreso = extractAmount(lines, warnings);
  const missing = [];
  if (!fecha) missing.push('fecha');
  if (!numero) missing.push('N° de comprobante');
  if (!proveedor) missing.push('beneficiario/proveedor');
  if (egreso == null) missing.push('importe');
  if (missing.length) warnings.push(`No se reconoció: ${missing.join(', ')}. Complételo manualmente.`);
  if (confidence < 60) warnings.push(`Lectura de baja calidad (${Math.round(confidence)}%). Revise todos los datos con la foto.`);
  if (!lines.length) warnings.push('No se detectó texto en la imagen.');
  const status = !lines.length ? 'ERROR' : missing.length || warnings.length ? 'REVISAR' : 'OK';
  return { fields: { fecha, numero, proveedor, concepto, egreso: egreso == null ? '' : egreso.toFixed(2) }, tipo, warnings, status, confidence };
}

const keyNum = (s) => {
  const n = norm(s).replace(/[–—\s]/g, '').replace(/[^A-Z0-9-]/g, '');
  const m = n.match(/^([A-Z0-9]+)-0*(\d+)$/);
  return m ? m[1] + '-' + m[2] : n.replace(/-/g, '').replace(/^0+(?=\d)/, '');
};
const keyName = (s) => norm(s).replace(/[^A-Z0-9]/g, '');

/** ¿El comprobante `a` coincide con alguno de `others`? Devuelve descripción o null. */
export function matchRecord(a, others) {
  const an = keyNum(a.numero), ap = keyName(a.proveedor), amt = Number(a.egreso);
  for (const o of others) {
    const on = keyNum(o.numero), op = keyName(o.proveedor), omt = Number(o.egreso);
    const sameAmt = Number.isFinite(amt) && Number.isFinite(omt) && Math.abs(amt - omt) < 0.005 && amt > 0;
    const sameDate = !!a.fecha && a.fecha === o.fecha;
    const sameNum = !!an && an === on;
    const sameProv = !!ap && ap === op;
    if ((sameNum && sameAmt) || (sameNum && sameDate) || (sameDate && sameAmt && sameProv)) return o;
  }
  return null;
}

export function findDuplicate(a, others) {
  const m = matchRecord(a, others);
  return m ? m.origen || 'registro anterior' : null;
}









