import { appendRecords } from '../src/excel.js';
import { writeFileSync } from 'node:fs';
const { buffer } = await appendRecords(null, [{ hid:'abc123', fecha:'2026-11-09', numero:'F002-431', proveedor:'X SAC', concepto:'Cable', egreso:'10.00', img:'data:image/jpeg;base64,AAAA' }], { appUrl:'https://jeffersonkid.github.io/gastos-sechura/', history:[] });
writeFileSync(process.argv[2], Buffer.from(buffer));
