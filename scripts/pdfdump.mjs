import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync } from 'node:fs';
import { pdfItemsToText } from '../src/pdftext.js';
import { extractFields } from '../src/extract.js';
for (const f of ['e001','f002']) {
  const pdf = await getDocument({data:new Uint8Array(readFileSync(`tests/fixtures/${f}.pdf`)), verbosity:0}).promise;
  let t=''; for (let p=1;p<=Math.min(3,pdf.numPages);p++) t += pdfItemsToText((await (await pdf.getPage(p)).getTextContent()).items)+'\n';
  console.log('=====',f); if (process.argv[2]) console.log(t);
  const x=extractFields(t); console.log(x.fields, x.warnings, x.status);
}
