import { createWorker } from 'tesseract.js';
import { extractFields } from '../src/extract.js';
const w = await createWorker(['spa','eng'],1,{langPath:'public/ocr/lang',gzip:true,cachePath:'.ocr-cache'});
await w.setParameters({preserve_interword_spaces:'1'});
let t='';
for (const m of ['3','6']) { await w.setParameters({tessedit_pageseg_mode:m}); t += (await w.recognize('tests/fixtures/norhogar.png')).data.text+'\n'; }
const x=extractFields(t,78); console.log(x.fields, x.warnings, x.status);
const y=extractFields(t.split('\n').slice(0,Math.floor(t.split('\n').length/2)).join('\n'),78); console.log('solo PSM3:', y.fields);
await w.terminate();
