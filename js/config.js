// ============================================================
// Site configuration
// Leave SUPABASE_URL empty to run in Demo mode (data stays in
// this browser only). Fill both values to enable accounts,
// shared team data and cloud screenshot storage.
// The anon key is safe to publish — Row Level Security in
// supabase/schema.sql protects the data.
// ============================================================

export const SUPABASE_URL = //'https://gzlrtkboucdokqkbslzw.supabase.co/';        // e.g. 'https://abcdxyz.supabase.co'
export const SUPABASE_ANON_KEY = //'sb_publishable_t09-qz4zAoNbHHLvKl2CYg_S8tmhujF';   // Project Settings → API → anon public key

export const SITE_NAME = 'Killfeed';

// Show a "Try the demo" button on the sign-in page (cloud mode only).
// The demo runs entirely in the visitor's browser with a sample team.
export const SHOW_DEMO = false;

// Default modes for new teams (owners can edit per team)
export const DEFAULT_MODES = ['Hardpoint', 'Search & Destroy', 'Hijack'];

// Current competitive map pool per mode. Teams and new events start from this;
// both can change their own pool (Team settings / event Setup → Format).
export const MAP_POOL = {
  'Hardpoint': ['Lotus', 'Lithium', 'Munition', 'Reactor U92', 'Rooftops', 'Sentry'],
  'Search & Destroy': ['Coal', 'Lotus', 'Munition', 'Reactor U92', 'Rooftops', 'Silkworm'],
  'Hijack': ['Lotus', 'Lithium', 'Munition'],
};
/** Every map in the pool, once. */
export const POOL_MAPS = [...new Set(Object.values(MAP_POOL).flat())].sort();
/** The pool for one mode, limited to a team's own map list when it has one. */
export function poolFor(mode, teamMaps = []) {
  const base = MAP_POOL[mode];
  if (!base) return teamMaps;
  return teamMaps.length ? base.filter(m => teamMaps.includes(m)) : base;
}

// Match types
export const MATCH_TYPES = [
  { id: 'scrim', label: 'Scrim' },
  { id: 'match', label: 'Match' },
  { id: 'tournament', label: 'Tournament' },
  { id: 'pug', label: 'PUG / 8s' },
];

// Every stat the app knows about. `modes` limits where a column
// appears (null = all modes). `time` = stored as seconds, shown as m:ss.
export const STAT_FIELDS = [
  { key: 'kills',        label: 'K',    long: 'Kills',        modes: null },
  { key: 'deaths',       label: 'D',    long: 'Deaths',       modes: null },
  { key: 'assists',      label: 'A',    long: 'Assists',      modes: null, optional: true },
  { key: 'damage',       label: 'DMG',  long: 'Damage',       modes: null, optional: true },
  { key: 'obj_time',     label: 'OBJ',  long: 'Obj time',     modes: ['Hardpoint'], time: true },
  { key: 'plants',       label: 'PL',   long: 'Plants',       modes: ['Search & Destroy'] },
  { key: 'defuses',      label: 'DEF',  long: 'Defuses',      modes: ['Search & Destroy'] },
  { key: 'first_bloods', label: 'FB',   long: 'First bloods', modes: ['Search & Destroy'], optional: true },
  { key: 'captures',     label: 'CAP',  long: 'Captures',     modes: ['Control'] },
];

// Fields that apply to a given mode. Unknown/custom modes get every field.
export function fieldsForMode(mode) {
  const known = STAT_FIELDS.some(f => f.modes && f.modes.includes(mode));
  return STAT_FIELDS.filter(f => !f.modes || !known || f.modes.includes(mode));
}

// LAN events. Player POV scoreboards only show the basics; a caster (CODCaster) POV adds the
// advanced columns, so those are only entered for casted matches.
export const EVENT_STAT_FIELDS = [
  { key: 'kills',            label: 'K',     long: 'Kills',               modes: null },
  { key: 'deaths',           label: 'D',     long: 'Deaths',              modes: null },
  { key: 'obj_time',         label: 'HILL',  long: 'Hill time',           modes: ['Hardpoint'], time: true },
  { key: 'plants',           label: 'PL',    long: 'Plants',              modes: ['Search & Destroy'] },
  { key: 'defuses',          label: 'DEF',   long: 'Defuses',             modes: ['Search & Destroy'] },
  { key: 'captures',         label: 'CAP',   long: 'Captures',            modes: ['Control'] },
  // caster only
  { key: 'assists',          label: 'A',     long: 'Assists',             modes: null, advanced: true },
  { key: 'non_traded_kills', label: 'NTK',   long: 'Non-traded kills',    modes: null, advanced: true },
  { key: 'highest_streak',   label: 'STRK',  long: 'Highest streak',      modes: null, advanced: true },
  { key: 'damage',           label: 'DMG',   long: 'Damage',              modes: null, advanced: true },
  { key: 'avg_hill_time',    label: 'AVG',   long: 'Average hill time',   modes: ['Hardpoint'], time: true, advanced: true },
  { key: 'obj_kills',        label: 'OBJ K', long: 'Objective kills',     modes: ['Hardpoint'], advanced: true },
  { key: 'contested_time',   label: 'CONT',  long: 'Contested hill time', modes: ['Hardpoint'], time: true, advanced: true },
  { key: 'first_bloods',     label: 'FB',    long: 'First bloods',        modes: ['Search & Destroy'], advanced: true },
];

/** Event stat columns for a mode; caster-only columns only when `advanced`. */
export function eventFields(mode, advanced = false) {
  const known = EVENT_STAT_FIELDS.some(f => f.modes && f.modes.includes(mode));
  return EVENT_STAT_FIELDS.filter(f => (!f.modes || !known || f.modes.includes(mode)) && (advanced || !f.advanced));
}

export const MAX_SCREENSHOT_PX = 2400;   // long edge, screenshots are downscaled before upload
export const SCREENSHOT_QUALITY = 0.85;  // JPEG quality
