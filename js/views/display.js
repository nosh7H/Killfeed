// Venue TV / stream display. Full-screen scenes that rotate every N seconds and update live.
// URL: #/display/<eventId>?t=20&scene=bracket&bg=transparent
import { h, clear, fmtTime, fmtNum } from '../ui.js';
import { ev, loadEvent, watchEvent, teamName, teamTag, bracketMatches, teamBadge } from '../event-state.js';
import { roundName } from '../event-logic.js';
import { allStandings, bracketView, leaderRows, teamRows, queueRows, awardsGrid } from './event-parts.js';
import { applyAccent, applyFont } from '../theme.js';
import { shortMode } from './event.js';
import { vetoSeriesList, vetoBanner } from './veto.js';
import { mapStates } from '../veto.js';

const SCENE_TITLES = { groups: 'Group stage', teams: 'Team stats', bracket: 'Playoff bracket', 'bracket:upper': 'Upper bracket', 'bracket:lower': 'Lower bracket', queue: 'Live and up next', veto: 'Map veto', awards: 'Awards' };

export async function displayView(eventId, params) {
  document.body.classList.add('display-mode');
  if (params.get('bg') === 'transparent') document.body.classList.add('display-transparent');
  const event = await loadEvent(eventId, { force: true });
  if (!event) return h('div', { class: 'empty' }, 'Event not found or not public.');
  applyAccent(event.accent);
  applyFont(event.settings?.display?.font || 'mix');

  const stage = h('div', { class: 'd-stage' });
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
    const title = sc.startsWith('kd:') ? `K/D leaders · ${sc.slice(3)}` : SCENE_TITLES[sc] || sc;
    clear(stage).append(...[
      h('header', { class: 'd-head' },
        h('div', { class: 'd-brand' }, h('span', { class: 'd-mark' }), ev.event.name),
        h('div', { class: 'd-title' }, title),
        h('div', { class: 'd-dots' }, list.map((_, i) => h('span', { class: i === idx ? 'on' : '' })))),
      h('div', { class: `d-body ${animate ? 'enter' : ''}` }, h('div', { class: 'd-fit' }, scene(sc))),
      ev.settings.display.ticker !== false ? ticker() : null,
      h('div', { class: 'd-progress' }, h('div', { class: 'd-progress-fill', style: { animationDuration: `${seconds()}s`, animationDelay: `-${(Date.now() - started) / 1000}s` } }))].filter(Boolean));
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
    timer = setTimeout(next, seconds() * 1000);
  }

  function scene(sc) {
    if (sc === 'groups') return h('div', { class: 'd-groups' }, allStandings({ link: false }));
    if (sc === 'bracket') return h('div', { class: 'd-bracket' }, bracketView({ link: false }));
    if (sc.startsWith('bracket:')) return h('div', { class: 'd-bracket d-bracket-half' }, bracketView({ link: false, only: sc.slice(8) }));
    if (sc === 'teams') return teamsScene();
    if (sc === 'queue') return queueScene();
    if (sc === 'veto') return vetoScene();
    if (sc === 'awards') return awardsGrid({ large: true });
    if (sc.startsWith('kd:')) return kdScene(sc.slice(3));
    return h('div');
  }

  function kdScene(mode) {
    const rows = leaderRows(mode).slice(0, 10);
    const max = Math.max(...rows.map(r => r.kd), 1);
    const extra = mode === 'Hardpoint' ? [['OBJ/MAP', r => fmtTime(r.objpg), r => r.objpg]]
      : mode === 'Search & Destroy' ? [['PLANTS', r => r.plants, r => r.plants], ['DEFUSES', r => r.defuses, r => r.defuses], ['FB', r => r.first_bloods, r => r.first_bloods]]
        : [['DMG/MAP', r => fmtNum(r.dmgpg), r => r.dmgpg]];
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
        h('span', { class: 'd-q-station' }, m.station || '—'),
        h('span', { class: 'd-q-teams' }, teamName(r.A), h('i', {}, 'vs'), teamName(r.B)),
        h('span', { class: 'd-q-round' }, roundName(m, bm)),
        h('span', { class: 'd-q-status' }, { live: 'Live', ondeck: 'On deck', scheduled: 'Up next' }[m.status] || ''));
    }));
  }

  function ticker() {
    const rows = queueRows(6);
    const live = rows.filter(m => m.status === 'live');
    const upcoming = rows.filter(m => m.status !== 'live').slice(0, 3);
    const item = m => { const r = ev.resolved.get(m.id); return h('span', { class: 'd-tk-item' }, h('b', {}, m.station || 'TBD'), `${teamTag(r.A) || teamName(r.A)} vs ${teamTag(r.B) || teamName(r.B)}`); };
    return h('footer', { class: 'd-ticker' },
      live.length ? h('div', { class: 'd-tk-group' }, h('span', { class: 'd-tk-label live' }, h('i'), 'Live'), live.map(item)) : null,
      upcoming.length ? h('div', { class: 'd-tk-group' }, h('span', { class: 'd-tk-label' }, 'Up next'), upcoming.map(item)) : null,
      !live.length && !upcoming.length ? h('div', { class: 'd-tk-group muted' }, 'Stay tuned') : null);
  }

  // Live data: re-render the current scene in place (timer keeps running)
  watchEvent(() => { applyAccent(ev.event.accent); applyFont(ev.settings.display.font || 'mix'); render(false); });
  // Keep the screen awake on TVs/laptops where supported
  try { await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
  // Click / arrow keys to advance manually (handy when testing)
  viewport.addEventListener('click', next);
  addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === ' ') next(); });

  render(true);
  timer = setTimeout(next, seconds() * 1000);
  requestAnimationFrame(fit);
  return viewport;
}
