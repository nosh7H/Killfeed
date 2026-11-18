// Admin view of an event: the control panel (live scores, queue, display remote)
// and Rows & pods (group-stage rows pinned per team, bracket rows per match).
import { h, clear, toast, confirmDialog, uid } from '../ui.js';
import { state } from '../state.js';
import { ev, eventPath, refreshEvent, eventSettings, teamName, teamTag, watchEvent, teamBadge, spotOf } from '../event-state.js';
import { roundName, queue, gamesByMatch, seriesResult, gameWinner, liveMap, seatConflicts, freeStation, autoRows, GROUP_LABELS } from '../event-logic.js';
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
async function setMatch(m, patch) {
  await state.store.evUpsert('event_matches', { ...m, ...patch, updated_at: now() });
}

/** Points step for the −/+ buttons: Hardpoint moves in bigger chunks. */
const stepFor = mode => (mode === 'Hardpoint' ? 10 : 1);

// =====================================================================
// CONTROL PANEL
// =====================================================================
export function eventControl() {
  if (!ev.isAdmin) return notAdmin('control');
  const root = h('div');
  let showFinal = false;
  let pending = false; // a repaint arrived while someone was typing

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

    clear(root).append(eventShell('control', h('div', { class: 'stack' },
      remote(),
      clashes.length ? h('div', { class: 'alert alert-warn' }, h('strong', {}, 'Seating clash: '),
        clashes.map(c => (c.team ? `${teamName(c.team)} is in two live matches` : `${c.key} has two live matches`)).join(' · ')) : null,
      panel(`Live now (${live.length})`, 'Type the score as the map is played. It shows on the display right away. End map saves it as a result.',
        live.length ? h('div', { class: 'cp-grid' }, live.map(m => liveCard(m, gbm.get(m.id) || [], bm))) : h('div', { class: 'empty-sm' }, 'No live matches. Start one from On deck or the queue.')),
      ondeck.length ? panel(`On deck (${ondeck.length})`, 'Teams are called to their rows. Start when they are ready.',
        h('div', { class: 'cp-grid cp-grid-sm' }, ondeck.map(m => deckCard(m, bm)))) : null,
      panel('Queue', 'Live first, then on deck, then scheduled. Group matches use each team’s pinned rows; bracket matches use the row set here.',
        q.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data queue-table' },
          h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Match'), h('th', {}, 'Where'), h('th', {}, 'Veto'), h('th', {}, 'Status'), h('th', {}))),
          h('tbody', {}, q.map((m, i) => queueRow(m, i, q, bm))))) : h('div', { class: 'empty-sm' }, 'Nothing waiting. Generate group matches in Setup.')),
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
    const label = k => (k.startsWith('kd:') ? `K/D · ${k.slice(3)}` : { live: 'Live matches', groups: 'Group standings', teams: 'Team stats', bracket: 'Bracket', queue: 'Live and up next', awards: 'Awards' }[k] || k);
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

  // ---------- live match card with score entry ----------
  function liveCard(m, games, bm) {
    const r = ev.resolved.get(m.id);
    const res = r.result || seriesResult(m, games);
    const lm = liveMap(m, games, ev.settings);
    const veto = ev.data.vetoes.find(v => v.match_id === m.id);
    const spot = spotOf(m);
    const score = { a: lm.a, b: lm.b };
    const inputs = {};
    const save = async () => {
      await setMatch(m, { live: { ...(m.live || {}), game_no: lm.game_no, a: score.a, b: score.b } });
    };
    let t = null;
    const bump = (side, d) => {
      score[side] = Math.max(0, score[side] + d);
      inputs[side].value = score[side];
      clearTimeout(t); t = setTimeout(save, 350);
    };
    const side = (key, id) => h('div', { class: `cp-side ${res.winner === key ? 'win' : ''}` },
      h('div', { class: 'cp-team' }, teamBadge(id, 'sm'), h('span', {}, teamName(id)), h('b', { class: 'cp-maps' }, res[key])),
      h('div', { class: 'cp-score' },
        h('button', { class: 'icon-btn', 'aria-label': `${teamName(id)} minus`, onclick: () => bump(key, -stepFor(lm.mode)) }, '−'),
        inputs[key] = h('input', { type: 'number', min: 0, class: 'in-score', value: score[key], 'aria-label': `${teamName(id)} score`, onchange: e => { score[key] = Math.max(0, +e.target.value || 0); save(); }, onblur: () => { if (pending) setTimeout(paint, 0); } }),
        h('button', { class: 'icon-btn', 'aria-label': `${teamName(id)} plus`, onclick: () => bump(key, stepFor(lm.mode)) }, '+'),
        stepFor(lm.mode) > 1 ? h('button', { class: 'icon-btn small', 'aria-label': `${teamName(id)} plus one`, onclick: () => bump(key, 1) }, '+1') : null));
    return h('div', { class: 'cp-card live' },
      h('div', { class: 'cp-head' },
        statusPill('live'), h('strong', {}, spot?.label || 'No row'),
        h('span', { class: 'muted small' }, `${roundName(m, bm)} · Bo${m.best_of}`),
        h('span', { class: 'spacer' }), vetoChip(m, veto)),
      h('div', { class: 'cp-map' }, `Map ${lm.game_no}`, lm.mode ? ` · ${lm.mode}` : '', lm.map ? ` · ${lm.map}` : ' · ',
        lm.map ? null : h('select', {
          class: 'cp-map-pick', 'aria-label': 'Map being played',
          onchange: async e => { if (!e.target.value) return; await setMatch(m, { live: { ...(m.live || {}), game_no: lm.game_no, mode: lm.mode, map: e.target.value, a: score.a, b: score.b } }); },
        }, h('option', { value: '' }, 'Set map…'), (ev.settings.maps[lm.mode] || []).map(x => h('option', { value: x }, x)))),
      side('a', r.A), side('b', r.B),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-sm btn-primary', 'data-submit': '', onclick: save }, 'Update score'),
        h('button', {
          class: 'btn btn-sm btn-primary', 'data-submit': '', onclick: async () => {
            score.a = +inputs.a.value || 0; score.b = +inputs.b.value || 0;
            if (score.a === score.b) return toast('Scores are tied — finish the map first', 'error');
            if (!(await confirmDialog(`End Map ${lm.game_no}: ${teamTag(r.A)} ${score.a}–${score.b} ${teamTag(r.B)}?`, 'End map'))) return;
            await endMap(m, games, lm, score);
          },
        }, 'End map'),
        h('span', { class: 'spacer' }),
        h('a', { class: 'btn btn-sm btn-ghost', href: eventPath(`match/${m.id}`) }, 'Player stats →')));
  }

  async function endMap(m, games, lm, score) {
    const existing = games.find(g => g.game_no === lm.game_no);
    const row = { id: existing?.id || uid(), event_id: ev.event.id, match_id: m.id, game_no: lm.game_no, mode: lm.mode, map: lm.map, a_score: score.a, b_score: score.b };
    await state.store.evUpsert('event_games', row);
    const after = [...games.filter(g => g.game_no !== lm.game_no), row];
    const res = seriesResult(m, after);
    const r = ev.resolved.get(m.id);
    if (res.done) {
      await setMatch(m, { status: 'final', live: null });
      toast(`${teamName(res.winner === 'a' ? r.A : r.B)} win ${Math.max(res.a, res.b)}–${Math.min(res.a, res.b)} · match final`, 'success');
    } else {
      await setMatch(m, { live: { game_no: lm.game_no + 1, a: 0, b: 0 } });
      toast(`Map ${lm.game_no} saved · series ${res.a}–${res.b}`, 'success');
    }
    await refreshEvent(); paint();
  }

  function deckCard(m, bm) {
    const r = ev.resolved.get(m.id);
    const veto = ev.data.vetoes.find(v => v.match_id === m.id);
    return h('div', { class: 'cp-card' },
      h('div', { class: 'cp-head' }, statusPill('ondeck'), h('strong', {}, spotOf(m)?.label || 'No row yet'), h('span', { class: 'spacer' }), vetoChip(m, veto)),
      h('div', { class: 'cp-deck-teams' }, teamBadge(r.A, 'sm'), teamName(r.A), h('span', { class: 'vs' }, 'vs'), teamBadge(r.B, 'sm'), teamName(r.B)),
      h('div', { class: 'muted small' }, `${roundName(m, bm)} · Bo${m.best_of}`),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-sm btn-primary', 'data-submit': '', onclick: () => goLive(m) }, 'Start match')));
  }

  async function goLive(m) {
    const patch = { status: 'live' };
    if (m.stage !== 'group' && !m.station) {
      patch.station = freeStation(ev.settings.stations, ev.data.matches, m.id);
      if (!patch.station) return toast('Every bracket row is busy. Pick a row for this match first.', 'error');
    }
    if (m.stage === 'group') {
      const r = ev.resolved.get(m.id);
      const missing = [r.A, r.B].filter(id => ev.teamById.get(id)?.row_no == null);
      if (missing.length && !m.station) return toast(`Pin ${missing.map(teamName).join(' and ')} to a row in Rows & pods first`, 'error');
    }
    const games = gamesByMatch(ev.data.games).get(m.id) || [];
    patch.live = m.live || { game_no: games.filter(g => gameWinner(g)).length + 1, a: 0, b: 0 };
    const test = ev.data.matches.map(x => (x.id === m.id ? { ...x, ...patch } : x));
    const clash = seatConflicts(test, ev.resolved, ev.teamById, rowLabel()).filter(c => c.matches.includes(m.id));
    if (clash.length && !(await confirmDialog(`${clash.map(c => (c.team ? `${teamName(c.team)} is already live` : `${c.key} is already in use`)).join(', ')}. Start anyway?`, 'Start anyway'))) return;
    await setMatch(m, patch);
    await refreshEvent(); paint();
    toast(`Live on ${spotOf({ ...m, ...patch })?.label || 'the floor'}`, 'success');
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
      ? h('span', { class: 'small', 'data-tip': 'Each team plays from its pinned row (Rows & pods)' }, spotOf(m)?.label || h('span', { class: 'muted' }, 'Pin rows'))
      : h('select', { 'aria-label': 'Row', onchange: async e => { await setMatch(m, { station: e.target.value || null }); await refreshEvent(); paint(); } },
        h('option', { value: '' }, '— row —'),
        ev.settings.stations.map(st => h('option', { value: st, selected: m.station === st }, st)));
    return h('tr', { class: `q-${m.status}` },
      h('td', { class: 'num muted' }, i + 1),
      h('td', {}, h('a', { href: eventPath(`match/${m.id}`) }, teamName(r.A), h('span', { class: 'vs' }, ' vs '), teamName(r.B)),
        h('div', { class: 'small muted' }, roundName(m, bm), ` · Bo${m.best_of}`)),
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
    const dropZone = (row, ...kids) => h('div', {
      class: 'seat-drop',
      ondragover: e => { e.preventDefault(); e.currentTarget.classList.add('over'); },
      ondragleave: e => e.currentTarget.classList.remove('over'),
      ondrop: e => {
        e.preventDefault(); e.currentTarget.classList.remove('over');
        const t = ev.teamById.get(e.dataTransfer.getData('text/plain') || dragId);
        if (t && t.row_no !== row) pin(t, row);
      },
    }, ...kids);

    const rowCount = h('input', { type: 'number', min: 1, max: 40, value: n, class: 'in-num' });
    const rowLabelIn = h('input', { value: label, class: 'in-tag', maxlength: 12 });
    const pcs = h('input', { type: 'number', min: 1, max: 12, value: seat.pcs || 5, class: 'in-num' });
    let podNames = [...s.stations];
    const podCount = h('input', { type: 'number', min: 1, max: 16, value: podNames.length, class: 'in-num' });
    const podGrid = h('div', { class: 'pod-names' });
    const renderPods = () => {
      const k = Math.max(1, Math.min(16, +podCount.value || 1));
      while (podNames.length < k) podNames.push(`${label} ${podNames.length + 1}`);
      podNames = podNames.slice(0, k);
      clear(podGrid).append(...podNames.map((nm, i) => h('input', { value: nm, 'aria-label': `Bracket row ${i + 1} name`, oninput: e => { podNames[i] = e.target.value; } })));
    };
    podCount.oninput = renderPods;
    renderPods();

    const unpinned = teams.filter(t => t.row_no == null || t.row_no > n);
    const bracketOpen = ev.data.matches.filter(m => { const r = ev.resolved.get(m.id); return m.stage !== 'group' && m.status !== 'final' && !r?.result?.done && r?.A !== 'BYE' && r?.B !== 'BYE'; })
      .sort((a, b) => (a.queue_pos ?? 999) - (b.queue_pos ?? 999));
    const bmAll = ev.data.matches.filter(m => m.stage !== 'group');

    clear(root).append(eventShell('seating', h('div', { class: 'stack' },
      panel('Layout', 'Group stage: each team keeps one row. Bracket stage: each match is set to a row.',
        h('div', { class: 'grid-4' },
          h('label', {}, 'Group stage rows', rowCount), h('label', {}, 'PCs per row', pcs), h('label', {}, 'Call them', rowLabelIn),
          h('div', { class: 'field' }, h('span', {}, 'Bracket rows'), h('label', { class: 'inline' }, 'How many', podCount))),
        h('div', { class: 'field' }, h('span', { class: 'small muted' }, 'Bracket row names'), podGrid),
        h('div', {}, h('button', {
          class: 'btn btn-primary', onclick: async () => {
            await saveSettings({
              seating: { ...seat, group_rows: Math.max(1, +rowCount.value || 8), pcs: Math.max(1, +pcs.value || 5), label: rowLabelIn.value.trim() || 'Row' },
              stations: podNames.map((x, i) => x.trim() || `Row ${i + 1}`),
            });
            toast('Layout saved', 'success'); paint();
          },
        }, 'Save layout'))),

      panel('Group stage rows', `${teams.length - unpinned.length} of ${teams.length} teams pinned · teams stay on their row for every group match`,
        h('div', { class: 'row' },
          h('button', {
            class: 'btn', onclick: async () => {
              if (teams.some(t => t.row_no != null) && !(await confirmDialog('Re-pin every team? Current rows are replaced.', 'Re-pin'))) return;
              const map = autoRows(ev.data.teams, n);
              await state.store.evUpsert('event_teams', ev.data.teams.map(t => ({ ...t, row_no: map[t.id] })));
              await refreshEvent(); toast('Teams pinned to rows', 'success'); paint();
            },
          }, 'Auto-pin by group and seed'),
          teams.length > n ? h('span', { class: 'small muted' }, `${teams.length} teams on ${n} rows: some rows are shared, so those teams can’t play at the same time.`) : null),
        h('div', { class: 'floor' },
          Array.from({ length: n }, (_, i) => {
            const row = i + 1;
            const here = teams.filter(t => t.row_no === row);
            const live = liveRows.get(row);
            return h('div', { class: `floor-row ${live ? 'is-live' : ''} ${here.length > 1 ? 'shared' : ''}` },
              h('div', { class: 'floor-label' }, h('b', {}, `${label} ${row}`), h('span', { class: 'pcs' }, Array.from({ length: seat.pcs || 5 }, () => h('i')))),
              dropZone(row, here.length ? here.map(chip) : h('span', { class: 'muted small' }, 'Drop a team here')),
              h('div', { class: 'floor-state small' }, live ? h('span', {}, statusPill('live'), ' ', (() => { const r = ev.resolved.get(live.id); return `${teamTag(r.A)} vs ${teamTag(r.B)}`; })()) : here.length > 1 ? 'Shared' : ''));
          }),
          unpinned.length ? h('div', { class: 'floor-row floor-tray' }, h('div', { class: 'floor-label' }, h('b', {}, 'Not pinned')), dropZone(null, unpinned.map(chip)), h('div')) : null)),

      panel('Bracket rows', `Set each bracket match to one of ${s.stations.length} rows. Starting a match without a row picks the first free one.`,
        bracketOpen.length ? h('div', { class: 'stack-sm' },
          h('div', { class: 'row' }, h('button', {
            class: 'btn', onclick: async () => {
              let k = 0;
              const rows = bracketOpen.map(m => ({ ...m, station: s.stations[k++ % s.stations.length], updated_at: now() }));
              await state.store.evUpsert('event_matches', rows);
              await refreshEvent(); toast('Rows set in queue order', 'success'); paint();
            },
          }, 'Fill rows in queue order')),
          h('div', { class: 'pod-board', style: { '--pods': s.stations.length } }, s.stations.map(st => h('div', { class: 'pod-col' },
            h('div', { class: 'eyebrow' }, st),
            bracketOpen.filter(m => m.station === st).map(m => bracketItem(m, bmAll)),
            !bracketOpen.some(m => m.station === st) ? h('div', { class: 'muted small' }, 'Empty') : null))),
          bracketOpen.some(m => !s.stations.includes(m.station))
            ? h('div', {}, h('div', { class: 'eyebrow' }, 'No row yet'), h('div', { class: 'pod-loose' }, bracketOpen.filter(m => !s.stations.includes(m.station)).map(m => bracketItem(m, bmAll))))
            : null)
          : h('div', { class: 'empty-sm' }, 'No open bracket matches yet. Generate playoffs in Setup.')))));

    function bracketItem(m, bm) {
      const r = ev.resolved.get(m.id);
      return h('div', { class: `pod-item q-${m.status}` },
        h('div', {}, h('strong', {}, `${teamTag(r.A) || 'TBD'} vs ${teamTag(r.B) || 'TBD'}`), h('div', { class: 'small muted' }, `${m.code} · ${roundName(m, bm)}`)),
        h('select', { 'aria-label': 'Row', onchange: async e => { await setMatch(m, { station: e.target.value || null }); await refreshEvent(); paint(); } },
          h('option', { value: '' }, '—'), s.stations.map(st => h('option', { value: st, selected: m.station === st }, st))));
    }
  };

  paint();
  watchEvent(() => { if (root.isConnected && !root.contains(document.activeElement)) paint(); });
  return root;
}

export { GROUP_LABELS };
