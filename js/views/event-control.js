// Admin view of an event: the control panel (live scores, queue, display remote)
// and Rows (a row per team: pinned for groups, per match in the bracket).
import { h, clear, toast, confirmDialog, uid, modal } from '../ui.js';
import { state, go } from '../state.js';
import { ev, eventPath, refreshEvent, eventSettings, teamName, teamTag, watchEvent, teamBadge, spotOf, matchNo, estOf, estText, finalDayRole, finalDayName } from '../event-state.js';
import { roundName, queue, gamesByMatch, seriesResult, gameWinner, liveMap, seatConflicts, busyRows, freeRowPair, teamRow, GROUP_LABELS, autoPlan, planRows, planIssues, teamSession, bracketRowHelp, numberMatches } from '../event-logic.js';
import { vetoNext, stepLabel } from '../veto.js';
import { eventShell } from './event.js';
import { statusPill } from './event-parts.js';

function notAdmin(sub) { return eventShell(sub, h('div', { class: 'empty' }, h('p', {}, 'Only event admins can see this page.'))); }
const panel = (title, sub, ...body) => h('section', { class: 'block' }, h('div', { class: 'block-head' }, h('h2', {}, title), sub ? h('span', { class: 'muted small' }, sub) : null), ...body);
const now = () => new Date().toISOString();
const rowLabel = () => ev.settings.seating.label || 'Row';

async function saveSettings(patch) {
  await state.store.updateEvent(ev.event.id, { settings: { ...eventSettings(ev.event), ...patch } });
  await refreshEvent();
}
async function saveDisplay(patch) {
  await saveSettings({ display: { ...ev.settings.display, ...patch } });
}
// ---------- bracket rows (one row per team, like the group stage) ----------
const rowCountOf = () => Math.max(2, ev.settings.seating?.group_rows || 8);
const rowWord = () => ev.settings.seating?.label || 'Row';

/** Rows for a bracket match: keep each team on the row it just played on, else a free side-by-side pair. */
function autoRowsFor(m) {
  const r = ev.resolved.get(m.id) || {};
  const prefer = [m.row_a ?? teamRow(r.A, ev.data.matches, ev.resolved, m.id), m.row_b ?? teamRow(r.B, ev.data.matches, ev.resolved, m.id)];
  return freeRowPair(rowCountOf(), busyRows(ev.data.matches, m.id), prefer);
}

/** Two small selects: the row team A reports to, and team B's. */
function rowPicker(m, after) {
  const r = ev.resolved.get(m.id) || {};
  const n = rowCountOf();
  const busy = busyRows(ev.data.matches, m.id);
  const save = async patch => { await setMatch(m, patch); await refreshEvent(); after ? after() : null; };
  const sel = (key, team) => h('label', { class: 'row-pick' },
    h('span', { class: 'small' }, teamTag(team) || 'TBD'),
    h('select', { 'aria-label': `${teamName(team) || 'Team'} row`, onchange: e => save({ [key]: e.target.value ? Number(e.target.value) : null }) },
      h('option', { value: '' }, '—'),
      Array.from({ length: n }, (_, k) => k + 1).map(x => h('option', { value: x, selected: Number(m[key]) === x }, `${rowWord()} ${x}${busy.has(x) ? ' · in use' : ''}`))));
  return h('div', { class: 'row-picks' }, sel('row_a', r.A), sel('row_b', r.B));
}

async function setMatch(m, patch) {
  await state.store.evUpsert('event_matches', { ...m, ...patch, updated_at: now() });
}

/** "W U1-2" / "L U1-2" for a bracket slot whose team isn't known yet. */
const srcLabel = src => { const [k2, ref] = (src || '').split(':'); return k2 === 'W' ? `W ${ref}` : k2 === 'L' ? `L ${ref}` : 'TBD'; };
const minsAgo = iso => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

// =====================================================================
// CONTROL PANEL
// =====================================================================
export function eventControl() {
  if (!ev.isAdmin) return notAdmin('control');
  const root = h('div');
  let showFinal = false;
  const photoState = new Map(); // match id → loaded captain photos + what was read from them
  let pending = false; // a repaint arrived while someone was typing
  // older events: give every match a permanent number (once)
  const unnumbered = numberMatches(ev.data.matches);
  if (unnumbered.length) state.store.evUpsert('event_matches', unnumbered).then(refreshEvent).then(() => paint()).catch(() => {});

  const paint = () => {
    if (root.contains(document.activeElement) && document.activeElement.matches('input, select, textarea')) { pending = true; return; }
    pending = false;
    const s = ev.settings;
    const gbm = gamesByMatch(ev.data.games);
    const bm = ev.data.matches.filter(m => m.stage !== 'group');
    const q = queue(ev.data.matches, ev.resolved);
    const live = q.filter(m => m.status === 'live');
    const ondeck = q.filter(m => m.status === 'ondeck');
    const finals = ev.data.matches.filter(m => m.status === 'final' || ev.resolved.get(m.id)?.result?.done);
    const clashes = seatConflicts(ev.data.matches, ev.resolved, ev.teamById, rowLabel());

    const calls = ev.data.teams.filter(t => t.help).sort((a, b) => a.help.at.localeCompare(b.help.at));
    const reported = ev.data.matches.filter(m => m.reports && Object.values(m.reports).some(x => x?.shots?.length))
      .sort((x, y) => (x.status === 'final' ? 0 : 1) - (y.status === 'final' ? 0 : 1) || (x.match_no || 0) - (y.match_no || 0));
    const disputes = ev.data.games.filter(g => g.win_check === 'disputed').map(g => [g, ev.data.matches.find(m => m.id === g.match_id)]).filter(([, m]) => m);
    clear(root).append(eventShell('control', h('div', { class: 'stack' },
      ev.coinsNeeded.length ? h('div', { class: 'notice warn' }, h('strong', {}, '🪙 Coin flip needed: '),
        ev.coinsNeeded.map(c => `${c.where} (${c.ids.map(teamName).join(' vs ')})`).join(' · '), ' ',
        h('a', { href: eventPath('setup') }, 'Settle it in Setup → Tiebreakers')) : null,
      calls.length ? h('section', { class: 'block calls' }, h('div', { class: 'block-head' }, h('h2', {}, `Staff called (${calls.length})`)),
        calls.map(t => h('div', { class: 'call-row' }, h('span', { class: 'pulse-dot' }), teamBadge(t.id, 'sm'), h('strong', {}, t.name),
          h('span', {}, t.row_no != null ? `${ev.settings.seating.label || 'Row'} ${t.row_no}` : ''),
          h('span', { class: 'muted' }, `${t.help.note} · ${minsAgo(t.help.at)}`), h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn-sm btn-primary', 'data-submit': '', onclick: async () => { await state.store.evUpsert('event_teams', { ...t, help: null }); await refreshEvent(); paint(); toast(`${t.name}: handled`); } }, 'Done')))) : null,
      disputes.length ? h('section', { class: 'block calls' }, h('div', { class: 'block-head' }, h('h2', {}, `Disputed maps (${disputes.length})`),
        h('span', { class: 'muted small' }, 'A captain says the other team’s tap was wrong. The result stands until you pick.')),
        disputes.map(([g, m]) => disputeCard(g, m))) : null,
      remote(),
      clashes.length ? h('div', { class: 'alert alert-warn' }, h('strong', {}, 'Seating clash: '),
        clashes.map(c => (c.team ? `${teamName(c.team)} is in two live matches` : `${c.key} has two live matches`)).join(' · ')) : null,
      panel(`Live now (${live.length})`, 'Captains tap who won each map from their phones. If they don’t, click it here. The series count updates on the display right away.',
        live.length ? h('div', { class: 'cp-grid' }, live.map(m => liveCard(m, gbm.get(m.id) || [], bm))) : h('div', { class: 'empty-sm' }, 'No live matches. Start one from On deck or the queue.')),
      ondeck.length ? panel(`On deck (${ondeck.length})`, 'Teams are called to their rows. Start when they are ready.',
        h('div', { class: 'cp-grid cp-grid-sm' }, ondeck.map(m => deckCard(m, bm)))) : null,
      panel('Queue', 'Live first, then on deck, then scheduled. Group matches use each team’s pinned rows; bracket matches use the row set here.',
        q.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data queue-table' },
          h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Match'), h('th', {}, 'Where'), h('th', {}, 'Veto'), h('th', {}, 'Status'), h('th', {}))),
          h('tbody', {}, q.map((m, i) => queueRow(m, i, q, bm))))) : h('div', { class: 'empty-sm' }, 'Nothing waiting. Generate group matches in Setup.')),
      reported.length ? panel(`Scoreboard photos to review (${reported.length})`, 'Captains’ photos of each map. Results already count from their taps, so do these after the round: save the scores, or open the editor for player stats.',
        h('div', { class: 'stack-sm' }, reported.map(m => reportCard(m, bm)))) : null,
      panel(`Completed (${finals.length})`, null,
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { showFinal = !showFinal; paint(); } }, showFinal ? 'Hide' : 'Show'),
        showFinal ? h('div', { class: 'list' }, finals.map(m => {
          const r = ev.resolved.get(m.id);
          return h('a', { class: 'list-row', href: eventPath(`match/${m.id}`) },
            h('span', {}, `${teamName(r.A)} ${r.result?.a ?? ''}–${r.result?.b ?? ''} ${teamName(r.B)}`),
            h('span', { class: 'muted small' }, roundName(m, bm)));
        })) : null))));
  };

  // ---------- display remote ----------
  function remote() {
    const d = ev.settings.display;
    const label = k => (k.startsWith('kd:') ? `K/D · ${k.slice(3)}` : { seating: 'Seating chart', live: 'Live matches', groups: 'Group standings', teams: 'Team stats', bracket: 'Bracket', queue: 'Live and up next', awards: 'Awards' }[k] || k);
    const msg = h('input', { placeholder: 'Announcement, e.g. "Lunch break — back at 1:00"', value: d.announce?.text || '', maxlength: 120, class: 'grow' });
    return h('section', { class: 'block cp-remote' },
      h('div', { class: 'block-head' }, h('h2', {}, 'Display remote'),
        h('span', { class: 'muted small' }, d.pin ? `Pinned: ${d.pin === 'veto' ? 'Map veto' : label(d.pin)}` : d.paused ? 'Paused' : `Rotating every ${d.seconds}s`),
        h('a', { class: 'btn btn-ghost btn-sm', href: `#/display/${ev.event.id}`, target: '_blank', rel: 'noopener' }, 'Open display ↗')),
      h('div', { class: 'row wrap' },
        h('select', {
          'aria-label': 'What the display shows',
          onchange: async e => { await saveDisplay({ pin: e.target.value || null, pin_veto: null }); toast(e.target.value ? 'Display pinned' : 'Display rotating'); },
        }, h('option', { value: '' }, 'Rotate all screens'), d.scenes.map(k => h('option', { value: k, selected: d.pin === k }, `Pin: ${label(k)}`)),
        h('option', { value: 'veto', selected: d.pin === 'veto' }, 'Pin: Map veto (latest)')),
        h('button', { class: 'btn btn-sm', 'data-tip': 'Skip to the next screen now', onclick: async () => { await saveDisplay({ cmd: { next: Date.now() } }); toast('Next screen'); } }, 'Next screen ⏭'),
        h('button', { class: 'btn btn-sm', onclick: async () => { await saveDisplay({ paused: !d.paused }); toast(d.paused ? 'Rotation resumed' : 'Rotation paused'); } }, d.paused ? 'Resume ▶' : 'Pause ⏸'),
        h('span', { class: 'divider-v' }),
        msg,
        h('button', { class: 'btn btn-sm btn-primary', onclick: async () => { const t = msg.value.trim(); if (!t) return toast('Type a message first', 'error'); await saveDisplay({ announce: { text: t, at: Date.now() } }); toast('Announcement on screen', 'success'); } }, 'Show on screen'),
        d.announce ? h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { await saveDisplay({ announce: null }); toast('Announcement cleared'); } }, 'Clear') : null));
  }

  // ---------- live match card: who won each map (no running score during a map) ----------
  function liveCard(m, games, bm) {
    const r = ev.resolved.get(m.id);
    const res = seriesResult(m, games);
    const lm = liveMap(m, games, ev.settings);
    const veto = ev.data.vetoes.find(v => v.match_id === m.id);
    const spot = spotOf(m);
    const decided = games.filter(g => gameWinner(g)).sort((x, y) => x.game_no - y.game_no);
    const last = decided[decided.length - 1];
    const fin = { a: '', b: '' };
    const side = (key, id) => h('div', { class: `cp-side ${res.a !== res.b && res[key] > res[key === 'a' ? 'b' : 'a'] ? 'win' : ''}` },
      h('div', { class: 'cp-team' }, teamBadge(id, 'sm'), h('span', {}, teamName(id)),
        spot?.rows?.[key === 'a' ? 0 : 1] != null ? h('span', { class: 'chip' }, `${rowLabel()} ${spot.rows[key === 'a' ? 0 : 1]}`) : null),
      h('b', { class: 'cp-series', 'aria-label': `${teamName(id)} maps won` }, res[key]));
    return h('div', { class: `cp-card live ${finalDayRole(m) === 'qualifies' ? 'q-sun' : ''}` },
      h('div', { class: 'cp-head' },
        statusPill('live'), h('strong', {}, spot?.full || 'No row'), m.match_no ? h('span', { class: 'muted small' }, matchNo(m)) : null,
        h('span', { class: 'muted small' }, `${roundName(m, bm)} · Bo${m.best_of}`),
        finalDayRole(m) === 'qualifies' ? h('span', { class: 'sun-chip' }, `Winner → ${finalDayName()}`) : finalDayRole(m) === 'both' ? h('span', { class: 'sun-chip' }, `Both → ${finalDayName()}`) : null,
        h('span', { class: 'spacer' }), castChip(m), vetoChip(m, veto)),
      side('a', r.A), side('b', r.B),
      decided.length ? h('div', { class: 'rep-maps' }, decided.map(g => {
        const w = gameWinner(g);
        const how = !g.win_by ? 'Entered by staff' : g.win_check === 'ok' ? `Tapped by ${teamTag(g.win_by)}, confirmed by the other captain` : g.win_check === 'disputed' ? `Tapped by ${teamTag(g.win_by)}, disputed by the other captain` : `Tapped by ${teamTag(g.win_by)}, not confirmed yet`;
        return h('span', { class: `chip ${g.win_check === 'disputed' ? 'chip-warn' : ''}`, 'data-tip': how },
          `M${g.game_no} ${teamTag(w === 'a' ? r.A : r.B)}`, g.win_by ? (g.win_check === 'ok' ? ' ✓' : g.win_check === 'disputed' ? ' ⚠' : ' 📱') : '');
      })) : null,
      h('div', { class: 'cp-map' }, `Map ${lm.game_no} in progress`, lm.mode ? ` · ${lm.mode}` : '', lm.map ? ` · ${lm.map}` : ' · ',
        lm.map ? null : h('select', {
          class: 'cp-map-pick', 'aria-label': 'Map being played',
          onchange: async e => { if (!e.target.value) return; await setMatch(m, { live: { game_no: lm.game_no, mode: lm.mode, map: e.target.value } }); },
        }, h('option', { value: '' }, 'Set map…'), (ev.settings.maps[lm.mode] || []).map(x => h('option', { value: x }, x)))),
      h('div', { class: 'cp-won' },
        h('span', { class: 'small muted' }, `Map ${lm.game_no} won by`),
        h('button', { class: 'btn btn-sm btn-primary', 'data-submit': '', onclick: () => endMap(m, games, lm, 'a', fin) }, teamTag(r.A) || teamName(r.A)),
        h('button', { class: 'btn btn-sm btn-primary', 'data-submit': '', onclick: () => endMap(m, games, lm, 'b', fin) }, teamTag(r.B) || teamName(r.B))),
      h('details', { class: 'cp-final' }, h('summary', { class: 'small muted' }, 'Add the final map score (optional)'),
        h('div', { class: 'row' }, teamTag(r.A), h('input', { type: 'number', min: 0, class: 'in-score', oninput: e => { fin.a = e.target.value; } }), '–',
          h('input', { type: 'number', min: 0, class: 'in-score', oninput: e => { fin.b = e.target.value; } }), teamTag(r.B),
          h('span', { class: 'small muted' }, 'Or save it from the captains’ photos later.'))),
      h('div', { class: 'row' },
        last ? h('button', {
          class: 'btn btn-sm btn-ghost', onclick: async () => {
            if (!(await confirmDialog(`Undo Map ${last.game_no} (${teamTag(gameWinner(last) === 'a' ? r.A : r.B)} win)?`, 'Undo map'))) return;
            await state.store.evUpsert('event_games', { ...last, winner: null, a_score: null, b_score: null, win_by: null, win_check: null, win_at: null });
            await setMatch(m, { live: { game_no: last.game_no, mode: last.mode, map: last.map } });
            await refreshEvent(); paint(); toast(`Map ${last.game_no} undone`);
          },
        }, '↶ Undo last map') : null,
        h('span', { class: 'spacer' }),
        h('a', { class: 'btn btn-sm btn-ghost', href: eventPath(`match/${m.id}`) }, 'Scores & player stats →')));
  }

  async function endMap(m, games, lm, winner, fin = {}) {
    const r = ev.resolved.get(m.id);
    const a = fin.a === '' || fin.a == null ? null : +fin.a, b = fin.b === '' || fin.b == null ? null : +fin.b;
    if (a != null && b != null && (a > b ? 'a' : b > a ? 'b' : null) !== winner) return toast('That final score says the other team won the map', 'error');
    const existing = games.find(g => g.game_no === lm.game_no);
    const row = { id: existing?.id || uid(), event_id: ev.event.id, match_id: m.id, game_no: lm.game_no, mode: lm.mode, map: lm.map, winner, a_score: a ?? existing?.a_score ?? null, b_score: b ?? existing?.b_score ?? null };
    if (row.a_score != null && row.b_score != null && gameWinner({ a_score: row.a_score, b_score: row.b_score }) !== winner) { row.a_score = null; row.b_score = null; }
    await state.store.evUpsert('event_games', row);
    const after = [...games.filter(g => g.game_no !== lm.game_no), row];
    const res = seriesResult(m, after);
    if (res.done) {
      await setMatch(m, { status: 'final', live: null });
      toast(`${teamName(res.winner === 'a' ? r.A : r.B)} win ${Math.max(res.a, res.b)}–${Math.min(res.a, res.b)} · match final`, 'success');
    } else {
      await setMatch(m, { live: { game_no: lm.game_no + 1 } });
      toast(`Map ${lm.game_no} to ${teamTag(winner === 'a' ? r.A : r.B)} · series ${res.a}–${res.b}`, 'success');
    }
    await refreshEvent(); paint();
  }

  function deckCard(m, bm) {
    const r = ev.resolved.get(m.id);
    const veto = ev.data.vetoes.find(v => v.match_id === m.id);
    return h('div', { class: `cp-card ${finalDayRole(m) === 'qualifies' ? 'q-sun' : ''}` },
      h('div', { class: 'cp-head' }, statusPill('ondeck'), finalDayRole(m) === 'qualifies' ? h('span', { class: 'sun-chip' }, `Winner → ${finalDayName()}`) : null, h('strong', {}, spotOf(m)?.full || 'No row yet'), h('span', { class: 'spacer' }), castChip(m), vetoChip(m, veto)),
      h('div', { class: 'cp-deck-teams' }, teamBadge(r.A, 'sm'), teamName(r.A), h('span', { class: 'vs' }, 'vs'), teamBadge(r.B, 'sm'), teamName(r.B)),
      checkins(m, r),
      h('div', { class: 'muted small' }, `${m.match_no ? `${matchNo(m)} · ` : ''}${roundName(m, bm)} · Bo${m.best_of}${estText(m, { staff: true }) ? ` · est. ${estText(m, { staff: true })}` : ''}`),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-sm btn-primary', 'data-submit': '', onclick: () => goLive(m) }, 'Start match')));
  }

  async function goLive(m) {
    const patch = { status: 'live' };
    if (m.stage !== 'group' && (m.row_a == null || m.row_b == null)) {
      const pair = autoRowsFor(m);
      if (!pair) return toast('Every row is busy. Set rows for this match first.', 'error');
      [patch.row_a, patch.row_b] = pair;
    }
    if (m.stage === 'group') {
      const r = ev.resolved.get(m.id);
      const missing = [r.A, r.B].filter(id => ev.teamById.get(id)?.row_no == null);
      if (missing.length) return toast(`Pin ${missing.map(teamName).join(' and ')} to a row in Rows first`, 'error');
    }
    const games = gamesByMatch(ev.data.games).get(m.id) || [];
    patch.live = m.live || { game_no: games.filter(g => gameWinner(g)).length + 1 };
    const test = ev.data.matches.map(x => (x.id === m.id ? { ...x, ...patch } : x));
    const clash = seatConflicts(test, ev.resolved, ev.teamById, rowLabel()).filter(c => c.matches.includes(m.id));
    if (clash.length && !(await confirmDialog(`${clash.map(c => (c.team ? `${teamName(c.team)} is already live` : `${c.key} is already in use`)).join(', ')}. Start anyway?`, 'Start anyway'))) return;
    await setMatch(m, patch);
    await refreshEvent(); paint();
    toast(`Live on ${spotOf({ ...m, ...patch })?.label || 'the floor'}`, 'success');
  }

  function checkins(m, r) {
    if (!r.A || !r.B || r.A === 'BYE' || r.B === 'BYE') return null;
    const c = m.checkin || {};
    return h('div', { class: 'checkin-row small' }, [r.A, r.B].map(id => h('span', { class: `ci ${c[id] ? 'ok' : ''}`, 'data-tip': c[id] ? `Checked in ${minsAgo(c[id])}` : 'Captain hasn’t checked in' }, c[id] ? '✓ ' : '○ ', teamTag(id))));
  }

  // captains' scoreboard photos → map scores (and player stats in the editor). Results already count from the
  // captains' taps, so this is review work for after the round: nothing waits on it.
  function reportCard(m, bm) {
    const r = ev.resolved.get(m.id);
    const reps = m.reports || {};
    const ps = photoState.get(m.id) || { shots: null, open: false, reading: false, read: null };
    photoState.set(m.id, ps);
    const nShots = Object.values(reps).reduce((n, x) => n + (x.shots?.length || 0), 0);
    const games = gamesByMatch(ev.data.games).get(m.id) || [];
    const res = seriesResult(m, games);
    const photoGames = ps.read?.filter(x => x.a != null) || [];
    const tapped = no => gameWinner(games.find(g => g.game_no === no) || {});
    const clash = photoGames.filter(x => tapped(x.game_no) && tapped(x.game_no) !== (x.a > x.b ? 'a' : 'b'));

    const loadShots = async () => { if (!ps.shots) ps.shots = await state.store.reportShots(m.id); return ps.shots; };
    const toBlob = async url => (await fetch(url)).blob();

    const readPhotos = async () => {
      ps.reading = true; paint();
      try {
        const shots = await loadShots();
        const latest = new Map();
        for (const x of shots) latest.set(x.game_no, x); // newest per map
        const { readScoreboard } = await import('../ocr.js');
        const { parseScoreboard, pickMapScore, teamSide } = await import('../ocr-parse.js');
        const roster = ev.data.players.filter(p => p.team_id === r.A || p.team_id === r.B);
        ps.read = [];
        for (const [no, shot] of [...latest].sort((x, y) => x[0] - y[0])) {
          const mode = games.find(g => g.game_no === no)?.mode || ev.settings.mode_order[(no - 1) % ev.settings.mode_order.length];
          const { text, scorePasses } = await readScoreboard(await toBlob(shot.image), () => {});
          const found = pickMapScore(scorePasses, mode);
          const side = teamSide(parseScoreboard(text, roster), p => p.team_id === r.A);
          ps.read.push(found ? { game_no: no, a: side === 'right' ? found.right : found.left, b: side === 'right' ? found.left : found.right, adjusted: found.adjusted, sideUnknown: !side } : { game_no: no, a: null, b: null });
        }
      } catch (e) { toast(e.message, 'error'); }
      ps.reading = false; paint();
    };

    // photo scores → the maps (the captains' map winners stay unless a score says otherwise and you agree)
    const saveScores = async () => {
      if (clash.length && !(await confirmDialog(`The photo score for map ${clash.map(x => x.game_no).join(', ')} says the other team won. Saving it changes the result of that map. Save anyway?`, 'Save anyway'))) return;
      const rows = photoGames.map(g => {
        const old = games.find(x => x.game_no === g.game_no);
        const mode = old?.mode || ev.settings.mode_order[(g.game_no - 1) % ev.settings.mode_order.length];
        return { ...(old || { id: uid(), event_id: ev.event.id, match_id: m.id, game_no: g.game_no, mode }), a_score: g.a, b_score: g.b };
      });
      await state.store.evUpsert('event_games', rows);
      await finish(rows);
      toast('Photo scores saved', 'success');
    };
    // keep the photos as the maps' screenshots and clear the review
    const finish = async rows => {
      if (nShots) {
        const shots = await loadShots();
        for (const x of shots) {
          const game = rows.find(g => g.game_no === x.game_no) || games.find(g => g.game_no === x.game_no);
          if (game) await state.store.evAddScreenshot(ev.event.id, game.id, await toBlob(x.image));
        }
        await state.store.evDelete('event_report_shots', shots.map(x => x.id));
      }
      await setMatch(m, { reports: {} });
      photoState.delete(m.id);
      await refreshEvent(); paint();
    };

    // the full results editor: player stats from the photos, then Save
    const openEditor = async () => {
      const shots = nShots ? await loadShots() : [];
      ev.handoff = { matchId: m.id, shotIds: shots.map(x => x.id), shots: await Promise.all(shots.map(async x => ({ game_no: x.game_no, blob: await toBlob(x.image) }))), scores: photoGames };
      go(eventPath(`match/${m.id}`));
    };

    const photos = ps.open && ps.shots ? h('div', { class: 'rep-photos' }, ps.shots.slice().sort((x, y) => x.game_no - y.game_no).map(x => h('button', {
      class: 'rep-photo', 'aria-label': `Map ${x.game_no} photo from ${teamTag(x.team_id)}`,
      onclick: () => modal(`Map ${x.game_no} · ${teamName(x.team_id)}`, h('img', { src: x.image, alt: '', class: 'rep-photo-big' }), []),
    }, h('img', { src: x.image, alt: '' }), h('span', {}, `M${x.game_no} · ${teamTag(x.team_id)}`)))) : null;

    return h('div', { class: `report-card ${clash.length ? 'differ' : ''}` },
      h('div', { class: 'cp-head' }, h('strong', {}, `${m.match_no ? `#${m.match_no} · ` : ''}${teamName(r.A)} vs ${teamName(r.B)}`),
        h('span', { class: 'muted small' }, `${roundName(m, bm)} · ${m.status === 'final' ? `final ${res.a}–${res.b}` : `still playing (${res.a}–${res.b})`}`),
        h('span', { class: 'spacer' }), h('span', { class: 'chip' }, `📷 ${nShots}`)),
      h('div', { class: 'rep-photo-bar' },
        h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { ps.open = !ps.open; if (ps.open) await loadShots(); paint(); } }, ps.open ? 'Hide photos' : 'Show photos'),
        h('button', { class: 'btn btn-sm', disabled: ps.reading, onclick: readPhotos }, ps.reading ? 'Reading…' : ps.read ? 'Read again' : 'Read scores from photos'),
        ps.read ? h('div', { class: 'rep-maps' }, ps.read.map(x => x.a == null
          ? h('span', { class: 'chip chip-warn' }, `M${x.game_no}: couldn’t read`)
          : h('span', { class: `chip ${x.adjusted || x.sideUnknown || clash.includes(x) ? 'chip-warn' : ''}`, 'data-tip': clash.includes(x) ? 'This score says the other team won the map — check the photo' : x.adjusted ? 'A 2x0 number was read and set to 250 — check the photo' : x.sideUnknown ? 'Couldn’t tell which side each team is on — check the photo' : 'Read from the photo' },
            `📷 M${x.game_no} ${teamTag(r.A)} ${x.a}–${x.b} ${teamTag(r.B)}`))) : null),
      photos,
      h('div', { class: 'row wrap' },
        photoGames.length ? h('button', { class: 'btn btn-sm btn-primary', 'data-submit': '', onclick: saveScores }, 'Save photo scores') : null,
        h('button', { class: 'btn btn-sm', onclick: openEditor, 'data-tip': 'Open the results editor with the photos, to read player stats too' }, 'Scores + player stats in editor'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm btn-ghost', 'data-tip': 'Keep the photos as screenshots and remove this from the list', onclick: () => finish([]).then(() => toast('Photos kept, review closed')) }, 'Done')));
  }

  // a captain says the other team's tap was wrong: staff decide who won the map
  function disputeCard(g, m) {
    const r = ev.resolved.get(m.id) || {};
    const by = g.win_by, other = by === r.A ? r.B : r.A;
    const w = gameWinner(g);
    const pick = async side => {
      await state.store.evUpsert('event_games', { ...g, winner: side, win_check: 'ok', ...(g.a_score != null && (g.a_score > g.b_score ? 'a' : 'b') !== side ? { a_score: null, b_score: null } : {}) });
      const games = (gamesByMatch(ev.data.games).get(m.id) || []).map(x => (x.id === g.id ? { ...x, winner: side, a_score: null, b_score: null } : x));
      const res = seriesResult({ ...m, status: 'live' }, games);
      if (m.status === 'final' && !res.done) await setMatch(m, { status: 'live', live: { game_no: games.filter(x => gameWinner(x)).length + 1 } });
      else if (m.status !== 'final' && res.done) await setMatch(m, { status: 'final', live: null });
      await refreshEvent(); paint(); toast(`Map ${g.game_no}: ${teamTag(side === 'a' ? r.A : r.B)} won`, 'success');
    };
    return h('div', { class: 'call-row dispute' },
      h('span', { class: 'pulse-dot' }),
      h('strong', {}, `${m.match_no ? `Match ${m.match_no}` : m.code} · map ${g.game_no}`),
      h('span', {}, `${teamTag(by)} says ${teamTag(w === 'a' ? r.A : r.B)} won · ${teamTag(other)} disputes it`),
      h('span', { class: 'spacer' }),
      h('span', { class: 'small muted' }, 'Who won?'),
      h('button', { class: 'btn btn-sm', 'data-submit': '', onclick: () => pick('a') }, teamTag(r.A)),
      h('button', { class: 'btn btn-sm', 'data-submit': '', onclick: () => pick('b') }, teamTag(r.B)),
      h('a', { class: 'btn btn-sm btn-ghost', href: eventPath(`match/${m.id}`) }, 'Open'));
  }

  // per-match "Casted" switch (only when the event has some casted matches)
  function castChip(m) {
    if (ev.settings.caster !== 'some') return null;
    return h('button', {
      class: `chip chip-btn ${m.casted ? 'chip-live' : ''}`, 'aria-pressed': String(!!m.casted),
      'data-tip': m.casted ? 'Casted: caster stats (damage, assists…) can be entered' : 'Player POV: basic stats only. Click if a caster covers this match.',
      onclick: async () => { await setMatch(m, { casted: !m.casted }); await refreshEvent(); paint(); },
    }, m.casted ? '● Casted' : '○ Casted');
  }

  function vetoChip(m, v) {
    const href = eventPath(`match/${m.id}`);
    if (!v) return h('a', { class: 'chip', href, 'data-tip': 'Create captain links or enter the maps the teams chose in person' }, 'Veto: none');
    if (v.status === 'done') return h('a', { class: 'chip chip-good', href }, v.source === 'in_person' ? 'Maps set in person' : 'Veto done');
    const st = vetoNext(v);
    return h('a', { class: 'chip chip-live', href, 'data-tip': `${teamName(st?.team === 'a' ? v.team_a : v.team_b) || 'Staff'} to ${stepLabel(st)}. Open to override.` }, `Veto ${v.actions.length}/${v.steps.length}`);
  }

  function queueRow(m, i, q, bm) {
    const r = ev.resolved.get(m.id);
    const v = ev.data.vetoes.find(x => x.match_id === m.id);
    const where = m.stage === 'group'
      ? h('span', { class: 'small', 'data-tip': 'Each team plays from its pinned row (Rows tab)' }, spotOf(m)?.full || h('span', { class: 'muted' }, 'Pin rows'))
      : rowPicker(m, paint);
    return h('tr', { class: `q-${m.status} ${finalDayRole(m) === 'qualifies' ? 'q-sun-row' : ''}` },
      h('td', { class: 'num muted' }, i + 1),
      h('td', {}, h('a', { href: eventPath(`match/${m.id}`) }, teamName(r.A), h('span', { class: 'vs' }, ' vs '), teamName(r.B)),
        finalDayRole(m) === 'qualifies' ? h('span', { class: 'sun-chip', style: { marginLeft: '.4rem' } }, `Winner → ${finalDayName()}`)
          : finalDayRole(m) === 'both' ? h('span', { class: 'sun-chip', style: { marginLeft: '.4rem' } }, `Both → ${finalDayName()}`) : null,
        h('div', { class: 'small muted' }, m.match_no ? `#${m.match_no} · ` : '', roundName(m, bm), ` · Bo${m.best_of}`,
          m.status === 'live' && estOf(m) ? ` · ends ~${estOf(m).end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : estText(m, { staff: true }) ? ` · est. ${estText(m, { staff: true })}` : ''), m.status !== 'live' ? checkins(m, r) : null),
      h('td', {}, where),
      h('td', {}, vetoChip(m, v)),
      h('td', {}, h('div', { class: 'seg seg-sm' }, ['scheduled', 'ondeck', 'live', 'final'].map(st => h('button', {
        class: m.status === st ? 'on' : '',
        onclick: async () => {
          if (st === 'live') return goLive(m);
          if (st === 'final' && !r.result?.done && !(await confirmDialog('No winner from the entered maps yet. Mark final anyway? The team with more maps wins.', 'Mark final'))) return;
          await setMatch(m, { status: st, ...(st !== 'live' && st !== 'ondeck' ? { live: st === 'final' ? null : m.live } : {}) });
          await refreshEvent(); paint();
        },
      }, { scheduled: 'Sched', ondeck: 'On deck', live: 'Live', final: 'Final' }[st])))),
      h('td', {}, h('div', { class: 'row' },
        h('button', { class: 'icon-btn', 'aria-label': 'Move up', onclick: () => reorder(q, i, -1) }, '↑'),
        h('button', { class: 'icon-btn', 'aria-label': 'Move down', onclick: () => reorder(q, i, 1) }, '↓'))));
  }

  async function reorder(q, i, dir) {
    const j = i + dir;
    if (j < 0 || j >= q.length) return;
    const list = [...q];
    [list[i], list[j]] = [list[j], list[i]];
    await state.store.evUpsert('event_matches', list.map((m, k) => ({ ...m, queue_pos: k + 1 })));
    await refreshEvent(); paint();
  }

  paint();
  root.addEventListener('focusout', () => setTimeout(() => { if (pending && !root.contains(document.activeElement)) paint(); }, 0));
  watchEvent(() => { if (root.isConnected) paint(); });
  return root;
}

// =====================================================================
// ROWS & PODS
// =====================================================================
export function eventSeating() {
  if (!ev.isAdmin) return notAdmin('seating');
  const root = h('div');
  let dragId = null;
  let draft = null; // unsaved sessions + plan

  const paint = () => {
    const s = ev.settings;
    const seat = s.seating;
    const n = Math.max(1, seat.group_rows || 8);
    const label = seat.label || 'Row';
    const teams = ev.data.teams.slice().sort((a, b) => (a.group_label || '~').localeCompare(b.group_label || '~') || (a.seed ?? 99) - (b.seed ?? 99));
    const liveRows = new Map();
    for (const m of ev.data.matches.filter(x => x.status === 'live' && x.stage === 'group')) {
      const sp = spotOf(m);
      sp?.rows?.forEach(x => x != null && liveRows.set(x, m));
    }
    const pin = async (team, row) => {
      await state.store.evUpsert('event_teams', { ...team, row_no: row });
      await refreshEvent(); paint();
    };
    const chip = t => h('span', {
      class: 'seat-chip', draggable: 'true', style: t.color ? { '--tc': t.color } : null,
      ondragstart: e => { dragId = t.id; e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; },
      'data-tip': `${t.name}${t.group_label ? ` · Group ${t.group_label}` : ''}. Drag to another row.`,
    }, teamBadge(t.id, 'xs'), t.tag || t.name, t.group_label ? h('i', {}, t.group_label) : null,
    h('select', { class: 'seat-pick', 'aria-label': `${t.name} row`, onchange: e => pin(t, e.target.value ? +e.target.value : null) },
      h('option', { value: '' }, '—'), Array.from({ length: n }, (_, i) => h('option', { value: i + 1, selected: t.row_no === i + 1 }, i + 1))));
    const dropZone = (row, ses, ...kids) => h('div', {
      class: 'seat-drop',
      ondragover: e => { e.preventDefault(); e.currentTarget.classList.add('over'); },
      ondragleave: e => e.currentTarget.classList.remove('over'),
      ondrop: e => {
        e.preventDefault(); e.currentTarget.classList.remove('over');
        const t = ev.teamById.get(e.dataTransfer.getData('text/plain') || dragId);
        if (!t) return;
        if (ses && teamSession(t, seat)?.id !== ses.id) return toast(`${t.name} plays in ${teamSession(t, seat)?.name || 'another session'}. Move the whole group in the plan above.`, 'error');
        if (t.row_no !== row) pin(t, row);
      },
    }, ...kids);

    const rowCount = h('input', { type: 'number', min: 1, max: 40, value: n, class: 'in-num' });
    const rowLabelIn = h('input', { value: label, class: 'in-tag', maxlength: 12 });
    const pcs = h('input', { type: 'number', min: 1, max: 12, value: seat.pcs || 5, class: 'in-num' });

    const bracketOpen = ev.data.matches.filter(m => { const r = ev.resolved.get(m.id); return m.stage !== 'group' && m.status !== 'final' && m.status !== 'live' && !r?.result?.done && r?.A !== 'BYE' && r?.B !== 'BYE'; })
      .sort((a, b) => (a.queue_pos ?? 999) - (b.queue_pos ?? 999));
    const bmAll = ev.data.matches.filter(m => m.stage !== 'group');

    // ---------- group stage plan: sessions + a block of rows per group ----------
    if (!draft) draft = { sessions: structuredClone(seat.sessions || []), plan: structuredClone(seat.plan || {}) };
    const groups = [...new Set(teams.map(t => t.group_label).filter(Boolean))].sort();
    const sizeOf = g => teams.filter(t => t.group_label === g).length;
    const dseat = { ...seat, ...draft };
    const issues = planIssues(teams, dseat, draft.plan);
    const issueFor = g => issues.filter(x => x.group === g);
    const groupColor = g => `var(--g${GROUP_LABELS.indexOf(g) % 8})`;
    const setPlan = (g, patch) => { draft.plan[g] = { ...(draft.plan[g] || { session: draft.sessions[0]?.id, from: 1 }), ...patch }; draft.dirty = true; paint(); };
    const savedPlan = Object.keys(seat.plan || {}).length > 0;

    const sessionEditor = h('div', { class: 'session-edit' },
      draft.sessions.map((x, i) => h('span', { class: 'session-chip' },
        h('input', { value: x.name, maxlength: 24, 'aria-label': `Session ${i + 1} name`, oninput: e => { x.name = e.target.value; draft.dirty = true; } }),
        draft.sessions.length > 1 ? h('button', {
          class: 'icon-btn', 'aria-label': `Remove ${x.name}`, onclick: () => {
            draft.sessions.splice(i, 1);
            for (const g of Object.keys(draft.plan)) if (draft.plan[g].session === x.id) draft.plan[g].session = draft.sessions[0].id;
            draft.dirty = true; paint();
          },
        }, '✕') : null)),
      draft.sessions.length < 4 ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { draft.sessions.push({ id: `s${Date.now().toString(36)}`, name: `Session ${draft.sessions.length + 1}` }); draft.dirty = true; paint(); } }, '＋ Session') : null);

    const planTable = groups.length ? h('div', { class: 'plan' }, groups.map(g => {
      const p = draft.plan[g] || {};
      const size = sizeOf(g);
      const bad = issueFor(g);
      const list = teams.filter(t => t.group_label === g);
      return h('div', { class: `plan-row ${bad.length ? 'bad' : ''}`, style: { '--gc': groupColor(g) } },
        h('div', { class: 'plan-group' }, h('b', {}, `Group ${g}`), h('span', { class: 'muted small' }, `${size} teams`)),
        h('div', { class: 'seg seg-sm', role: 'group', 'aria-label': `Group ${g} session` }, draft.sessions.map(x => h('button', { class: p.session === x.id ? 'on' : '', onclick: () => setPlan(g, { session: x.id }) }, x.name))),
        h('label', { class: 'inline' }, 'Rows', h('select', { onchange: e => setPlan(g, { from: +e.target.value }) },
          Array.from({ length: Math.max(1, n - size + 1) }, (_, i) => h('option', { value: i + 1, selected: p.from === i + 1 }, `${i + 1}–${i + size}`)),
          p.from > n - size + 1 ? h('option', { value: p.from, selected: true }, `${p.from}–${p.from + size - 1} (too far)`) : null)),
        h('div', { class: 'plan-teams small' }, list.map((t, i) => h('span', {}, h('i', {}, p.from ? `${label[0]}${p.from + i}` : '–'), t.tag || t.name))),
        h('div', { class: 'plan-state small' }, !p.session ? h('span', { class: 'muted' }, 'Not planned') : bad.length ? h('span', { class: 'warn-text' }, '⚠ ', bad.map(x => x.text).join('; ')) : h('span', { class: 'ok-text' }, '✓')));
    })) : h('div', { class: 'empty-sm' }, 'Assign groups in Setup first, then plan where each group sits.');

    // mini map: which group owns which rows in each session
    const miniMap = h('div', { class: 'plan-map' }, draft.sessions.map(x => h('div', { class: 'plan-map-ses' },
      h('span', { class: 'plan-map-name' }, x.name),
      h('div', { class: 'plan-map-rows', style: { '--n': n } }, Array.from({ length: n }, (_, i) => {
        const row = i + 1;
        const g = groups.find(gg => draft.plan[gg]?.session === x.id && row >= draft.plan[gg].from && row < draft.plan[gg].from + sizeOf(gg));
        const clash = groups.filter(gg => draft.plan[gg]?.session === x.id && row >= draft.plan[gg].from && row < draft.plan[gg].from + sizeOf(gg)).length > 1;
        return h('span', { class: `pm-cell ${g ? 'on' : ''} ${clash ? 'clash' : ''}`, style: g ? { '--gc': groupColor(g) } : null, 'data-tip': `${x.name} · ${label} ${row}${g ? ` · Group ${g}` : ' · free'}` }, g ? h('b', {}, g) : null, h('small', {}, row));
      })))));

    const planPanel = panel('Group stage seating', 'Each group plays all its group matches in one session, on a block of rows.',
      h('div', { class: 'field' }, h('span', {}, '1 · Sessions'), sessionEditor),
      h('div', { class: 'field' }, h('span', {}, '2 · Where each group sits'), planTable),
      groups.length ? miniMap : null,
      h('div', { class: 'row wrap' },
        h('button', {
          class: 'btn', 'data-tip': 'Fill the first session’s rows group by group, then the next session',
          onclick: () => { draft.plan = autoPlan(ev.data.teams, { ...seat, sessions: draft.sessions }); draft.dirty = true; paint(); },
        }, 'Auto-plan'),
        h('span', { class: 'spacer' }),
        draft.dirty ? h('span', { class: 'small muted' }, 'Unsaved changes') : null,
        draft.dirty ? h('button', { class: 'btn btn-ghost', onclick: () => { draft = null; paint(); } }, 'Discard') : null,
        h('button', {
          class: 'btn btn-primary', disabled: !groups.length, onclick: async () => {
            const missing = groups.filter(g => !draft.plan[g]?.session);
            if (missing.length) return toast(`Put group${missing.length > 1 ? 's' : ''} ${missing.join(', ')} in a session first`, 'error');
            if (issues.length && !(await confirmDialog(`${issues.map(x => x.text).join('. ')}. Save anyway?`, 'Save anyway'))) return;
            const sessions = draft.sessions.map((x, i) => ({ ...x, name: x.name.trim() || `Session ${i + 1}` }));
            await saveSettings({ seating: { ...seat, sessions, plan: draft.plan } });
            const rows = planRows(ev.data.teams, draft.plan);
            await state.store.evUpsert('event_teams', ev.data.teams.filter(t => rows[t.id] != null).map(t => ({ ...t, row_no: rows[t.id] })));
            draft = null;
            await refreshEvent(); toast('Plan saved and teams seated', 'success'); paint();
          },
        }, 'Save and seat teams')));

    // ---------- row chart (one per session) ----------
    const sessionsShown = savedPlan ? (seat.sessions || []) : [null];
    const inSession = (t, x) => (x ? teamSession(t, seat)?.id === x.id : true);
    const chartFor = x => {
      const mine = teams.filter(t => inSession(t, x));
      const loose = mine.filter(t => t.row_no == null || t.row_no > n);
      return h('div', { class: `floor-ses ${seat.current && x && seat.current === x.id ? 'current' : ''}` },
        h('div', { class: 'floor-ses-head' }, h('b', {}, x ? x.name : 'All teams'),
          x && seat.current === x.id ? h('span', { class: 'chip chip-live' }, 'Playing now') : null,
          h('span', { class: 'muted small' }, `${mine.length} teams`)),
        h('div', { class: 'floor' },
          Array.from({ length: n }, (_, i) => {
            const row = i + 1;
            const here = mine.filter(t => t.row_no === row);
            const live = liveRows.get(row);
            const liveHere = live && here.some(t => [ev.resolved.get(live.id)?.A, ev.resolved.get(live.id)?.B].includes(t.id));
            return h('div', { class: `floor-row ${liveHere ? 'is-live' : ''} ${here.length > 1 ? 'shared' : ''}` },
              h('div', { class: 'floor-label' }, h('b', {}, `${label} ${row}`), h('span', { class: 'pcs' }, Array.from({ length: seat.pcs || 5 }, () => h('i')))),
              dropZone(row, x, here.length ? here.map(chip) : h('span', { class: 'muted small' }, 'Free')),
              h('div', { class: 'floor-state small' }, liveHere ? h('span', {}, statusPill('live'), ' ', (() => { const r = ev.resolved.get(live.id); return `${teamTag(r.A)} vs ${teamTag(r.B)}`; })()) : here.length > 1 ? 'Shared' : ''));
          }),
          loose.length ? h('div', { class: 'floor-row floor-tray' }, h('div', { class: 'floor-label' }, h('b', {}, 'No row')), dropZone(null, x, loose.map(chip)), h('div')) : null));
    };
    const unplanned = savedPlan ? teams.filter(t => !teamSession(t, seat)) : [];
    const chartPanel = panel('Row chart', savedPlan ? 'Drag a team to swap it to another row in its session, or use its row menu.' : 'Save a plan above to split the chart by session.',
      savedPlan ? h('div', { class: 'row wrap' },
        h('label', { class: 'inline' }, 'Playing now', h('select', {
          onchange: async e => { await saveSettings({ seating: { ...seat, current: e.target.value } }); toast(e.target.value ? 'Display shows this session’s seating' : 'Display shows every session'); paint(); },
        }, h('option', { value: '' }, 'All sessions'), (seat.sessions || []).map(x => h('option', { value: x.id, selected: seat.current === x.id }, x.name)))),
        h('span', { class: 'small muted' }, 'Sets which session the Seating screen on the display shows.')) : null,
      h('div', { class: `floor-sessions n${sessionsShown.length}` }, sessionsShown.map(chartFor)),
      unplanned.length ? h('p', { class: 'small muted' }, `Not in a session yet: ${unplanned.map(t => t.tag || t.name).join(', ')}`) : null);

    const layoutPanel = h('details', { class: 'block', open: !savedPlan && !teams.length },
      h('summary', {}, h('strong', {}, 'Room layout'), h('span', { class: 'muted small' }, ` · ${n} rows of ${seat.pcs || 5} PCs`)),
      h('div', { class: 'stack-sm', style: { marginTop: '.8rem' } },
        h('div', { class: 'grid-4' },
          h('label', {}, 'Rows in the room', rowCount), h('label', {}, 'PCs per row', pcs), h('label', {}, 'Call them', rowLabelIn)),
        h('p', { class: 'small muted' }, 'Group stage and bracket use the same rows. In the bracket each team gets its own row, the same as groups.'),
        h('div', {}, h('button', {
          class: 'btn btn-primary', onclick: async () => {
            await saveSettings({
              seating: { ...seat, group_rows: Math.max(1, +rowCount.value || 8), pcs: Math.max(1, +pcs.value || 5), label: rowLabelIn.value.trim() || 'Row' },
            });
            toast('Layout saved', 'success'); paint();
          },
        }, 'Save layout'))));

    clear(root).append(eventShell('seating', h('div', { class: 'stack' },
      planPanel,
      chartPanel,
      panel('Bracket seating', 'Every team in a bracket match gets its own row. Matches get rows automatically when you start them; set them earlier here.',
        bracketOpen.length || bmAll.some(m => m.status === 'live') ? h('div', { class: 'bracket-seat' },
          h('div', { class: 'stack-sm' },
            h('div', { class: 'row' }, h('button', {
              class: 'btn', onclick: async () => {
                // walk the queue: each match takes the rows its teams are on, or the next free pair
                const used = busyRows(ev.data.matches);
                const rows = [];
                for (const m of bracketOpen) {
                  const r = ev.resolved.get(m.id) || {};
                  const prefer = [teamRow(r.A, ev.data.matches, ev.resolved, m.id), teamRow(r.B, ev.data.matches, ev.resolved, m.id)];
                  let pair = freeRowPair(n, used, prefer);
                  if (!pair) { used.clear(); busyRows(ev.data.matches).forEach(x => used.add(x)); pair = freeRowPair(n, used, prefer); }
                  if (!pair) break;
                  pair.forEach(x => used.add(x));
                  rows.push({ ...m, row_a: pair[0], row_b: pair[1], updated_at: now() });
                }
                if (!rows.length) return toast('No free rows', 'error');
                await state.store.evUpsert('event_matches', rows);
                await refreshEvent(); toast('Rows set in queue order', 'success'); paint();
              },
            }, 'Fill rows in queue order')),
            bracketRowBoard(bmAll),
            h('table', { class: 'data tight bseat-list' },
              h('thead', {}, h('tr', {}, h('th', {}, 'Match'), h('th', {}, 'Rows'), h('th', {}, ''))),
              h('tbody', {}, bracketOpen.map(m => {
                const r = ev.resolved.get(m.id);
                return h('tr', { class: `q-${m.status}` },
                  h('td', {}, h('strong', {}, `${teamTag(r.A) || srcLabel(m.src_a)} vs ${teamTag(r.B) || srcLabel(m.src_b)}`),
                    h('div', { class: 'small muted' }, `${m.code} · ${roundName(m, bmAll)}${m.status === 'ondeck' ? ' · on deck' : ''}`)),
                  h('td', {}, rowPicker(m, paint)),
                  h('td', {}, h('button', {
                    class: 'btn btn-sm btn-ghost', 'data-tip': 'Keep teams where they are, else the next free pair',
                    onclick: async () => { const p = autoRowsFor(m); if (!p) return toast('No free rows', 'error'); await setMatch(m, { row_a: p[0], row_b: p[1] }); await refreshEvent(); paint(); },
                  }, 'Auto')));
              })))),
          seatHelper(bmAll))
          : h('div', { class: 'empty-sm' }, 'No open bracket matches yet. Generate playoffs in Setup.')),
      layoutPanel)));

    // the room during the bracket: who sits on each row now, and who's coming
    function bracketRowBoard(bm) {
      const live = bm.filter(m => m.status === 'live');
      const who = new Map(); // row → { team, m, live }
      for (const m of [...live, ...bracketOpen]) {
        const r = ev.resolved.get(m.id) || {};
        for (const [row, team, src] of [[m.row_a, r.A, m.src_a], [m.row_b, r.B, m.src_b]]) {
          if (row == null) continue;
          const list = who.get(Number(row)) || [];
          list.push({ team, src, m, live: m.status === 'live' });
          who.set(Number(row), list);
        }
      }
      return h('div', { class: 'brow-board' }, Array.from({ length: n }, (_, k) => k + 1).map(row => {
        const list = who.get(row) || [];
        const now_ = list.find(x => x.live), next = list.filter(x => !x.live).slice(0, 2);
        return h('div', { class: `brow ${now_ ? 'is-live' : ''}` },
          h('b', {}, `${label} ${row}`),
          now_ ? h('div', { class: 'small' }, statusPill('live'), ' ', h('strong', {}, teamTag(now_.team) || srcLabel(now_.src)), h('span', { class: 'muted' }, ` · ${now_.m.code}`)) : h('div', { class: 'small muted' }, 'Free'),
          next.map(x => h('div', { class: 'small muted' }, 'Next: ', h('span', {}, teamTag(x.team) || srcLabel(x.src)), ` · ${x.m.code}`)));
      }));
    }

    // helper: keep teams on the same setup for back-to-back matches (suggestions only)
    function seatHelper(bm) {
      const tips = bracketRowHelp(ev.data.matches, ev.resolved, n);
      const todo = tips.filter(t => !t.ok && !t.clash), done = tips.filter(t => t.ok), waiting = tips.filter(t => t.clash);
      const vs = m => { const r = ev.resolved.get(m.id); return `${teamTag(r.A) || srcLabel(m.src_a)} vs ${teamTag(r.B) || srcLabel(m.src_b)}`; };
      const nm = sd => (sd.team ? teamName(sd.team) : sd.who || 'TBD');
      const rw = x => (x == null ? '—' : `${label} ${x}`);
      return h('aside', { class: 'seat-help' },
        h('div', { class: 'seat-help-head' }, h('strong', {}, 'Seating helper'),
          h('p', { class: 'small muted' }, 'Keeps teams on the same row when they play back to back. Suggestions only — nothing moves until you click Apply.')),
        !tips.length ? h('div', { class: 'empty-sm' }, 'No suggestions yet. They appear once bracket matches have been played on rows.') : null,
        todo.map(t => h('div', { class: `tip ${t.clash ? 'warn' : ''}` },
          h('div', { class: 'tip-top' }, h('strong', {}, `${t.match.code} · ${vs(t.match)}`), h('span', { class: 'muted small' }, roundName(t.match, bm))),
          t.clash ? null : t.sides.map((sd, k) => h('div', { class: 'small' },
            h('b', {}, nm(sd)), ' → ',
            sd.waits ? h('span', { class: 'muted' }, `stays on their row (decided when ${sd.waits} ends)`)
              : sd.takesFrom ? h('span', { class: 'muted' }, `takes the row the other ${sd.takesFrom.code} team leaves (${sd.takesFrom.rows.map(rw).join(' or ')})`)
              : h('span', {}, h('b', {}, rw(sd.row)), sd.stays ? h('span', { class: 'muted' }, ' · stays seated') : h('span', { class: 'muted' }, ` · moves${t.current[k] != null && Number(t.current[k]) !== sd.row ? ` from ${rw(t.current[k])}` : ''}`)))),
          t.clash ? h('div', { class: 'small warn-text' }, '⚠ Every row is in use or promised to a match earlier in the queue. Rows free up as live matches end.') : null,
          t.clash || t.rows.every(x => x == null) ? null : h('div', { class: 'row' }, h('button', {
            class: 'btn btn-sm btn-primary', onclick: async () => {
              const patch = {};
              if (t.rows[0] != null) patch.row_a = t.rows[0];
              if (t.rows[1] != null) patch.row_b = t.rows[1];
              await setMatch(t.match, patch); await refreshEvent(); paint(); toast(`${t.match.code} → ${t.rows.filter(x => x != null).map(rw).join(' & ')}`, 'success');
            },
          }, `Apply · ${t.rows.filter(x => x != null).map(rw).join(' & ')}`)))),
        waiting.length ? h('div', { class: 'tip-done small muted' }, `⏳ No free rows yet for ${waiting.map(t => t.match.code).join(', ')}. Suggestions appear as live matches end.`) : null,
        done.length ? h('div', { class: 'tip-done small' }, `✓ ${done.length} already on the best rows: `, done.map(t => `${t.match.code} (${t.rows.map(x => x ?? '?').join(' & ')})`).join(', ')) : null);
    }
  };

  paint();
  watchEvent(() => { if (root.isConnected && !root.contains(document.activeElement)) paint(); });
  return root;
}
