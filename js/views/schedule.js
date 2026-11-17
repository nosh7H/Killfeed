// Team schedule: week / month / list, drag to reschedule, player time off, best-time finder, league colors.
import { h, clear, toast, modal, confirmDialog } from '../ui.js';
import { state, canEdit, isOwner, refreshTeams, teamPath, go } from '../state.js';
import {
  KINDS, scheduleCfg, eventColor, expandTimeOff, eventConflicts, overlapsWith, findSlots, mergeSlots, moveEvent, LEAGUE_PALETTE,
} from '../schedule.js';

const HOUR_PX = 46, SNAP = 15;
const DAY = 86400000;
const startOfWeek = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const fmtT = d => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtD = (d, o = {}) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...o });
const minsOf = d => { const x = new Date(d); return x.getHours() * 60 + x.getMinutes(); };
const dateInput = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const timeInput = d => { const x = new Date(d); return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; };
const combine = (dateStr, timeStr) => new Date(`${dateStr}T${timeStr || '00:00'}`);

export async function scheduleView() {
  const editable = canEdit();
  let view = localStorage.getItem('kf-sched-view') || 'week';
  let anchor = startOfWeek(new Date());
  let data = await state.store.listSchedule(state.team.id);
  let cfg = scheduleCfg(state.team);
  const roster = () => state.data.players.filter(p => p.active !== false);
  const pname = id => state.data.players.find(p => p.id === id)?.gamertag || 'Player';
  const root = h('div', { class: 'page sched' });

  const reload = async () => { data = await state.store.listSchedule(state.team.id); paint(); };
  const rangeFor = () => (view === 'month'
    ? (() => { const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1); const s = startOfWeek(first); return [s, addDays(s, 42)]; })()
    : view === 'week' ? [anchor, addDays(anchor, 7)] : [addDays(startOfWeek(new Date()), -14), addDays(new Date(), 90)]);
  const label = ev => ev.title || (ev.kind === 'scrim' ? `Scrim${ev.opponent ? ` vs ${ev.opponent}` : ''}` : ev.kind === 'practice' ? 'Practice' : `${cfg.leagues.find(l => l.id === ev.league_id)?.name || 'Match'}${ev.opponent ? ` vs ${ev.opponent}` : ''}`);

  // ---------- save helpers ----------
  async function saveEvent(ev, msg) {
    try { await state.store.saveScheduleEvent(state.team.id, ev); if (msg) toast(msg, 'success'); await reload(); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function reschedule(ev, newStart) {
    if (new Date(newStart).getTime() === new Date(ev.starts_at).getTime()) return;
    const prev = { ...ev };
    const moved = moveEvent(ev, newStart, state.user?.email || null);
    await state.store.saveScheduleEvent(state.team.id, moved);
    await reload();
    const t = h('div', { class: 'toast toast-success', role: 'status' }, `Moved to ${fmtD(moved.starts_at)} ${fmtT(moved.starts_at)} `,
      h('button', { class: 'link', onclick: async () => { t.remove(); await state.store.saveScheduleEvent(state.team.id, prev); await reload(); toast('Move undone'); } }, 'Undo'));
    document.querySelector('#toasts').append(t);
    setTimeout(() => t.remove(), 6000);
  }

  // ---------- render ----------
  function paint() {
    const [from, to] = rangeFor();
    const intervals = expandTimeOff(data.timeoff, from.toISOString(), to.toISOString());
    const events = data.events.filter(e => new Date(e.ends_at) > from && new Date(e.starts_at) < to).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const title = view === 'month' ? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : view === 'week' ? `${fmtD(anchor, { weekday: undefined })} – ${fmtD(addDays(anchor, 6), { weekday: undefined })}` : 'Upcoming';
    clear(root).append(...[
      h('div', { class: 'page-head' },
        h('div', {}, h('div', { class: 'eyebrow' }, 'Scrims, matches and availability'), h('h1', {}, 'Schedule')),
        editable ? h('div', { class: 'actions wrap' },
          h('button', { class: 'btn', onclick: () => timeOffDialog() }, '＋ Time off'),
          h('button', { class: 'btn', onclick: () => finder() }, 'Find a time'),
          h('button', { class: 'btn', onclick: () => eventDialog({ kind: 'match' }) }, '＋ Match'),
          h('button', { class: 'btn btn-primary', onclick: () => eventDialog({ kind: 'scrim' }) }, '＋ Scrim')) : null),
      h('div', { class: 'toolbar' },
        h('div', { class: 'row' },
          view !== 'list' ? h('div', { class: 'seg' },
            h('button', { onclick: () => { anchor = view === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1) : addDays(anchor, -7); paint(); }, 'aria-label': 'Previous' }, '‹'),
            h('button', { onclick: () => { anchor = view === 'month' ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : startOfWeek(new Date()); paint(); } }, 'Today'),
            h('button', { onclick: () => { anchor = view === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1) : addDays(anchor, 7); paint(); }, 'aria-label': 'Next' }, '›')) : null,
          h('strong', { class: 'sched-title' }, title)),
        h('div', { class: 'row' }, legend(),
          h('div', { class: 'seg' }, [['week', 'Week'], ['month', 'Month'], ['list', 'List']].map(([k, l]) => h('button', {
            class: view === k ? 'on' : '', onclick: () => {
              view = k; localStorage.setItem('kf-sched-view', k);
              anchor = k === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth(), 1) : startOfWeek(anchor);
              paint();
            },
          }, l))))),
      !roster().length ? h('p', { class: 'note-warn' }, 'Add your roster in Team settings so time off and availability work.') : null,
      view === 'week' ? weekView(events, intervals) : view === 'month' ? monthView(events, intervals) : listView(events, intervals),
      timeOffList(),
      isOwner() ? leagueSettings() : null,
    ].filter(Boolean));
    if (view === 'week') requestAnimationFrame(() => {
      const body = root.querySelector('.wk-scroll');
      if (body && !body.dataset.scrolled) { body.scrollTop = Math.max(0, (17 * 60 - cfg.day_start) / 60 * HOUR_PX); body.dataset.scrolled = '1'; }
    });
  }

  function legend() {
    return h('div', { class: 'legend sched-legend' },
      h('span', {}, h('i', { style: { background: cfg.scrim_color } }), 'Scrim'),
      cfg.leagues.map(l => h('span', {}, h('i', { style: { background: l.color } }), l.name)),
      h('span', {}, h('i', { class: 'lg-off' }), 'Time off'));
  }

  function badgeFor(ev, intervals) {
    const out = eventConflicts(ev, intervals);
    const dbl = overlapsWith(ev, data.events);
    if (!out.size && !dbl.length) return null;
    const tip = [out.size ? `Out: ${[...out].map(pname).join(', ')}` : '', dbl.length ? `Overlaps: ${dbl.map(label).join(', ')}` : ''].filter(Boolean).join('\n');
    return h('span', { class: 'ev-warn', 'data-tip': tip }, out.size ? `${out.size} out` : 'Overlap');
  }

  // ---------- week ----------
  function weekView(events, intervals) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
    const startM = cfg.day_start, endM = cfg.day_end;
    const height = (endM - startM) / 60 * HOUR_PX;
    const y = m => (m - startM) / 60 * HOUR_PX;
    const grid = h('div', { class: 'wk-grid', style: { height: `${height}px` } });
    const cols = days.map(d => {
      const col = h('div', { class: `wk-col ${sameDay(d, new Date()) ? 'today' : ''}`, 'data-day': d.toISOString() });
      if (editable) col.addEventListener('dblclick', e => {
        if (e.target !== col) return;
        const m = Math.round((startM + (e.offsetY / HOUR_PX) * 60) / 30) * 30;
        const s = new Date(d); s.setHours(0, m, 0, 0);
        eventDialog({ kind: 'scrim', starts_at: s.toISOString() });
      });
      // time off blocks
      for (const iv of intervals) {
        const s = Math.max(iv.s, d.getTime()), e = Math.min(iv.e, d.getTime() + DAY);
        if (e <= s) continue;
        const sm = Math.max(startM, minsOf(s)), em = Math.min(endM, e >= d.getTime() + DAY ? 24 * 60 : minsOf(e));
        if (em <= sm) continue;
        col.append(h('div', { class: 'wk-off', style: { top: `${y(sm)}px`, height: `${y(em) - y(sm)}px` }, 'data-tip': `${pname(iv.player_id)} off${iv.reason ? ` · ${iv.reason}` : ''}${iv.repeat === 'weekly' ? ' (weekly)' : ''}` }, h('span', {}, pname(iv.player_id))));
      }
      // events
      for (const ev of events.filter(e => sameDay(new Date(e.starts_at), d))) {
        const sm = Math.max(startM, minsOf(ev.starts_at));
        const em = Math.min(endM, sameDay(new Date(ev.ends_at), d) ? minsOf(ev.ends_at) : 24 * 60);
        const block = h('div', {
          class: `wk-ev k-${ev.kind} st-${ev.status}`, style: { top: `${y(sm)}px`, height: `${Math.max(22, y(em) - y(sm))}px`, '--ec': eventColor(ev, cfg) },
          tabindex: 0, 'aria-label': `${label(ev)}, ${fmtD(ev.starts_at)} ${fmtT(ev.starts_at)}`,
        },
        h('div', { class: 'ev-time' }, `${fmtT(ev.starts_at)} – ${fmtT(ev.ends_at)}`),
        h('div', { class: 'ev-title' }, label(ev)),
        ev.history?.length ? h('div', { class: 'ev-moved', 'data-tip': ev.history.map(x => `Moved from ${fmtD(x.from)} ${fmtT(x.from)}`).join('\n') }, 'Rescheduled') : null,
        badgeFor(ev, intervals));
        block.addEventListener('keydown', e => { if (e.key === 'Enter') eventDialog(ev); });
        dragWeek(block, ev, () => grid, days, startM, endM);
        col.append(block);
      }
      return col;
    });
    grid.append(...cols);
    const hours = h('div', { class: 'wk-hours', style: { height: `${height}px` } },
      Array.from({ length: (endM - startM) / 60 }, (_, i) => h('div', { class: 'wk-hour', style: { top: `${i * HOUR_PX}px` } }, new Date(2000, 0, 1, (startM / 60) + i).toLocaleTimeString(undefined, { hour: 'numeric' }))));
    return h('div', { class: 'wk' },
      h('div', { class: 'wk-head' }, h('div'), days.map(d => h('div', { class: `wk-day ${sameDay(d, new Date()) ? 'today' : ''}` },
        h('span', {}, d.toLocaleDateString(undefined, { weekday: 'short' })), h('strong', {}, d.getDate()),
        outCount(d)))),
      h('div', { class: 'wk-scroll' }, h('div', { class: 'wk-body' }, hours, grid)),
      editable ? h('p', { class: 'hint' }, 'Drag a block to reschedule. Double-click an empty spot to add a scrim. Click a block to edit.') : null);
  }

  function outCount(d) {
    const ivs = expandTimeOff(data.timeoff, d.toISOString(), addDays(d, 1).toISOString());
    const who = [...new Set(ivs.map(i => i.player_id))];
    return who.length ? h('em', { class: 'day-out', 'data-tip': `Time off: ${who.map(pname).join(', ')}` }, `${who.length} off`) : null;
  }

  /** Pointer-based drag (mouse + touch) in week view, snapping to 15 minutes. */
  function dragWeek(block, ev, gridOf, days, startM, endM) {
    let sx, sy, moved = false, pointer = null;
    block.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      sx = e.clientX; sy = e.clientY; moved = false; pointer = e.pointerId;
      block.setPointerCapture(pointer);
    });
    block.addEventListener('pointermove', e => {
      if (pointer !== e.pointerId || !editable) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true; block.classList.add('dragging');
      block.style.transform = `translate(${dx}px, ${Math.round(dy / (HOUR_PX / 4)) * (HOUR_PX / 4)}px)`;
    });
    block.addEventListener('pointerup', async e => {
      if (pointer !== e.pointerId) return;
      block.releasePointerCapture(pointer); pointer = null;
      if (!moved) return eventDialog(ev);
      block.classList.remove('dragging'); block.style.transform = '';
      const grid = gridOf().getBoundingClientRect();
      const colW = grid.width / 7;
      const di = Math.max(0, Math.min(6, Math.floor((e.clientX - grid.left) / colW)));
      const blockTop = parseFloat(block.style.top) + (e.clientY - sy);
      let m = startM + Math.round(((blockTop / HOUR_PX) * 60) / SNAP) * SNAP;
      m = Math.max(0, Math.min(24 * 60 - SNAP, m));
      const s = new Date(days[di]); s.setHours(0, m, 0, 0);
      await reschedule(ev, s.toISOString());
    });
  }

  // ---------- month ----------
  function monthView(events, intervals) {
    const [from] = rangeFor();
    const cells = Array.from({ length: 42 }, (_, i) => addDays(from, i));
    return h('div', { class: 'mo' },
      h('div', { class: 'mo-head' }, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => h('div', {}, d))),
      h('div', { class: 'mo-grid' }, cells.map(d => {
        const inMonth = d.getMonth() === anchor.getMonth();
        const cell = h('div', {
          class: `mo-cell ${inMonth ? '' : 'dim'} ${sameDay(d, new Date()) ? 'today' : ''}`,
          ondragover: e => { if (editable) { e.preventDefault(); cell.classList.add('over'); } },
          ondragleave: () => cell.classList.remove('over'),
          ondrop: async e => {
            e.preventDefault(); cell.classList.remove('over');
            const ev = data.events.find(x => x.id === e.dataTransfer.getData('text/plain'));
            if (!ev) return;
            const s = new Date(d); const o = new Date(ev.starts_at); s.setHours(o.getHours(), o.getMinutes(), 0, 0);
            await reschedule(ev, s.toISOString());
          },
        },
        h('div', { class: 'mo-date' }, h('button', { class: 'link', onclick: () => { view = 'week'; anchor = startOfWeek(d); paint(); } }, d.getDate()), outCount(d)),
        events.filter(e => sameDay(new Date(e.starts_at), d)).map(ev => h('div', {
          class: `mo-ev st-${ev.status}`, style: { '--ec': eventColor(ev, cfg) }, draggable: editable ? 'true' : null,
          ondragstart: e => e.dataTransfer.setData('text/plain', ev.id), onclick: () => eventDialog(ev),
        }, h('b', {}, fmtT(ev.starts_at)), ' ', label(ev), badgeFor(ev, intervals))));
        return cell;
      })),
      editable ? h('p', { class: 'hint' }, 'Drag an event to another day to reschedule (keeps the same time). Click a date to open its week.') : null);
  }

  // ---------- list ----------
  function listView(events, intervals) {
    const now = Date.now();
    const upcoming = events.filter(e => new Date(e.ends_at).getTime() >= now);
    const past = events.filter(e => new Date(e.ends_at).getTime() < now).reverse();
    const row = ev => h('div', { class: `ls-row st-${ev.status}`, style: { '--ec': eventColor(ev, cfg) }, onclick: () => eventDialog(ev) },
      h('span', { class: 'ls-bar' }),
      h('span', { class: 'ls-when' }, h('strong', {}, fmtD(ev.starts_at)), h('span', { class: 'muted small' }, `${fmtT(ev.starts_at)} – ${fmtT(ev.ends_at)}`)),
      h('span', { class: 'ls-what' }, h('strong', {}, label(ev)),
        h('span', { class: 'muted small' }, [KINDS.find(k => k.id === ev.kind)?.label, ev.status !== 'scheduled' ? ev.status : null, ev.history?.length ? `moved ${ev.history.length}×` : null].filter(Boolean).join(' · '))),
      badgeFor(ev, intervals) || h('span'),
      ev.status !== 'cancelled' && new Date(ev.ends_at).getTime() < now && !ev.match_id && editable
        ? h('button', { class: 'btn btn-sm', onclick: e => { e.stopPropagation(); logResult(ev); } }, 'Log result') : h('span'));
    return h('div', { class: 'stack-sm' },
      h('div', { class: 'eyebrow' }, `Upcoming (${upcoming.length})`),
      upcoming.length ? h('div', { class: 'ls' }, upcoming.map(row)) : h('div', { class: 'empty-sm' }, 'Nothing scheduled.'),
      past.length ? h('div', { class: 'eyebrow' }, 'Last two weeks') : null,
      past.length ? h('div', { class: 'ls' }, past.map(row)) : null);
  }

  function logResult(ev) {
    sessionStorage.setItem('kf-prefill', JSON.stringify({ type: ev.kind === 'practice' ? 'scrim' : ev.kind, opponent: ev.opponent || '', played_on: dateInput(ev.starts_at), sched_id: ev.id }));
    go(teamPath('match/new'));
  }

  // ---------- time off list ----------
  function timeOffList() {
    const now = Date.now();
    const rows = data.timeoff.filter(t => t.repeat === 'weekly' ? (!t.until || new Date(t.until).getTime() + DAY > now) : new Date(t.ends_at).getTime() > now)
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    return h('section', { class: 'block' },
      h('div', { class: 'block-head' }, h('h2', {}, 'Time off'), h('span', { class: 'muted small' }, 'Players add when they can’t play. Weekly blocks repeat (work, school).')),
      rows.length ? h('div', { class: 'ls' }, rows.map(t => h('div', { class: 'ls-row to-row' },
        h('span', { class: 'ls-bar off' }),
        h('strong', {}, pname(t.player_id)),
        h('span', {}, t.repeat === 'weekly'
          ? `Every ${new Date(t.starts_at).toLocaleDateString(undefined, { weekday: 'long' })} ${fmtT(t.starts_at)} – ${fmtT(t.ends_at)}${t.until ? ` until ${fmtD(t.until)}` : ''}`
          : `${fmtD(t.starts_at)} ${fmtT(t.starts_at)} → ${fmtD(t.ends_at)} ${fmtT(t.ends_at)}`),
        h('span', { class: 'muted small' }, t.reason || ''),
        editable ? h('div', { class: 'row' },
          h('button', { class: 'btn btn-sm btn-ghost', onclick: () => timeOffDialog(t) }, 'Edit'),
          h('button', { class: 'icon-btn', 'aria-label': 'Delete time off', onclick: async () => { await state.store.deleteTimeOff(t.id); await reload(); } }, '✕')) : null)))
        : h('div', { class: 'empty-sm' }, 'No upcoming time off.'));
  }

  // ---------- leagues & colors (owner) ----------
  function leagueSettings() {
    const leagues = cfg.leagues.map(l => ({ ...l }));
    const scrim = h('input', { type: 'color', class: 'in-color', value: cfg.scrim_color });
    const practice = h('input', { type: 'color', class: 'in-color', value: cfg.practice_color });
    const list = h('div', { class: 'stack-sm' });
    const drawList = () => clear(list).append(...leagues.map((l, i) => h('div', { class: 'row' },
      h('input', { type: 'color', class: 'in-color', value: l.color, oninput: e => { l.color = e.target.value; } }),
      h('input', { value: l.name, style: { maxWidth: '260px' }, oninput: e => { l.name = e.target.value; } }),
      h('button', { class: 'icon-btn', 'aria-label': 'Remove league', onclick: () => { leagues.splice(i, 1); drawList(); } }, '✕'))),
    h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { leagues.push({ id: `lg-${Math.random().toString(36).slice(2, 8)}`, name: 'New league', color: LEAGUE_PALETTE[leagues.length % LEAGUE_PALETTE.length] }); drawList(); } }, '＋ League'));
    drawList();
    return h('details', { class: 'block sched-settings' },
      h('summary', {}, 'Leagues and colors'),
      h('div', { class: 'grid-2 gap-lg' },
        h('div', { class: 'stack-sm' }, h('label', { class: 'inline' }, scrim, 'Scrims'), h('label', { class: 'inline' }, practice, 'Practice / VOD review')),
        h('div', {}, h('div', { class: 'small muted' }, 'Leagues (each gets its own color)'), list)),
      h('div', {}, h('button', {
        class: 'btn btn-primary', onclick: async () => {
          const next = { ...cfg, scrim_color: scrim.value, practice_color: practice.value, leagues: leagues.filter(l => l.name.trim()) };
          await state.store.updateTeam(state.team.id, { schedule_cfg: next });
          state.team.schedule_cfg = next; cfg = scheduleCfg(state.team); await refreshTeams(); toast('Colors saved', 'success'); paint();
        },
      }, 'Save colors')));
  }

  // ---------- dialogs ----------
  async function eventDialog(ev0) {
    const ev = { kind: 'scrim', status: 'scheduled', ...ev0 };
    const start = ev.starts_at ? new Date(ev.starts_at) : (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(19, 0, 0, 0); return d; })();
    const dur = ev.ends_at ? (new Date(ev.ends_at) - new Date(ev.starts_at)) / 60000 : (ev.kind === 'scrim' ? 120 : 90);
    const kind = h('select', {}, KINDS.map(k => h('option', { value: k.id, selected: ev.kind === k.id }, k.label)));
    const league = h('select', {}, cfg.leagues.map(l => h('option', { value: l.id, selected: ev.league_id === l.id }, l.name)));
    const leagueWrap = h('label', {}, 'League', league);
    const opp = h('input', { value: ev.opponent || '', placeholder: 'Team name', list: 'dl-sched-opp' });
    const date = h('input', { type: 'date', value: dateInput(start) });
    const time = h('input', { type: 'time', value: timeInput(start), step: 900 });
    const len = h('select', {}, [60, 90, 120, 150, 180, 240].map(m => h('option', { value: m, selected: Math.round(dur) === m }, `${m / 60} h`)));
    const status = h('select', {}, [['scheduled', 'Scheduled'], ['confirmed', 'Confirmed'], ['cancelled', 'Cancelled'], ['done', 'Played']].map(([v, l]) => h('option', { value: v, selected: ev.status === v }, l)));
    const notes = h('textarea', { rows: 2, placeholder: 'Lobby info, rules, who hosts…' }, ev.notes || '');
    const avail = h('div', { class: 'avail' });
    const opps = [...new Set([...state.data.matches.map(m => m.opponent), ...data.events.map(e => e.opponent)].filter(Boolean))];
    const sync = () => {
      leagueWrap.style.display = ['match', 'tournament'].includes(kind.value) ? '' : 'none';
      const s = combine(date.value, time.value), e = new Date(s.getTime() + (+len.value) * 60000);
      const iv = expandTimeOff(data.timeoff, s.toISOString(), e.toISOString());
      const out = eventConflicts({ starts_at: s.toISOString(), ends_at: e.toISOString() }, iv);
      const dbl = overlapsWith({ id: ev.id, starts_at: s.toISOString(), ends_at: e.toISOString() }, data.events);
      clear(avail).append(...[
        h('div', { class: out.size ? 'warn' : 'ok' }, out.size ? `Out: ${[...out].map(pname).join(', ')}` : `Everyone available (${roster().length} players)`),
        dbl.length ? h('div', { class: 'warn' }, `Overlaps with ${dbl.map(label).join(', ')}`) : null].filter(Boolean));
    };
    [kind, date, time, len].forEach(x => x.addEventListener('change', sync));
    sync();
    const body = h('div', { class: 'stack-sm' },
      h('datalist', { id: 'dl-sched-opp' }, opps.map(o => h('option', { value: o }))),
      h('div', { class: 'grid-2' }, h('label', {}, 'Type', kind), leagueWrap),
      h('label', {}, 'Opponent', opp),
      h('div', { class: 'grid-3' }, h('label', {}, 'Date', date), h('label', {}, 'Start', time), h('label', {}, 'Length', len)),
      avail,
      ev.id ? h('label', {}, 'Status', status) : null,
      h('label', {}, 'Notes', notes),
      ev.history?.length ? h('div', { class: 'small muted' }, ev.history.map(x => h('div', {}, `Moved from ${fmtD(x.from)} ${fmtT(x.from)} → ${fmtD(x.to)} ${fmtT(x.to)}`))) : null);
    const actions = editable ? [
      ...(ev.id ? [{ label: 'Delete', value: 'delete', class: 'btn-ghost btn-danger-text' }] : []),
      ...(ev.id && new Date(ev.ends_at) < new Date() && !ev.match_id ? [{ label: 'Log result', value: 'log' }] : []),
      { label: 'Cancel', value: null },
      { label: ev.id ? 'Save' : 'Add to schedule', value: 'save', class: 'btn-primary' },
    ] : [{ label: 'Close', value: null }];
    const res = await modal(ev.id ? 'Edit' : `New ${KINDS.find(k => k.id === ev.kind)?.label.toLowerCase()}`, body, actions);
    if (res === 'delete') { if (await confirmDialog('Delete this from the schedule?')) { await state.store.deleteScheduleEvent(ev.id); await reload(); } return; }
    if (res === 'log') return logResult(ev);
    if (res !== 'save') return;
    const s = combine(date.value, time.value);
    const next = {
      ...ev, kind: kind.value, league_id: ['match', 'tournament'].includes(kind.value) ? league.value : null,
      opponent: opp.value.trim() || null, notes: notes.value.trim() || null, status: ev.id ? status.value : 'scheduled',
      starts_at: s.toISOString(), ends_at: new Date(s.getTime() + (+len.value) * 60000).toISOString(),
    };
    if (ev.id && ev.starts_at && new Date(ev.starts_at).getTime() !== s.getTime()) next.history = [...(ev.history || []), { from: ev.starts_at, to: next.starts_at, at: new Date().toISOString() }];
    await saveEvent(next, ev.id ? 'Saved' : 'Added to schedule');
  }

  async function timeOffDialog(t0 = null) {
    if (!roster().length) return toast('Add your roster first (Team settings)', 'error');
    const t = t0 || {};
    const s0 = t.starts_at ? new Date(t.starts_at) : (() => { const d = new Date(); d.setHours(18, 0, 0, 0); return d; })();
    const e0 = t.ends_at ? new Date(t.ends_at) : new Date(s0.getTime() + 3 * 3600000);
    const who = h('select', {}, roster().map(p => h('option', { value: p.id, selected: t.player_id === p.id }, p.gamertag)));
    const allDay = h('input', { type: 'checkbox', checked: !!t.all_day });
    const sd = h('input', { type: 'date', value: dateInput(s0) }), st = h('input', { type: 'time', value: timeInput(s0), step: 900 });
    const ed = h('input', { type: 'date', value: dateInput(e0) }), et = h('input', { type: 'time', value: timeInput(e0), step: 900 });
    const weekly = h('input', { type: 'checkbox', checked: t.repeat === 'weekly' });
    const until = h('input', { type: 'date', value: t.until || '' });
    const reason = h('input', { value: t.reason || '', placeholder: 'Work, school, travel… (optional)' });
    const sync = () => { st.disabled = et.disabled = allDay.checked; until.disabled = !weekly.checked; };
    allDay.onchange = sync; weekly.onchange = sync; sync();
    const body = h('div', { class: 'stack-sm' },
      h('label', {}, 'Player', who),
      h('label', { class: 'check' }, allDay, 'All day'),
      h('div', { class: 'grid-2' }, h('label', {}, 'From', h('div', { class: 'row' }, sd, st)), h('label', {}, 'To', h('div', { class: 'row' }, ed, et))),
      h('div', { class: 'row' }, h('label', { class: 'check' }, weekly, 'Repeats every week'), h('label', { class: 'inline' }, 'until', until)),
      h('label', {}, 'Reason', reason));
    const res = await modal(t.id ? 'Edit time off' : 'Add time off', body, [{ label: 'Cancel', value: null }, { label: 'Save', value: 'save', class: 'btn-primary' }]);
    if (res !== 'save') return;
    let s = allDay.checked ? combine(sd.value, '00:00') : combine(sd.value, st.value);
    let e = allDay.checked ? addDays(combine(ed.value, '00:00'), 1) : combine(ed.value, et.value);
    if (e <= s) return toast('End must be after start', 'error');
    await state.store.saveTimeOff(state.team.id, {
      ...t, player_id: who.value, starts_at: s.toISOString(), ends_at: e.toISOString(), all_day: undefined,
      repeat: weekly.checked ? 'weekly' : 'none', until: weekly.checked && until.value ? until.value : null, reason: reason.value.trim() || null,
    });
    toast('Time off saved', 'success'); await reload();
  }

  async function finder() {
    const players = roster();
    if (!players.length) return toast('Add your roster first (Team settings)', 'error');
    const days = h('select', {}, [[7, 'Next 7 days'], [14, 'Next 14 days'], [30, 'Next 30 days']].map(([v, l]) => h('option', { value: v, selected: v === 14 }, l)));
    const len = h('select', {}, [60, 90, 120, 150, 180].map(m => h('option', { value: m, selected: m === 120 }, `${m / 60} h`)));
    const from = h('input', { type: 'time', value: '18:00', step: 1800 }), to = h('input', { type: 'time', value: '23:00', step: 1800 });
    const need = h('select', {}, players.map((_, i) => players.length - i).filter(n => n >= Math.min(4, players.length)).map(n => h('option', { value: n }, n === players.length ? `All ${n} players` : `At least ${n} of ${players.length}`)));
    const results = h('div', { class: 'slots' });
    const run = () => {
      const now = new Date();
      const [fh, fm] = from.value.split(':').map(Number), [th, tm] = to.value.split(':').map(Number);
      const slots = findSlots({
        from: now.toISOString(), to: addDays(now, +days.value).toISOString(), now: now.toISOString(),
        durationMin: +len.value, dayStartMin: fh * 60 + fm, dayEndMin: th * 60 + tm, stepMin: 30,
        minPlayers: +need.value, players: players.map(p => p.id), events: data.events, timeoff: data.timeoff,
      });
      const ranges = mergeSlots(slots, +len.value).slice(0, 12);
      clear(results).append(...(ranges.length ? ranges.map(r => h('div', { class: 'slot' },
        h('div', {}, h('strong', {}, fmtD(r.start)),
          h('span', { class: 'muted small' }, ` start ${fmtT(r.start)}${r.lastStart !== r.start ? ` – ${fmtT(r.lastStart)}` : ''}`)),
        h('span', { class: r.out.length ? 'warn small' : 'ok small' }, r.out.length ? `${r.free.length}/${players.length} · out: ${r.out.map(pname).join(', ')}` : `All ${players.length} free`),
        editable ? h('button', { class: 'btn btn-sm', onclick: () => { document.querySelector('.modal-overlay .modal-head .icon-btn')?.click(); eventDialog({ kind: 'scrim', starts_at: r.start, ends_at: r.end }); } }, 'Schedule') : null))
        : [h('div', { class: 'empty-sm' }, 'No time works with these settings. Try a longer range, a wider window or fewer players.')]));
    };
    [days, len, from, to, need].forEach(x => x.addEventListener('change', run));
    const body = h('div', { class: 'stack-sm' },
      h('div', { class: 'grid-3' }, h('label', {}, 'When', days), h('label', {}, 'Length', len), h('label', {}, 'Players needed', need)),
      h('div', { class: 'grid-2' }, h('label', {}, 'Earliest start', from), h('label', {}, 'Latest finish', to)),
      h('p', { class: 'hint' }, 'Skips times that clash with something already scheduled. Best options first: most players free, then soonest.'),
      results);
    run();
    modal('Find a time', body, []);
  }

  paint();
  return root;
}
