// Current LAN event: data cache + everything derived from it (standings, bracket, queue).
import { MAP_POOL } from './config.js';
import { state } from './state.js';
import { installEventLog } from './event-log.js';
import {
  resolveMatches, groupStandings, playoffSeeds, buildBracket, indexEvent, advanceCount, groupCount, matchSpot, seriesResult, seedTable, headToHead, pendingCoins, estimateTimes, fmtEst, EST_DEFAULTS, finalDayPlan,
} from './event-logic.js';

export const DEFAULT_EVENT_SETTINGS = {
  modes: ['Hardpoint', 'Hijack', 'Search & Destroy'],
  maps: structuredClone(MAP_POOL),   // per mode; edit in Setup → Format
  mode_order: ['Hardpoint', 'Search & Destroy', 'Hijack', 'Hardpoint', 'Search & Destroy'],
  // Group stage: 40-PC lab = 8 rows of 5. Each team is pinned to one row for the whole group stage.
  seating: {
    group_rows: 8, label: 'Row', pcs: 5,
    // Group stage in sessions: each group plays all its matches in one session on a block of rows.
    sessions: [{ id: 's1', name: 'Morning' }, { id: 's2', name: 'Evening' }],
    plan: {},        // { A: { session: 's1', from: 1 }, B: { session: 's1', from: 5 }, ... }
    current: '',     // session shown on the seating screen ('' = all)
  },
  caster: 'some',    // advanced (caster POV) stats: 'none' | 'some' (tick per match) | 'all'
  veto_method: 'online',  // default for new vetoes: 'online' (captain links) or 'in_person' (staff enters maps)
  groups: 'auto',        // 'auto' = 2–4 groups depending on entries, or a number
  advance: 'all',        // 'all' = every team goes to the bracket, or top N per group
  bracket: 'double',
  group_bo: 3,
  playoff_bo: 5,
  final_bo: 5,
  seeds: null,            // locked playoff seed list (team ids) once playoffs are generated
  seed_override: null,    // manual seed order chosen before generating playoffs
  seed_method: 'rank',    // 'rank': place by place, ranked with the tiebreakers · 'snake': A1, B1, B2, A2 …
  coin_flips: {},         // { 'id,id': [winner first, …] } coin flips already done
  group_override: {},     // { A: [team ids] } manual group order (rearranged by staff)
  final_top: 6,           // teams that make the final day (Sunday); 0 = no cut
  final_rounds: null,     // bracket rounds staff ticked as "played on Sunday" (['upper:4', 'lower:4', …]); null = automatic
  est: { ...EST_DEFAULTS }, // estimated start times: minutes per map, gap between matches, day/session start times
  display: {
    seconds: 20,
    scenes: ['live', 'groups', 'kd:Hardpoint', 'kd:Hijack', 'kd:Search & Destroy', 'teams', 'bracket'],
    scenes_v: 2,
    min_games: 2,
    ticker: true,           // live / up next bar on every screen
    leaders: true,          // scrolling category leaders in that bar
    paused: false,          // remote: hold the current screen
    cmd: null,              // remote: { next: timestamp } skips to the next screen
    announce: null,         // remote: { text, at } banner on the screen
  },
};

export function eventSettings(ev) {
  const s = ev?.settings || {};
  const display = { ...DEFAULT_EVENT_SETTINGS.display, ...(s.display || {}) };
  // events made before the Live screen existed: add it once at the front
  if (!s.display?.scenes_v && s.display?.scenes && !display.scenes.includes('live')) display.scenes = ['live', ...display.scenes];
  return {
    ...DEFAULT_EVENT_SETTINGS, ...s,
    maps: { ...DEFAULT_EVENT_SETTINGS.maps, ...(s.maps || {}) },
    seating: { ...DEFAULT_EVENT_SETTINGS.seating, ...(s.seating || {}) },
    est: { ...EST_DEFAULTS, ...(s.est || {}) },
    display,
  };
}

export const ev = {
  event: null,
  settings: null,
  data: null,
  isAdmin: false,      // admin powers on this page (false while an admin previews another role)
  realAdmin: false,    // the signed-in user really is an event admin (owner, admin or staff)
  memberRole: null,    // 'owner' | 'admin' | 'staff'
  manager: false,      // owner or admin: setup, teams, groups, seeding, captain links, members
  staffName: null,     // this admin's name in the activity log
  role: 'viewer',      // 'admin' | 'captain' | 'player' | 'viewer'
  myTeam: null,        // team id for players and captains
  captainKey: null,    // the team's private captain key (captains only)
  preview: null,       // admin "preview as": { role, team }
  resolved: new Map(),
  standings: {},
  seedTable: [],         // [{ id, place, group, tb, coin }] seed list with the tiebreaker behind each spot
  coinsNeeded: [],       // coin flips still to do
  finalDay: null,        // { sunday, qualifies, qualified, top } — the top-N final day
  h2h: new Map(),
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
  ev.realAdmin = state.user ? await state.store.isEventAdmin(id) : false;
  ev.memberRole = ev.realAdmin ? (await state.store.eventRole?.(id).catch(() => 'admin')) || 'admin' : null;
  if (ev.realAdmin) {
    installEventLog();
    ev.staffName = await state.store.myEventName?.(id).catch(() => null) || 'Staff';
  }
  ev.data = await state.store.evLoad(id);
  ev.data.vetoes ||= [];
  await loadLogos();
  derive();
  await resolveRole();
  return event;
}

// ---------- roles ----------
// viewer:  anyone with the link (read only)
// player:  picked their team on this device; personal "My team" page, still read only
// captain: opened their team's private captain link; can check in, veto, report scores, call staff, fix the roster
// admin:   event admins / staff (signed in)
const lsKey = (what, id = ev.event?.id) => `kf-ev-${what}-${id}`;
const store = {
  get: key => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, v) => { try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, v); } catch { /* private mode */ } },
};

export async function resolveRole() {
  const id = ev.event.id;
  // a captain link: #/e/<id>?cap=KEY → remember it on this device and tidy the address bar
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const urlKey = params.get('cap');
  if (urlKey) {
    params.delete('cap');
    const clean = location.hash.split('?')[0] + (params.toString() ? `?${params}` : '');
    history.replaceState(null, '', clean);
    if (ev.realAdmin) {
      // an admin opening a captain link (e.g. testing it): show exactly what that captain sees, as a preview
      const team = await state.store.captainTeam(id, urlKey).catch(() => null);
      if (team && ev.teamById.has(team)) {
        try { sessionStorage.setItem(lsKey('preview'), JSON.stringify({ role: 'captain', team })); } catch { /* ignore */ }
        toastLater(`Showing ${teamName(team)}’s captain screen. You’re an admin: “Exit preview” takes you back.`, 'info');
      } else toastLater('That captain link isn’t valid any more.');
    } else store.set(lsKey('cap'), urlKey);
  }
  ev.preview = (() => { try { return JSON.parse(sessionStorage.getItem(lsKey('preview')) || 'null'); } catch { return null; } })();
  if (!ev.realAdmin) ev.preview = null;
  // "Preview as Staff": an admin sees the event the way a staff member does
  const staffPreview = ev.preview?.role === 'staff';
  ev.isAdmin = ev.realAdmin && (!ev.preview || staffPreview);
  // managers (owner / admin) do setup; staff run matches
  ev.manager = ev.isAdmin && ['owner', 'admin'].includes(ev.memberRole) && !staffPreview;
  ev.captainKey = null; ev.myTeam = null; ev.role = 'viewer';
  if (staffPreview) { ev.role = 'admin'; return; }

  if (ev.preview) {
    ev.role = ev.preview.role;
    ev.myTeam = ev.teamById.has(ev.preview.team) ? ev.preview.team : null;
    if (ev.role === 'captain' && ev.myTeam) {
      const keys = await state.store.teamKeys(id).catch(() => []);
      ev.captainKey = keys.find(x => x.team_id === ev.myTeam)?.captain_key || null;
    }
    if (ev.role !== 'viewer' && !ev.myTeam) ev.role = 'viewer';
    return;
  }
  if (ev.realAdmin) { ev.role = 'admin'; return; }

  const capKey = store.get(lsKey('cap'));
  if (capKey) {
    const team = await state.store.captainTeam(id, capKey).catch(() => null);
    if (team && ev.teamById.has(team)) { ev.role = 'captain'; ev.myTeam = team; ev.captainKey = capKey; return; }
    store.set(lsKey('cap'), null);
    if (urlKey) toastLater('That captain link isn’t valid any more. Ask the tournament staff for a new one.');
  }
  const picked = store.get(lsKey('team'));
  if (picked && ev.teamById.has(picked)) { ev.role = 'player'; ev.myTeam = picked; }
}
function toastLater(msg, kind = 'error') { setTimeout(() => import('./ui.js').then(m => m.toast(msg, kind)), 300); }

/** Player: "this is my team" on this device (null = just watching). */
export function setMyTeam(teamId) {
  store.set(lsKey('team'), teamId || null);
  if (!teamId) store.set(lsKey('watching'), '1');
  ev.myTeam = teamId || null;
  ev.role = ev.role === 'captain' || ev.role === 'admin' ? ev.role : teamId ? 'player' : 'viewer';
}
export const dismissedPicker = () => store.get(lsKey('watching')) === '1';
/** Captain: stop using the captain link on this device. */
export function leaveCaptain() { store.set(lsKey('cap'), null); ev.captainKey = null; ev.role = ev.myTeam ? 'player' : 'viewer'; if (ev.myTeam) store.set(lsKey('team'), ev.myTeam); }
/** Admin: preview the site as another role (this tab only). */
export async function setPreview(p) {
  try { p ? sessionStorage.setItem(lsKey('preview'), JSON.stringify(p)) : sessionStorage.removeItem(lsKey('preview')); } catch { /* ignore */ }
  await resolveRole();
}
/** Captain link for a team. */
export const captainLink = key => `${location.origin}${location.pathname}#/e/${ev.event.id}/me?cap=${encodeURIComponent(key)}`;
export const ROLE_LABEL = { admin: 'Admin', captain: 'Captain', player: 'Player', viewer: 'Viewer' };

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
  ev.standings = groupStandings(d.teams, d.matches, d.games, { coins: ev.settings.coin_flips || {} });
  // staff can rearrange a group by hand (rulings, forfeits); teams not in the saved order keep their place at the end
  for (const [g, order] of Object.entries(ev.settings.group_override || {})) {
    const rows = ev.standings[g];
    if (!rows || !order?.length) continue;
    const pos = id => { const i = order.indexOf(id); return i < 0 ? 1e3 : i; };
    ev.standings[g] = [...rows].sort((x, y) => pos(x.team.id) - pos(y.team.id)).map(r => ({ ...r, manual: true }));
  }
  ev.h2h = headToHead(d.matches, d.games);
  const gms = d.matches.filter(m => m.stage === 'group');
  const groupsDone = gms.length > 0 && gms.every(m => m.status === 'final' || seriesResult(m, d.games.filter(g => g.match_id === m.id)).done);
  ev.seedTable = seedTable(ev.standings, advanceCount(ev.settings.advance), { method: ev.settings.seed_method || 'rank', coins: ev.settings.coin_flips || {}, h2h: ev.h2h, final: groupsDone });
  ev.coinsNeeded = pendingCoins(ev.standings, ev.seedTable);
  const hasBracket = d.matches.some(m => m.stage !== 'group');
  if (hasBracket && ev.settings.seeds?.length) {
    ev.seeds = ev.settings.seeds;
    ev.projected = false;
    ev.bracketPreview = [];
  } else {
    // live projection from current standings
    const auto = ev.seedTable.map(x => x.id);
    const o = ev.settings.seed_override;
    ev.seeds = o?.length ? [...o.filter(id => auto.includes(id)), ...auto.filter(id => !o.includes(id))] : auto;
    ev.projected = true;
    ev.bracketPreview = ev.seeds.length >= 2
      ? buildBracket(ev.seeds.length, ev.settings.bracket).map(m => ({ ...m, id: `preview-${m.code}`, best_of: ev.settings.playoff_bo, status: 'scheduled' }))
      : [];
  }
  const all = [...d.matches, ...ev.bracketPreview];
  ev.resolved = resolveMatches(all, d.games, ev.seeds);
  // the final day: real bracket if it exists, else the projected one
  const bmAll = d.matches.some(m => m.stage !== 'group') ? d.matches : all;
  ev.finalDay = finalDayPlan(bmAll, ev.resolved, Number(ev.settings.final_top ?? 6), ev.settings.final_rounds);
  ev.finalDayAuto = ev.settings.final_rounds?.length ? finalDayPlan(bmAll, ev.resolved, Number(ev.settings.final_top ?? 6)) : ev.finalDay;
  ev.idx = indexEvent(d);
}

export const groupsFor = () => groupCount(ev.settings.groups, ev.data.teams.length);
export const bracketMatches = () => (ev.projected ? ev.bracketPreview : ev.data.matches.filter(m => m.stage !== 'group'));
export const teamName = id => (id === 'BYE' ? 'BYE' : ev.teamById.get(id)?.name || null);
export const teamTag = id => ev.teamById.get(id)?.tag || ev.teamById.get(id)?.name?.slice(0, 4).toUpperCase() || '';
/** Where a match is played (pinned rows in groups, row/pod in the bracket). */
/** Expected start of a match: { start, end, live } or null. Recomputed at most once a minute (or when data changes). */
let estCache = null, estAt = 0, estData = null;
export function estOf(m) {
  if (!m || !ev.data) return null;
  if (estData !== ev.data || Date.now() - estAt > 60000) {
    estCache = estimateTimes(ev.data.matches, ev.resolved, ev.data.games, { now: new Date(), settings: ev.settings, teamById: ev.teamById, eventDate: ev.event?.starts_on, sunday: ev.finalDay?.sunday });
    estAt = Date.now(); estData = ev.data;
  }
  return estCache.get(m.id) || null;
}
/** "~2:40 PM" / "Now" for a match that hasn't started, '' otherwise (or when hidden from the public). */
export function estText(m, { staff = false } = {}) {
  if (!staff && ev.settings?.est?.public === false) return '';
  const e = estOf(m);
  if (!e || e.live) return '';
  const t = fmtEst(e.start);
  return t === 'Now' ? 'Now' : `~${t}`;
}
/** "Sunday" (or the weekday of the final day's start time). */
export function finalDayName() {
  const v = ev.settings?.est?.sunday_start;
  const d = v && /T/.test(v) ? new Date(v) : null;
  return d && !isNaN(d) ? d.toLocaleDateString([], { weekday: 'long' }) : 'Sunday';
}
/** For a match: 'qualifies' (winner makes the final day), 'both' (both teams already through, still played today),
 *  'final' (played on the final day) or null. */
export function finalDayRole(m) {
  const p = ev.finalDay;
  if (!p || !m) return null;
  return p.qualifies.has(m.id) ? 'qualifies' : p.both?.has(m.id) ? 'both' : p.sunday.has(m.id) ? 'final' : null;
}
export const isQualified = teamId => !!ev.finalDay?.qualified.has(teamId);

/** "Match 12" (empty if the match has no number yet). */
export const matchNo = m => (m?.match_no ? `Match ${m.match_no}` : '');
export const spotOf = m => matchSpot(m, ev.resolved.get(m.id), ev.teamById, ev.settings.seating);
/** Where each team reports: "AFTERGLOW → Row 5 · IRONCLAD → Row 6" (tags with short = true). */
export function reportTo(m, short = false) {
  const sp = spotOf(m);
  if (!sp) return '';
  if (!sp.rows) return sp.label;
  const r = ev.resolved.get(m.id) || {};
  const lbl = ev.settings.seating?.label || 'Row';
  const nm = id => (short ? teamTag(id) : teamName(id)) || 'TBD';
  return [[r.A, sp.rows[0]], [r.B, sp.rows[1]]].map(([id, row]) => `${nm(id)} → ${lbl} ${row ?? '?'}`).join(' · ');
}
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
