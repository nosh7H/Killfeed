import { h, fmtDate, fmtTime, toast, confirmDialog } from '../ui.js';
import { state, teamPath, go, canEdit, refreshData } from '../state.js';
import { record, gameResult, playerKey } from '../stats.js';
import { fieldsForMode } from '../config.js';
import { resultBadge, typeLabel, section } from './dashboard.js';
import { sortTable } from './table.js';

export function matchesView() {
  const byMatch = new Map();
  for (const g of state.joined) {
    if (!byMatch.has(g.match_id)) byMatch.set(g.match_id, { match: g.match, games: [] });
    byMatch.get(g.match_id).games.push(g);
  }
  // include series with no games yet
  for (const m of state.data.matches) if (!byMatch.has(m.id)) byMatch.set(m.id, { match: m, games: [] });
  const rows = [...byMatch.values()].map(r => ({ ...r, rec: record(r.games) }));

  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', {}, 'Matches'),
      canEdit() ? h('a', { class: 'btn btn-primary', href: teamPath('match/new') }, '＋ Log match') : null),
    h('div', { class: 'card' }, sortTable([
      { key: 'date', label: 'Date', get: r => r.match.played_on, fmt: v => fmtDate(v) },
      { key: 'type', label: 'Type', get: r => typeLabel(r.match.type) },
      { key: 'opp', label: 'Opponent', get: r => r.match.opponent || '—' },
      { key: 'event', label: 'Event', get: r => r.match.event || '' },
      { key: 'maps', label: 'Maps', num: true, get: r => r.games.length },
      { key: 'series', label: 'Result', get: r => r.rec.w - r.rec.l, render: r => seriesBadge(r.rec) },
      { key: 'detail', label: 'Maps played', get: r => r.games.map(g => g.map).join(', '), render: r => h('span', { class: 'chips' },
        [...r.games].sort((a, b) => a.game_no - b.game_no).map(g => h('span', { class: `chip chip-${gameResult(g) || 'na'}`, 'data-tip': `${g.mode} · ${g.team_score ?? '–'}–${g.opp_score ?? '–'}` }, g.map || '?'))) },
    ], rows, { sort: 'date', empty: 'No matches logged yet.', onRow: r => go(teamPath(`match/${r.match.id}`)) })));
}

function seriesBadge(rec) {
  if (!rec.n) return h('span', { class: 'muted' }, '—');
  const r = rec.w > rec.l ? 'W' : rec.w < rec.l ? 'L' : 'T';
  return h('span', { class: `badge badge-${r}` }, `${r} ${rec.w}–${rec.l}`);
}

export function matchDetailView(matchId) {
  const match = state.data.matches.find(m => m.id === matchId);
  if (!match) return h('div', { class: 'empty' }, h('p', {}, 'Match not found.'));
  const games = state.joined.filter(g => g.match_id === matchId).sort((a, b) => a.game_no - b.game_no);
  const rec = record(games);

  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'crumbs' }, h('a', { href: teamPath('matches') }, 'Matches'), ' / '),
        h('h1', {}, `${typeLabel(match.type)} vs ${match.opponent || 'Unknown'}`),
        h('p', { class: 'muted' }, [fmtDate(match.played_on), match.event].filter(Boolean).join(' · '), ' ', seriesBadge(rec))),
      canEdit() ? h('div', { class: 'actions' },
        h('a', { class: 'btn', href: teamPath(`match/${matchId}/edit`) }, 'Edit'),
        h('button', {
          class: 'btn btn-ghost btn-danger-text', onclick: async () => {
            if (!(await confirmDialog('Delete this match, its games, stats and screenshots?'))) return;
            await state.store.deleteMatch(matchId); await refreshData();
            toast('Match deleted'); go(teamPath('matches'));
          },
        }, 'Delete')) : null),
    match.notes ? h('div', { class: 'card notes' }, match.notes) : null,
    games.length ? games.map(g => section(
      h('span', {}, `Map ${g.game_no} · ${g.map || '?'} `, h('span', { class: 'muted' }, g.mode || ''), ' ', resultBadge(g), ` ${g.team_score ?? '–'}–${g.opp_score ?? '–'}`),
      null,
      h('div', {}, scoreboard(g), h('a', { class: 'btn btn-sm btn-ghost', href: teamPath(`game/${g.id}`) }, 'Screenshots, VOD & notes →'))))
      : h('div', { class: 'empty' }, h('p', {}, 'No games in this match yet.')));
}

export function scoreboard(g) {
  const lines = state.statsIdx.get(g.id) || [];
  const fields = fieldsForMode(g.mode).filter(f => !f.optional || lines.some(s => s[f.key] != null && s[f.key] !== ''));
  return sortTable([
    { key: 'player_name', label: 'Player', render: s => h('a', { href: teamPath(`player/${encodeURIComponent(playerKey(s))}`) }, s.player_name) },
    ...fields.map(f => ({ key: f.key, label: f.label, tip: f.long, num: true, lead: f.key !== 'deaths', fmt: v => (f.time ? fmtTime(v) : (v ?? '–')) })),
    { key: 'kd', label: 'K/D', num: true, lead: true, get: s => (s.deaths ? s.kills / s.deaths : s.kills), fmt: v => v == null ? '–' : Number(v).toFixed(2) },
  ], lines, { sort: 'kills', empty: 'No stats recorded for this map.' });
}
