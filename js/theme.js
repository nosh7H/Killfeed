// Per-team accent color. Buttons, highlights and the brand mark follow the team's
// color; data marks in charts keep their own fixed color so charts read the same for every team.

export const DEFAULT_ACCENT = '#b69cff';
export const ACCENT_PRESETS = [
  ['#b69cff', 'Light purple'], ['#f2a93b', 'Amber'], ['#e5484d', 'Red'], ['#30a46c', 'Green'], ['#12a594', 'Teal'],
  ['#3e8ef7', 'Blue'], ['#8e4ec6', 'Violet'], ['#e93d82', 'Pink'], ['#e8e8e8', 'White'],
];

export function isHex(c) { return /^#[0-9a-f]{6}$/i.test(c || ''); }

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mix(hex, withHex, amount) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const a = p(hex), b = p(withHex);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('');
}

export function applyAccent(color) {
  const hex = isHex(color) ? color : DEFAULT_ACCENT;
  const L = luminance(hex);
  const root = document.documentElement.style;
  root.setProperty('--accent', hex);
  // text ON the accent (button labels): dark or light, whichever reads better
  root.setProperty('--accent-ink', L > 0.18 ? '#111111' : '#ffffff');
  // accent used AS text on the dark background: lighten very dark picks so it stays readable
  root.setProperty('--accent-text', L < 0.12 ? mix(hex, '#ffffff', 0.45) : hex);
}

// Font styles — see the [data-font] blocks at the top of css/styles.css
export const FONT_STYLES = [
  ['mix', 'Mix (recommended): Chakra Petch headings, IBM Plex text, JetBrains Mono numbers, Big Shoulders on the TV'],
  ['tactical', 'Tactical HUD: Chakra Petch + IBM Plex Sans'],
  ['analyst', 'Analyst: Space Grotesk + JetBrains Mono numbers'],
  ['stadium', 'Stadium: Big Shoulders Display + Archivo'],
];
export function applyFont(style) {
  const ok = FONT_STYLES.some(([k]) => k === style);
  document.documentElement.dataset.font = ok ? style : 'mix';
}
export const deviceFont = () => localStorage.getItem('kf-font') || 'mix';
