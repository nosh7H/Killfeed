import { h } from '../ui.js';
import { MATCH_TYPES } from '../config.js';
import { state, setFilters } from '../state.js';
import { distinct, playerTable } from '../stats.js';

/** One row of filters above the charts. Calls onChange(filters) on any change. */
export function filterBar(onChange, { player = true } = {}) {
  const f = { ...state.filters };
  const games = state.joined;
  const maps = distinct(games.map(g => g.map));
  const modes = distinct(games.map(g => g.mode));
  const opps = distinct(games.map(g => g.match.opponent));
  const players = playerTable(games, state.statsIdx, state.data.players).sort((a, b) => a.name.localeCompare(b.name));

  const sel = (key, label, options) => h('label', { class: 'filter' }, h('span', {}, label),
    h('select', { onchange: e => update(key, e.target.value) },
      h('option', { value: '' }, 'All'),
      options.map(o => typeof o === 'string'
        ? h('option', { value: o, selected: f[key] === o }, o)
        : h('option', { value: o.value, selected: f[key] === o.value }, o.label))));

  const date = (key, label) => h('label', { class: 'filter' }, h('span', {}, label),
    h('input', { type: 'date', value: f[key] || '', onchange: e => update(key, e.target.value) }));

  const update = (key, v) => {
    if (v) f[key] = v; else delete f[key];
    setFilters({ ...f });
    onChange({ ...f });
  };

  const active = Object.keys(f).length;
  return h('div', { class: 'filters' },
    sel('map', 'Map', maps),
    sel('mode', 'Mode', modes),
    sel('type', 'Type', MATCH_TYPES.map(t => ({ value: t.id, label: t.label }))),
    sel('opponent', 'Opponent', opps),
    player ? sel('player', 'Player', players.map(p => ({ value: p.key, label: p.name }))) : null,
    sel('result', 'Result', [{ value: 'W', label: 'Wins' }, { value: 'L', label: 'Losses' }]),
    date('from', 'From'), date('to', 'To'),
    active ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { setFilters({}); onChange({}); } }, `Reset (${active})`) : null);
}
