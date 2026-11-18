import { h, clear, fmtRatio, fmtPct, fmtNum, fmtTime, fmtDate, download } from '../ui.js';
import { state, setFilters, teamPath, go, canEdit } from '../state.js';
import { filterGames, record, teamTotals, mapModeMatrix, playerTable, opponentTable, gameResult, toCSV, flatRows, FLAT_COLUMNS } from '../stats.js';
import { MATCH_TYPES } from '../config.js';
import { filterBar } from './filters.js';
import { sortTable } from './table.js';

export function dashboardView() {
  const root = h('div', { class: 'page' });
  const render = () => {
    clear(root);
    const f = state.filters;
    const games = filterGames(state.joined, f, state.statsIdx);
    // Player filter narrows games; stat tables still show everyone in those games
    const rec = record(games);
    const tot = teamTotals(games, state.statsIdx);

    root.append(
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, state.team.name), h('p', { class: 'muted' }, `${state.joined.length} games logged`)),
        h('div', { class: 'actions' },
          h('button', { class: 'btn btn-ghost', onclick: () => download(`${state.team.name}-stats.csv`, toCSV(flatRows(games, state.statsIdx), FLAT_COLUMNS), 'text/csv') }, 'Export CSV'),
          canEdit() ? h('a', { class: 'btn btn-primary', href: teamPath('match/new') }, '＋ Log match') : null)),
      filterBar(render));

    if (!state.joined.length) {
      root.append(h('div', { class: 'empty' },
        h('h2', {}, 'No matches yet'),
        h('p', {}, 'Log your first scrim or match — upload the scoreboard screenshot and the stats fill in for you.'),
        canEdit() ? h('a', { class: 'btn btn-primary', href: teamPath('match/new') }, '＋ Log your first match') : null,
        !state.data.players.length ? h('p', { class: 'muted small' }, 'Tip: add your roster first in ', h('a', { href: teamPath('settings') }, 'Team settings'), ' so screenshots can be matched to players.') : null));
      return;
    }
    if (!games.length) { root.append(h('div', { class: 'empty' }, h('p', {}, 'No games match these filters.'))); return; }

    // KPI tiles
    root.append(h('div', { class: 'kpis' },
      kpi('Games', games.length),
      kpi('Record', `${rec.w}–${rec.l}${rec.t ? `–${rec.t}` : ''}`),
      kpi('Win rate', fmtPct(rec.winPct)),
      kpi('Team K/D', tot.kd == null ? '–' : tot.kd.toFixed(2), `${tot.kills} kills · ${tot.deaths} deaths`)));

    // Players
    const players = playerTable(games, state.statsIdx, state.data.players);
    root.append(section('Players', `Across ${games.length} game${games.length === 1 ? '' : 's'}`, playerStatsTable(players, f.mode)));

    // Map × mode
    root.append(h('div', { class: 'grid-2 gap-lg' },
      section('Map × mode', 'Win rate per map and mode — click a cell to filter', matrixView(games, render)),
      section('Opponents', 'Head-to-head record', sortTable([
        { key: 'opponent', label: 'Opponent', render: r => h('a', { href: '#', onclick: e => { e.preventDefault(); setFilters({ ...state.filters, opponent: r.opponent }); render(); } }, r.opponent) },
        { key: 'n', label: 'Maps', num: true },
        { key: 'w', label: 'Map W–L', num: true, render: r => `${r.w}–${r.l}` },
        { key: 'winPct', label: 'Win %', num: true, fmt: fmtPct },
        { key: 'seriesW', label: 'Series', num: true, render: r => `${r.seriesW}–${r.seriesL}` },
        { key: 'last', label: 'Last', fmt: v => fmtDate(v) },
      ], opponentTable(games), { sort: 'n' }))));

    // Recent games
    root.append(section('Recent games', null, recentGames(games.slice(0, 15))));
  };
  render();
  return root;
}

function kpi(label, value, sub) {
  return h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value),
    sub ? h('div', { class: 'kpi-sub' }, sub) : null);
}

export function section(title, sub, body) {
  return h('section', { class: 'card section' },
    h('div', { class: 'section-head' }, h('h2', {}, title), sub ? h('span', { class: 'muted small' }, sub) : null), body);
}

export function playerStatsTable(rows, mode) {
  const showObj = !mode || mode === 'Hardpoint';
  const showSnd = !mode || mode === 'Search & Destroy';
  const showCtrl = !mode || mode === 'Control';
  const anyDmg = rows.some(r => r.dmgGames);
  const cols = [
    { key: 'name', label: 'Player', render: r => h('a', { href: teamPath(`player/${encodeURIComponent(r.key)}`) }, r.name) },
    { key: 'games', label: 'GP', num: true, tip: 'Games played' },
    { key: 'kd', label: 'K/D', num: true, lead: true, bar: true, fmt: v => v == null ? '–' : v.toFixed(2) },
    { key: 'kills', label: 'K', num: true, lead: true },
    { key: 'deaths', label: 'D', num: true },
    { key: 'plusMinus', label: '+/-', num: true, fmt: v => (v > 0 ? `+${v}` : v), cls: '' },
    { key: 'kpg', label: 'K/G', num: true, lead: true, tip: 'Kills per game', fmt: v => fmtNum(v, 1) },
    anyDmg ? { key: 'dmgpg', label: 'DMG/G', num: true, lead: true, tip: 'Average damage per game', fmt: v => fmtNum(v) } : null,
    showObj ? { key: 'objpg', label: 'OBJ/G', num: true, lead: true, tip: 'Average Hardpoint hill time per HP game', fmt: fmtTime } : null,
    showSnd ? { key: 'plants', label: 'Plants', num: true, lead: true } : null,
    showSnd ? { key: 'defuses', label: 'Defuses', num: true, lead: true } : null,
    showSnd && rows.some(r => r.first_bloods) ? { key: 'first_bloods', label: 'FB', num: true, lead: true, tip: 'First bloods' } : null,
    showCtrl ? { key: 'capspg', label: 'CAP/G', num: true, lead: true, tip: 'Average captures per Control game', fmt: v => fmtNum(v, 1) } : null,
    { key: 'winPct', label: 'Win %', num: true, fmt: fmtPct },
  ].filter(Boolean);
  return sortTable(cols, rows, { sort: 'kd', onRow: r => go(teamPath(`player/${encodeURIComponent(r.key)}`)) });
}

function matrixView(games, rerender) {
  const { maps, modes, cells } = mapModeMatrix(games);
  if (!maps.length) return h('div', { class: 'empty-sm' }, 'No map/mode data');
  return h('div', { class: 'table-wrap' }, h('table', { class: 'matrix' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Map'), modes.map(m => h('th', {}, m)))),
    h('tbody', {}, maps.map(map => h('tr', {}, h('th', { scope: 'row' }, map), modes.map(mode => {
      const c = cells[`${map}|${mode}`];
      if (!c) return h('td', { class: 'cell-empty' }, '·');
      const alpha = c.winPct == null ? 0.06 : 0.1 + 0.62 * c.winPct;
      return h('td', {
        class: 'cell', tabindex: 0, style: { background: `rgba(57,135,229,${alpha.toFixed(2)})` },
        'data-tip': `${map} · ${mode}\n${c.w}W ${c.l}L${c.t ? ` ${c.t}T` : ''} · ${fmtPct(c.winPct)}\nRound/score diff ${c.diff > 0 ? '+' : ''}${c.diff}`,
        onclick: () => { setFilters({ ...state.filters, map, mode }); rerender(); },
      }, h('strong', {}, fmtPct(c.winPct)), h('span', {}, `${c.w}–${c.l}`));
    }))))));
}

export function resultBadge(g) {
  const r = gameResult(g);
  if (!r) return h('span', { class: 'badge' }, '—');
  return h('span', { class: `badge badge-${r}`, 'aria-label': { W: 'Win', L: 'Loss', T: 'Tie' }[r] }, r);
}

export function typeLabel(t) { return MATCH_TYPES.find(x => x.id === t)?.label || t; }

function recentGames(games) {
  return sortTable([
    { key: 'date', label: 'Date', get: g => g.match.played_on, fmt: v => fmtDate(v) },
    { key: 'res', label: '', get: g => gameResult(g), render: resultBadge },
    { key: 'score', label: 'Score', num: true, get: g => (Number(g.team_score) || 0) - (Number(g.opp_score) || 0), render: g => `${g.team_score ?? '–'}–${g.opp_score ?? '–'}` },
    { key: 'map', label: 'Map' },
    { key: 'mode', label: 'Mode' },
    { key: 'opp', label: 'Opponent', get: g => g.match.opponent || '—' },
    { key: 'type', label: 'Type', get: g => typeLabel(g.match.type) },
    { key: 'kd', label: 'Team K/D', num: true, get: g => {
      const t = teamTotals([g], state.statsIdx); return t.kd;
    }, fmt: v => v == null ? '–' : v.toFixed(2) },
  ], games, { sort: 'date', onRow: g => go(teamPath(`game/${g.id}`)) });
}

export { fmtRatio };
