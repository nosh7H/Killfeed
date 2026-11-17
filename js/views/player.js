import { h, clear, fmtPct, fmtNum, fmtTime, fmtDate } from '../ui.js';
import { state, teamPath, go } from '../state.js';
import { filterGames, playerTable, playerTrend, playerSplits, playerKey } from '../stats.js';
import { filterBar } from './filters.js';
import { sortTable } from './table.js';
import { section, resultBadge } from './dashboard.js';

export function playerView(key) {
  const root = h('div', { class: 'page' });
  const render = () => {
    clear(root);
    const f = { ...state.filters }; delete f.player;
    const all = filterGames(state.joined, f, state.statsIdx);
    const games = all.filter(g => (state.statsIdx.get(g.id) || []).some(s => playerKey(s) === key));
    const row = playerTable(games, state.statsIdx, state.data.players).find(r => r.key === key);
    const name = row?.name || state.data.players.find(p => p.id === key)?.gamertag || key.replace(/^name:/, '');

    root.append(
      h('div', { class: 'page-head' }, h('div', {},
        h('div', { class: 'crumbs' }, h('a', { href: teamPath('dashboard') }, 'Dashboard'), ' /'),
        h('h1', {}, name))),
      filterBar(render, { player: false }));

    if (!row) { root.append(h('div', { class: 'empty' }, h('p', {}, 'No games for this player with these filters.'))); return; }

    root.append(h('div', { class: 'kpis' },
      kpi('Games', row.games), kpi('K/D', row.kd?.toFixed(2) ?? '–', `${row.kills} K · ${row.deaths} D`),
      kpi('Kills / game', fmtNum(row.kpg, 1)), kpi('Win rate', fmtPct(row.winPct)),
      row.hpGames ? kpi('Obj time / HP', fmtTime(row.objpg), `${row.hpGames} Hardpoint games`) : null,
      row.sndGames ? kpi('Plants · Defuses', `${row.plants} · ${row.defuses}`, `${row.sndGames} S&D games`) : null));

    const trend = playerTrend(key, games, state.statsIdx);
    root.append(section('K/D by game', `Last ${Math.min(trend.length, 40)} games · dashed line = 1.00`, trendChart(trend.slice(-40))));

    const splitCols = [
      { key: 'label', label: '' },
      { key: 'games', label: 'GP', num: true },
      { key: 'kd', label: 'K/D', num: true, bar: true, fmt: v => v.toFixed(2) },
      { key: 'kpg', label: 'K/G', num: true, fmt: v => fmtNum(v, 1) },
      { key: 'objpg', label: 'OBJ/G', num: true, fmt: fmtTime, tip: 'Hardpoint only' },
      { key: 'plants', label: 'PL', num: true }, { key: 'defuses', label: 'DEF', num: true },
      { key: 'winPct', label: 'Win %', num: true, fmt: fmtPct },
    ];
    root.append(h('div', { class: 'grid-2 gap-lg' },
      section('By map', null, sortTable(splitCols.map((c, i) => i ? c : { ...c, label: 'Map' }), playerSplits(key, games, state.statsIdx, 'map'), { sort: 'games' })),
      section('By mode', null, sortTable(splitCols.map((c, i) => i ? c : { ...c, label: 'Mode' }), playerSplits(key, games, state.statsIdx, 'mode'), { sort: 'games' }))));
    root.append(section('By map & mode', null, sortTable(splitCols.map((c, i) => i ? c : { ...c, label: 'Map · Mode' }), playerSplits(key, games, state.statsIdx, 'mapmode'), { sort: 'games' })));

    root.append(section('Game log', null, sortTable([
      { key: 'date', label: 'Date', get: t => t.game.match.played_on, fmt: v => fmtDate(v) },
      { key: 'res', label: '', get: t => t.result, render: t => resultBadge(t.game) },
      { key: 'map', label: 'Map', get: t => t.game.map },
      { key: 'mode', label: 'Mode', get: t => t.game.mode },
      { key: 'opp', label: 'Opponent', get: t => t.game.match.opponent || '—' },
      { key: 'kills', label: 'K', num: true }, { key: 'deaths', label: 'D', num: true },
      { key: 'kd', label: 'K/D', num: true, fmt: v => v.toFixed(2) },
    ], [...trend].reverse(), { sort: 'date', onRow: t => go(teamPath(`game/${t.game.id}`)) })));
  };
  render();
  return root;
}

function kpi(label, value, sub) {
  return h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null);
}

// Single-series line chart, SVG, with a 1.0 reference and per-point hover
function trendChart(points) {
  if (points.length < 2) return h('div', { class: 'empty-sm' }, 'Needs at least two games.');
  const NS = 'http://www.w3.org/2000/svg';
  const s = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
  const W = 800, H = 220, P = { l: 40, r: 16, t: 12, b: 26 };
  const max = Math.max(2, Math.ceil(Math.max(...points.map(p => p.kd)) * 2) / 2);
  const x = i => P.l + (i / (points.length - 1)) * (W - P.l - P.r);
  const y = v => P.t + (1 - v / max) * (H - P.t - P.b);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'trend', role: 'img', 'aria-label': `K/D per game, ${points.length} games` });
  for (let v = 0; v <= max; v += max > 3 ? 1 : 0.5) {
    svg.append(s('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid' }));
    const t = s('text', { x: P.l - 8, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }); t.textContent = v.toFixed(1); svg.append(t);
  }
  svg.append(s('line', { x1: P.l, x2: W - P.r, y1: y(1), y2: y(1), class: 'ref' }));
  svg.append(s('path', { d: points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.kd).toFixed(1)}`).join(''), class: 'line' }));
  points.forEach((p, i) => {
    const g = s('g', { 'data-tip': `${fmtDate(p.game.match.played_on)} · ${p.game.map} ${p.game.mode}\n${p.kills}–${p.deaths} (${p.kd.toFixed(2)}) · ${p.result || '—'}` });
    g.append(s('circle', { cx: x(i), cy: y(p.kd), r: 12, class: 'hit' }));
    g.append(s('circle', { cx: x(i), cy: y(p.kd), r: 4, class: 'dot' }));
    svg.append(g);
  });
  return h('div', { class: 'chart' }, svg);
}
