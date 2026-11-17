import { appendRecords } from '../src/excel.js';
import { writeFileSync } from 'node:fs';
const { buffer } = await appendRecords(null, [
 { fecha:'2026-10-30', numero:'E001-1289', proveedor:'ESINEEL S.A.C', concepto:'Cable', egreso:'1603.12' },
 { fecha:'2026-11-09', numero:'F002-00000431', proveedor:'ESTUDIOS-DISEÑOS DE INGENIERIA ELECTRICA & ELECTRONICA S.A.C.', concepto:'Cable', egreso:'219.80' },
]);
writeFileSync('dist/base.xlsx', Buffer.from(buffer));
