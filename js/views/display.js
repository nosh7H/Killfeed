// Venue TV / stream display. Full-screen scenes that rotate every N seconds and update live.
// URL: #/display/<eventId>?t=20&scene=bracket&bg=transparent
import { h, clear, fmtTime, fmtNum } from '../ui.js';
import { ev, loadEvent, watchEvent, teamName, teamTag, bracketMatches, teamBadge, spotOf, reportTo, estText, finalDayRole, finalDayName } from '../event-state.js';
import { roundName, liveMap, gamesByMatch, seriesResult, categoryLeaders, hasAdvanced, teamSession } from '../event-logic.js';
import { allStandings, bracketView, leaderRows, teamRows, queueRows, awardsGrid } from './event-parts.js';
import { applyAccent, applyFont } from '../theme.js';
import { shortMode } from './event.js';
import { vetoSeriesList, vetoBanner } from './veto.js';
import { mapStates } from '../veto.js';

const SCENE_TITLES = { seating: 'Seating', live: 'Live now', groups: 'Group stage', teams: 'Team stats', bracket: 'Playoff bracket', 'bracket:upper': 'Upper bracket', 'bracket:lower': 'Lower bracket', queue: 'Live and up next', veto: 'Map veto', awards: 'Awards' };

export async function displayView(eventId, params) {
  document.body.classList.add('display-mode');
  if (params.get('bg') === 'transparent') document.body.classList.add('display-transparent');
  const event = await loadEvent(eventId, { force: true });
  if (!event) return h('div', { class: 'empty' }, 'Event not found or not public.');
  applyAccent(event.accent);
  applyFont(event.settings?.display?.font || 'mix');

  const screen = h('div', { class: 'd-screen' });
  const tickerSlot = h('div', { class: 'd-ticker-slot' });
  const progress = h('div', { class: 'd-progress' });
  const stage = h('div', { class: 'd-stage' }, screen, tickerSlot, progress);
  const viewport = h('div', { class: 'd-viewport' }, stage);
  let idx = 0, timer = null, started = Date.now();

  const fit = () => {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  };
  addEventListener('resize', fit);

  const scenes = () => {
    const pinned = params.get('scene') || ev.settings.display.pin;
    let list = pinned ? [pinned] : ev.settings.display.scenes;
    // skip K/D screens for modes with no data yet so the loop never shows empty boards
    list = list.filter(sc => !sc.startsWith('kd:') || leaderRows(sc.slice(3)).length);
    // big double-elim brackets (more than 8 teams) get one screen per half so they stay readable
    const bm = bracketMatches();
    const big = bm.some(m => m.stage === 'lower') && bm.filter(m => m.stage === 'upper' && m.round === 1).length > 4;
    if (big) list = list.flatMap(sc => (sc === 'bracket' ? ['bracket:upper', 'bracket:lower'] : [sc]));
    return list.length ? list : ['groups'];
  };
  const seconds = () => Math.max(5, Number(params.get('t')) || ev.settings.display.seconds || 20);

  function render(animate) {
    const list = scenes();
    if (idx >= list.length) idx = 0;
    const sc = list[idx];
    const curSes = ev.settings.seating.current && ev.settings.seating.sessions?.find(x => x.id === ev.settings.seating.current);
    const title = sc.startsWith('kd:') ? `K/D leaders · ${sc.slice(3)}` : sc === 'seating' && bracketSeatingOn() ? 'Seating · Playoffs' : sc === 'seating' && curSes ? `Seating · ${curSes.name}` : SCENE_TITLES[sc] || sc;
    const d = ev.settings.display;
    const paused = d.paused && !params.get('scene');
    const tk = d.ticker !== false || sc === 'live' ? ticker() : null;
    clear(screen).append(...[
      h('header', { class: 'd-head' },
        h('div', { class: 'd-brand' }, h('span', { class: 'd-mark' }), ev.event.name),
        h('div', { class: 'd-title' }, title),
        h('div', { class: 'd-dots' }, list.map((_, i) => h('span', { class: i === idx ? 'on' : '' })))),
      d.announce?.text ? h('div', { class: 'd-announce' }, h('span', { class: 'd-announce-tag' }, 'Notice'), d.announce.text) : null,
      h('div', { class: `d-body ${animate ? 'enter' : ''}` }, h('div', { class: 'd-fit' }, scene(sc)))].filter(Boolean));
    // the ticker element is kept between renders so its scroll never restarts
    if (tk) { if (tickerSlot.firstChild !== tk) clear(tickerSlot).append(tk); } else clear(tickerSlot);
    clear(progress).append(...(paused || list.length < 2 ? [] : [h('div', { class: 'd-progress-fill', style: { animationDuration: `${seconds()}s`, animationDelay: `-${(Date.now() - started) / 1000}s` } })]));
    requestAnimationFrame(fitScene);
  }

  // Shrink a scene that is bigger than the screen (e.g. a 16-team double-elim bracket)
  function fitScene() {
    const body = stage.querySelector('.d-body'), inner = stage.querySelector('.d-fit');
    if (!body || !inner) return;
    inner.style.transform = '';
    const availW = body.clientWidth - 144, availH = body.clientHeight - 80;
    const s = Math.min(1, availW / inner.scrollWidth, availH / inner.scrollHeight);
    if (s < 1) inner.style.transform = `scale(${s})`;
  }

  function next() {
    idx++;
    started = Date.now();
    render(true);
    clearTimeout(timer);
    if (!(ev.settings.display.paused && !params.get('scene'))) timer = setTimeout(next, seconds() * 1000);
  }

  function scene(sc) {
    if (sc === 'groups') return h('div', { class: 'd-groups' }, allStandings({ link: false }));
    if (sc === 'bracket') return h('div', { class: 'd-bracket' }, bracketView({ link: false }));
    if (sc.startsWith('bracket:')) return h('div', { class: 'd-bracket d-bracket-half' }, bracketView({ link: false, only: sc.slice(8) }));
    if (sc === 'teams') return teamsScene();
    if (sc === 'queue') return queueScene();
    if (sc === 'live') return liveScene();
    if (sc === 'seating') return seatingScene();
    if (sc === 'veto') return vetoScene();
    if (sc === 'awards') return awardsGrid({ large: true });
    if (sc.startsWith('kd:')) return kdScene(sc.slice(3));
    return h('div');
  }

  function kdScene(mode) {
    const rows = leaderRows(mode).slice(0, 10);
    const max = Math.max(...rows.map(r => r.kd), 1);
    // caster-only columns appear once casted maps have them
    const adv = hasAdvanced(ev.data.stats);
    const dmg = ['DMG/MAP', r => (r.dmgpg == null ? '–' : fmtNum(r.dmgpg)), r => r.dmgpg];
    const extra = mode === 'Hardpoint' ? [['HILL/MAP', r => fmtTime(r.objpg), r => r.objpg], ...(adv ? [dmg] : [])]
      : mode === 'Search & Destroy' ? [['PLANTS', r => r.plants, r => r.plants], ['DEFUSES', r => r.defuses, r => r.defuses], ...(adv ? [['FB', r => r.first_bloods ?? '–', r => r.first_bloods]] : [])]
        : adv ? [dmg] : [];
    const all = leaderRows(mode);
    const top = extra.map(([, , raw]) => Math.max(0, ...all.map(r => Number(raw(r)) || 0)));
    const kMax = Math.max(0, ...all.map(r => r.kills));
    return h('div', { class: 'd-board', style: { '--cols': `80px minmax(0, 2.6fr) 1.9fr 1.2fr .8fr ${extra.map(() => '1fr').join(' ')}` } },
      h('div', { class: 'd-row d-row-head' }, h('span', {}, '#'), h('span', {}, 'Player'), h('span', {}, 'K/D'), h('span', {}, 'K–D'), h('span', {}, 'Maps'),
        ...extra.map(([l]) => h('span', {}, l))),
      rows.map((r, i) => h('div', { class: `d-row ${i === 0 ? 'top' : ''}` },
        h('span', { class: 'd-rank' }, i + 1),
        h('span', { class: 'd-player' }, r.team ? teamBadge(r.team.id, 'md') : null, r.name),
        h('span', { class: 'd-kd' }, h('b', {}, r.kd.toFixed(2)), h('i', { class: 'd-bar' }, h('i', { style: { width: `${(r.kd / max) * 100}%` } }))),
        h('span', { class: r.kills === kMax && kMax > 0 ? 'is-lead' : '' }, `${r.kills}–${r.deaths}`),
        h('span', {}, r.games),
        ...extra.map(([, f, raw], j) => h('span', { class: Number(raw(r)) > 0 && Number(raw(r)) === top[j] ? 'is-lead' : '' }, f(r) ?? '–')))),
      h('div', { class: 'd-foot' }, `Minimum ${ev.settings.display.min_games} ${mode} maps`));
  }

  function teamsScene() {
    const rows = teamRows().slice(0, 12);
    const modes = ev.settings.modes;
    const kdTop = Math.max(0, ...teamRows().map(r => r.kd || 0));
    return h('div', { class: 'd-board d-teams', style: { '--cols': `80px minmax(0, 2.6fr) 1fr 1fr .8fr .9fr ${modes.map(() => '.9fr').join(' ')}` } },
      h('div', { class: 'd-row d-row-head' }, h('span', {}, '#'), h('span', {}, 'Team'), h('span', {}, 'Series'), h('span', {}, 'Maps'), h('span', {}, '+/-'), h('span', {}, 'K/D'),
        ...modes.map(m => h('span', {}, shortMode(m)))),
      rows.map((r, i) => h('div', { class: 'd-row' },
        h('span', { class: 'd-rank' }, i + 1),
        h('span', { class: 'd-player' }, teamBadge(r.team.id, 'md'), r.team.name),
        h('span', {}, h('b', {}, `${r.sw}–${r.sl}`)),
        h('span', {}, `${r.mw}–${r.ml}`),
        h('span', {}, r.md > 0 ? `+${r.md}` : r.md),
        h('span', { class: r.kd && r.kd === kdTop ? 'is-lead' : '' }, r.kd == null ? '–' : r.kd.toFixed(2)),
        ...modes.map(m => h('span', {}, r.modes[m] ? `${r.modes[m].w}–${r.modes[m].l}` : '–')))));
  }

  function vetoScene() {
    const vs = ev.data.vetoes || [];
    const v = vs.find(x => x.id === ev.settings.display.pin_veto)
      || [...vs].sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || (b.updated_at || '').localeCompare(a.updated_at || ''))[0];
    if (!v) return h('div', { class: 'd-empty' }, 'No veto yet');
    const modes = [...new Set(v.steps.map(s => s.mode))];
    return h('div', { class: 'd-veto' },
      h('div', { class: 'd-veto-teams' }, h('span', {}, teamName(v.team_a)), h('i', {}, 'vs'), h('span', {}, teamName(v.team_b))),
      vetoBanner(v),
      h('div', { class: 'd-veto-grid' },
        vetoSeriesList(v, { large: true }),
        h('div', { class: 'd-veto-pools' }, modes.map(mode => h('div', { class: 'd-pool' },
          h('div', { class: 'd-pool-mode' }, mode),
          h('div', { class: 'd-pool-maps' }, mapStates(v, mode).map(ms => h('span', { class: `d-pm ${ms.state}` }, ms.map))))))));
  }

  function queueScene() {
    const rows = queueRows(10);
    const bm = ev.data.matches.filter(m => m.stage !== 'group');
    if (!rows.length) return h('div', { class: 'd-empty' }, 'No matches waiting');
    return h('div', { class: 'd-queue' }, rows.map(m => {
      const r = ev.resolved.get(m.id);
      return h('div', { class: `d-q q-${m.status}` },
        h('span', { class: 'd-q-station' }, spotOf(m)?.label || '—'),
        h('span', { class: 'd-q-teams' }, teamName(r.A), h('i', {}, 'vs'), teamName(r.B)),
        h('span', { class: 'd-q-round' }, roundName(m, bm)),
        h('span', { class: 'd-q-status' }, m.status === 'scheduled' && estText(m) && estText(m) !== 'Now' ? estText(m) : { live: 'Live', ondeck: 'On deck', scheduled: 'Up next' }[m.status] || ''));
    }));
  }

  // ---------- Seating chart: which row each team sits at, per session ----------
  // once the group stage is over and bracket matches are on rows, the seating screen shows the bracket rows
  function bracketSeatingOn() {
    const g = ev.data.matches.filter(m => m.stage === 'group');
    return g.length > 0 && g.every(m => m.status === 'final' || ev.resolved.get(m.id)?.result?.done) && ev.data.matches.some(m => m.stage !== 'group' && (m.row_a != null || m.row_b != null || m.station) && m.status !== 'final');
  }
  function bracketSeating() {
    const seat = ev.settings.seating;
    const n = Math.max(1, seat.group_rows || 8);
    const label = seat.label || 'Row';
    const bm = ev.data.matches.filter(m => m.stage !== 'group');
    const open = [...bm.filter(m => m.status === 'live'), ...queueRows(40).filter(m => m.stage !== 'group' && m.status !== 'live')];
    // each row: the team sitting there now (live), else the next team due there
    const at = new Map();
    for (const m of open) {
      const r = ev.resolved.get(m.id) || {};
      [[m.row_a, r.A, r.B, m.row_b], [m.row_b, r.B, r.A, m.row_a]].forEach(([row, team, opp, oppRow]) => {
        if (row == null || at.has(Number(row))) return;
        at.set(Number(row), { m, team, opp, oppRow });
      });
    }
    const tag = m => (m.status === 'live' ? h('em', { class: 'd-seat-live' }, 'Live') : h('em', { class: 'd-seat-next' }, m.status === 'ondeck' ? 'On deck' : 'Next'));
    const half = Math.ceil(n / 2);
    const col = (from, to) => h('div', { class: 'd-seat-col' },
      h('div', { class: 'd-seat-rows', style: { '--n': half } }, Array.from({ length: to - from + 1 }, (_, i) => {
        const row = from + i;
        const x = at.get(row);
        return h('div', { class: `d-seat-row ${x ? '' : 'is-empty'}` },
          h('span', { class: 'd-seat-n' }, h('small', {}, label), row),
          h('span', { class: 'd-seat-teams' }, x ? [
            h('span', { class: 'd-seat-team' }, teamBadge(x.team, 'md'), h('span', { class: 'd-seat-name' }, teamName(x.team) || 'TBD'), tag(x.m)),
            h('span', { class: 'd-seat-vs' }, `vs ${teamName(x.opp) || 'TBD'}${x.oppRow != null ? ` · ${label} ${x.oppRow}` : ''} · ${roundName(x.m, bm)}`),
          ] : h('span', { class: 'd-seat-free' }, '—')));
      })));
    return h('div', { class: `d-seat ${n > 6 ? 'n2' : 'n1'}` }, n > 6 ? [col(1, half), col(half + 1, n)] : col(1, n));
  }

  function seatingScene() {
    if (bracketSeatingOn()) return bracketSeating();
    const seat = ev.settings.seating;
    const n = Math.max(1, seat.group_rows || 8);
    const label = seat.label || 'Row';
    const planned = Object.keys(seat.plan || {}).length > 0;
    let sessions = planned ? (seat.sessions || []) : [null];
    if (planned && seat.current && sessions.some(x => x.id === seat.current)) sessions = sessions.filter(x => x.id === seat.current);
    const liveTeams = new Set(ev.data.matches.filter(m => m.status === 'live' && m.stage === 'group').flatMap(m => [ev.resolved.get(m.id)?.A, ev.resolved.get(m.id)?.B]));
    const gIdx = g => 'ABCDEFGH'.indexOf(g) % 8;
    if (!ev.data.teams.some(t => t.row_no != null)) return h('div', { class: 'd-empty' }, 'Seating is posted soon');
    const col = x => {
      const mine = ev.data.teams.filter(t => !x || teamSession(t, seat)?.id === x.id);
      const groups = [...new Set(mine.map(t => t.group_label).filter(Boolean))].sort();
      return h('div', { class: 'd-seat-col' },
        sessions.length > 1 || x ? h('div', { class: 'd-seat-head' }, h('b', {}, x ? x.name : 'Seating'), groups.length ? h('span', {}, `Group${groups.length > 1 ? 's' : ''} ${groups.join(' · ')}`) : null) : null,
        h('div', { class: 'd-seat-rows', style: { '--n': n } }, Array.from({ length: n }, (_, i) => {
          const row = i + 1;
          const here = mine.filter(t => t.row_no === row);
          return h('div', { class: `d-seat-row ${here.length ? '' : 'is-empty'}` },
            h('span', { class: 'd-seat-n' }, h('small', {}, label), row),
            h('span', { class: 'd-seat-teams' }, here.length ? here.map(t => h('span', { class: 'd-seat-team' },
              teamBadge(t.id, sessions.length > 1 ? 'md' : 'lg'), h('span', { class: 'd-seat-name' }, t.name),
              t.group_label ? h('i', { class: 'd-seat-g', style: { '--gc': `var(--g${gIdx(t.group_label)})` } }, t.group_label) : null,
              liveTeams.has(t.id) ? h('em', { class: 'd-seat-live' }, 'Live') : null)) : h('span', { class: 'd-seat-free' }, '—')));
        })));
    };
    return h('div', { class: `d-seat n${sessions.length}` }, sessions.map(col));
  }

  // ---------- Live scene: every live match with its running score, then who's up next ----------
  function liveScene() {
    const all = queueRows(16);
    const live = all.filter(m => m.status === 'live');
    const next = all.filter(m => m.status !== 'live').slice(0, live.length > 2 ? 3 : 5);
    const gbm = gamesByMatch(ev.data.games);
    const bm = ev.data.matches.filter(m => m.stage !== 'group');
    if (!live.length && !next.length) return h('div', { class: 'd-empty' }, 'No matches right now');
    const card = m => {
      const r = ev.resolved.get(m.id);
      const games = gbm.get(m.id) || [];
      const res = seriesResult(m, games);
      const lm = liveMap(m, games, ev.settings);
      // series map count (no running score during a map)
      const lead = res.a > res.b ? 'a' : res.b > res.a ? 'b' : null;
      const side = (key, id) => h('div', { class: `d-lv-team ${lead === key ? 'lead' : lead ? 'trail' : ''}` },
        teamBadge(id, 'lg'),
        h('span', { class: 'd-lv-name' }, teamName(id)),
        h('span', { class: 'd-lv-pts', 'aria-label': 'Maps won' }, res[key]));
      const q = finalDayRole(m) === 'qualifies';
      return h('div', { class: `d-lv-card ${q ? 'q-sun' : ''}` },
        h('div', { class: 'd-lv-meta' }, h('span', { class: 'd-lv-live' }, h('i'), 'Live'), h('span', {}, spotOf(m)?.label || ''), h('span', { class: 'muted' }, roundName(m, bm)),
          q ? h('span', { class: 'd-sun' }, `Winner → ${finalDayName()}`) : finalDayRole(m) === 'both' ? h('span', { class: 'd-sun' }, `Both → ${finalDayName()}`) : null),
        side('a', r.A), side('b', r.B),
        h('div', { class: 'd-lv-map' }, h('b', {}, `Map ${lm.game_no} in progress`), [lm.mode, lm.map].filter(Boolean).join(' · ') || '', h('span', { class: 'muted' }, ` · Bo${m.best_of}`)));
    };
    return h('div', { class: `d-live n${Math.min(live.length, 4)}` },
      live.length ? h('div', { class: 'd-lv-grid' }, live.slice(0, 4).map(card)) : null,
      next.length ? h('div', { class: 'd-lv-next' },
        h('div', { class: 'd-lv-next-title' }, live.length ? 'Up next' : 'Next matches'),
        next.map(m => {
          const r = ev.resolved.get(m.id);
          return h('div', { class: `d-lv-row q-${m.status} ${finalDayRole(m) === 'qualifies' ? 'q-sun' : ''}` },
            h('span', { class: 'd-lv-status' }, m.status === 'ondeck' ? 'On deck' : estText(m) && estText(m) !== 'Now' ? h('span', { class: 'd-est' }, estText(m)) : 'Up next'),
            h('span', { class: 'd-lv-vs' }, teamBadge(r.A, 'md'), teamName(r.A), h('i', {}, 'vs'), teamBadge(r.B, 'md'), teamName(r.B)),
            h('span', { class: 'd-lv-where' }, reportTo(m) || roundName(m, bm)));
        })) : null);
  }

  // ---------- bottom bar: live scores, up next, then scrolling category leaders ----------
  // Built once and updated in place so the scroll doesn't jump when a score changes.
  let tickerEl = null, tickerKey = '';
  function ticker() {
    const rows = queueRows(12);
    const gbm = gamesByMatch(ev.data.games);
    const live = rows.filter(m => m.status === 'live');
    const upcoming = rows.filter(m => m.status !== 'live').slice(0, 3);
    const items = [];
    for (const m of live) {
      const r = ev.resolved.get(m.id);
      const games = gbm.get(m.id) || [];
      const res = seriesResult(m, games);
      const lm = liveMap(m, games, ev.settings);
      items.push({ k: `L${m.id}`, cls: 'live', label: 'Live', text: `${teamTag(r.A)} ${res.a}–${res.b} ${teamTag(r.B)}`, sub: `Map ${lm.game_no}${lm.mode ? ` · ${lm.mode === 'Search & Destroy' ? 'SnD' : lm.mode}` : ''}` });
    }
    for (const m of upcoming) {
      const r = ev.resolved.get(m.id);
      items.push({ k: `U${m.id}`, cls: 'next', label: m.status === 'ondeck' ? 'On deck' : 'Up next', text: `${teamTag(r.A)} vs ${teamTag(r.B)}`, sub: [reportTo(m, true), m.status === 'scheduled' && estText(m) && estText(m) !== 'Now' ? estText(m) : ''].filter(Boolean).join(' · ') });
    }
    if (ev.settings.display.leaders !== false) {
      for (const l of categoryLeaders(ev.data, ev.settings, ev.idx, Math.max(1, ev.settings.display.min_games || 1))) {
        items.push({ k: `C${l.cat}`, cls: 'leader', label: l.cat, text: l.name, team: l.team?.tag || '', sub: l.value });
      }
    }
    if (!items.length) items.push({ k: 'idle', cls: 'next', label: ev.event.name, text: 'Stay tuned', sub: '' });
    const key = items.map(i => i.k).join('|');
    const scroll = items.length > 4;
    const itemEl = i => h('span', { class: `d-tk-item ${i.cls}`, 'data-k': i.k },
      h('span', { class: 'd-tk-label' }, i.cls === 'live' ? h('i') : null, i.label),
      h('b', { class: 'd-tk-text' }, i.text), i.team ? h('span', { class: 'd-tk-team' }, i.team) : null,
      i.sub ? h('span', { class: 'd-tk-sub' }, i.sub) : null);
    if (!tickerEl || key !== tickerKey) {
      tickerKey = key;
      const track = h('div', { class: `d-tk-track ${scroll ? 'scroll' : ''}` }, items.map(itemEl), scroll ? items.map(itemEl) : null);
      tickerEl = h('footer', { class: 'd-ticker' }, h('div', { class: 'd-tk-viewport' }, track));
      if (scroll) requestAnimationFrame(() => {
        // constant speed (~90px/s) whatever the content length
        const half = track.scrollWidth / 2;
        track.style.setProperty('--tk-dist', `-${half}px`);
        track.style.animationDuration = `${Math.max(20, half / 90)}s`;
      });
    } else {
      // same items: just refresh the text (scores) without restarting the scroll
      for (const i of items) tickerEl.querySelectorAll(`[data-k="${CSS.escape(i.k)}"]`).forEach(el => {
        el.querySelector('.d-tk-text').textContent = i.text;
        const sub = el.querySelector('.d-tk-sub'); if (sub) sub.textContent = i.sub;
      });
    }
    return tickerEl;
  }

  // Live data: re-render the current scene in place (timer keeps running)
  let lastCmd = ev.settings.display.cmd?.next || 0;
  let wasPaused = !!ev.settings.display.paused;
  watchEvent(() => {
    applyAccent(ev.event.accent); applyFont(ev.settings.display.font || 'mix');
    const d = ev.settings.display;
    if (d.cmd?.next && d.cmd.next > lastCmd) { lastCmd = d.cmd.next; next(); return; }      // "Next screen" from the control panel
    if (wasPaused !== !!d.paused) {                                                          // pause / resume
      wasPaused = !!d.paused;
      clearTimeout(timer);
      if (!wasPaused) { started = Date.now(); timer = setTimeout(next, seconds() * 1000); }
    }
    render(false);
  });
  // Keep the screen awake on TVs/laptops where supported
  try { await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
  // Click / arrow keys to advance manually (handy when testing)
  viewport.addEventListener('click', next);
  addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === ' ') next(); });

  render(true);
  if (!ev.settings.display.paused) timer = setTimeout(next, seconds() * 1000);
  requestAnimationFrame(fit);
  return viewport;
}
