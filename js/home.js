// Team Home: widget catalog, layout handling and the numbers behind each widget.
// Pure functions (no DOM) so they can be unit-tested in Node.
import { gameResult, record, teamTotals, playerTable } from './stats.js';

export const SIZES = { s: 'Small', m: 'Medium', l: 'Wide' };

export const METRICS = {
  kd: { label: 'K/D', fmt: 'ratio', mode: null },
  kpg: { label: 'Kills / map', fmt: 'num1', mode: null },
  plusMinus: { label: '+/-', fmt: 'signed', mode: null },
  dmgpg: { label: 'Damage / map', fmt: 'num0', mode: null },
  objpg: { label: 'Hill time / HP map', fmt: 'time', mode: 'Hardpoint' },
  plants: { label: 'Plants', fmt: 'num0', mode: 'Search & Destroy' },
  defuses: { label: 'Defuses', fmt: 'num0', mode: 'Search & Destroy' },
  first_bloods: { label: 'First bloods', fmt: 'num0', mode: 'Search & Destroy' },
  winPct: { label: 'Win % when playing', fmt: 'pct', mode: null },
};

/** Single team numbers for the "Stat" tile. */
export const TEAM_STATS = {
  winrate: 'Map win rate',
  kd: 'Team K/D',
  record: 'Map record',
  series: 'Series record',
  maps: 'Maps played',
  kpm: 'Team kills / map',
  avgdiff: 'Average score diff',
  objpm: 'Team hill time / HP map',
  plantspm: 'Plants / S&D map',
};

export const KPI_ITEMS = ['record', 'winrate', 'kd', 'series', 'maps', 'avgdiff'];

/** The widget catalog. cfg keys: mode, metric, n, items, stat, text, title. */
export const WIDGETS = {
  kpis: { title: 'Key numbers', blurb: 'Record, win rate, team K/D and more in one strip', size: 'l', sizes: ['m', 'l'], cfg: { items: ['record', 'winrate', 'kd', 'series'] } },
  stat: { title: 'Stat', blurb: 'One big number — pick the stat and mode', size: 's', sizes: ['s', 'm'], cfg: { stat: 'winrate', mode: '' } },
  form: { title: 'Recent form', blurb: 'Last 10 series, newest on the right', size: 'm', sizes: ['s', 'm', 'l'], cfg: { n: 10 } },
  kd_trend: { title: 'Team K/D trend', blurb: 'Team K/D per series over time', size: 'm', sizes: ['m', 'l'], cfg: { mode: '', n: 20 } },
  mode_wr: { title: 'Win rate by mode', blurb: 'Map win rate in each mode', size: 's', sizes: ['s', 'm'], cfg: {} },
  map_wr: { title: 'Map win rates', blurb: 'Win rate on each map for one mode', size: 'm', sizes: ['s', 'm', 'l'], cfg: { mode: '' } },
  leaders: { title: 'Top players', blurb: 'Leaderboard for any stat', size: 's', sizes: ['s', 'm'], cfg: { metric: 'kd', mode: '', n: 5 } },
  player_bars: { title: 'Player comparison', blurb: 'Bar chart of one stat for every player', size: 'm', sizes: ['m', 'l'], cfg: { metric: 'kd', mode: '' } },
  upcoming: { title: 'Coming up', blurb: 'Next scrims and matches from the schedule', size: 's', sizes: ['s', 'm'], cfg: { n: 4 } },
  recent: { title: 'Recent matches', blurb: 'Latest series with scores', size: 'm', sizes: ['s', 'm', 'l'], cfg: { n: 6 } },
  notes: { title: 'Pinned notes', blurb: 'Notes pinned on the Notes page', size: 's', sizes: ['s', 'm'], cfg: {} },
  snd_rounds: { title: 'S&D rounds (tagged)', blurb: 'First blood, post-plant, 3v2 and 2v3 from tagged VODs', size: 'm', sizes: ['s', 'm'], cfg: {} },
  hp_hills: { title: 'Hill by hill (tagged)', blurb: 'Hold and break rates from tagged VODs', size: 's', sizes: ['s', 'm'], cfg: {} },
  text: { title: 'Team message', blurb: 'Goals, reminders, the week’s focus', size: 'm', sizes: ['s', 'm', 'l'], cfg: { title: 'This week', text: '' } },
};

export const DEFAULT_LAYOUT = {
  v: 1,
  widgets: [
    { type: 'kpis' },
    { type: 'form', size: 'm' }, { type: 'upcoming', size: 'm' },
    { type: 'kd_trend', size: 'm' }, { type: 'mode_wr', size: 'm' },
    { type: 'stat', size: 's', cfg: { stat: 'winrate', mode: 'Search & Destroy' } }, { type: 'leaders', size: 's', cfg: { metric: 'kd', mode: '', n: 5 } }, { type: 'snd_rounds', size: 's' },
    { type: 'map_wr', size: 'm', cfg: { mode: 'Hardpoint' } }, { type: 'notes', size: 'm' },
  ],
};

let seq = 0;
const wid = () => `w${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Fill in ids, sizes and config defaults; drop unknown widget types. */
export function normalizeLayout(layout) {
  const src = layout?.widgets?.length ? layout : DEFAULT_LAYOUT;
  return {
    v: 1,
    widgets: src.widgets.filter(w => WIDGETS[w.type]).map(w => {
      const def = WIDGETS[w.type];
      const size = def.sizes.includes(w.size) ? w.size : def.size;
      return { id: w.id || wid(), type: w.type, size, cfg: { ...def.cfg, ...(w.cfg || {}) } };
    }),
  };
}
export const newWidget = type => normalizeLayout({ widgets: [{ type }] }).widgets[0];

/** Move a widget to another index. */
export function moveWidget(layout, id, to) {
  const list = [...layout.widgets];
  const from = list.findIndex(w => w.id === id);
  if (from < 0) return layout;
  const [w] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(list.length, to)), 0, w);
  return { ...layout, widgets: list };
}

// ---------- numbers ----------

/** Games filtered by the page filters: { type, days } (days counted back from `today`). */
export function homeGames(joined, { type = '', days = 0 } = {}, today = new Date()) {
  const from = days ? new Date(today.getTime() - days * 86400000).toLocaleDateString('en-CA') : '';
  return joined.filter(g => (!type || g.match.type === type) && (!from || (g.match.played_on || '') >= from));
}

/** Group games into series (one logged match each), oldest → newest. */
export function seriesList(games) {
  const by = new Map();
  for (const g of games) {
    if (!by.has(g.match_id)) by.set(g.match_id, { match: g.match, games: [] });
    by.get(g.match_id).games.push(g);
  }
  return [...by.values()].map(s => {
    const r = record(s.games);
    return { ...s, w: r.w, l: r.l, result: r.w > r.l ? 'W' : r.l > r.w ? 'L' : r.w + r.l ? 'T' : null };
  }).sort((a, b) => (a.match.played_on || '').localeCompare(b.match.played_on || '') || (a.match.created_at || '').localeCompare(b.match.created_at || ''));
}

export function teamStat(stat, games, statsIdx) {
  const rec = record(games);
  const tot = teamTotals(games, statsIdx);
  const ser = seriesList(games);
  const sw = ser.filter(s => s.result === 'W').length, sl = ser.filter(s => s.result === 'L').length;
  const lines = gs => gs.flatMap(g => statsIdx.get(g.id) || []);
  switch (stat) {
    case 'winrate': return { value: rec.winPct, fmt: 'pct', sub: `${rec.w}–${rec.l}${rec.t ? `–${rec.t}` : ''} in ${rec.n} maps` };
    case 'kd': return { value: tot.kd, fmt: 'ratio', sub: `${tot.kills} kills · ${tot.deaths} deaths` };
    case 'record': return { value: `${rec.w}–${rec.l}${rec.t ? `–${rec.t}` : ''}`, fmt: 'raw', sub: `${rec.n} maps` };
    case 'series': return { value: `${sw}–${sl}`, fmt: 'raw', sub: `${ser.length} series` };
    case 'maps': return { value: rec.n, fmt: 'num0', sub: `${ser.length} series` };
    case 'kpm': return { value: games.length ? tot.kills / games.length : null, fmt: 'num1', sub: `${games.length} maps` };
    case 'avgdiff': {
      const scored = games.filter(g => gameResult(g));
      const v = scored.length ? scored.reduce((a, g) => a + (Number(g.team_score) - Number(g.opp_score)), 0) / scored.length : null;
      return { value: v, fmt: 'signed1', sub: 'score per map' };
    }
    case 'objpm': {
      const hp = games.filter(g => g.mode === 'Hardpoint');
      const t = lines(hp).reduce((a, s) => a + (Number(s.obj_time) || 0), 0);
      return { value: hp.length ? t / hp.length : null, fmt: 'time', sub: `${hp.length} HP maps` };
    }
    case 'plantspm': {
      const snd = games.filter(g => g.mode === 'Search & Destroy');
      const t = lines(snd).reduce((a, s) => a + (Number(s.plants) || 0), 0);
      return { value: snd.length ? t / snd.length : null, fmt: 'num1', sub: `${snd.length} S&D maps` };
    }
    default: return { value: null, fmt: 'raw', sub: '' };
  }
}

/** Map win rate per mode: [{ label, w, l, n, rate }] (most played first). */
export function winRateBy(games, key) {
  const by = new Map();
  for (const g of games) {
    const k = g[key];
    if (!k) continue;
    const r = gameResult(g);
    if (!r) continue;
    if (!by.has(k)) by.set(k, { label: k, w: 0, l: 0, t: 0 });
    const x = by.get(k);
    if (r === 'W') x.w++; else if (r === 'L') x.l++; else x.t++;
  }
  return [...by.values()].map(x => ({ ...x, n: x.w + x.l + x.t, rate: x.w / (x.w + x.l + x.t) })).sort((a, b) => b.n - a.n || b.rate - a.rate);
}

/** Team K/D per series, oldest → newest (last n). */
export function kdTrend(games, statsIdx, n = 20) {
  return seriesList(games).map(s => {
    const t = teamTotals(s.games, statsIdx);
    return { match: s.match, kd: t.kd, kills: t.kills, deaths: t.deaths, result: s.result, w: s.w, l: s.l };
  }).filter(p => p.kd != null).slice(-n);
}

/** Players ranked by one metric (mode filter optional). */
export function playerMetric(games, statsIdx, players, metric, mode = '') {
  const gs = mode ? games.filter(g => g.mode === mode) : games;
  return playerTable(gs, statsIdx, players)
    .map(r => ({ ...r, value: r[metric] }))
    .filter(r => r.value != null && !Number.isNaN(r.value))
    .sort((a, b) => b.value - a.value || b.games - a.games);
}
