// Current LAN event: data cache + everything derived from it (standings, bracket, queue).
import { state } from './state.js';
import {
  resolveMatches, groupStandings, playoffSeeds, buildBracket, indexEvent, advanceCount, groupCount,
} from './event-logic.js';

export const DEFAULT_EVENT_SETTINGS = {
  modes: ['Hardpoint', 'Hijack', 'Search & Destroy'],
  maps: { 'Hardpoint': [], 'Hijack': [], 'Search & Destroy': [] },
  mode_order: ['Hardpoint', 'Search & Destroy', 'Hijack', 'Hardpoint', 'Search & Destroy'],
  // 40-PC lab: 8 rows of 5 in 4 sections → each section (2 rows, 10 PCs) runs one 4v4 match
  stations: ['Section A', 'Section B', 'Section C', 'Section D'],
  groups: 'auto',        // 'auto' = 2–4 groups depending on entries, or a number
  advance: 'all',        // 'all' = every team goes to the bracket, or top N per group
  bracket: 'double',
  group_bo: 3,
  playoff_bo: 5,
  final_bo: 5,
  seeds: null,            // locked playoff seed list (team ids) once playoffs are generated
  seed_override: null,    // manual seed order chosen before generating playoffs
  display: {
    seconds: 20,
    scenes: ['groups', 'kd:Hardpoint', 'kd:Hijack', 'kd:Search & Destroy', 'teams', 'bracket'],
    min_games: 2,
    ticker: true,
  },
};

export function eventSettings(ev) {
  const s = ev?.settings || {};
  return {
    ...DEFAULT_EVENT_SETTINGS, ...s,
    maps: { ...DEFAULT_EVENT_SETTINGS.maps, ...(s.maps || {}) },
    display: { ...DEFAULT_EVENT_SETTINGS.display, ...(s.display || {}) },
  };
}

export const ev = {
  event: null,
  settings: null,
  data: null,
  isAdmin: false,
  resolved: new Map(),
  standings: {},
  seeds: [],
  projected: false,      // bracket shown from live standings (playoffs not generated yet)
  bracketPreview: [],    // in-memory bracket when not generated
  teamById: new Map(),
  idx: null,
  unsub: null,
  logoUrls: {},     // logo_path → displayable URL
};

export async function loadEvent(id, { force = false } = {}) {
  if (!force && ev.event?.id === id && ev.data) return ev.event;
  const event = await state.store.getEvent(id);
  if (!event) return null;
  ev.event = event;
  ev.isAdmin = state.user ? await state.store.isEventAdmin(id) : false;
  ev.data = await state.store.evLoad(id);
  ev.data.vetoes ||= [];
  await loadLogos();
  derive();
  return event;
}

export async function refreshEvent() {
  ev.event = await state.store.getEvent(ev.event.id) || ev.event;
  ev.data = await state.store.evLoad(ev.event.id);
  ev.data.vetoes ||= [];
  await loadLogos();
  derive();
}

export async function loadLogos() {
  const missing = ev.data.teams.map(t => t.logo_path).filter(p => p && !ev.logoUrls[p]);
  if (!missing.length) return;
  try { Object.assign(ev.logoUrls, await state.store.evLogoUrls(missing)); } catch (e) { console.warn('logos', e); }
}

export function derive() {
  ev.settings = eventSettings(ev.event);
  const d = ev.data;
  ev.teamById = new Map(d.teams.map(t => [t.id, t]));
  ev.standings = groupStandings(d.teams, d.matches, d.games);
  const hasBracket = d.matches.some(m => m.stage !== 'group');
  if (hasBracket && ev.settings.seeds?.length) {
    ev.seeds = ev.settings.seeds;
    ev.projected = false;
    ev.bracketPreview = [];
  } else {
    // live projection from current standings
    const auto = playoffSeeds(ev.standings, advanceCount(ev.settings.advance));
    const o = ev.settings.seed_override;
    ev.seeds = o?.length ? [...o.filter(id => auto.includes(id)), ...auto.filter(id => !o.includes(id))] : auto;
    ev.projected = true;
    ev.bracketPreview = ev.seeds.length >= 2
      ? buildBracket(ev.seeds.length, ev.settings.bracket).map(m => ({ ...m, id: `preview-${m.code}`, best_of: ev.settings.playoff_bo, status: 'scheduled' }))
      : [];
  }
  const all = [...d.matches, ...ev.bracketPreview];
  ev.resolved = resolveMatches(all, d.games, ev.seeds);
  ev.idx = indexEvent(d);
}

export const groupsFor = () => groupCount(ev.settings.groups, ev.data.teams.length);
export const bracketMatches = () => (ev.projected ? ev.bracketPreview : ev.data.matches.filter(m => m.stage !== 'group'));
export const teamName = id => (id === 'BYE' ? 'BYE' : ev.teamById.get(id)?.name || null);
export const teamTag = id => ev.teamById.get(id)?.tag || ev.teamById.get(id)?.name?.slice(0, 4).toUpperCase() || '';
export const eventPath = (sub = '') => `#/e/${ev.event.id}${sub ? '/' + sub : ''}`;

/** Subscribe to live changes; calls onChange after data is reloaded. */
export function watchEvent(onChange) {
  ev.unsub?.();
  const id = ev.event.id;
  let busy = false;
  const reload = async () => {
    if (busy || ev.event?.id !== id) return;
    busy = true;
    try { await refreshEvent(); onChange(); } finally { busy = false; }
  };
  const unsubLive = state.store.subscribeEvent(id, reload);
  const poll = setInterval(reload, 30000); // safety net if the live connection drops
  ev.unsub = () => { unsubLive(); clearInterval(poll); ev.unsub = null; };
  return ev.unsub;
}

/** Small team badge: logo if uploaded, otherwise the tag on the team color. */
export function teamBadge(id, size = 'sm') {
  const t = ev.teamById.get(id);
  if (!t) return null;
  const url = t.logo_path && ev.logoUrls[t.logo_path];
  const el = document.createElement('span');
  el.className = `tbadge tbadge-${size}`;
  if (t.color) el.style.setProperty('--tc', t.color);
  if (url) { const img = document.createElement('img'); img.src = url; img.alt = ''; el.append(img); el.classList.add('has-logo'); }
  else el.textContent = (t.tag || t.name.slice(0, 3)).slice(0, 4).toUpperCase();
  return el;
}

/** Download every stat for the current event as one ZIP (CSV files + JSON backup), or one CSV. */
export async function exportEvent(only = null) {
  const { eventCsvs, makeZip } = await import('./event-export.js');
  const files = eventCsvs(ev.event, ev.data, ev.resolved, ev.standings, ev.settings);
  const base = ev.event.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'event';
  const save = (blob, name) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  if (only) return save(new Blob(['\ufeff' + files[only]], { type: 'text/csv' }), `${base}-${only}`);
  save(new Blob([makeZip(files)], { type: 'application/zip' }), `${base}-stats.zip`);
}
