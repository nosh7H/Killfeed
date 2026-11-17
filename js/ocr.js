// In-browser OCR with Tesseract.js (loaded from CDN only when first used).
let loading = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!loading) {
    loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = () => res(window.Tesseract);
      s.onerror = () => { loading = null; rej(new Error('Could not load the OCR engine (check your connection).')); };
      document.head.append(s);
    });
  }
  return loading;
}

// CoD scoreboards are light text on dark, translucent backgrounds.
// Upscale, grayscale, invert when dark, and stretch contrast.
async function preprocess(blob) {
  const img = await createImageBitmap(blob);
  const scale = img.width < 2000 ? 2 : 1;
  const c = document.createElement('canvas');
  c.width = img.width * scale; c.height = img.height * scale;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = g; sum += g;
  }
  const invert = sum / (px.length / 4) < 128;
  for (let i = 0; i < px.length; i += 4) {
    let g = px[i];
    if (invert) g = 255 - g;
    g = g < 150 ? Math.max(0, (g - 40) * 1.6) : 255; // soft threshold
    px[i] = px[i + 1] = px[i + 2] = g;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

export async function recognize(blob, onProgress = () => {}) {
  const T = await loadTesseract();
  onProgress(0.05, 'Preparing image…');
  const canvas = await preprocess(blob);
  const worker = await T.createWorker('eng', 1, {
    logger: m => { if (m.status === 'recognizing text') onProgress(0.1 + m.progress * 0.9, 'Reading scoreboard…'); },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
