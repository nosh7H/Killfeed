// Pure data functions: filtering and aggregation. No DOM — unit-testable in Node.

export function gameResult(g) {
  if (g.team_score == null || g.opp_score == null || g.team_score === '' || g.opp_score === '') return null;
  const a = Number(g.team_score), b = Number(g.opp_score);
  return a > b ? 'W' : a < b ? 'L' : 'T';
}

export function playerKey(s) {
  return s.player_id || `name:${String(s.player_name || '').trim().toLowerCase()}`;
}

// Join games with their parent match, sorted newest first
export function joinGames(data) {
  const matchById = new Map(data.matches.map(m => [m.id, m]));
  return data.games
    .map(g => ({ ...g, match: matchById.get(g.match_id) }))
    .filter(g => g.match)
    .sort((a, b) => (b.match.played_on || '').localeCompare(a.match.played_on || '')
      || (b.match.created_at || '').localeCompare(a.match.created_at || '')
      || (b.game_no || 0) - (a.game_no || 0));
}

export function statsByGame(stats) {
  const m = new Map();
  for (const s of stats) {
    if (!m.has(s.game_id)) m.set(s.game_id, []);
    m.get(s.game_id).push(s);
  }
  return m;
}

/**
 * filters: { map, mode, type, opponent, from, to, player, result }
 * Empty/undefined values mean "any".
 */
export function filterGames(joined, filters = {}, statsIdx = null) {
  const f = filters;
  return joined.filter(g => {
    if (f.map && g.map !== f.map) return false;
    if (f.mode && g.mode !== f.mode) return false;
    if (f.type && g.match.type !== f.type) return false;
    if (f.opponent && (g.match.opponent || '').toLowerCase() !== f.opponent.toLowerCase()) return false;
    if (f.from && (g.match.played_on || '') < f.from) return false;
    if (f.to && (g.match.played_on || '') > f.to) return false;
    if (f.result && gameResult(g) !== f.result) return false;
    if (f.player && statsIdx) {
      const lines = statsIdx.get(g.id) || [];
      if (!lines.some(s => playerKey(s) === f.player)) return false;
    }
    return true;
  });
}

export function record(games) {
  const r = { w: 0, l: 0, t: 0, n: games.length };
  for (const g of games) {
    const res = gameResult(g);
    if (res === 'W') r.w++; else if (res === 'L') r.l++; else if (res === 'T') r.t++;
  }
  const decided = r.w + r.l + r.t;
  r.winPct = decided ? r.w / decided : null;
  return r;
}

export function teamTotals(games, statsIdx) {
  let kills = 0, deaths = 0;
  for (const g of games) for (const s of statsIdx.get(g.id) || []) {
    kills += Number(s.kills) || 0; deaths += Number(s.deaths) || 0;
  }
  return { kills, deaths, kd: deaths ? kills / deaths : null };
}

// map × mode win/loss matrix
export function mapModeMatrix(games) {
  const maps = [...new Set(games.map(g => g.map).filter(Boolean))].sort();
  const modes = [...new Set(games.map(g => g.mode).filter(Boolean))].sort();
  const cells = {};
  for (const g of games) {
    if (!g.map || !g.mode) continue;
    const k = `${g.map}|${g.mode}`;
    cells[k] = cells[k] || { w: 0, l: 0, t: 0, n: 0, diff: 0 };
    const c = cells[k]; const res = gameResult(g);
    c.n++;
    if (res === 'W') c.w++; else if (res === 'L') c.l++; else if (res === 'T') c.t++;
    if (res) c.diff += Number(g.team_score) - Number(g.opp_score);
  }
  for (const c of Object.values(cells)) {
    const d = c.w + c.l + c.t; c.winPct = d ? c.w / d : null;
  }
  return { maps, modes, cells };
}

const SUM_FIELDS = ['kills', 'deaths', 'assists', 'damage', 'obj_time', 'plants', 'defuses', 'captures', 'first_bloods'];

/**
 * Per-player aggregates. Mode-specific averages only count games of that mode:
 *   obj_time → Hardpoint, plants/defuses/first_bloods → S&D, captures → Control.
 */
export function playerTable(games, statsIdx, players = []) {
  const byId = new Map(players.map(p => [p.id, p]));
  const rows = new Map();
  for (const g of games) {
    for (const s of statsIdx.get(g.id) || []) {
      const key = playerKey(s);
      if (!rows.has(key)) {
        const p = s.player_id ? byId.get(s.player_id) : null;
        rows.set(key, {
          key, name: p ? p.gamertag : s.player_name, player_id: s.player_id || null,
          games: 0, wins: 0, hpGames: 0, sndGames: 0, ctrlGames: 0, dmgGames: 0,
          ...Object.fromEntries(SUM_FIELDS.map(f => [f, 0])),
        });
      }
      const r = rows.get(key);
      r.games++;
      if (gameResult(g) === 'W') r.wins++;
      for (const f of SUM_FIELDS) r[f] += Number(s[f]) || 0;
      if (g.mode === 'Hardpoint' && s.obj_time != null) r.hpGames++;
      if (g.mode === 'Search & Destroy') r.sndGames++;
      if (g.mode === 'Control') r.ctrlGames++;
      if (s.damage != null && s.damage !== '') r.dmgGames++;
    }
  }
  return [...rows.values()].map(r => ({
    ...r,
    kd: r.deaths ? r.kills / r.deaths : (r.kills ? r.kills : null),
    plusMinus: r.kills - r.deaths,
    kpg: r.games ? r.kills / r.games : null,
    dpg: r.games ? r.deaths / r.games : null,
    dmgpg: r.dmgGames ? r.damage / r.dmgGames : null,
    objpg: r.hpGames ? r.obj_time / r.hpGames : null,
    capspg: r.ctrlGames ? r.captures / r.ctrlGames : null,
    winPct: r.games ? r.wins / r.games : null,
  })).sort((a, b) => (b.kd ?? -1) - (a.kd ?? -1));
}

// Head-to-head by opponent (game-level and series-level)
export function opponentTable(games) {
  const rows = new Map();
  for (const g of games) {
    const opp = (g.match.opponent || '—').trim() || '—';
    if (!rows.has(opp)) rows.set(opp, { opponent: opp, games: [], series: new Map() });
    const r = rows.get(opp);
    r.games.push(g);
    if (!r.series.has(g.match_id)) r.series.set(g.match_id, []);
    r.series.get(g.match_id).push(g);
  }
  return [...rows.values()].map(r => {
    const rec = record(r.games);
    let sw = 0, sl = 0;
    for (const gs of r.series.values()) {
      const sr = record(gs);
      if (sr.w > sr.l) sw++; else if (sr.l > sr.w) sl++;
    }
    const last = r.games.map(g => g.match.played_on).sort().pop();
    return { opponent: r.opponent, ...rec, seriesW: sw, seriesL: sl, last };
  }).sort((a, b) => b.n - a.n);
}

// Chronological series of a player's per-game numbers (oldest → newest)
export function playerTrend(key, games, statsIdx) {
  const out = [];
  for (const g of [...games].reverse()) {
    const s = (statsIdx.get(g.id) || []).find(x => playerKey(x) === key);
    if (!s) continue;
    const k = Number(s.kills) || 0, d = Number(s.deaths) || 0;
    out.push({ game: g, kills: k, deaths: d, kd: d ? k / d : k, result: gameResult(g) });
  }
  return out;
}

// Per-map / per-mode breakdown for a single player
export function playerSplits(key, games, statsIdx, by = 'map') {
  const groups = new Map();
  for (const g of games) {
    const s = (statsIdx.get(g.id) || []).find(x => playerKey(x) === key);
    if (!s) continue;
    const label = (by === 'mapmode' ? `${g.map} · ${g.mode}` : g[by]) || '—';
    if (!groups.has(label)) groups.set(label, { label, games: 0, wins: 0, kills: 0, deaths: 0, obj_time: 0, hp: 0, plants: 0, defuses: 0 });
    const r = groups.get(label);
    r.games++; if (gameResult(g) === 'W') r.wins++;
    r.kills += Number(s.kills) || 0; r.deaths += Number(s.deaths) || 0;
    if (g.mode === 'Hardpoint' && s.obj_time != null) { r.obj_time += Number(s.obj_time) || 0; r.hp++; }
    r.plants += Number(s.plants) || 0; r.defuses += Number(s.defuses) || 0;
  }
  return [...groups.values()].map(r => ({
    ...r, kd: r.deaths ? r.kills / r.deaths : r.kills, kpg: r.kills / r.games,
    objpg: r.hp ? r.obj_time / r.hp : null, winPct: r.wins / r.games,
  })).sort((a, b) => b.games - a.games);
}

export function distinct(values) {
  return [...new Set(values.filter(v => v != null && String(v).trim() !== ''))].sort((a, b) => String(a).localeCompare(String(b)));
}

export function toCSV(rows, columns) {
  const esc = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(c => esc(c.label)).join(','),
    ...rows.map(r => columns.map(c => esc(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\n');
}

// Flat export: one row per player per game
export function flatRows(games, statsIdx) {
  const rows = [];
  for (const g of games) for (const s of statsIdx.get(g.id) || []) {
    rows.push({
      date: g.match.played_on, type: g.match.type, opponent: g.match.opponent, event: g.match.event,
      game_no: g.game_no, map: g.map, mode: g.mode, team_score: g.team_score, opp_score: g.opp_score,
      result: gameResult(g), player: s.player_name,
      ...Object.fromEntries(SUM_FIELDS.map(f => [f, s[f]])),
    });
  }
  return rows;
}
export const FLAT_COLUMNS = ['date', 'type', 'opponent', 'event', 'game_no', 'map', 'mode', 'team_score', 'opp_score', 'result', 'player', ...SUM_FIELDS]
  .map(k => ({ key: k, label: k }));
