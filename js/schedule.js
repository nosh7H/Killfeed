// Team schedule logic — pure functions (unit-tested in Node).
//   events:  [{ id, kind: 'scrim'|'match'|'tournament'|'practice', league_id, title, opponent, starts_at, ends_at, status, history }]
//   timeoff: [{ id, player_id, starts_at, ends_at, repeat: 'none'|'weekly', until, reason }]
// Times are ISO strings (stored UTC, shown in local time).

export const KINDS = [
  { id: 'scrim', label: 'Scrim' },
  { id: 'match', label: 'League match' },
  { id: 'tournament', label: 'Tournament' },
  { id: 'practice', label: 'Practice / VOD review' },
];

export const DEFAULT_SCHEDULE_CFG = {
  scrim_color: '#14b8a6',
  practice_color: '#71717a',
  leagues: [
    { id: 'lg-1', name: 'League 1', color: '#3987e5' },
    { id: 'lg-2', name: 'League 2', color: '#f2a93b' },
  ],
  day_start: 12 * 60,   // calendar shows 12:00 …
  day_end: 24 * 60,     // … to midnight
};
export const LEAGUE_PALETTE = ['#3987e5', '#f2a93b', '#e93d82', '#22c55e', '#ef4444', '#8b5cf6', '#06b6d4', '#eab308'];

export function scheduleCfg(team) {
  const c = team?.schedule_cfg || {};
  return { ...DEFAULT_SCHEDULE_CFG, ...c, leagues: c.leagues?.length ? c.leagues : DEFAULT_SCHEDULE_CFG.leagues };
}

/** Color for an event: scrims and practice have their own; matches/tournaments use their league's color. */
export function eventColor(ev, cfg) {
  if (ev.kind === 'scrim') return cfg.scrim_color;
  if (ev.kind === 'practice') return cfg.practice_color;
  return cfg.leagues.find(l => l.id === ev.league_id)?.color || '#a1a1aa';
}

const ms = s => new Date(s).getTime();
const MIN = 60000, DAY = 86400000, WEEK = 7 * DAY;

/** Expand time off (incl. weekly repeats) into concrete intervals overlapping [from, to). */
export function expandTimeOff(timeoff, from, to) {
  const out = [];
  const f = ms(from), t = ms(to);
  for (const o of timeoff) {
    const s = ms(o.starts_at), e = ms(o.ends_at);
    if (!(e > s)) continue;
    if (o.repeat === 'weekly') {
      const until = o.until ? ms(o.until) + DAY : Infinity;
      // first occurrence that could overlap `from`
      let k = Math.max(0, Math.floor((f - e) / WEEK) - 1);
      const addWeeks = (t0, n) => { const d = new Date(t0); d.setDate(d.getDate() + 7 * n); return d.getTime(); }; // local calendar weeks (DST-safe)
      for (; ; k++) {
        const os = addWeeks(s, k), oe = addWeeks(e, k);
        if (os >= t || os >= until) break;
        if (oe > f) out.push({ ...o, s: os, e: oe });
      }
    } else if (e > f && s < t) out.push({ ...o, s, e });
  }
  return out;
}

/** Players unavailable during [s, e) — returns a Set of player ids. */
export function outDuring(intervals, s, e) {
  const set = new Set();
  for (const iv of intervals) if (iv.s < e && iv.e > s) set.add(iv.player_id);
  return set;
}

/** Conflicts for one event: which roster players have time off during it. */
export function eventConflicts(ev, intervals) {
  return outDuring(intervals, ms(ev.starts_at), ms(ev.ends_at));
}

/** Events overlapping each other (double bookings). */
export function overlapsWith(ev, events) {
  const s = ms(ev.starts_at), e = ms(ev.ends_at);
  return events.filter(x => x.id !== ev.id && x.status !== 'cancelled' && ms(x.starts_at) < e && ms(x.ends_at) > s);
}

/**
 * Best times to schedule something.
 * opts: { from, to, durationMin, dayStartMin, dayEndMin, stepMin, minPlayers, players: [ids], events, timeoff, now }
 * Window is in local time of day (minutes after midnight). Returns slots sorted by most players free, then earliest.
 */
export function findSlots(opts) {
  const { from, to, durationMin = 120, dayStartMin = 18 * 60, dayEndMin = 23 * 60, stepMin = 30, players = [], events = [], timeoff = [] } = opts;
  const minPlayers = opts.minPlayers ?? players.length;
  const intervals = expandTimeOff(timeoff, from, new Date(ms(to) + DAY).toISOString());
  const busy = events.filter(e => e.status !== 'cancelled').map(e => [ms(e.starts_at), ms(e.ends_at)]);
  const now = opts.now ? ms(opts.now) : -Infinity;
  const slots = [];
  const day0 = new Date(from); day0.setHours(0, 0, 0, 0);
  for (let d = day0.getTime(); d < ms(to); d += DAY) {
    const base = new Date(d);
    for (let m = dayStartMin; m + durationMin <= dayEndMin; m += stepMin) {
      const s = new Date(base); s.setHours(0, m, 0, 0);
      const st = s.getTime(), en = st + durationMin * MIN;
      if (st < ms(from) || st < now) continue;
      if (busy.some(([bs, be]) => bs < en && be > st)) continue;
      const out = outDuring(intervals, st, en);
      const free = players.filter(p => !out.has(p));
      if (free.length < minPlayers) continue;
      slots.push({ start: new Date(st).toISOString(), end: new Date(en).toISOString(), free, out: players.filter(p => out.has(p)) });
    }
  }
  return slots.sort((a, b) => b.free.length - a.free.length || ms(a.start) - ms(b.start));
}

/** Merge back-to-back slots with identical availability into ranges for a readable list. */
export function mergeSlots(slots, durationMin) {
  const byStart = [...slots].sort((a, b) => ms(a.start) - ms(b.start));
  const out = [];
  for (const s of byStart) {
    const last = out[out.length - 1];
    if (last && ms(s.start) - ms(last.lastStart) <= 30 * MIN && last.out.join() === s.out.join()) { last.lastStart = s.start; last.latestEnd = s.end; continue; }
    out.push({ ...s, lastStart: s.start, latestEnd: s.end });
  }
  return out.sort((a, b) => b.free.length - a.free.length || ms(a.start) - ms(b.start)).map(r => ({ ...r, durationMin }));
}

/** Move an event, keeping its length; records the change in history. */
export function moveEvent(ev, newStart, by = null) {
  const len = ms(ev.ends_at) - ms(ev.starts_at);
  const s = ms(newStart);
  return {
    ...ev,
    starts_at: new Date(s).toISOString(),
    ends_at: new Date(s + len).toISOString(),
    history: [...(ev.history || []), { from: ev.starts_at, to: new Date(s).toISOString(), at: new Date().toISOString(), by }],
  };
}
