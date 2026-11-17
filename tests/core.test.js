import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { extractFields, parseAmount, findDuplicate } from '../src/extract.js';
import { appendRecords, readExcel, shiftFormula } from '../src/excel.js';

const FACTURA = `FERRETERIA CONSTRUCTORA SECHURA S.A.C.
RUC: 20601234567
AV. GRAU 123 - SECHURA - PIURA
FACTURA ELECTRONICA
F001-00012345
Fecha de emisión: 14/03/2026
Señor(es): CONSORCIO OBRA SECHURA
RUC: 20509998887
Cant  Descripción        P.Unit   Importe
10 BLS Cemento Sol tipo I   30.00   300.00
2 UND Fierro corrugado 1/2   45.00   90.00
Op. Gravada 330.51
IGV 18% 59.49
Importe Total S/ 390.00
SON: TRESCIENTOS NOVENTA Y 00/100 SOLES`;

const BOLETA = `FERRETERIA EL PROGRESO E.I.R.L.
RUC 10456789012
BOLETA DE VENTA ELECTRONICA
B001-0004567
FECHA: 02-04-2026 10:15
DESCRIPCION CANT P.UNIT TOTAL
CLAVOS 3 PULG 2 KG 6.50 13.00
ALAMBRE N16 5 KG 5.00 25.00
SUBTOTAL 32.20
IGV 5.80
TOTAL S/ 38.00
EFECTIVO 50.00
VUELTO 12.00`;

const YAPE = `¡Yapeaste!
S/ 150
15 mar. 2026 | 10:30 a. m.
Destino
Juan Pérez Quispe
Nro. de operación
04839201
Mensaje
Pago de peón`;

const VOUCHER = `BCP
Constancia de transferencia
Operación exitosa
Fecha y hora: 20/05/2026 14:22
Número de operación: 00987654
Cuenta destino
Beneficiario: TRANSPORTES RIVERA SAC
Monto transferido: S/ 1,250.50
Comisión: S/ 0.00
Concepto: Flete de arena`;

describe('parseAmount', () => {
  it.each([['1,234.50', 1234.5], ['1.234,50', 1234.5], ['S/ 50,00', 50], ['390.00', 390], ['1,250', 1250], ['12.5', 12.5]])('%s', (a, b) => expect(parseAmount(a)).toBe(b));
});

describe('extracción', () => {
  it('factura electrónica', () => {
    const r = extractFields(FACTURA).fields;
    expect(r.fecha).toBe('2026-03-14');
    expect(r.numero).toBe('F001-00012345');
    expect(r.proveedor).toBe('FERRETERIA CONSTRUCTORA SECHURA S.A.C.');
    expect(r.egreso).toBe('390.00'); // no el IGV ni el subtotal
    expect(r.concepto.toLowerCase()).toContain('cemento');
  });
  it('boleta: total, no vuelto ni efectivo', () => {
    const r = extractFields(BOLETA).fields;
    expect(r.egreso).toBe('38.00');
    expect(r.numero).toBe('B001-0004567');
    expect(r.fecha).toBe('2026-04-02');
    expect(r.proveedor).toBe('FERRETERIA EL PROGRESO E.I.R.L.');
  });
  it('yape', () => {
    const x = extractFields(YAPE);
    expect(x.tipo).toBe('YAPE');
    expect(x.fields.egreso).toBe('150.00');
    expect(x.fields.fecha).toBe('2026-03-15');
    expect(x.fields.numero).toBe('04839201');
    expect(x.fields.proveedor).toBe('Juan Pérez Quispe');
    expect(x.fields.concepto).toBe('Pago de peón');
  });
  it('voucher bancario', () => {
    const r = extractFields(VOUCHER).fields;
    expect(r.egreso).toBe('1250.50');
    expect(r.numero).toBe('00987654');
    expect(r.proveedor).toBe('TRANSPORTES RIVERA SAC');
    expect(r.fecha).toBe('2026-05-20');
    expect(r.concepto).toBe('Flete de arena');
  });
  it('no inventa datos', () => {
    const x = extractFields('hola mundo\nsin datos');
    expect(x.fields.fecha).toBe('');
    expect(x.fields.egreso).toBe('');
    expect(x.status).toBe('REVISAR');
  });
  it('advierte con varios importes', () => {
    const x = extractFields('TIENDA SAC\nTOTAL 100.00\nTOTAL A PAGAR 90.00');
    expect(x.fields.egreso).toBe('90.00');
    expect(x.warnings.join(' ')).toMatch(/Varios importes/);
  });
});

describe('duplicados', () => {
  const prev = [{ numero: 'F001-00012345', fecha: '2026-03-14', proveedor: 'X', egreso: '390.00', origen: 'Excel, fila 5' }];
  it('detecta', () => expect(findDuplicate({ numero: 'F001-12345', fecha: '', proveedor: '', egreso: '390' }, prev)).toBe('Excel, fila 5'));
  it('no bloquea similares', () => expect(findDuplicate({ numero: 'F001-00012346', fecha: '2026-03-14', proveedor: 'Y', egreso: '120.00' }, prev)).toBeNull());
});

async function sampleWorkbook(withTotals) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja1');
  ws.getCell('A1').value = 'GASTOS REALIZADOS EN OBRA SECHURA';
  ['ÍTEM', 'FECHA', 'N° RECIBO/FACTURA/BOLETA O MOVIMIENTO', 'BENEFICIARIO/PROVEEDOR', 'CONCEPTO/DETALLE DEL GASTO', 'INGRESOS (+)', 'EGRESOS (-)'].forEach((h, i) => {
    const c = ws.getRow(4).getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  });
  [['01', new Date(Date.UTC(2026, 0, 5)), 'B001-1', 'ACME', 'Cemento', null, 100], ['02', new Date(Date.UTC(2026, 0, 6)), 'F001-2', 'BETA', 'Arena', null, 250.5]].forEach((r, k) => {
    r.forEach((v, i) => {
      const c = ws.getRow(5 + k).getCell(i + 1);
      c.value = v;
      c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      c.font = { name: 'Arial', size: 11 };
    });
    ws.getRow(5 + k).getCell(2).numFmt = 'dd/mm/yyyy';
  });
  ws.getColumn(5).width = 55;
  if (withTotals) {
    ws.getCell('D7').value = 'TOTAL';
    ws.getCell('G7').value = { formula: 'SUM(G5:G6)', result: 350.5 };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const NEW = [
  { fecha: '2026-03-14', numero: 'F001-00012345', proveedor: 'FERRETERIA SECHURA SAC', concepto: 'Cemento', egreso: '390.00' },
  { fecha: '2026-03-15', numero: '04839201', proveedor: 'Juan Pérez', concepto: 'Peón', egreso: '1250.5' },
];

describe('excel', () => {
  it('conserva registros, estilos y numera', async () => {
    const base = await sampleWorkbook(false);
    const { buffer } = await appendRecords(base, NEW);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet('Hoja1');
    expect(ws.getCell('A1').value).toBe('GASTOS REALIZADOS EN OBRA SECHURA');
    expect(ws.getCell('D5').value).toBe('ACME');
    expect(ws.getCell('G6').value).toBe(250.5);
    expect(ws.getCell('A7').value).toBe('03');
    expect(ws.getCell('A8').value).toBe('04');
    expect(ws.getCell('C7').value).toBe('F001-00012345');
    expect(ws.getCell('D7').value).toBe('FERRETERIA SECHURA SAC');
    expect(ws.getCell('G7').value).toBe(390);
    expect(ws.getCell('G8').value).toBe(1250.5);
    expect(ws.getCell('G7').numFmt).toBe('#,##0.00');
    expect(ws.getCell('F7').value).toBeNull();
    expect(ws.getCell('B7').value).toEqual(new Date(Date.UTC(2026, 2, 14)));
    expect(ws.getCell('D7').border.top.style).toBe('thin');
    expect(ws.getCell('D7').font.name).toBe('Arial');
    expect(ws.getCell('A4').fill.fgColor.argb).toBe('FF1F3864');
    expect(ws.getColumn(5).width).toBe(55);
    const info = await readExcel(buffer);
    expect(info.count).toBe(4);
    expect(info.nextItem).toBe(5);
  });
  it('con fila de total: inserta antes y extiende la suma', async () => {
    const base = await sampleWorkbook(true);
    const { buffer } = await appendRecords(base, NEW);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet('Hoja1');
    expect(ws.getCell('D7').value).toBe('FERRETERIA SECHURA SAC');
    expect(ws.getCell('D8').value).toBe('Juan Pérez');
    expect(ws.getCell('D9').value).toBe('TOTAL');
    expect(ws.getCell('G9').value.formula).toBe('SUM(G5:G8)');
    expect(ws.getCell('D5').value).toBe('ACME');
  });
  it('crea Excel nuevo con la estructura exacta', async () => {
    const { buffer } = await appendRecords(null, NEW);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    expect(ws.getCell('A1').value).toBe('GASTOS REALIZADOS EN OBRA SECHURA');
    expect(ws.getCell('G3').value).toBe('EGRESOS (-)');
    expect(ws.getCell('A4').value).toBe('01');
    expect(ws.getCell('G5').value).toBe(1250.5);
    const info = await readExcel(buffer);
    expect(info.count).toBe(2);
  });
  it('shiftFormula', () => expect(shiftFormula('SUM(G5:G6)+G9', 7)).toBe('SUM(G5:G7)+G10'));
});

describe('factura real NORHOGAR (dos RUC, logo, tabla con códigos)', () => {
  const TXT = `GUENTE                                                                                                  RUC : 20525524435
RUC                20602520146                                                                  A
DENOMINACION             TRANSPORTES DIEGO DE GUADALUPE ELR.L.                                               FACTURA ELECTRÓNICA
FECHA DE FACTURA        20/10/2026            MONEDA              Soles                        FS01-8428
FECHA DE VENCIMIENTO      20/10/2026
CANT_UdM     CÓDIGO         DESCRIPCIÓN                                                       iu     P/U__ SUBTOTAL
50.000 Unidades — RAPMORTARO0O1  RAPIMIX MORTERO TARRAJEQ TIPO MS (MORADO)                              S/1144 §/1350  §/51203
45.000 Unidades  PEGAMECHO0001 — PEGAMENTO CHEMAYOLIC GRIS * 25 KIL                                   $/1525  $/1800  $/686.44
5000 Unidades — VESOMRO000001  YESOMORROPE 08 KIL                                            $/424  §/500 s/2119
FORMA DE PAGO                               (conTaDo]                                                                                             BASE IMPONIBLE                                          $/1,322.03
MONTO EN LETRAS                            MIL QUINIENTOS SESENTA CON 00/100 SOLES                                                 Iv                                                             §1231.91
TOTAL                       $/1,560.00
2h   MATERIALES DE  NORHOGAR SRL                                      ¡.. SOMOS tu mejor ALIADO...en tu`;
  it('proveedor = emisor (no el cliente), concepto = lo comprado, egreso = TOTAL', () => {
    const r = extractFields(TXT).fields;
    expect(r.proveedor).toBe('NORHOGAR SRL');
    expect(r.numero).toBe('FS01-8428');
    expect(r.fecha).toBe('2026-10-20');
    expect(r.egreso).toBe('1560.00');
    expect(r.concepto).toBe('RAPIMIX MORTERO TARRAJEQ TIPO MS (MORADO); PEGAMENTO CHEMAYOLIC GRIS * 25 KIL; YESOMORROPE 08 KIL');
  });
});

describe('N° con dígito perdido en una lectura', () => {
  it('prefiere la lectura completa', () => {
    expect(extractFields('FACTURA ELECTRONICA\nFS01-842\nFS01-8428\nTOTAL S/ 10.00').fields.numero).toBe('FS01-8428');
  });
});

describe('correlativo cortado en dos líneas', () => {
  it('une FS01-842 con -8428', () => {
    expect(extractFields('FACTURA\nDIRECCION CAL X     FS01-842\nFECHA DE FACTURA 20/10/2026     -8428\nTOTAL S/ 10.00').fields.numero).toBe('FS01-8428');
  });
});
