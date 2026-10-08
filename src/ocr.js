// Reads the text in a screenshot ON THIS DEVICE (nothing is uploaded). Uses Tesseract.js with English data:
// the amounts, dates, + / - signs and bank codes in a bank history are digits and Latin letters.
let workerPromise = null;
let onProgress = null;

const url = (p) => new URL(p, document.baseURI).href;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker('eng', 1, {
        workerPath: url('ocr/worker.min.js'),
        corePath: url('ocr/core'),
        langPath: url('ocr/lang'),
        gzip: true,
        logger: (m) => { if (onProgress && m && typeof m.progress === 'number' && m.status === 'recognizing text') onProgress(m.progress); }
      });
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

// Bigger, grey, and light-on-dark flipped to dark-on-light: this is what makes the reading reliable.
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  let scale = Math.min(3, Math.max(1, 1600 / bmp.width));
  let w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const MAX = 24e6;
  if (w * h > MAX) { const k = Math.sqrt(MAX / (w * h)); w = Math.round(w * k); h = Math.round(h * k); }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; d[i] = d[i + 1] = d[i + 2] = g; sum += g; }
  if (sum / (d.length / 4) < 110) for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = 255 - d[i]; }
  ctx.putImageData(img, 0, 0);
  return c;
}

// files: array of File. progress(fraction 0..1 across all files). Returns all text, one image after another.
export async function readImagesText(files, progress) {
  const worker = await getWorker();
  let out = '';
  for (let i = 0; i < files.length; i++) {
    onProgress = (p) => { if (progress) progress((i + p) / files.length); };
    const canvas = await prepare(files[i]);
    const { data } = await worker.recognize(canvas);
    out += (data.text || '') + '\n';
  }
  onProgress = null;
  return out;
}
