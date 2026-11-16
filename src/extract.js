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

const EXCLUDE_AMOUNT = /SUB\s*TOTAL|IGV|I\.G\.V|IMPUESTO|GRAVAD|EXONERAD|INAFECT|GRATUIT|VUELTO|CAMBIO|DESCUENTO|DSCTO|DCTO|ICBPER|REDONDEO|RECIBIDO|PAGO CON|SU PAGO|EFECTIVO|PERCEP|DETRAC|COMISION|ITF|SALDO/;

const KEYS = [
  { re: /TOTAL A PAGAR|IMPORTE TOTAL|TOTAL PAGADO|MONTO TOTAL|TOTAL VENTA|TOTAL GENERAL|IMPORTE PAGADO|MONTO PAGADO|NETO A PAGAR|TOTAL COMPROBANTE|MONTO ENVIADO|MONTO TRANSFERIDO|MONTO DE (LA )?OPERACION|IMPORTE DE (LA )?OPERACION|IMPORTE ENVIADO|YAPEASTE|PLINEASTE|TE YAPEO|ENVIASTE|TOTAL PAGO|IMPORTE DEL PAGO|MONTO DEL PAGO|MONTO ABONADO|IMPORTE TRANSFERIDO/, rank: 3, next: true },
  { re: /\bTOTAL\b/, rank: 2, next: false },
  { re: /\bMONTO\b|\bIMPORTE\b|\bPAGO\b/, rank: 1, next: true },
];

export function extractAmount(lines, warnings) {
  const cands = [];
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
    if (/VENCIMIENTO|NACIMIENTO|VENCE|VALIDO HASTA/.test(n)) return;
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

const BLACK_NAME = /FACTURA|BOLETA|ELECTRONIC|\bRUC\b|TICKET|DIRECCION|^AV\b|^JR\b|^CALLE|^PSJE|TELEF|DOCUMENTO|CLIENTE|SENOR|FECHA|HORA|REPRESENTACION|IMPRESA|SUNAT|GRACIAS|PAGINA|COMPROBANTE|NOTA DE|\bN[°ºO]\b|^LIMA|^PIURA|^TEL|^CEL|WWW\.|@|VENTA|COPIA|ORIGINAL|OPERACION|YAPE|PLIN/;

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

export function extractProvider(lines) {
  for (const re of [/NOMBRE DEL BENEFICIARIO|BENEFICIARIO|DESTINATARIO|PROVEEDOR/, /ENVIADO A|YAPEASTE A|PLINEASTE A|PAGADO A|TRANSFERIDO A|NOMBRE DE DESTINO/, /DESTINO/, /\bPARA\b/]) {
    const labeled = labeledValue(lines, re);
    if (labeled && looksLikeName(labeled) && !/:\s*\S/.test(labeled)) return labeled;
  }

  const rucIdx = [];
  lines.forEach((l, i) => { if (/\b(10|15|17|20)\d{9}\b/.test(l.replace(/[\s-]/g, '')) && /RUC/i.test(l)) rucIdx.push(i); });
  const isClientCtx = (i) => lines.slice(Math.max(0, i - 3), i + 1).some((l) => /CLIENTE|SENOR|ADQUIRIENTE|DESTINATARIO/.test(norm(l)));
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
  for (const line of lines) {
    const n = norm(line).replace(/[–—]/g, '-');
    if (/\bRUC\b/.test(n) && !SERIE_RE.test(n)) continue;
    const m = n.match(SERIE_RE);
    if (m && /\d/.test(m[1] + m[2])) return `${fixSerie(m[1])}-${m[2]}`;
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
    const m = n.match(/(NUMERO DE OPERACION|NRO\.? DE OPERACION|N[°ºO]\.? DE OPERACION|CODIGO DE OPERACION|N[°ºO]\.? OPERACION|NRO\.? OPERACION|OPERACION|TRANSACCION|MOVIMIENTO|RECIBO|CONSTANCIA|COMPROBANTE|REFERENCIA|CODIGO)[^\dA-Z]*([A-Z0-9-]*)/);
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
  for (let j = hi + 1; j < lines.length && items.length < 4; j++) {
    const n = norm(lines[j]);
    if (/SUB\s*TOTAL|\bTOTAL\b|^SON\b|OP\.? ?GRAVADA|\bIGV\b|IMPORTE|FORMA DE PAGO|OBSERV/.test(n)) break;
    const c = lines[j]
      .replace(/\d+[.,]\d{2,}/g, ' ')
      .replace(/^\s*\d+([.,]\d+)?\s*(UND|UNID|UNIDAD|NIU|ZZ|KG|M|M2|M3|BLS|BOLSA|GLN|PZA|SERV)?\b\.?\s+/i, '')
      .replace(/[|]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+\d+$/, '')
      .trim();
    if ((c.match(/[A-Za-zÁÉÍÓÚÑ]/g) || []).length >= 3) items.push(c);
  }
  return items.join('; ').slice(0, 160);
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
export function findDuplicate(a, others) {
  const an = keyNum(a.numero), ap = keyName(a.proveedor), amt = Number(a.egreso);
  for (const o of others) {
    const on = keyNum(o.numero), op = keyName(o.proveedor), omt = Number(o.egreso);
    const sameAmt = Number.isFinite(amt) && Number.isFinite(omt) && Math.abs(amt - omt) < 0.005 && amt > 0;
    const sameDate = !!a.fecha && a.fecha === o.fecha;
    const sameNum = !!an && an === on;
    const sameProv = !!ap && ap === op;
    if ((sameNum && sameAmt) || (sameNum && sameDate) || (sameDate && sameAmt && sameProv)) return o.origen || 'registro anterior';
  }
  return null;
}



