// OCR local con Tesseract.js (motor, worker e idiomas servidos desde esta misma web: sin CDN, sin APIs).
import { createWorker } from 'tesseract.js';
import { pdfItemsToText } from './pdftext.js';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

const abs = (p) => new URL(import.meta.env.BASE_URL + p, location.href).href;
let workerP = null;
let onProgress = () => {};

export function getWorker() {
  workerP ||= createWorker(['spa', 'eng'], 1, {
    workerPath: abs('ocr/worker.min.js'),
    corePath: abs('ocr/core'),
    langPath: abs('ocr/lang'),
    gzip: true,
    logger: (m) => { if (m.status === 'recognizing text') onProgress(m.progress); },
  }).then(async (w) => {
    await w.setParameters({ preserve_interword_spaces: '1' });
    return w;
  }).catch((e) => { workerP = null; throw e; });
  return workerP;
}

async function toBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fallback */ }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

const canvasBlob = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));

function drawScaled(src, w, h, maxSide, minSide) {
  let s = 1;
  const long = Math.max(w, h), short = Math.min(w, h);
  if (long > maxSide) s = maxSide / long;
  else if (short < minSide) s = Math.min(2, minSide / short);
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Escala de grises + estiramiento de contraste (mejora fotos de celular sin binarizar). */
function enhance(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    d[i] = g; hist[g]++;
  }
  const total = d.length / 4;
  let acc = 0, lo = 0, hi = 255;
  // Percentiles muy bajos para el negro: el texto ocupa poco área frente al fondo.
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > total * 0.001) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > total * 0.05) { hi = i; break; } }
  if (hi - lo < 60) lo = Math.max(0, hi - 160); // imagen casi uniforme: no estirar de más
  const range = Math.max(60, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

async function ocrCanvas(canvas) {
  const w = await getWorker();
  const blob = await canvasBlob(canvas, 'image/png');
  await w.setParameters({ tessedit_pageseg_mode: '3' });
  const r = (await w.recognize(blob)).data;
  if (r.confidence >= 90) return { text: r.text, confidence: r.confidence };
  // Segunda lectura con otro modo de segmentación: se juntan ambos textos (logos/columnas se leen distinto).
  await w.setParameters({ tessedit_pageseg_mode: '6' });
  const r2 = (await w.recognize(blob)).data;
  return { text: r.text + '\n' + r2.text, confidence: Math.max(r.confidence, r2.confidence) };
}

async function pdfTextOrCanvases(file) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = Math.min(pdf.numPages, 3);
  let text = '';
  let first = null;
  const canvases = [];
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    text += pdfItemsToText(tc.items) + '\n';
    const vp = page.getViewport({ scale: Math.min(3, 2200 / Math.max(page.view[2], page.view[3])) });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp, canvas: c }).promise;
    if (!first) first = c;
    canvases.push(c);
  }
  return { text, first, canvases };
}

/**
 * Procesa una imagen o PDF. Devuelve { text, confidence, image(Blob JPEG para revisión), method }.
 */
export async function recognizeFile(file, progress) {
  onProgress = progress || (() => {});
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    const { text, first, canvases } = await pdfTextOrCanvases(file);
    const image = await canvasBlob(drawScaled(first, first.width, first.height, 1600, 0), 'image/jpeg', 0.8);
    if (text.replace(/\s/g, '').length > 40) return { text, confidence: 100, image, method: 'texto del PDF' };
    let out = '', conf = 0;
    for (const c of canvases) { const r = await ocrCanvas(enhance(c)); out += r.text + '\n'; conf += r.confidence / canvases.length; }
    return { text: out, confidence: conf, image, method: 'OCR (PDF escaneado)' };
  }
  const bmp = await toBitmap(file);
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
  const image = await canvasBlob(drawScaled(bmp, w, h, 1600, 0), 'image/jpeg', 0.8);
  const canvas = enhance(drawScaled(bmp, w, h, 2400, 1400));
  bmp.close?.();
  const r = await ocrCanvas(canvas);
  return { ...r, image, method: 'OCR' };
}

