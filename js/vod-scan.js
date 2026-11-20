// Auto-timestamp scanner: reads the HUD off a local VOD file in the browser (nothing is uploaded).
// It seeks through the video, crops the boxes you marked (our score, their score, killfeed, banner),
// cleans each crop up and reads it with Tesseract. Crops that haven't changed since the last read are skipped,
// which keeps a 10-minute map to a minute or two. vod-detect.js turns the readings into tags.
import { loadTesseract } from './ocr.js';

export const REGION_KEYS = {
  us: { label: 'Our score', color: '#a78bfa', need: true },
  them: { label: 'Their score', color: '#f59e0b', need: true },
  feed: { label: 'Killfeed', color: '#34d399', modes: ['snd'] },
  banner: { label: 'Centre banner (plant / defuse)', color: '#60a5fa', modes: ['snd'] },
};

// Starting boxes (fractions of the frame). Everyone's HUD differs a little, so you adjust these once.
export const DEFAULT_REGIONS = {
  pov: { us: { x: 0.035, y: 0.055, w: 0.05, h: 0.045 }, them: { x: 0.09, y: 0.055, w: 0.05, h: 0.045 }, feed: { x: 0.02, y: 0.58, w: 0.3, h: 0.2 }, banner: { x: 0.3, y: 0.2, w: 0.4, h: 0.1 } },
  caster: { us: { x: 0.405, y: 0.02, w: 0.06, h: 0.06 }, them: { x: 0.535, y: 0.02, w: 0.06, h: 0.06 }, feed: { x: 0.7, y: 0.12, w: 0.28, h: 0.22 }, banner: { x: 0.3, y: 0.2, w: 0.4, h: 0.1 } },
};

const key = (teamId, source) => `kf-vodscan-${teamId}-${source}`;
export function loadRegions(teamId, source) {
  try { return { ...DEFAULT_REGIONS[source], ...(JSON.parse(localStorage.getItem(key(teamId, source)) || 'null') || {}) }; } catch { return { ...DEFAULT_REGIONS[source] }; }
}
export function saveRegions(teamId, source, regions) { try { localStorage.setItem(key(teamId, source), JSON.stringify(regions)); } catch { /* private mode */ } }

export function openVideo(src) {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.playsInline = true; v.crossOrigin = 'anonymous';
    v.onloadeddata = () => res(v);
    v.onerror = () => rej(new Error('Couldn’t open this video in the browser. MP4 (H.264) or WebM works best.'));
    v.src = src;
  });
}

export function seek(v, t) {
  return new Promise(res => {
    const done = () => { v.removeEventListener('seeked', done); clearTimeout(to); res(); };
    const to = setTimeout(done, 4000);
    v.addEventListener('seeked', done);
    v.currentTime = Math.min(Math.max(0, t), Math.max(0, (v.duration || 0) - 0.05));
  });
}

/** The current frame as a canvas (full size). */
export function frameCanvas(v, into) {
  const c = into || document.createElement('canvas');
  if (c.width !== v.videoWidth || c.height !== v.videoHeight) { c.width = v.videoWidth; c.height = v.videoHeight; }
  c.getContext('2d', { willReadFrequently: true }).drawImage(v, 0, 0);
  return c;
}
export const canvasBlob = (c, type = 'image/jpeg') => new Promise(res => c.toBlob(res, type, 0.92));

/**
 * Crop a region and make it easy to read: upscale, grayscale, light text → dark on white, hard threshold.
 * Returns { canvas, sig } where sig is a tiny fingerprint used to skip crops that didn't change.
 */
export function prepCrop(frame, r, { scale = 3, threshold = 150 } = {}) {
  const sx = Math.round(r.x * frame.width), sy = Math.round(r.y * frame.height);
  const sw = Math.max(4, Math.round(r.w * frame.width)), sh = Math.max(4, Math.round(r.h * frame.height));
  const c = document.createElement('canvas');
  c.width = sw * scale; c.height = sh * scale;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height); const px = d.data;
  // HUD text is bright: keep bright pixels as ink
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const v = g >= threshold ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  // white margin: Tesseract misses characters that touch the edge of the image (a lone "0" against the box edge)
  const pad = Math.round(Math.max(8, c.height * 0.25));
  const out = document.createElement('canvas');
  out.width = c.width + pad * 2; out.height = c.height + pad * 2;
  const octx = out.getContext('2d', { willReadFrequently: true });
  octx.fillStyle = '#fff'; octx.fillRect(0, 0, out.width, out.height); octx.drawImage(c, pad, pad);
  // fingerprint: 24×8 average of the cleaned crop
  const sig = new Float32Array(24 * 8);
  const bw = c.width / 24, bh = c.height / 8;
  for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
    const i = (y * c.width + x) * 4;
    sig[Math.min(7, Math.floor(y / bh)) * 24 + Math.min(23, Math.floor(x / bw))] += px[i] < 128 ? 1 : 0;
  }
  const n = (bw * bh) / 4 || 1;
  for (let i = 0; i < sig.length; i++) sig[i] /= n;
  return { canvas: out, sig };
}
export function sigDiff(a, b) {
  if (!a || !b) return 1;
  let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

export const parseScore = text => {
  const d = String(text || '').replace(/[oO]/g, '0').replace(/[lI|]/g, '1').replace(/[^0-9]/g, '');
  return d ? Math.min(999, parseInt(d.slice(0, 3), 10)) : null;
};

/**
 * Scan the video. regions: { us, them, feed?, banner? } as fractions.
 * Returns readings [{ t, us, them, feed: [lines], banner }] for vod-detect.js.
 * opts.reader (tests): async (canvas, kind) → text, instead of Tesseract.
 */
export async function scanVideo(src, regions, { step = 1, from = 0, to = null, onProgress = () => {}, signal, reader = null, wants = ['us', 'them'] } = {}) {
  const v = await openVideo(src);
  const end = Math.min(to ?? v.duration, v.duration);
  let digitW = null, textW = null;
  let read = reader;
  if (!read) {
    onProgress(0, 'Loading the text reader…');
    const T = await loadTesseract();
    digitW = await T.createWorker('eng', 1);
    await digitW.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789' });
    if (wants.includes('feed') || wants.includes('banner')) {
      textW = await T.createWorker('eng', 1);
      await textW.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    }
    read = async (canvas, kind) => ((kind === 'us' || kind === 'them' ? digitW : textW).recognize(canvas)).then(r => r.data.text);
  }
  const last = {}; // region → { sig, value }
  const frame = document.createElement('canvas');
  const out = [];
  const started = performance.now();
  try {
    for (let t = from; t <= end; t += step) {
      if (signal?.aborted) throw new DOMException('Scan stopped', 'AbortError');
      await seek(v, t);
      frameCanvas(v, frame);
      const r = { t: Math.round(t * 10) / 10, us: null, them: null, feed: [], banner: '' };
      for (const k of wants) {
        const box = regions[k];
        if (!box) continue;
        const { canvas, sig } = prepCrop(frame, box, { scale: k === 'feed' || k === 'banner' ? 2 : 3 });
        const prev = last[k];
        let value;
        if (prev && sigDiff(prev.sig, sig) < 0.012) value = prev.value; // nothing changed in this box
        else {
          const text = await read(canvas, k);
          value = k === 'us' || k === 'them' ? parseScore(text) : k === 'feed' ? String(text || '').split('\n').map(s => s.trim()).filter(s => s.length > 3) : String(text || '').trim();
          // only remember a good read: a failed one is tried again on the next frame, not reused for the rest of the stretch
          if (value != null && value !== '') last[k] = { sig, value }; else delete last[k];
        }
        if (k === 'feed') r.feed = value || []; else r[k] = value;
      }
      out.push(r);
      const done = (t - from) / Math.max(1, end - from);
      const secs = (performance.now() - started) / 1000;
      onProgress(done, `Reading ${fmt(t)} of ${fmt(end)}`, done > 0.03 ? Math.round(secs / done - secs) : null);
    }
  } finally {
    await digitW?.terminate(); await textW?.terminate();
    v.removeAttribute('src'); v.load();
  }
  return out;
}

const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
