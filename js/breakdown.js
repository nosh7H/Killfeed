// VOD breakdowns (hill-by-hill, round-by-round) — data model + derived stats. Pure, unit-tested.
//
// Stored per map (game) as { source: 'pov' | 'caster', mode, data }:
//   Hardpoint:        data.hills  = [{ n, t, first: 'us'|'them'|null, broken: bool, us, them, unsure, note }]
//   Search & Destroy: data.rounds = [{ n, t, side: 'atk'|'def', events: [{ k: 'kill'|'death'|'plant'|'defuse', t }], result: 'W'|'L'|null, unsure }]
//   other modes:      data.events = [{ t, label, side: 'us'|'them'|null }]
//
// "first"  = which team scored first on the hill (won the rotation)
// "broken" = the other team took the hill back at some point during it

export const BREAKDOWN_MODES = { 'Hardpoint': 'hp', 'Search & Destroy': 'snd' };
export const modeKind = mode => BREAKDOWN_MODES[mode] || 'events';
export const TEAM_SIZE = 4;

export function emptyData(mode) {
  const k = modeKind(mode);
  return k === 'hp' ? { hills: [] } : k === 'snd' ? { start_side: 'atk', rounds: [] } : { events: [] };
}

// ---------- Hardpoint ----------
export function hillOutcome(h) {
  if (!h.first) return 'none';
  if (h.first === 'us') return h.broken ? 'got_broken' : 'held';
  return h.broken ? 'broke' : 'lost';
}
export const HILL_LABEL = { held: 'Held', got_broken: 'Got broken', broke: 'Broke', lost: 'Lost', none: '—' };

export function hpSummary(data) {
  const hills = (data?.hills || []).filter(h => h.first);
  const usFirst = hills.filter(h => h.first === 'us'), themFirst = hills.filter(h => h.first === 'them');
  const c = o => hills.filter(h => hillOutcome(h) === o).length;
  const pts = (k) => (data?.hills || []).reduce((s, h) => s + (Number(h[k]) || 0), 0);
  return {
    hills: hills.length, rotations: usFirst.length,
    held: c('held'), got_broken: c('got_broken'), broke: c('broke'), lost: c('lost'),
    rotationRate: hills.length ? usFirst.length / hills.length : null,
    holdRate: usFirst.length ? c('held') / usFirst.length : null,
    breakRate: themFirst.length ? c('broke') / themFirst.length : null,
    pointsUs: pts('us'), pointsThem: pts('them'),
    unsure: (data?.hills || []).filter(h => h.unsure).length,
  };
}

// ---------- Search & Destroy ----------
/** Walk a round's kill/death sequence → first blood, every man-count state reached, state at plant. */
export function sndRound(r, size = TEAM_SIZE) {
  let us = size, them = size, fb = null, plantState = null, planted = false, defused = false;
  const states = [`${us}v${them}`];
  for (const e of [...(r.events || [])].sort((a, b) => (a.t ?? 0) - (b.t ?? 0))) {
    if (e.k === 'kill' || e.k === 'death') {
      if (!fb) fb = e.k === 'kill' ? 'us' : 'them';
      if (e.k === 'kill') them = Math.max(0, them - 1); else us = Math.max(0, us - 1);
      const s = `${us}v${them}`;
      if (states[states.length - 1] !== s) states.push(s);
    } else if (e.k === 'plant') { planted = true; plantState = `${us}v${them}`; }
    else if (e.k === 'defuse') defused = true;
  }
  return { fb, states, planted, plantState, defused, side: r.side, result: r.result, aliveEnd: { us, them } };
}

/** Side for round n given the starting side (sides swap every round). */
export const sideFor = (start, n) => ((n - 1) % 2 === 0 ? start : start === 'atk' ? 'def' : 'atk');

export function sndSummary(data, size = TEAM_SIZE) {
  const rs = (data?.rounds || []).filter(r => r.result).map(r => sndRound(r, size));
  const rate = (arr) => (arr.length ? arr.filter(x => x.result === 'W').length / arr.length : null);
  const fbUs = rs.filter(r => r.fb === 'us'), fbThem = rs.filter(r => r.fb === 'them');
  const atk = rs.filter(r => r.side === 'atk'), def = rs.filter(r => r.side === 'def');
  const postPlant = atk.filter(r => r.planted), retake = def.filter(r => r.planted);
  const states = {};
  for (const r of rs) for (const s of new Set(r.states.slice(1))) { (states[s] ||= { n: 0, w: 0 }); states[s].n++; if (r.result === 'W') states[s].w++; }
  return {
    rounds: rs.length, won: rs.filter(r => r.result === 'W').length,
    fbRate: rs.length ? fbUs.length / rs.length : null,
    fbConv: rate(fbUs), fbThemSurvive: rate(fbThem),
    atkRate: rate(atk), defRate: rate(def),
    plants: postPlant.length, postPlantRate: rate(postPlant),
    retakes: retake.length, retakeRate: rate(retake),
    states,
    unsure: (data?.rounds || []).filter(r => r.unsure).length,
  };
}

// ---------- across many maps ----------
/** breakdowns: [{ game, data, source }] (already filtered to one mode) */
export function hpAggregate(list) {
  const byHill = {};
  const all = [];
  for (const b of list) for (const h of b.data.hills || []) {
    if (!h.first) continue;
    all.push(h);
    const n = h.n || 1;
    byHill[n] ||= [];
    byHill[n].push(h);
  }
  const sum = hs => hpSummary({ hills: hs });
  return {
    maps: list.length, total: sum(all),
    byHill: Object.keys(byHill).map(Number).sort((a, b) => a - b).map(n => ({ n, ...sum(byHill[n]) })),
  };
}

export function sndAggregate(list, size = TEAM_SIZE) {
  const rounds = list.flatMap(b => b.data.rounds || []);
  return { maps: list.length, ...sndSummary({ rounds }, size) };
}

/** Per-map features for "what wins us maps" (merged into the stat-line features). */
export function breakdownFeatures(mode, data) {
  if (!data) return {};
  const k = modeKind(mode);
  if (k === 'hp') {
    const s = hpSummary(data);
    if (!s.hills) return {};
    return { hp_rotation_rate: s.rotationRate, hp_holds: s.held, hp_breaks: s.broke, hp_got_broken: s.got_broken };
  }
  if (k === 'snd') {
    const s = sndSummary(data);
    if (!s.rounds) return {};
    const f = { snd_fb_rate: s.fbRate };
    if (s.fbConv != null) f.snd_fb_conversion = s.fbConv;
    if (s.plants) f.snd_post_plant_rate = s.postPlantRate;
    if (s.retakes) f.snd_retake_rate = s.retakeRate;
    return f;
  }
  return {};
}
