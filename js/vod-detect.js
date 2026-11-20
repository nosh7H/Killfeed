// Auto-timestamping: turn what the scanner read off the VOD into Map breakdown tags. Pure and unit-tested.
//
// The scanner (vod-scan.js) samples the video and produces one reading per sample:
//   { t, us, them, feed: [text lines], banner: 'text' }
//   us / them : the score in "our score" / "their score" boxes (null when it couldn't be read)
//   feed      : killfeed lines as read
//   banner    : the centre banner text ("BOMB PLANTED", "ROUND WIN", …) or ''
//
// Source changes how much we trust a reading:
//   caster : the HUD is always on screen → one clean read is enough
//   pov    : deathcams / killcams hide or cover the HUD → a value must be read twice in a row, and anything
//            that happens while the HUD was hidden is marked unsure so you can check it
import { similarity } from './ocr-parse.js';
import { sideFor } from './breakdown.js';

export const SCAN_DEFAULTS = { hillSeconds: 60, roundGap: 8, feedExpire: 3, gapUnsure: 5 };

const num = v => (v == null || v === '' || Number.isNaN(+v) ? null : +v);

/**
 * Clean score series: confirmed (us, them) values over time, never going down.
 * Returns { points: [{ t, us, them }], gaps: [[from, to]] } — gaps are stretches with no usable reading.
 */
export function cleanScores(readings, { source = 'pov', mode = 'snd', gapUnsure = SCAN_DEFAULTS.gapUnsure } = {}) {
  // how far a score can move between two readings dt seconds apart
  const maxJump = dt => (mode === 'snd' ? 1 + (dt > 60 ? 1 : 0) : mode === 'hj' ? 32 + 2 * Math.max(1, dt) : 3 * Math.max(1, dt) + 6);
  const fits = (a, b) => b.us >= a.us && b.them >= a.them && b.us - a.us <= maxJump(b.t - a.t) && b.them - a.them <= maxJump(b.t - a.t);
  let cur = null; let cand = null; let lastGood = null;
  const points = []; const gaps = [];
  let prevT = null; // time of the last good reading (so a jump is measured against it, not the last change)
  const accept = p => { if (!cur || p.us !== cur.us || p.them !== cur.them) { cur = { t: p.t, us: p.us, them: p.them, pt: p.pt ?? p.t }; points.push(cur); } };
  const sideOk = (a, b, dt) => b != null && b >= a && b - a <= maxJump(dt);
  for (const r of readings) {
    const v = { t: r.t, us: num(r.us), them: num(r.them), pt: prevT };
    if (cur) {
      // each side is checked on its own: one misread box (a 7 read as a 1) doesn't throw away the other side
      const dt = v.t - cur.t;
      const okU = sideOk(cur.us, v.us, dt), okT = sideOk(cur.them, v.them, dt);
      if (!okU && !okT) continue;
      if (!okU) v.us = (cand && sideOk(cur.us, cand.us, dt) ? cand.us : cur.us);
      if (!okT) v.them = (cand && sideOk(cur.them, cand.them, dt) ? cand.them : cur.them);
    } else if (v.us == null || v.them == null) continue;
    if (lastGood != null && v.t - lastGood > gapUnsure) gaps.push([lastGood, v.t]);
    lastGood = v.t; prevT = v.t;
    if (source === 'caster') { accept(v); continue; }
    // POV: a reading counts once the next one agrees with it (same or a little higher, never lower)
    if (cand && fits(cand, v)) { accept(cand); cand = v; continue; }
    cand = v;
  }
  if (cand && source !== 'caster' && cur && fits(cur, cand) && cand.t - cur.t <= gapUnsure) accept(cand); // last reading of the map
  return { points, gaps };
}

const inGap = (gaps, a, b) => gaps.some(([x, y]) => x < b && y > a);

/**
 * Killfeed lines → our kills and deaths with timestamps.
 * A line with one of our gamertags on the left is our kill, on the right is our death. Lines stay on screen a few
 * seconds, so the same line read again is not counted twice (but two kills by one player in a row are).
 */
export function feedEvents(readings, roster, { feedExpire = SCAN_DEFAULTS.feedExpire, minScore = 0.72 } = {}) {
  const names = roster.map(p => ({ p, n: norm(p.gamertag || p.player_name || p.name || '') })).filter(x => x.n.length >= 2);
  const active = new Map(); // key → [lastSeen, …] one per entry on screen
  const out = [];
  for (const r of readings) {
    const counts = new Map();
    for (const line of r.feed || []) {
      const hit = matchLine(line, names, minScore);
      if (!hit) continue;
      const key = `${hit.player}|${hit.k}`;
      counts.set(key, (counts.get(key) || { n: 0, hit }));
      counts.get(key).n++;
    }
    for (const [key, list] of active) active.set(key, list.filter(seen => r.t - seen <= feedExpire));
    for (const [key, { n, hit }] of counts) {
      const list = active.get(key) || [];
      for (let i = 0; i < Math.min(n, list.length); i++) list[i] = r.t;
      for (let i = list.length; i < n; i++) { list.push(r.t); out.push({ t: r.t, k: hit.k, player: hit.player }); }
      active.set(key, list);
    }
  }
  return out;
}

export const norm = s => String(s || '').toLowerCase().replace(/\[[^\]]*\]/g, '').replace(/[^a-z0-9]/g, '');

/** One killfeed line → { player, k: 'kill'|'death' } for the first of our players found in it, or null. */
export function matchLine(line, names, minScore = 0.72) {
  const raw = String(line || '');
  const tokens = [...raw.matchAll(/[^\s]+/g)].map(m => ({ s: norm(m[0]), at: m.index + m[0].length / 2 })).filter(x => x.s.length >= 2);
  if (!tokens.length) return null;
  let best = null;
  for (const tk of tokens) {
    for (const { p, n } of names) {
      const sc = tk.s === n ? 1 : similarity(tk.s, n);
      if (sc >= minScore && (!best || sc > best.sc)) best = { sc, p, at: tk.at };
    }
  }
  if (!best) return null;
  const mid = raw.trim().length / 2 + (raw.length - raw.trimStart().length);
  return { player: best.p.gamertag || best.p.player_name || best.p.name, k: best.at < mid ? 'kill' : 'death' };
}

const bannerHits = (readings, re, every = 20) => {
  const out = [];
  for (const r of readings) if (re.test(r.banner || '') && !(out.length && r.t - out[out.length - 1] < every)) out.push(r.t);
  return out;
};

/** Search & Destroy: rounds from score changes, kills/deaths from the killfeed, plants/defuses from the banner. */
export function detectSnd(readings, { source = 'pov', roster = [], startSide = 'atk', ...opt } = {}) {
  const o = { ...SCAN_DEFAULTS, ...opt };
  const { points, gaps } = cleanScores(readings, { source, mode: 'snd', gapUnsure: o.gapUnsure });
  const t0 = readings.find(r => num(r.us) != null)?.t ?? readings[0]?.t ?? 0;
  const ends = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const steps = (b.us - a.us) + (b.them - a.them);
    // more than one round between two readings (long HUD gap): add them, marked unsure
    for (let s = 0; s < steps; s++) {
      const usWon = s < b.us - a.us;
      ends.push({ t: b.t, result: usWon ? 'W' : 'L', unsure: steps > 1 || inGap(gaps, a.t, b.t) });
    }
  }
  // a score that starts above 0-0 means the scan started mid-map: those rounds are not tagged
  const feed = feedEvents(readings, roster, o);
  const plants = bannerHits(readings, /PLANT/i), defuses = bannerHits(readings, /DEFUS/i);
  const rounds = [];
  let start = t0;
  ends.forEach((e, i) => {
    const n = i + 1;
    const ev = [
      ...feed.filter(x => x.t > start && x.t <= e.t).map(x => ({ k: x.k, t: x.t, player: x.player, auto: true })),
      ...plants.filter(t => t > start && t <= e.t).slice(0, 1).map(t => ({ k: 'plant', t, auto: true })),
      ...defuses.filter(t => t > start && t <= e.t).slice(0, 1).map(t => ({ k: 'defuse', t, auto: true })),
    ].sort((a, b) => a.t - b.t);
    const unsure = e.unsure || (source === 'pov' && inGap(gaps, start, e.t) && ev.length === 0);
    rounds.push({ n, t: Math.round(start), side: sideFor(startSide, n), events: ev, result: e.result, unsure, auto: true });
    start = e.t + o.roundGap;
  });
  const last = points[points.length - 1];
  return {
    data: { start_side: startSide, rounds, series: scoreSeries(points, 1) },
    report: {
      rounds: rounds.length, kills: feed.filter(x => x.k === 'kill').length, deaths: feed.filter(x => x.k === 'death').length,
      plants: rounds.filter(r => r.events.some(e => e.k === 'plant')).length, unsure: rounds.filter(r => r.unsure).length,
      final: last ? { us: last.us, them: last.them } : null, gaps: gaps.length, byPlayer: tally(feed),
      startedMidMap: points[0] ? points[0].us + points[0].them > 0 : false,
      firstBloods: rounds.filter(r => r.events.find(e => e.k === 'kill' || e.k === 'death')?.k === 'kill').length,
      firstDeaths: rounds.filter(r => r.events.find(e => e.k === 'kill' || e.k === 'death')?.k === 'death').length,
    },
  };
}

/** Hardpoint: hills on a fixed rotation; who scored first on each, whether the other team broke it, points each. */
export function detectHp(readings, { source = 'pov', ...opt } = {}) {
  const o = { ...SCAN_DEFAULTS, ...opt };
  const { points, gaps } = cleanScores(readings, { source, mode: 'hp', gapUnsure: o.gapUnsure });
  if (points.length < 2) return { data: { hills: [], series: [] }, report: { hills: 0, unsure: 0, final: null, gaps: gaps.length } };
  // the first hill starts just before the first point is scored
  const firstMove = points.find((p, i) => i && (p.us > points[0].us || p.them > points[0].them));
  const t0 = Math.max(readings[0]?.t ?? 0, (firstMove?.t ?? points[0].t) - 2);
  const L = o.hillSeconds;
  const end = points[points.length - 1].t;
  const hills = [];
  for (let i = 0, s = t0; s < end; i++, s += L) {
    const e = s + L;
    const before = [...points].reverse().find(p => p.t <= s) || points[0];
    const inside = points.filter(p => p.t > s && p.t <= e);
    if (!inside.length && i > 0 && s > end) break;
    const after = inside[inside.length - 1] || before;
    let first = null, broken = false, prev = before;
    for (const p of inside) {
      const du = p.us - prev.us, dt = p.them - prev.them;
      if (!first) { if (du > 0 && dt <= 0) first = 'us'; else if (dt > 0 && du <= 0) first = 'them'; else if (du > 0 && dt > 0) first = du >= dt ? 'us' : 'them'; }
      else if ((first === 'us' && dt > 0) || (first === 'them' && du > 0)) broken = true;
      prev = p;
    }
    const us = after.us - before.us, them = after.them - before.them;
    if (!first && us === 0 && them === 0 && s + L > end) break; // trailing empty window
    const decided = inside.find(p => p.us > before.us || p.them > before.them);
    const unsure = !first || (source === 'pov' && inGap(gaps, s, decided ? decided.t : e));
    hills.push({ n: i + 1, t: Math.round(s), first, broken, us, them, unsure, auto: true });
  }
  const last = points[points.length - 1];
  return {
    data: { hills, series: scoreSeries(points) },
    report: { hills: hills.length, held: hills.filter(x => x.first === 'us' && !x.broken).length, broke: hills.filter(x => x.first === 'them' && x.broken).length, unsure: hills.filter(x => x.unsure).length, final: { us: last.us, them: last.them }, gaps: gaps.length },
  };
}

/** Score over time for the chart: one point every `every` seconds plus every change, as [t, us, them]. */
export function scoreSeries(points, every = 2) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || p.t - last[0] >= every) out.push([Math.round(p.t), p.us, p.them]);
    else { last[1] = p.us; last[2] = p.them; }
  }
  return out;
}

/**
 * Hijack: a dunk is worth 30, a throw 15, then 1 point a second while you hold it.
 * A score jump bigger than the time could explain is a dunk (≈30) or a throw (≈15); the rest is capture time.
 */
export function detectHj(readings, { source = 'pov', ...opt } = {}) {
  const o = { ...SCAN_DEFAULTS, ...opt };
  const { points, gaps } = cleanScores(readings, { source, mode: 'hj', gapUnsure: o.gapUnsure });
  const events = []; const hold = { us: 0, them: 0 };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dt = Math.max(1, b.t - (b.pt ?? a.t));
    for (const side of ['us', 'them']) {
      const d = b[side] - a[side];
      if (d <= 0) continue;
      const extra = d - dt; // more than one point a second can only come from a dunk or throw
      const k = extra >= 22 ? 'dunk' : extra >= 10 ? 'throw' : null;
      const bonus = k === 'dunk' ? 30 : k === 'throw' ? 15 : 0;
      if (k) events.push({ t: Math.round(b.t), k, label: k === 'dunk' ? 'Dunk' : 'Throw', side, auto: true, unsure: source === 'pov' && inGap(gaps, a.t - 1, b.t) });
      hold[side] += Math.max(0, d - bonus);
    }
  }
  const last = points[points.length - 1];
  return {
    data: { events, hold, series: scoreSeries(points) },
    report: {
      dunks: { us: events.filter(e => e.k === 'dunk' && e.side === 'us').length, them: events.filter(e => e.k === 'dunk' && e.side === 'them').length },
      throws: { us: events.filter(e => e.k === 'throw' && e.side === 'us').length, them: events.filter(e => e.k === 'throw' && e.side === 'them').length },
      hold, final: last ? { us: last.us, them: last.them } : null, gaps: gaps.length, unsure: events.filter(e => e.unsure).length,
    },
  };
}

function tally(feed) {
  const out = {};
  for (const x of feed) { out[x.player] ||= { kills: 0, deaths: 0 }; out[x.player][x.k === 'kill' ? 'kills' : 'deaths']++; }
  return out;
}

/**
 * Put scan results into an existing breakdown. Tags you added by hand stay; tags from an earlier scan are replaced.
 * S&D: hand-tagged rounds keep their events, results and notes; scanned kills/plants are added to the round they fall in.
 */
export function mergeScan(kind, existing, scanned) {
  const withSeries = d => ({ ...d, series: scanned.series || d.series || [] });
  return withSeries(mergeTags(kind, existing, scanned));
}
function mergeTags(kind, existing, scanned) {
  if (kind === 'hj') {
    const manual = (existing.events || []).filter(e => !e.auto);
    return { ...existing, hold: scanned.hold, events: [...manual, ...scanned.events].sort((a, b) => (a.t ?? 0) - (b.t ?? 0)) };
  }
  if (kind === 'hp') {
    const manual = (existing.hills || []).filter(x => !x.auto);
    if (!manual.length) return { ...existing, hills: scanned.hills };
    // keep the hand-tagged hill for any window it covers
    const out = scanned.hills.map(sx => manual.find(m => m.t != null && Math.abs(m.t - sx.t) < 20) || sx);
    for (const m of manual) if (!out.includes(m)) out.push(m);
    out.sort((a, b) => (a.t ?? 0) - (b.t ?? 0)).forEach((x, i) => { x.n = i + 1; });
    return { ...existing, hills: out };
  }
  if (kind === 'snd') {
    const manual = (existing.rounds || []).filter(r => !r.auto);
    if (!manual.length) return { ...existing, start_side: scanned.start_side, rounds: scanned.rounds };
    const out = scanned.rounds.map(sr => {
      const m = manual.find(x => x.n === sr.n);
      if (!m) return sr;
      const own = (m.events || []).filter(e => !e.auto);
      // hand-tagged kills/deaths win over the killfeed for that round; plants/defuses fill in if missing
      const hasKd = own.some(e => e.k === 'kill' || e.k === 'death');
      const add = sr.events.filter(e => (hasKd ? e.k === 'plant' || e.k === 'defuse' : true) && !own.some(o => o.k === e.k && (e.k === 'plant' || e.k === 'defuse')));
      return { ...m, t: m.t ?? sr.t, result: m.result ?? sr.result, events: [...own, ...add].sort((a, b) => (a.t ?? 0) - (b.t ?? 0)) };
    });
    for (const m of manual) if (!out.some(r => r.n === m.n)) out.push(m);
    out.sort((a, b) => a.n - b.n);
    return { ...existing, rounds: out };
  }
  return existing;
}

/**
 * Split a full-series VOD into maps. A new map starts when both scores go back to (near) 0–0 after the last map
 * had a real score, and stay low for a few readings. The lobby / loading screen in between has no HUD, so a long
 * stretch without a score right before the reset makes it more likely to be a real map change. With more candidates
 * than you said there are maps, the strongest ones win.
 * Returns { segments: [{ from, to, end }], found } — end = last moment the map's score was on screen (the
 * end-of-map scoreboard usually follows a few seconds later).
 */
export function splitSeries(readings, n, { lowSum = 1, confirm = 3 } = {}) {
  const valid = readings.filter(r => num(r.us) != null && num(r.them) != null).map(r => ({ t: r.t, s: num(r.us) + num(r.them) }));
  const first = readings[0]?.t ?? 0, last = (readings[readings.length - 1]?.t ?? 0) + 1;
  const endBefore = t => { const v = [...valid].reverse().find(x => x.t < t && x.s > lowSum); return v ? v.t : t; };
  if (!valid.length || n <= 1) return { segments: [{ from: first, to: last, end: endBefore(last) }], found: valid.length ? 1 : 0 };
  const cands = [];
  let peak = 0;
  for (let i = 0; i < valid.length; i++) {
    const v = valid[i];
    // peak: a score that the next reading agrees with (ignores one-frame misreads like 999)
    const nx = valid[i + 1];
    if (nx && nx.s >= v.s - 2 && nx.s <= v.s + 40) peak = Math.max(peak, v.s);
    // "back to about 0–0": a few points at most, and far below where the last map got to
    const low = Math.min(6, Math.max(lowSum, Math.floor(peak * 0.25)));
    if (v.s > low || peak < 3) continue;
    const next = valid.slice(i + 1, i + confirm);
    if (next.length < confirm - 1 || next.some((x, j) => x.s > low + 2 * (x.t - v.t) + 2 || x.s < (j ? next[j - 1].s : v.s))) continue;
    const prevT = valid[i - 1]?.t ?? first;
    cands.push({ t: v.t, peak, gap: v.t - prevT });
    peak = 0;
  }
  const pick = cands.length > n - 1
    ? cands.map(c => ({ ...c, score: Math.min(c.gap, 180) + Math.min(c.peak, 50) / 5 })).sort((a, b) => b.score - a.score).slice(0, n - 1).sort((a, b) => a.t - b.t)
    : cands;
  // a map starts at the end of the no-HUD stretch before its reset; the stretch itself belongs to the map before
  const starts = [first, ...pick.map(c => c.t)];
  const segments = starts.map((s, i) => {
    const to = i + 1 < starts.length ? starts[i + 1] : last;
    return { from: s, to, end: endBefore(to) };
  });
  return { segments, found: cands.length + 1 };
}
