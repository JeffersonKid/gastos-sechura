import { describe, it, expect } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
import { pdfItemsToText } from '../src/pdftext.js';
import { extractFields } from '../src/extract.js';

async function pdfFields(name) {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(`tests/fixtures/${name}.pdf`)), verbosity: 0 }).promise;
  let t = '';
  for (let p = 1; p <= Math.min(3, pdf.numPages); p++) t += pdfItemsToText((await (await pdf.getPage(p)).getTextContent()).items) + '\n';
  return extractFields(t).fields;
}

describe('PDF reales', () => {
  it('E001-1289 (ESINEEL)', async () => {
    const f = await pdfFields('e001');
    expect(f).toMatchObject({ fecha: '2026-10-30', numero: 'E001-1289', proveedor: 'ESINEEL S.A.C', egreso: '1603.12' });
    expect(f.concepto).toContain('CONDUCTOR ELECTRICO 1KV LIBRE HALOGENO 6MM2 NEGRO N2XOH');
  });
  it('F002-431', async () => {
    const f = await pdfFields('f002');
    expect(f).toMatchObject({ fecha: '2026-11-09', numero: 'F002-00000431', egreso: '219.80' });
    expect(f.proveedor).toBe('ESTUDIOS-DISEÑOS DE INGENIERIA ELECTRICA & ELECTRONICA S.A.C.');
  });
});
