// Team analytics — pure functions (unit-tested in Node).
//   mapStrength(): win rate per map & mode with shrinkage + 80% interval → pick/ban advice
//   winFactors():  which team stats separate won maps from lost maps, with simple thresholds
//   playerImpact(): win rate when each player goes positive vs negative
import { gameResult } from './stats.js';

const Z80 = 1.2816;

/** Wilson score interval (80%). Honest for small samples. */
export function wilson(w, n, z = Z80) {
  if (!n) return [0, 1];
  const p = w / n, z2 = z * z, den = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / den, m = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / den;
  return [Math.max(0, c - m), Math.min(1, c + m)];
}

/**
 * games: joined games (with .match), already filtered.
 * Returns { [mode]: [{ map, n, w, l, rate, post, lo, hi, diff, label, verdict }] } sorted strongest first.
 * post = Beta(2,2)-smoothed win rate: (w+2)/(n+4) — pulls small samples toward 50%.
 */
export function mapStrength(games) {
  const by = {};
  for (const g of games) {
    const r = gameResult(g);
    if (!r || r === 'T' || !g.mode || !g.map) continue;
    const k = `${g.mode}|${g.map}`;
    by[k] ||= { mode: g.mode, map: g.map, n: 0, w: 0, diff: 0 };
    by[k].n++; if (r === 'W') by[k].w++;
    by[k].diff += (Number(g.team_score) || 0) - (Number(g.opp_score) || 0);
  }
  const out = {};
  for (const x of Object.values(by)) {
    const [lo, hi] = wilson(x.w, x.n);
    const post = (x.w + 2) / (x.n + 4);
    let label;
    if (x.n < 3) label = 'Low sample';
    else if (lo > 0.5) label = 'Strong';
    else if (hi < 0.5) label = 'Weak';
    else if (post >= 0.56) label = 'Leaning strong';
    else if (post <= 0.44) label = 'Leaning weak';
    else label = 'Even';
    (out[x.mode] ||= []).push({ ...x, l: x.n - x.w, rate: x.w / x.n, post, lo, hi, avgDiff: x.diff / x.n, label });
  }
  for (const m of Object.keys(out)) out[m].sort((a, b) => b.post - a.post || b.n - a.n);
  return out;
}

/**
 * Pick/ban suggestion for one mode's map list (from mapStrength), optionally limited to a map pool.
 * Picks need some evidence (n ≥ 3); bans go to the weakest map.
 */
export function vetoAdvice(rows, pool = null) {
  const list = (pool?.length ? rows.filter(r => pool.includes(r.map)) : rows).slice();
  const unplayed = pool?.length ? pool.filter(m => !rows.some(r => r.map === m)) : [];
  const evid = list.filter(r => r.n >= 3);
  const pick = (evid.length ? evid : list).slice().sort((a, b) => b.post - a.post)[0] || null;
  const ban = (evid.length ? evid : list).slice().sort((a, b) => a.post - b.post)[0] || null;
  return { pick, ban: ban && pick && ban.map === pick.map ? null : ban, unplayed };
}

// ---------- what wins us maps ----------

const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

/** Team-level features for one game from our players' stat lines. */
export function gameFeatures(g, lines) {
  if (!lines?.length) return null;
  const sum = k => lines.reduce((s, x) => s + (Number(x[k]) || 0), 0);
  const has = k => lines.some(x => x[k] != null && x[k] !== '');
  const K = sum('kills'), D = sum('deaths');
  const kds = lines.map(x => (Number(x.kills) || 0) / Math.max(1, Number(x.deaths) || 0));
  const f = {
    team_kd: D ? K / D : K,
    kills: K,
    deaths: D,
    kd_spread: Math.max(...kds) - Math.min(...kds),
    worst_kd: Math.min(...kds),
  };
  if (has('damage') && K) f.dmg_per_kill = sum('damage') / K;
  if (g.mode === 'Hardpoint' && has('obj_time')) {
    const objs = lines.map(x => Number(x.obj_time) || 0), tot = objs.reduce((s, x) => s + x, 0);
    f.obj_total = tot;
    if (tot) f.obj_top_share = Math.max(...objs) / tot;
  }
  if (g.mode === 'Search & Destroy') {
    if (has('first_bloods')) f.first_bloods = sum('first_bloods');
    if (has('plants') || has('defuses')) f.bomb_plays = sum('plants') + sum('defuses');
  }
  if (has('captures')) f.captures = sum('captures');
  return f;
}

export const FEATURE_INFO = {
  team_kd: { label: 'Team K/D', fmt: v => v.toFixed(2), better: 'higher' },
  kills: { label: 'Team kills', fmt: v => Math.round(v), better: 'higher' },
  deaths: { label: 'Team deaths', fmt: v => Math.round(v), better: 'lower' },
  kd_spread: { label: 'K/D gap (best − worst player)', fmt: v => v.toFixed(2), better: 'lower' },
  worst_kd: { label: 'Lowest player K/D', fmt: v => v.toFixed(2), better: 'higher' },
  dmg_per_kill: { label: 'Damage per kill', fmt: v => Math.round(v), better: 'lower' },
  obj_total: { label: 'Team hill time', fmt: v => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}`, better: 'higher' },
  obj_top_share: { label: 'Top player share of hill time', fmt: v => `${Math.round(v * 100)}%`, better: 'lower' },
  first_bloods: { label: 'First bloods', fmt: v => v.toFixed(1), better: 'higher' },
  bomb_plays: { label: 'Plants + defuses', fmt: v => v.toFixed(1), better: 'higher' },
  captures: { label: 'Captures', fmt: v => v.toFixed(1), better: 'higher' },
  hp_rotation_rate: { label: 'Rotations won (tagged)', fmt: v => `${Math.round(v * 100)}%`, better: 'higher' },
  hp_holds: { label: 'Hills held (tagged)', fmt: v => v.toFixed(1), better: 'higher' },
  hp_breaks: { label: 'Hills broken by us (tagged)', fmt: v => v.toFixed(1), better: 'higher' },
  hp_got_broken: { label: 'Times we got broken (tagged)', fmt: v => v.toFixed(1), better: 'lower' },
  snd_fb_rate: { label: 'First-blood rate (tagged)', fmt: v => `${Math.round(v * 100)}%`, better: 'higher' },
  snd_fb_conversion: { label: 'Rounds won after our first blood', fmt: v => `${Math.round(v * 100)}%`, better: 'higher' },
  snd_post_plant_rate: { label: 'Post-plant win % (tagged)', fmt: v => `${Math.round(v * 100)}%`, better: 'higher' },
  snd_retake_rate: { label: 'Retake win % (tagged)', fmt: v => `${Math.round(v * 100)}%`, better: 'higher' },
  snd_fd_rate: { label: 'First-death rate (tagged)', fmt: v => `${Math.round(v * 100)}%`, better: 'lower' },
  hj_dunks: { label: 'Our dunks (tagged)', fmt: v => v.toFixed(1), better: 'higher' },
  hj_throws: { label: 'Our throws (tagged)', fmt: v => v.toFixed(1), better: 'higher' },
  hj_dunks_against: { label: 'Dunks against us (tagged)', fmt: v => v.toFixed(1), better: 'lower' },
  hj_hold_share: { label: 'Share of capture time (tagged)', fmt: v => `${Math.round(v * 100)}%`, better: 'higher' },
};

/**
 * For one mode: compare features in won vs lost maps.
 * Returns { n, wins, losses, factors: [{ key, label, winMean, lossMean, effect, threshold }] } sorted by |effect|.
 * effect = standardized mean difference (Cohen's d) — positive means "higher in wins".
 * threshold = the cut that best separates wins (≥3 maps on each side), e.g. "Team K/D ≥ 1.05: 8/10 won".
 */
export function winFactors(games, statsIdx, mode = null, extra = null) {
  const rows = [];
  for (const g of games) {
    if (mode && g.mode !== mode) continue;
    const r = gameResult(g);
    if (r !== 'W' && r !== 'L') continue;
    const base = gameFeatures(g, statsIdx.get(g.id));
    const more = extra?.(g) || {};
    if (!base && !Object.keys(more).length) continue;
    rows.push({ win: r === 'W', f: { ...(base || {}), ...more } });
  }
  const wins = rows.filter(r => r.win).length, losses = rows.length - wins;
  const keys = [...new Set(rows.flatMap(r => Object.keys(r.f)))];
  const factors = [];
  for (const key of keys) {
    const pts = rows.filter(r => r.f[key] != null && isFinite(r.f[key])).map(r => ({ v: r.f[key], win: r.win }));
    const W = pts.filter(p => p.win).map(p => p.v), L = pts.filter(p => !p.win).map(p => p.v);
    if (W.length < 2 || L.length < 2) continue;
    const pooled = Math.sqrt(((W.length - 1) * sd(W) ** 2 + (L.length - 1) * sd(L) ** 2) / (W.length + L.length - 2)) || 1e-9;
    // cap so a stat that never varies (sd = 0) doesn't produce an absurd effect size
    const effect = Math.max(-4, Math.min(4, (mean(W) - mean(L)) / pooled));
    factors.push({ key, ...(FEATURE_INFO[key] || { label: key, fmt: v => v.toFixed(2) }), winMean: mean(W), lossMean: mean(L), effect, n: pts.length, threshold: bestThreshold(pts, effect >= 0) });
  }
  factors.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  return { n: rows.length, wins, losses, factors };
}

/** Best single cut on a feature: maximizes the win-rate gap between the two sides (min 3 maps per side). */
export function bestThreshold(pts, higherIsGood) {
  const vals = [...new Set(pts.map(p => p.v))].sort((a, b) => a - b);
  let best = null;
  for (let i = 1; i < vals.length; i++) {
    const t = (vals[i - 1] + vals[i]) / 2;
    const good = pts.filter(p => (higherIsGood ? p.v >= t : p.v < t)), bad = pts.filter(p => !(higherIsGood ? p.v >= t : p.v < t));
    if (good.length < 3 || bad.length < 3) continue;
    const gw = good.filter(p => p.win).length, bw = bad.filter(p => p.win).length;
    const gap = gw / good.length - bw / bad.length;
    if (!best || gap > best.gap) best = { t, dir: higherIsGood ? '≥' : '<', gap, goodN: good.length, goodW: gw, badN: bad.length, badW: bw };
  }
  return best && best.gap > 0 ? best : null;
}

/** Win rate when each player has K/D ≥ 1 vs < 1 in a mode (min 2 maps each side). */
export function playerImpact(games, statsIdx, mode = null, keyOf = s => s.player_id || s.player_name) {
  const by = new Map();
  for (const g of games) {
    if (mode && g.mode !== mode) continue;
    const r = gameResult(g);
    if (r !== 'W' && r !== 'L') continue;
    for (const s of statsIdx.get(g.id) || []) {
      const k = keyOf(s);
      if (!by.has(k)) by.set(k, { name: s.player_name, pos: [0, 0], neg: [0, 0] });
      const row = by.get(k);
      const kd = (Number(s.kills) || 0) / Math.max(1, Number(s.deaths) || 0);
      const bucket = kd >= 1 ? row.pos : row.neg;
      bucket[1]++; if (r === 'W') bucket[0]++;
    }
  }
  return [...by.values()].filter(r => r.pos[1] >= 2 && r.neg[1] >= 2)
    .map(r => ({ ...r, posRate: r.pos[0] / r.pos[1], negRate: r.neg[0] / r.neg[1], swing: r.pos[0] / r.pos[1] - r.neg[0] / r.neg[1] }))
    .sort((a, b) => b.swing - a.swing);
}
