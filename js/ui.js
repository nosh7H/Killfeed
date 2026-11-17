// Small DOM + formatting helpers (no framework)

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v; // only used with trusted static strings
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

export function toast(msg, kind = 'info') {
  const wrap = $('#toasts');
  const t = h('div', { class: `toast toast-${kind}`, role: 'status' }, msg);
  wrap.append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

export function modal(title, body, actions = []) {
  return new Promise(resolve => {
    const close = (val) => { overlay.remove(); resolve(val); };
    const overlay = h('div', { class: 'modal-overlay', onclick: e => { if (e.target === overlay) close(null); } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'modal-head' }, h('h3', {}, title),
          h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close(null) }, '✕')),
        h('div', { class: 'modal-body' }, body),
        actions.length ? h('div', { class: 'modal-foot' },
          actions.map(a => h('button', { class: `btn ${a.class || ''}`, onclick: () => close(a.value) }, a.label))) : null));
    document.body.append(overlay);
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', esc); close(null); }
    });
  });
}

export async function confirmDialog(msg, okLabel = 'Delete') {
  return (await modal('Are you sure?', h('p', {}, msg), [
    { label: 'Cancel', value: false },
    { label: okLabel, value: true, class: 'btn-danger' },
  ])) === true;
}

// ---- formatting ----
export function fmtTime(sec) {
  if (sec == null || sec === '' || isNaN(sec)) return '–';
  sec = Math.round(Number(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// "1:23" → 83, "83" → 83, "" → null
export function parseTime(str) {
  if (str == null) return null;
  str = String(str).trim();
  if (!str) return null;
  const m = str.match(/^(\d+):(\d{1,2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(str);
  return isNaN(n) ? null : Math.round(n);
}

export function fmtNum(n, digits = 0) {
  if (n == null || isNaN(n)) return '–';
  return Number(n).toFixed(digits);
}

export function fmtRatio(a, b) {
  if (!b) return a ? Number(a).toFixed(2) : '–';
  return (a / b).toFixed(2);
}

export function fmtPct(x) {
  if (x == null || isNaN(x)) return '–';
  return `${Math.round(x * 100)}%`;
}

export function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d + (String(d).length === 10 ? 'T12:00:00' : ''));
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    }));
}

export function download(filename, text, type = 'text/plain') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Downscale an image file to a JPEG blob
export async function compressImage(file, maxPx, quality) {
  const img = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(img.src);
  return await new Promise(res => c.toBlob(res, 'image/jpeg', quality));
}
