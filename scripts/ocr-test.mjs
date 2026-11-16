// Prueba real de OCR (Node) con los mismos datos de idioma que usa la web. Uso: npm run test:ocr
import { createWorker } from 'tesseract.js';
import { readdirSync } from 'node:fs';
import { extractFields } from '../src/extract.js';

const w = await createWorker(['spa', 'eng'], 1, { langPath: 'public/ocr/lang', gzip: true, cachePath: '.ocr-cache' });
for (const f of readdirSync('tests/fixtures').filter((n) => /\.(jpg|png)$/.test(n))) {
  const { data } = await w.recognize('tests/fixtures/' + f);
  const x = extractFields(data.text, data.confidence);
  console.log(`\n== ${f}  (confianza ${data.confidence.toFixed(0)}%, estado ${x.status}, tipo ${x.tipo})`);
  console.log(x.fields, x.warnings);
}
await w.terminate();
