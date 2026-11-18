// Activity log: every change staff make to an event is written to event_log with the rows as they were
// (before) and as written (after), so any action can be traced ("who entered map 3?") and reverted.
// Captain actions are logged by the database functions themselves (schema.sql → _log).
//
// It works by wrapping the store's event writes once: evUpsert, evDelete and updateEvent (settings).
// The writes from one click (or key press) are one action (a group) and revert together.
import { state } from './state.js';
import { ev, teamTag, teamName } from './event-state.js';
import { gameWinner } from './event-logic.js';
import { uid } from './ui.js';

const LOGGED = ['event_matches', 'event_games', 'event_stats', 'event_teams', 'event_players', 'event_vetoes'];
const DATA_KEY = { event_matches: 'matches', event_games: 'games', event_stats: 'stats', event_teams: 'teams', event_players: 'players', event_vetoes: 'vetoes' };
// settings that change on their own or are cosmetic: not worth a log line
const QUIET_SETTINGS = new Set(['display']);
const GROUP_GAP = 2500;

let installed = false;
let group = null, lastWrite = 0;
let reverting = null; // group id being reverted (labels the writes it causes)
let paused = 0;       // > 0 while writes shouldn't be logged (sample events, bulk imports)

const now = () => new Date().toISOString();
const clone = x => (x == null ? x : JSON.parse(JSON.stringify(x)));
const rowsOf = table => ev.data?.[DATA_KEY[table]] || [];

/** Who is making changes from this browser: a name set on the Activity tab, else the admin's event name. */
export function staffName() {
  try { return localStorage.getItem('kf-staff-name') || ev.staffName || 'Staff'; } catch { return ev.staffName || 'Staff'; }
}
export function setStaffName(n) { try { n ? localStorage.setItem('kf-staff-name', n) : localStorage.removeItem('kf-staff-name'); } catch { /* private mode */ } }

/** Run fn without logging (e.g. building a practice event). */
export async function quietly(fn) { paused++; try { return await fn(); } finally { paused--; } }

function groupId() {
  const t = Date.now();
  if (!group || t - lastWrite > GROUP_GAP) group = uid();
  lastWrite = t;
  return group;
}

// rows deleted along with a parent (same cascade as the database), so a revert can bring them back
function withChildren(table, rows) {
  const out = { [table]: rows };
  const ids = new Set(rows.map(r => r.id));
  if (table === 'event_matches') {
    const games = rowsOf('event_games').filter(g => ids.has(g.match_id));
    const gids = new Set(games.map(g => g.id));
    out.event_games = games;
    out.event_stats = rowsOf('event_stats').filter(s => gids.has(s.game_id));
    out.event_vetoes = rowsOf('event_vetoes').filter(v => ids.has(v.match_id));
  } else if (table === 'event_games') {
    out.event_stats = rowsOf('event_stats').filter(s => ids.has(s.game_id));
  } else if (table === 'event_teams') {
    out.event_players = rowsOf('event_players').filter(p => ids.has(p.team_id));
  }
  for (const k of Object.keys(out)) if (!out[k].length) delete out[k];
  return clone(out);
}

/** Install once. Safe to call on every event load. */
export function installEventLog() {
  const store = state.store;
  if (installed === store) return;
  installed = store;
  // every click or key press starts a new action, so two quick clicks never merge into one group
  if (typeof document !== 'undefined' && !document.__kfLogActions) {
    document.__kfLogActions = true;
    const fresh = () => { if (!reverting) group = null; };
    document.addEventListener('pointerdown', fresh, true);
    document.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fresh(); }, true);
    document.addEventListener('change', fresh, true);
    window.addEventListener('hashchange', fresh);
  }
  const up = store.evUpsert.bind(store), del = store.evDelete.bind(store), upd = store.updateEvent.bind(store);

  store.evUpsert = async (table, rows) => {
    rows = [].concat(rows);
    if (table === 'event_matches') stampTimes(rows);
    if (!shouldLog(table, rows)) return up(table, rows);
    const cur = new Map(rowsOf(table).map(r => [r.id, r]));
    const before = rows.map(r => (r.id ? cur.get(r.id) : null)).filter(Boolean);
    const out = await up(table, rows);
    const after = (out || rows).map(r => ({ ...(cur.get(r.id) || {}), ...r }));
    await write(table, { [table]: clone(before) }, { [table]: clone(after) }, describeUpsert(table, before, after));
    return out;
  };
  store.evDelete = async (table, ids) => {
    const list = [].concat(ids);
    if (!LOGGED.includes(table) || !ev.realAdmin || paused || !list.length) return del(table, ids);
    const gone = rowsOf(table).filter(r => list.includes(r.id));
    const res = await del(table, ids);
    if (gone.length) await write(table, withChildren(table, gone), null, describeDelete(table, gone));
    return res;
  };
  store.updateEvent = async (id, patch) => {
    const res = await upd(id, patch);
    if (ev.event?.id === id && ev.realAdmin && !paused && patch.settings) {
      const old = ev.event.settings || {};
      const keys = Object.keys(patch.settings).filter(k => !QUIET_SETTINGS.has(k) && JSON.stringify(old[k]) !== JSON.stringify(patch.settings[k]));
      if (keys.length) {
        const b = Object.fromEntries(keys.map(k => [k, old[k] ?? null])), a = Object.fromEntries(keys.map(k => [k, patch.settings[k] ?? null]));
        await write('settings', { settings: clone(b) }, { settings: clone(a) }, describeSettings(b, a));
      }
    }
    return res;
  };
}

function shouldLog(table, rows) {
  return LOGGED.includes(table) && ev.realAdmin && !paused && ev.event && rows.every(r => !r.event_id || r.event_id === ev.event.id);
}

// start / end times for estimated start times (any write that takes a match live or final)
function stampTimes(rows) {
  const cur = new Map((ev.data?.matches || []).map(m => [m.id, m]));
  for (const r of rows) {
    const old = cur.get(r.id);
    if (r.status === 'live' && old?.status !== 'live' && !r.started_at) r.started_at = now();
    if (r.status === 'final' && old && old.status !== 'final' && !r.ended_at) r.ended_at = now();
    if (r.status && r.status !== 'final' && old?.status === 'final') r.ended_at = null;
    if ((r.status === 'scheduled' || r.status === 'ondeck') && old?.status === 'live') r.started_at = null;
  }
}

async function write(table, before, after, info) {
  if (!info) return;
  const row = {
    event_id: ev.event.id, actor: staffName(), group_id: reverting ? `r-${reverting}` : groupId(),
    kind: reverting ? 'revert' : 'staff', summary: reverting ? `Reverted: ${info.text}` : info.text,
    match_id: info.match || null, before, after, reverts: reverting || null,
  };
  try { await state.store.evLogAdd(row); } catch (e) { console.warn('activity log:', e.message); }
}

// ---------- plain-English summaries ----------

const matchById = id => ev.data?.matches?.find(m => m.id === id);
function matchLabel(m) {
  if (!m) return 'a match';
  const r = ev.resolved?.get(m.id) || { A: m.team_a, B: m.team_b };
  const vs = `${teamTag(r.A) || 'TBD'} vs ${teamTag(r.B) || 'TBD'}`;
  return m.match_no ? `Match ${m.match_no} (${vs})` : `${m.code || 'Match'} (${vs})`;
}
const STATUS = { scheduled: 'scheduled', ondeck: 'on deck', live: 'live', final: 'final' };
const rowWord = () => ev.settings?.seating?.label || 'Row';

function describeUpsert(table, before, after) {
  const was = new Map(before.map(r => [r.id, r]));
  const changed = (r, k) => JSON.stringify(was.get(r.id)?.[k] ?? null) !== JSON.stringify(r[k] ?? null);
  if (table === 'event_matches') {
    const created = after.filter(r => !was.has(r.id));
    if (created.length > 1) return { text: `Created ${created.length} ${created[0].stage === 'group' ? 'group' : 'playoff'} matches` };
    const moved = after.filter(r => was.has(r.id) && changed(r, 'queue_pos'));
    if (after.length > 2 && moved.length > 1 && after.every(r => !changed(r, 'status'))) return { text: 'Reordered the queue' };
    if (after.length > 2 && after.every(r => changed(r, 'match_no') || !was.has(r.id))) return { text: `Numbered ${after.length} matches` };
    const lines = [];
    for (const r of after) {
      const b = was.get(r.id);
      const lbl = matchLabel({ ...b, ...r });
      if (!b) { lines.push(`Created ${lbl}`); continue; }
      const bits = [];
      if (changed(r, 'status')) bits.push(`${STATUS[b.status] || b.status} → ${STATUS[r.status] || r.status}`);
      if (changed(r, 'row_a') || changed(r, 'row_b')) bits.push(`rows ${r.row_a ?? '–'} & ${r.row_b ?? '–'}`);
      if (changed(r, 'casted')) bits.push(r.casted ? 'marked casted' : 'unmarked casted');
      if (changed(r, 'best_of')) bits.push(`best of ${r.best_of}`);
      if (changed(r, 'team_a') || changed(r, 'team_b')) bits.push('teams changed');
      if (changed(r, 'reports') && !Object.keys(r.reports || {}).length) bits.push('cleared captain reports');
      if (changed(r, 'checkin') && !changed(r, 'status')) bits.push('check-in changed');
      if (changed(r, 'queue_pos') && !bits.length) bits.push('moved in the queue');
      if (changed(r, 'live') && !changed(r, 'status') && r.live?.game_no) bits.push(`map ${r.live.game_no} in progress`);
      if (bits.length) lines.push(`${lbl}: ${bits.join(', ')}`);
    }
    return lines.length ? { text: lines.join(' · '), match: after.length === 1 ? after[0].id : null } : null;
  }
  if (table === 'event_games') {
    const m = matchById(after[0]?.match_id);
    const r = ev.resolved?.get(m?.id) || { A: m?.team_a, B: m?.team_b };
    const lines = after.map(g => {
      const b = was.get(g.id);
      const w = gameWinner(g), bw = b ? gameWinner(b) : null;
      const score = g.a_score != null && g.b_score != null && g.a_score !== '' ? ` ${g.a_score}–${g.b_score}` : '';
      const map = [g.mode, g.map].filter(Boolean).join(' · ');
      if (!b) return `map ${g.game_no}${map ? ` (${map})` : ''}${w ? ` won by ${teamTag(w === 'a' ? r.A : r.B)}${score}` : ''}`;
      if (w !== bw || changed(g, 'a_score') || changed(g, 'b_score')) {
        return `map ${g.game_no}: ${bw ? `${teamTag(bw === 'a' ? r.A : r.B)} ${b.a_score ?? ''}${b.a_score != null ? '–' : ''}${b.b_score ?? ''}`.trim() : 'no result'} → ${w ? `${teamTag(w === 'a' ? r.A : r.B)}${score}` : 'no result'}`;
      }
      if (changed(g, 'map') || changed(g, 'mode')) return `map ${g.game_no} set to ${map}`;
      return null;
    }).filter(Boolean);
    return lines.length ? { text: `${matchLabel(m)}: ${lines.join(', ')}`, match: m?.id } : null;
  }
  if (table === 'event_stats') {
    const games = new Map((ev.data?.games || []).map(g => [g.id, g]));
    const g = games.get(after[0]?.game_id);
    const m = matchById(g?.match_id);
    const fresh = after.filter(r => !was.has(r.id)).length;
    return { text: `${matchLabel(m)}${g ? ` map ${g.game_no}` : ''}: ${fresh ? 'entered' : 'edited'} stats for ${after.length} player${after.length === 1 ? '' : 's'}`, match: m?.id };
  }
  if (table === 'event_teams') {
    const created = after.filter(r => !was.has(r.id));
    if (created.length > 1) return { text: `Added ${created.length} teams` };
    const lines = after.map(t => {
      const b = was.get(t.id);
      if (!b) return `Added team ${t.name}`;
      const bits = [];
      if (changed(t, 'row_no')) bits.push(t.row_no != null ? `${rowWord()} ${t.row_no}` : 'unpinned');
      if (changed(t, 'group_label')) bits.push(t.group_label ? `group ${t.group_label}` : 'no group');
      if (changed(t, 'help') && !t.help) bits.push('staff call handled');
      if (changed(t, 'seed')) bits.push(`seed ${t.seed}`);
      if (changed(t, 'name') || changed(t, 'tag')) bits.push(`renamed ${b.name} → ${t.name}`);
      if (changed(t, 'logo_path') || changed(t, 'color')) bits.push('logo/color');
      return bits.length ? `${t.tag || t.name}: ${bits.join(', ')}` : null;
    }).filter(Boolean);
    if (after.length > 3 && lines.length > 3) return { text: `Updated ${lines.length} teams (${lines.slice(0, 3).join(' · ')} …)` };
    return lines.length ? { text: lines.join(' · ') } : null;
  }
  if (table === 'event_players') {
    const teams = [...new Set(after.map(p => p.team_id))];
    return { text: `Roster: ${teams.map(id => `${teamTag(id) || teamName(id)} (${after.filter(p => p.team_id === id).map(p => p.gamertag).join(', ')})`).join(' · ')}` };
  }
  if (table === 'event_vetoes') {
    const v = after[0], b = was.get(v?.id);
    const m = matchById(v?.match_id);
    if (!b) return { text: `${matchLabel(m)}: veto created${v.source === 'in_person' ? ' (maps entered in person)' : ''}`, match: m?.id };
    const n = (v.actions?.length || 0) - (b.actions?.length || 0);
    if (n > 0) {
      const a = v.actions[v.actions.length - 1];
      return { text: `${matchLabel(m)}: veto ${a.kind} ${a.choice} (${a.mode})${a.staff ? ' for the team, at the desk' : ''}`, match: m?.id };
    }
    if (n < 0) return { text: `${matchLabel(m)}: veto step undone`, match: m?.id };
    return { text: `${matchLabel(m)}: veto updated${v.source === 'in_person' ? ' (maps entered in person)' : ''}`, match: m?.id };
  }
  return null;
}

function describeDelete(table, gone) {
  if (table === 'event_matches') return { text: gone.length > 1 ? `Deleted ${gone.length} matches (with their maps and stats)` : `Deleted ${matchLabel(gone[0])}`, match: gone.length === 1 ? gone[0].id : null };
  if (table === 'event_games') {
    const m = matchById(gone[0].match_id);
    return { text: `${matchLabel(m)}: removed map ${gone.map(g => g.game_no).join(', ')}`, match: m?.id };
  }
  if (table === 'event_stats') return { text: `Removed ${gone.length} stat line${gone.length === 1 ? '' : 's'}` };
  if (table === 'event_teams') return { text: `Removed team ${gone.map(t => t.name).join(', ')}` };
  if (table === 'event_players') return { text: `Removed player ${gone.map(p => p.gamertag).join(', ')}` };
  if (table === 'event_vetoes') return { text: `${matchLabel(matchById(gone[0].match_id))}: veto removed`, match: gone[0].match_id };
  return { text: `Deleted ${gone.length} row(s)` };
}

function describeSettings(b, a) {
  const out = [];
  for (const k of Object.keys(a)) {
    if (k === 'coin_flips') {
      const added = Object.keys(a[k] || {}).filter(x => !(b[k] || {})[x]);
      const removed = Object.keys(b[k] || {}).filter(x => !(a[k] || {})[x]);
      added.forEach(x => out.push(`Coin flip: ${(a[k][x] || []).map(teamName).join(' > ')}`));
      removed.forEach(() => out.push('Coin flip undone'));
    } else if (k === 'seed_override') out.push(a[k] ? 'Playoff seeding rearranged' : 'Playoff seeding back to automatic');
    else if (k === 'group_override') out.push('Group standings rearranged');
    else if (k === 'seeds') out.push(a[k] ? 'Playoff seeds locked' : 'Playoff seeds cleared');
    else if (k === 'seating') out.push('Seating plan changed');
    else if (k === 'est') out.push('Match timing changed');
    else if (k === 'final_rounds') out.push(a[k] ? 'Final-day rounds picked' : 'Final-day rounds back to automatic');
    else if (k === 'final_top') out.push(`Teams on the final day: ${a[k]}`);
    else out.push(`Setting changed: ${k.replace(/_/g, ' ')}`);
  }
  return { text: out.join(' · ') || 'Settings changed' };
}

// ---------- revert ----------

export const TABLE_LABEL = { event_matches: 'match', event_games: 'map', event_stats: 'player stats', event_teams: 'team', event_players: 'player', event_vetoes: 'veto' };
const ORDER = ['event_teams', 'event_players', 'event_matches', 'event_vetoes', 'event_games', 'event_stats'];
const same = (cur, want) => cur && Object.keys(want).every(k => k === 'updated_at' || JSON.stringify(cur[k] ?? null) === JSON.stringify(want[k] ?? null));

/** What a revert would run into: rows changed again after this group was written. */
export function revertConflicts(entries) {
  const out = [];
  for (const e of entries) {
    for (const [table, rows] of Object.entries(e.after || {})) {
      if (table === 'settings') {
        for (const [k, v] of Object.entries(rows || {})) if (JSON.stringify(ev.settings?.[k] ?? null) !== JSON.stringify(v ?? null)) out.push(`setting ${k.replace(/_/g, ' ')}`);
        continue;
      }
      const cur = new Map(rowsOf(table).map(r => [r.id, r]));
      for (const r of rows || []) if (!same(cur.get(r.id), r)) out.push(TABLE_LABEL[table] || table);
    }
  }
  return [...new Set(out)];
}

/** Put everything in a group back the way it was. entries: the group's log rows (newest first). */
export async function revertGroup(entries) {
  const gid = entries[0].group_id;
  reverting = gid;
  try {
    for (const e of entries) { // newest first
      const before = e.before || {}, after = e.after || {};
      if (after.settings || before.settings) {
        await state.store.updateEvent(ev.event.id, { settings: { ...ev.event.settings, ...(before.settings || {}) } });
        ev.event.settings = { ...ev.event.settings, ...(before.settings || {}) };
        continue;
      }
      // rows the action created → delete; rows it changed or deleted → write back as they were
      for (const table of [...ORDER].reverse()) {
        const was = new Set((before[table] || []).map(r => r.id));
        const created = (after[table] || []).filter(r => !was.has(r.id)).map(r => r.id);
        if (created.length) await state.store.evDelete(table, created);
      }
      for (const table of ORDER) {
        if (before[table]?.length) await state.store.evUpsert(table, before[table]);
      }
    }
  } finally { reverting = null; }
}
