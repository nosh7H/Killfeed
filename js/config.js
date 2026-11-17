// ============================================================
// Site configuration
// Leave SUPABASE_URL empty to run in Demo mode (data stays in
// this browser only). Fill both values to enable accounts,
// shared team data and cloud screenshot storage.
// The anon key is safe to publish — Row Level Security in
// supabase/schema.sql protects the data.
// ============================================================

export const SUPABASE_URL = '';        // e.g. 'https://abcdxyz.supabase.co'
export const SUPABASE_ANON_KEY = '';   // Project Settings → API → anon public key

export const SITE_NAME = 'Killfeed';

// Show a "Try the demo" button on the sign-in page (cloud mode only).
// The demo runs entirely in the visitor's browser with a sample team.
export const SHOW_DEMO = true;

// Default modes for new teams (owners can edit per team)
export const DEFAULT_MODES = ['Hardpoint', 'Search & Destroy', 'Control'];

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

export const MAX_SCREENSHOT_PX = 2400;   // long edge, screenshots are downscaled before upload
export const SCREENSHOT_QUALITY = 0.85;  // JPEG quality
