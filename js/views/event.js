// Public event pages: overview, bracket, stats, teams. Live-updating.
import { h, clear, fmtDate, fmtTime, fmtNum, fmtPct } from '../ui.js';
import { ev, eventPath, watchEvent, teamName, teamBadge, exportEvent } from '../event-state.js';
import { playerBoard } from '../event-logic.js';
import { allStandings, bracketView, queueList, leaderRows, modeColumns, teamRows, statusPill, awardsGrid } from './event-parts.js';
import { sortTable } from './table.js';
import { roundName, seriesResult, gamesByMatch } from '../event-logic.js';

export function eventShell(active, body) {
  const tabs = [
    ['', 'Overview'], ['bracket', 'Bracket'], ['stats', 'Stats'], ['teams', 'Teams'],
    ...(ev.isAdmin ? [['control', 'Control room'], ['setup', 'Setup']] : []),
  ];
  const e = ev.event;
  return h('div', { class: 'page event-page' },
    h('div', { class: 'event-head' },
      h('div', {},
        h('div', { class: 'eyebrow' }, [e.starts_on && fmtDate(e.starts_on), e.venue].filter(Boolean).join(' · ') || 'LAN event'),
        h('h1', {}, e.name)),
      h('a', { class: 'btn btn-ghost', href: `#/display/${e.id}`, target: '_blank', rel: 'noopener', 'data-tip': 'Open the rotating TV / stream screen in a new tab' }, 'Display ↗')),
    h('nav', { class: 'tabs' }, tabs.map(([sub, label]) => h('a', { href: eventPath(sub), class: active === sub ? 'active' : '' }, label))),
    body);
}

/** Wrap a render function so the page re-renders whenever event data changes. */
export function live(render) {
  const root = h('div');
  const paint = () => clear(root).append(render());
  paint();
  const unsub = watchEvent(() => {
    if (!root.isConnected) { unsub(); return; }
    paint();
  });
  return root;
}

// ---------- overview ----------
export function eventOverview() {
  return live(() => eventShell('', h('div', { class: 'stack' },
    h('div', { class: 'grid-2 gap-lg' },
      section('Live and up next', queueList({ limit: 8 })),
      section('Top performers', topPerformers())),
    section('Group stage', allStandings()),
    section(ev.projected ? 'Playoffs (projected)' : 'Playoffs', bracketView()),
    section('Awards', awardsGrid()))));
}

function section(title, body, extra) {
  return h('section', { class: 'block' }, h('div', { class: 'block-head' }, h('h2', {}, title), extra || null), body);
}

function topPerformers() {
  const cards = ev.settings.modes.map(mode => {
    const top = leaderRows(mode, 'kd', 1)[0];
    return h('div', { class: 'perf' },
      h('div', { class: 'eyebrow' }, `Best K/D · ${mode}`),
      top ? h('div', {}, h('div', { class: 'perf-name' }, top.name, h('span', { class: 'tag-sm' }, top.team?.tag || '')),
        h('div', { class: 'perf-val' }, top.kd.toFixed(2), h('span', { class: 'muted small' }, ` ${top.kills}–${top.deaths} · ${top.games} maps`)))
        : h('div', { class: 'muted small' }, 'No maps played yet'));
  });
  return h('div', { class: 'perf-grid' }, cards);
}

// ---------- bracket ----------
export function eventBracket() {
  return live(() => eventShell('bracket', h('div', { class: 'stack' }, bracketView(), section('Group stage', allStandings()))));
}

// ---------- stats ----------
export function eventStats() {
  let mode = ev.settings.modes[0] || '';
  let minGames = ev.settings.display.min_games;
  const root = h('div');
  const paint = () => {
    const modes = ['', ...ev.settings.modes];
    const rows = playerBoard(ev.data, { mode }, ev.idx).filter(r => r.games >= minGames);
    const cols = [
      { key: 'name', label: 'Player', render: r => h('span', {}, r.name, r.team ? h('a', { class: 'tag-sm', href: eventPath(`team/${r.team.id}`) }, r.team.tag || r.team.name) : null) },
      { key: 'games', label: 'Maps', num: true },
      { key: 'kd', label: 'K/D', num: true, bar: true, lead: true, fmt: v => v.toFixed(2) },
      { key: 'kills', label: 'K', num: true, lead: true }, { key: 'deaths', label: 'D', num: true },
      { key: 'kpg', label: 'K/map', num: true, lead: true, fmt: v => fmtNum(v, 1) },
      ...(mode ? modeColumns(mode) : [{ key: 'objpg', label: 'OBJ/HP', fmt: fmtTime }, { key: 'plants', label: 'PL' }, { key: 'defuses', label: 'DEF' }])
        .map(c => ({ ...c, num: true, lead: true })),
    ];
    clear(root).append(eventShell('stats', h('div', { class: 'stack' },
      h('div', { class: 'toolbar' },
        h('div', { class: 'seg' }, modes.map(m => h('button', { class: mode === m ? 'on' : '', onclick: () => { mode = m; paint(); } }, m || 'All modes'))),
        h('div', { class: 'row' },
          h('label', { class: 'inline' }, 'Min maps', h('input', { type: 'number', min: 1, value: minGames, class: 'in-num', onchange: e => { minGames = Math.max(1, +e.target.value || 1); paint(); } })),
          h('button', { class: 'btn btn-sm', onclick: () => exportEvent(), 'data-tip': 'All stats as CSV files in a ZIP' }, 'Export stats ↓'))),
      section(mode ? `Players · ${mode}` : 'Players · all modes', sortTable(cols, rows, { sort: 'kd', empty: 'No stats yet.' })),
      section('Teams', teamTable()))));
  };
  paint();
  watchEvent(() => { if (root.isConnected) paint(); });
  return root;
}

export function teamTable() {
  const modes = ev.settings.modes;
  return sortTable([
    { key: 'name', label: 'Team', get: r => r.team.name, render: r => h('span', { class: 'team-cell' }, teamBadge(r.team.id), h('a', { href: eventPath(`team/${r.team.id}`) }, r.team.name)) },
    { key: 'sw', label: 'Series', num: true, render: r => `${r.sw}–${r.sl}` },
    { key: 'mw', label: 'Maps', num: true, render: r => `${r.mw}–${r.ml}` },
    { key: 'md', label: '+/-', num: true, fmt: v => (v > 0 ? `+${v}` : v) },
    { key: 'kd', label: 'K/D', num: true, bar: true, lead: true, fmt: v => (v == null ? '–' : v.toFixed(2)) },
    ...modes.map(m => ({ key: `m:${m}`, label: shortMode(m), num: true, tip: `${m} map record`, get: r => (r.modes[m] ? r.modes[m].w - r.modes[m].l : null), render: r => (r.modes[m] ? `${r.modes[m].w}–${r.modes[m].l}` : '–') })),
  ], teamRows(), { sort: 'sw' });
}

export const shortMode = m => ({ 'Hardpoint': 'HP', 'Search & Destroy': 'SnD', 'Control': 'CTRL', 'Overload': 'OVL', 'Hijack': 'HJK' }[m] || m.slice(0, 4).toUpperCase());

// ---------- teams ----------
export function eventTeams() {
  return live(() => eventShell('teams', h('div', { class: 'team-cards' }, ev.data.teams
    .slice().sort((a, b) => (a.group_label || '').localeCompare(b.group_label || '') || (a.seed ?? 99) - (b.seed ?? 99))
    .map(t => h('a', { class: 'team-tile', href: eventPath(`team/${t.id}`) },
      teamBadge(t.id, 'lg'),
      h('div', {}, h('strong', {}, t.name), h('div', { class: 'muted small' }, t.group_label ? `Group ${t.group_label}` : 'No group'),
        h('div', { class: 'small roster-line' }, ev.data.players.filter(p => p.team_id === t.id).map(p => p.gamertag).join(' · ') || 'No roster')))))));
}

export function eventTeam(teamId) {
  return live(() => {
    const t = ev.teamById.get(teamId);
    if (!t) return eventShell('teams', h('div', { class: 'empty' }, 'Team not found.'));
    const gbm = gamesByMatch(ev.data.games);
    const matches = ev.data.matches.filter(m => { const r = ev.resolved.get(m.id); return r && (r.A === teamId || r.B === teamId); });
    const players = playerBoard(ev.data, { team: teamId }, ev.idx);
    const perMode = ev.settings.modes.map(mode => ({ mode, rows: playerBoard(ev.data, { team: teamId, mode }, ev.idx) }));
    const bm = ev.data.matches.filter(m => m.stage !== 'group');
    return eventShell('teams', h('div', { class: 'stack' },
      h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'eyebrow' }, t.group_label ? `Group ${t.group_label}` : 'Team'), h('h2', { class: 'h-xl' }, t.name, t.tag ? h('span', { class: 'tag-sm' }, t.tag) : null))),
      section('Players · all modes', sortTable([
        { key: 'name', label: 'Player' }, { key: 'games', label: 'Maps', num: true },
        { key: 'kd', label: 'K/D', num: true, bar: true, lead: true, fmt: v => v.toFixed(2) }, { key: 'kills', label: 'K', num: true, lead: true }, { key: 'deaths', label: 'D', num: true },
        { key: 'objpg', label: 'OBJ/HP', num: true, lead: true, fmt: fmtTime }, { key: 'plants', label: 'PL', num: true, lead: true }, { key: 'defuses', label: 'DEF', num: true, lead: true },
      ], players, { sort: 'kd', empty: 'No maps played yet.' })),
      h('div', { class: 'grid-3 gap-lg' }, perMode.map(({ mode, rows }) => section(mode, sortTable([
        { key: 'name', label: 'Player' }, { key: 'kd', label: 'K/D', num: true, lead: true, fmt: v => v.toFixed(2) },
        ...modeColumns(mode).map(c => ({ ...c, num: true, lead: true })),
      ], rows, { sort: 'kd', empty: '—' })))),
      section('Matches', sortTable([
        { key: 'round', label: 'Round', get: m => (m.stage === 'group' ? 0 : 1) * 100 + m.round, render: m => roundName(m, bm) },
        { key: 'opp', label: 'Opponent', get: m => { const r = ev.resolved.get(m.id); return teamName(r.A === teamId ? r.B : r.A) || 'TBD'; } },
        { key: 'score', label: 'Result', num: true, get: m => { const r = ev.resolved.get(m.id); const s = r.result || seriesResult(m, gbm.get(m.id) || []); return r.A === teamId ? s.a - s.b : s.b - s.a; },
          render: m => { const r = ev.resolved.get(m.id); const s = r.result || seriesResult(m, gbm.get(m.id) || []); return r.A === teamId ? `${s.a}–${s.b}` : `${s.b}–${s.a}`; } },
        { key: 'status', label: '', get: m => m.status, render: m => statusPill(m.status) },
      ], matches, { sort: 'round', desc: false, onRow: m => { location.hash = eventPath(`match/${m.id}`); } }))));
  });
}

export { fmtPct };
