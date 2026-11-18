// Tournament logic for LAN events. Pure functions — no DOM, unit-testable in Node.
//
// Data shapes (rows from the event_* tables):
//   team   { id, name, tag, group_label, seed }
//   match  { id, stage: 'group'|'upper'|'lower'|'grand', group_label, round, slot, code,
//            team_a, team_b, src_a, src_b, best_of, status, station, queue_pos }
//   game   { id, match_id, game_no, map, mode, a_score, b_score, winner }  (winner: 'a'|'b' when only the map result is known)
//   stat   { id, game_id, team_id, player_id, player_name, kills, deaths, ... }

export const GROUP_LABELS = 'ABCDEFGHIJKLMNOP'.split('');

// ---------- groups ----------

/** Snake-draft teams (ordered by seed) into n groups: A B C C B A A B C … */
export function snakeGroups(teams, n) {
  const sorted = [...teams].sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999) || a.name.localeCompare(b.name));
  const out = {};
  sorted.forEach((t, i) => {
    const lap = Math.floor(i / n), pos = i % n;
    out[t.id] = GROUP_LABELS[lap % 2 ? n - 1 - pos : pos];
  });
  return out;
}

/** Round-robin rounds via the circle method. Returns [[ [a,b], … ], …] */
export function roundRobin(ids) {
  const list = [...ids];
  if (list.length < 2) return [];
  if (list.length % 2) list.push(null);
  const n = list.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i], b = list[n - 1 - i];
      if (a && b) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop()); // rotate all but the first
  }
  return rounds;
}

// ---------- series ----------

export function gamesByMatch(games) {
  const m = new Map();
  for (const g of games) {
    if (!m.has(g.match_id)) m.set(g.match_id, []);
    m.get(g.match_id).push(g);
  }
  for (const list of m.values()) list.sort((a, b) => a.game_no - b.game_no);
  return m;
}

export function gameWinner(g) {
  if (g.a_score == null || g.b_score == null || g.a_score === '' || g.b_score === '') return g.winner === 'a' || g.winner === 'b' ? g.winner : null;
  const a = Number(g.a_score), b = Number(g.b_score);
  return a > b ? 'a' : b > a ? 'b' : (g.winner === 'a' || g.winner === 'b' ? g.winner : null);
}

/** Map count and winner of a series. A series is decided when someone reaches a majority
 *  of best_of, or when an admin marks it final (more maps wins). */
export function seriesResult(match, games = []) {
  let a = 0, b = 0, aPts = 0, bPts = 0;
  for (const g of games) {
    const w = gameWinner(g);
    if (w === 'a') a++; else if (w === 'b') b++;
    aPts += Number(g.a_score) || 0; bPts += Number(g.b_score) || 0;
  }
  const need = Math.floor((match.best_of || 5) / 2) + 1;
  let winner = null;
  if (a >= need) winner = 'a';
  else if (b >= need) winner = 'b';
  else if (match.status === 'final' && a !== b) winner = a > b ? 'a' : 'b';
  return { a, b, aPts, bPts, winner, done: winner != null };
}

// ---------- bracket ----------

/** Standard seeding order for a bracket of size n (power of 2): 1 v n, … arranged so top seeds meet last. */
export function seedOrder(n) {
  let order = [1];
  while (order.length < n) {
    const size = order.length * 2;
    order = order.flatMap(s => [s, size + 1 - s]);
  }
  return order;
}

export const nextPow2 = n => (n <= 1 ? 1 : 2 ** Math.ceil(Math.log2(n)));

/**
 * Build bracket match templates for `teamCount` seeded teams.
 * Sources: 'S:3' = seed 3, 'W:U1-2' = winner of match U1-2, 'L:U1-2' = loser.
 * type: 'double' | 'single'
 */
export function buildBracket(teamCount, type = 'double') {
  const S = Math.max(2, nextPow2(teamCount));
  const k = Math.log2(S);
  const out = [];
  const add = (stage, round, slot, src_a, src_b) => {
    const code = stage === 'grand' ? 'GF' : `${stage === 'upper' ? 'U' : 'L'}${round}-${slot}`;
    out.push({ stage, round, slot, code, src_a, src_b });
    return code;
  };

  // upper bracket
  const order = seedOrder(S);
  for (let i = 0; i < S / 2; i++) add('upper', 1, i + 1, `S:${order[2 * i]}`, `S:${order[2 * i + 1]}`);
  for (let r = 2; r <= k; r++) {
    for (let i = 0; i < S / 2 ** r; i++) add('upper', r, i + 1, `W:U${r - 1}-${2 * i + 1}`, `W:U${r - 1}-${2 * i + 2}`);
  }
  if (type !== 'double' || S < 4) return out;

  // lower bracket
  let lr = 1;
  for (let i = 0; i < S / 4; i++) add('lower', 1, i + 1, `L:U1-${2 * i + 1}`, `L:U1-${2 * i + 2}`);
  for (let j = 1; j <= k - 1; j++) {
    // drop-down round: LB winners meet losers from upper round j+1 (reversed to avoid quick rematches)
    const count = S / 2 ** (j + 1);
    lr++;
    for (let i = 0; i < count; i++) {
      const drop = j % 2 ? count - i : i + 1;
      add('lower', lr, i + 1, `W:L${lr - 1}-${i + 1}`, `L:U${j + 1}-${drop}`);
    }
    if (j < k - 1) {
      lr++;
      for (let i = 0; i < count / 2; i++) add('lower', lr, i + 1, `W:L${lr - 1}-${2 * i + 1}`, `W:L${lr - 1}-${2 * i + 2}`);
    }
  }
  add('grand', 1, 1, `W:U${k}-1`, `W:L${lr}-1`);
  return out;
}

export function roundName(m, bracketMatches) {
  if (m.stage === 'group') return `Group ${m.group_label} · Round ${m.round}`;
  if (m.stage === 'grand') return 'Grand final';
  const sameStage = bracketMatches.filter(x => x.stage === m.stage);
  const last = Math.max(...sameStage.map(x => x.round));
  if (m.stage === 'upper') {
    const fromEnd = last - m.round;
    const single = !bracketMatches.some(x => x.stage === 'lower');
    if (fromEnd === 0) return single ? 'Final' : 'Upper final';
    if (fromEnd === 1) return single ? 'Semifinals' : 'Upper semis';
    if (fromEnd === 2) return single ? 'Quarterfinals' : 'Upper quarters';
    return `Upper round ${m.round}`;
  }
  return m.round === last ? 'Lower final' : `Lower round ${m.round}`;
}

/**
 * Resolve every match's two teams.
 * seeds: array of team ids, index 0 = seed 1.
 * Returns Map(matchId → { A, B, winner, loser, result }) where A/B are team id | 'BYE' | null (pending).
 */
export function resolveMatches(matches, games, seeds = []) {
  const gbm = gamesByMatch(games);
  const byCode = new Map(matches.filter(m => m.code).map(m => [m.code, m]));
  const memo = new Map();

  const solve = m => {
    if (memo.has(m.id)) return memo.get(m.id);
    memo.set(m.id, { A: null, B: null, winner: null, loser: null, result: null }); // cycle guard
    const side = (team, src) => {
      if (team) return team;
      if (!src) return null;
      const [kind, ref] = src.split(':');
      if (kind === 'S') { const n = Number(ref); return n > seeds.length ? 'BYE' : (seeds[n - 1] || null); }
      const feeder = byCode.get(ref);
      if (!feeder) return null;
      const r = solve(feeder);
      return kind === 'W' ? r.winner : r.loser;
    };
    const A = side(m.team_a, m.src_a), B = side(m.team_b, m.src_b);
    const res = { A, B, winner: null, loser: null, result: null };
    if (A === 'BYE' && B === 'BYE') { res.winner = 'BYE'; res.loser = 'BYE'; }
    else if (A === 'BYE' && B) { res.winner = B; res.loser = 'BYE'; }
    else if (B === 'BYE' && A) { res.winner = A; res.loser = 'BYE'; }
    else if (A && B) {
      res.result = seriesResult(m, gbm.get(m.id) || []);
      if (res.result.winner) {
        res.winner = res.result.winner === 'a' ? A : B;
        res.loser = res.result.winner === 'a' ? B : A;
      }
    }
    memo.set(m.id, res);
    return res;
  };
  for (const m of matches) solve(m);
  return memo;
}

// ---------- match numbers ----------

/** Give every match without a number the next one: group matches first (in queue order), then the bracket
 *  (in bracket order). Numbers already given never change. Returns only the matches that got a new number. */
export function numberMatches(matches) {
  let next = Math.max(0, ...matches.map(m => Number(m.match_no) || 0));
  const stageRank = { group: 0, upper: 1, lower: 2, grand: 3 };
  const order = (a, b) => (a.stage === 'group') !== (b.stage === 'group')
    ? (a.stage === 'group' ? -1 : 1)
    : (a.queue_pos ?? 1e4) - (b.queue_pos ?? 1e4) || (a.round - b.round) || (stageRank[a.stage] - stageRank[b.stage]) || (a.slot - b.slot);
  return matches.filter(m => !m.match_no).sort(order).map(m => ({ ...m, match_no: ++next }));
}

// ---------- standings ----------

// Tiebreakers, in order: a. series win–loss record, b. head-to-head result, c. map win percentage, d. coin flip.
export const TIEBREAKERS = [
  ['record', 'Series record'],
  ['h2h', 'Head to head'],
  ['maps', 'Map win %'],
  ['coin', 'Coin flip'],
];
export const coinKey = ids => [...ids].sort().join(',');
const seriesPct = r => ((r.sw || 0) + (r.sl || 0) ? (r.sw || 0) / ((r.sw || 0) + (r.sl || 0)) : 0);
export const mapPct = r => ((r.mw || 0) + (r.ml || 0) ? (r.mw || 0) / ((r.mw || 0) + (r.ml || 0)) : 0);

/**
 * Order rows with the tiebreakers. Each row gets `tb`: the tiebreaker that put it above the next row
 * ('record' | 'h2h' | 'maps' | 'coin' | 'coin?' when a coin flip is still needed), and `coin`: the key of
 * its coin-flip group when it took (or still needs) one.
 * h2h: Map "x|y" → series x won against y. coins: { key: [team ids in order] } — flips already done.
 * final: false while the teams still have matches to play (no coin flip is asked for yet).
 */
export function tiebreakSort(rows, { h2h = new Map(), coins = {}, final = true } = {}) {
  const val = {
    record: r => seriesPct(r) * 1e6 + (r.sw || 0) * 1e3 - (r.sl || 0),
    h2h: (r, tied) => tied.reduce((n, o) => n + (o === r ? 0 : h2h.get(`${r.team.id}|${o.team.id}`) || 0), 0),
    maps: r => Math.round(mapPct(r) * 1e6),
  };
  const steps = ['record', 'h2h', 'maps'];
  const run = (list, k) => {
    if (list.length < 2) return list;
    if (k === steps.length) {
      const key = coinKey(list.map(r => r.team.id));
      const done = coins[key];
      const sorted = done?.length
        ? [...list].sort((x, y) => done.indexOf(x.team.id) - done.indexOf(y.team.id))
        : [...list].sort((x, y) => (x.team.seed ?? 99) - (y.team.seed ?? 99) || String(x.team.name || '').localeCompare(String(y.team.name || '')));
      // a coin flip is only due once the tied teams have finished playing (until then: seed order, no flag)
      if (done?.length || final) sorted.forEach((r, i) => { r.coin = key; if (i < sorted.length - 1) r.tb = done?.length ? 'coin' : 'coin?'; });
      return sorted;
    }
    const f = val[steps[k]];
    const scored = list.map(r => [r, f(r, list)]);
    const levels = [...new Set(scored.map(x => x[1]))].sort((x, y) => y - x);
    const out = [];
    levels.forEach((lv, i) => {
      const same = scored.filter(x => x[1] === lv).map(x => x[0]);
      // a multi-way tie that was partly broken starts again from head to head for the teams still level
      const part = run(same, same.length < list.length && k >= 1 ? 1 : k + 1);
      if (i < levels.length - 1) part[part.length - 1].tb = steps[k];
      out.push(...part);
    });
    return out;
  };
  rows.forEach(r => { delete r.tb; delete r.coin; });
  const out = run(rows, 0);
  if (out.length) delete out[out.length - 1].tb;
  return out;
}

/** Head-to-head series wins: Map "x|y" → series x won against y (group stage). */
export function headToHead(matches, games) {
  const gbm = gamesByMatch(games);
  const out = new Map();
  for (const m of matches) {
    if (m.stage !== 'group' || !m.team_a || !m.team_b) continue;
    const r = seriesResult(m, gbm.get(m.id) || []);
    if (!r.done) continue;
    const [w, l] = r.winner === 'a' ? [m.team_a, m.team_b] : [m.team_b, m.team_a];
    out.set(`${w}|${l}`, (out.get(`${w}|${l}`) || 0) + 1);
  }
  return out;
}

export function groupStandings(teams, matches, games, { coins = {} } = {}) {
  const gbm = gamesByMatch(games);
  const groups = {};
  for (const t of teams) {
    if (!t.group_label) continue;
    (groups[t.group_label] ||= new Map()).set(t.id, {
      team: t, played: 0, sw: 0, sl: 0, mw: 0, ml: 0, pf: 0, pa: 0,
    });
  }
  for (const m of matches) {
    if (m.stage !== 'group' || !m.team_a || !m.team_b) continue;
    const g = groups[m.group_label];
    if (!g) continue;
    const r = seriesResult(m, gbm.get(m.id) || []);
    const a = g.get(m.team_a), b = g.get(m.team_b);
    if (!a || !b) continue;
    a.mw += r.a; a.ml += r.b; b.mw += r.b; b.ml += r.a;
    a.pf += r.aPts; a.pa += r.bPts; b.pf += r.bPts; b.pa += r.aPts;
    if (r.done) {
      a.played++; b.played++;
      if (r.winner === 'a') { a.sw++; b.sl++; } else { b.sw++; a.sl++; }
    }
  }
  const h2h = headToHead(matches, games);
  const out = {};
  for (const [label, rows] of Object.entries(groups).sort()) {
    const list = [...rows.values()].map(r => ({ ...r, md: r.mw - r.ml, pd: r.pf - r.pa, mpct: mapPct(r) }));
    const gm = matches.filter(m => m.stage === 'group' && m.group_label === label);
    const final = gm.length > 0 && gm.every(m => m.status === 'final' || seriesResult(m, gbm.get(m.id) || []).done);
    out[label] = tiebreakSort(list, { h2h, coins, final });
  }
  return out;
}

/** Number of groups: 'auto' = 2 for ≤8 teams, 3 for ≤12, 4 for 13–16 (and beyond). */
export function groupCount(setting, teamCount) {
  if (setting && setting !== 'auto') return Math.max(1, Number(setting) || 1);
  return teamCount <= 8 ? 2 : teamCount <= 12 ? 3 : 4;
}
export const advanceCount = a => (a === 'all' || a == null ? Infinity : Number(a) || Infinity);

/**
 * The playoff seed list with the reason for each spot.
 * method 'rank' (default): all group winners first, ranked against each other with the tiebreakers
 * (series record → head to head → map win % → coin flip), then all runners-up the same way, and so on.
 * method 'snake': A1, B1, C1, C2, B2, A2 … (no cross-group ranking).
 * Returns [{ id, place, group, row, tb, coin }].
 */
export function seedTable(standings, advance, { method = 'rank', coins = {}, h2h = new Map(), final = true } = {}) {
  const labels = Object.keys(standings).sort();
  const out = [];
  const deepest = Math.max(0, ...labels.map(l => standings[l].length));
  for (let p = 0; p < Math.min(advance, deepest); p++) {
    const tier = labels.filter(l => standings[l][p]).map(l => ({ ...standings[l][p], group: l }));
    let ordered;
    if (method === 'snake') {
      ordered = p % 2 ? [...tier].reverse() : tier;
      ordered.forEach(r => { delete r.tb; delete r.coin; });
    } else ordered = tiebreakSort(tier, { h2h, coins, final });
    for (const r of ordered) out.push({ id: r.team.id, place: p + 1, group: r.group, row: r, tb: r.tb || null, coin: r.coin || null });
  }
  return out;
}
export function playoffSeeds(standings, advance, opts) {
  return seedTable(standings, advance, opts).map(x => x.id);
}

/** Coin flips that are still needed: [{ key, ids, where }] (groups, then seeding). */
export function pendingCoins(standings, seeds = []) {
  const out = new Map();
  for (const [label, rows] of Object.entries(standings)) {
    for (const r of rows) if (r.coin && rows.some(x => x.coin === r.coin && x.tb === 'coin?')) {
      if (!out.has(r.coin)) out.set(r.coin, { key: r.coin, ids: rows.filter(x => x.coin === r.coin).map(x => x.team.id), where: `Group ${label}` });
    }
  }
  for (const sd of seeds) if (sd.coin && seeds.some(x => x.coin === sd.coin && x.tb === 'coin?') && !out.has(sd.coin)) {
    const ids = seeds.filter(x => x.coin === sd.coin).map(x => x.id);
    out.set(sd.coin, { key: sd.coin, ids, where: `Seeding · ${ordinal(sd.place)} places` });
  }
  return [...out.values()];
}
const ordinal = n => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

// ---------- stats ----------

const SUMS = ['kills', 'deaths', 'assists', 'damage', 'obj_time', 'plants', 'defuses', 'first_bloods', 'captures', 'non_traded_kills', 'obj_kills', 'contested_time'];
// caster-only stats: averaged over the maps that actually have them (casted maps), not all maps
const ADV = ['assists', 'damage', 'first_bloods', 'non_traded_kills', 'obj_kills', 'contested_time', 'avg_hill_time', 'highest_streak'];

/** Join games with their match (for stage filters) and index stats by game. */
export function indexEvent(data) {
  const matchById = new Map(data.matches.map(m => [m.id, m]));
  const games = data.games.map(g => ({ ...g, match: matchById.get(g.match_id) })).filter(g => g.match);
  const statsByGame = new Map();
  for (const s of data.stats) {
    if (!statsByGame.has(s.game_id)) statsByGame.set(s.game_id, []);
    statsByGame.get(s.game_id).push(s);
  }
  return { games, statsByGame };
}

/**
 * Player leaderboard. filters: { mode, stage: 'group'|'playoffs', team }
 * Each row: games, kills, deaths, kd, per-game averages.
 */
export function playerBoard(data, filters = {}, idx = indexEvent(data)) {
  const teamById = new Map(data.teams.map(t => [t.id, t]));
  const rows = new Map();
  for (const g of idx.games) {
    if (filters.mode && g.mode !== filters.mode) continue;
    if (filters.stage === 'group' && g.match.stage !== 'group') continue;
    if (filters.stage === 'playoffs' && g.match.stage === 'group') continue;
    for (const s of idx.statsByGame.get(g.id) || []) {
      if (filters.team && s.team_id !== filters.team) continue;
      const key = s.player_id || `${s.team_id}:${(s.player_name || '').toLowerCase()}`;
      if (!rows.has(key)) rows.set(key, { key, name: s.player_name, team: teamById.get(s.team_id) || null, games: 0, ...Object.fromEntries(SUMS.map(f => [f, 0])), hp: 0, n: {}, hill_sum: 0, highest_streak: 0 });
      const r = rows.get(key);
      r.games++;
      for (const f of SUMS) r[f] += Number(s[f]) || 0;
      for (const f of ADV) if (s[f] != null && s[f] !== '') r.n[f] = (r.n[f] || 0) + 1;
      if (s.avg_hill_time != null) r.hill_sum += Number(s.avg_hill_time) || 0;
      if (s.highest_streak != null) r.highest_streak = Math.max(r.highest_streak, Number(s.highest_streak) || 0);
      if (g.mode === 'Hardpoint' && s.obj_time != null) r.hp++;
    }
  }
  return [...rows.values()].map(r => ({
    ...r,
    kd: r.deaths ? r.kills / r.deaths : r.kills,
    kpg: r.kills / r.games,
    objpg: r.hp ? r.obj_time / r.hp : null,
    casted: Math.max(0, ...Object.values(r.n)),             // maps with caster stats
    dmgpg: r.n.damage ? r.damage / r.n.damage : null,
    apg: r.n.assists ? r.assists / r.n.assists : null,
    ntkpg: r.n.non_traded_kills ? r.non_traded_kills / r.n.non_traded_kills : null,
    objkpg: r.n.obj_kills ? r.obj_kills / r.n.obj_kills : null,
    contpg: r.n.contested_time ? r.contested_time / r.n.contested_time : null,
    avg_hill: r.n.avg_hill_time ? r.hill_sum / r.n.avg_hill_time : null,
    first_bloods: r.n.first_bloods ? r.first_bloods : null,
    highest_streak: r.n.highest_streak ? r.highest_streak : null,
  }));
}

/** True when any stat line has caster-only numbers (so advanced columns are worth showing). */
export function hasAdvanced(stats, keys = ['damage', 'assists', 'non_traded_kills', 'first_bloods']) {
  return stats.some(s => keys.some(k => s[k] != null && s[k] !== ''));
}

/** Team table: series and map records, K/D, record per mode. */
export function teamBoard(data, resolved, idx = indexEvent(data)) {
  const rows = new Map(data.teams.map(t => [t.id, {
    team: t, sw: 0, sl: 0, mw: 0, ml: 0, kills: 0, deaths: 0, modes: {}, games: 0,
  }]));
  for (const m of data.matches) {
    const r = resolved.get(m.id);
    if (!r || !r.result?.done || !rows.has(r.winner) || !rows.has(r.loser)) continue;
    rows.get(r.winner).sw++; rows.get(r.loser).sl++;
  }
  for (const g of idx.games) {
    const r = resolved.get(g.match_id);
    if (!r || !rows.has(r.A) || !rows.has(r.B)) continue;
    const w = gameWinner(g);
    for (const [side, tid] of [['a', r.A], ['b', r.B]]) {
      const row = rows.get(tid);
      const md = (row.modes[g.mode || '—'] ||= { w: 0, l: 0 });
      if (w) { if (w === side) { row.mw++; md.w++; } else { row.ml++; md.l++; } }
      row.games++;
    }
    for (const s of idx.statsByGame.get(g.id) || []) {
      const row = rows.get(s.team_id);
      if (row) { row.kills += Number(s.kills) || 0; row.deaths += Number(s.deaths) || 0; }
    }
  }
  return [...rows.values()].map(r => ({ ...r, kd: r.deaths ? r.kills / r.deaths : null, md: r.mw - r.ml }))
    .sort((a, b) => b.sw - a.sw || a.sl - b.sl || b.md - a.md || (b.kd ?? 0) - (a.kd ?? 0));
}

/** Matches in queue order for the "now / up next" displays. */
export function queue(matches, resolved) {
  const playable = matches.filter(m => {
    const r = resolved.get(m.id);
    return m.status !== 'final' && !r?.result?.done && r?.A && r?.B && r.A !== 'BYE' && r.B !== 'BYE';
  });
  const rank = { live: 0, ondeck: 1, scheduled: 2 };
  return playable.sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3)
    || (a.queue_pos ?? 9999) - (b.queue_pos ?? 9999)
    || (a.stage === 'group' ? 0 : 1) - (b.stage === 'group' ? 0 : 1)
    || a.round - b.round || (a.slot ?? 0) - (b.slot ?? 0));
}

// ---------- awards ----------

/**
 * Auto awards from event stats. minMaps keeps one hot map from winning everything.
 * Returns [{ key, title, blurb, row (player board row), value, display }]
 */
export function computeAwards(data, idx = indexEvent(data), minMaps = 4) {
  const all = playerBoard(data, {}, idx);
  const hp = playerBoard(data, { mode: 'Hardpoint' }, idx);
  const snd = playerBoard(data, { mode: 'Search & Destroy' }, idx);
  const eligible = all.filter(r => r.games >= minMaps);
  const best = (rows, val, min = 1) => rows.filter(r => (val(r) ?? -Infinity) > 0 && r.games >= min).sort((a, b) => val(b) - val(a) || b.kills - a.kills)[0];
  const t = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const out = [];
  const push = (key, title, blurb, row, value, display) => { if (row) out.push({ key, title, blurb, row, value, display }); };

  const mvp = best(eligible, r => r.kd);
  push('mvp', 'Event MVP', `Best K/D across all modes (${minMaps}+ maps)`, mvp, mvp?.kd, mvp && mvp.kd.toFixed(2));
  const slayer = best(all, r => r.kills);
  push('slayer', 'Slayer', 'Most kills', slayer, slayer?.kills, slayer && String(slayer.kills));
  const obj = best(hp, r => r.objpg, 2);
  push('obj', 'Obj King', 'Most hill time per Hardpoint map', obj, obj?.objpg, obj && t(obj.objpg));
  const bomb = best(snd, r => r.plants + r.defuses, 2);
  push('bomb', 'Bomb Specialist', 'Most plants + defuses in S&D', bomb, bomb && bomb.plants + bomb.defuses, bomb && `${bomb.plants + bomb.defuses}`);
  const fb = best(snd, r => r.first_bloods, 2);
  push('fb', 'First Blood', 'Most opening kills in S&D', fb, fb?.first_bloods, fb && String(fb.first_bloods));
  const dmg = best(all.filter(r => r.dmgpg), r => r.dmgpg, Math.max(2, minMaps / 2));
  push('dmg', 'Damage Dealer', 'Most damage per map', dmg, dmg?.dmgpg, dmg && Math.round(dmg.dmgpg).toLocaleString());

  // Most consistent: smallest spread of per-map K/D among positive players
  const perMap = new Map();
  for (const g of idx.games) for (const s of idx.statsByGame.get(g.id) || []) {
    const key = s.player_id || `${s.team_id}:${(s.player_name || '').toLowerCase()}`;
    if (!perMap.has(key)) perMap.set(key, []);
    perMap.get(key).push((Number(s.kills) || 0) / Math.max(1, Number(s.deaths) || 0));
  }
  const steady = eligible.filter(r => r.kd >= 1).map(r => {
    const xs = perMap.get(r.key) || []; const m = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    return { r, sd: Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)) };
  }).sort((a, b) => a.sd - b.sd)[0];
  push('steady', 'Mr. Consistent', `Steadiest K/D map to map (K/D ≥ 1, ${minMaps}+ maps)`, steady?.r, steady?.sd, steady && `±${steady.sd.toFixed(2)}`);
  return out;
}

// ---------- seating (rows / pods) ----------
//
// Group stage: every team is pinned to one row (team.row_no) for the whole group stage,
// so a group match is played from the two teams' own rows.
// Bracket stage: each match is set to one of the bracket rows (match.station).

/** Pin teams to rows 1..rowCount: groups stay together, seed order inside each group.
 *  More teams than rows → rows are shared (those teams can't play at the same time). */
export function autoRows(teams, rowCount) {
  const n = Math.max(1, rowCount | 0);
  const sorted = [...teams].sort((a, b) => (a.group_label || '~').localeCompare(b.group_label || '~') || (a.seed ?? 999) - (b.seed ?? 999) || a.name.localeCompare(b.name));
  return Object.fromEntries(sorted.map((t, i) => [t.id, (i % n) + 1]));
}

// ---------- sessions (e.g. Morning / Evening) ----------
// seating.sessions: [{ id, name }]   seating.plan: { A: { session: 's1', from: 1 }, ... }
// A group plays its whole group stage in one session on a block of rows (A: Morning rows 1–4).

const groupSizes = teams => {
  const by = {};
  for (const t of teams) if (t.group_label) by[t.group_label] = (by[t.group_label] || 0) + 1;
  return by;
};

/** Pack groups in order: fill session 1's rows, then session 2's, and so on. */
export function autoPlan(teams, seating) {
  const rows = Math.max(1, seating.group_rows || 8);
  const sessions = seating.sessions?.length ? seating.sessions : [{ id: 's1', name: 'Session 1' }];
  const sizes = groupSizes(teams);
  const plan = {};
  let si = 0, next = 1;
  for (const g of Object.keys(sizes).sort()) {
    if (next > 1 && next + sizes[g] - 1 > rows) { si = Math.min(si + 1, sessions.length - 1); next = 1; }
    plan[g] = { session: sessions[si].id, from: next };
    next += sizes[g];
  }
  return plan;
}

/** Row for every team from the plan: seed order inside each group, starting at the group's first row. */
export function planRows(teams, plan = {}) {
  const out = {};
  const by = {};
  for (const t of teams) if (t.group_label) (by[t.group_label] ||= []).push(t);
  for (const [g, list] of Object.entries(by)) {
    const p = plan[g];
    if (!p) continue;
    list.sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999) || a.name.localeCompare(b.name))
      .forEach((t, i) => { out[t.id] = p.from + i; });
  }
  return out;
}

/** Problems with a plan: groups sharing rows in the same session, or running past the last row. */
export function planIssues(teams, seating, plan = seating.plan || {}) {
  const rows = Math.max(1, seating.group_rows || 8);
  const sizes = groupSizes(teams);
  const issues = [];
  const name = id => seating.sessions?.find(x => x.id === id)?.name || 'a session';
  const gs = Object.keys(sizes).sort();
  for (const g of gs) {
    const p = plan[g];
    if (!p) { issues.push({ group: g, text: `Group ${g} has no session or rows yet` }); continue; }
    const end = p.from + sizes[g] - 1;
    if (end > rows) issues.push({ group: g, text: `Group ${g} needs rows ${p.from}–${end}, but there are only ${rows}` });
  }
  for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) {
    const a = plan[gs[i]], b = plan[gs[j]];
    if (!a || !b || a.session !== b.session) continue;
    const ae = a.from + sizes[gs[i]] - 1, be = b.from + sizes[gs[j]] - 1;
    if (a.from <= be && b.from <= ae) issues.push({ group: gs[j], text: `Groups ${gs[i]} and ${gs[j]} share rows in ${name(a.session)}` });
  }
  return issues;
}

/** The session a team plays its group stage in (from its group's plan). */
export function teamSession(team, seating) {
  const id = seating?.plan?.[team?.group_label]?.session;
  return id ? seating.sessions?.find(x => x.id === id) || null : null;
}

/** Where a match is played. Returns { label, full, rows?: [a, b], pod?, session? } or null.
 *  opts: the seating settings (or just the row label). */
export function matchSpot(m, r, teamById, opts = 'Row') {
  const seat = typeof opts === 'string' ? { label: opts } : (opts || {});
  const label = seat.label || 'Row';
  if (m.stage === 'group') {
    const ta = teamById.get(r?.A), tb = teamById.get(r?.B);
    const ra = ta?.row_no ?? null, rb = tb?.row_no ?? null;
    if (ra != null || rb != null) {
      const ses = teamSession(ta, seat) || teamSession(tb, seat);
      const lbl = `${label}s ${ra ?? '?'} & ${rb ?? '?'}`;
      return { rows: [ra, rb], label: lbl, full: ses ? `${ses.name} · ${lbl}` : lbl, session: ses?.name || null, short: `${ra ?? '?'}/${rb ?? '?'}` };
    }
  }
  if (m.row_a != null || m.row_b != null) {
    const ra = m.row_a ?? null, rb = m.row_b ?? null;
    const lbl = `${label}s ${ra ?? '?'} & ${rb ?? '?'}`;
    return { rows: [ra, rb], label: lbl, full: lbl, session: null, short: `${ra ?? '?'}/${rb ?? '?'}` };
  }
  // older events stored one pod name per bracket match
  return m.station ? { pod: m.station, label: m.station, full: m.station, short: m.station } : null;
}

/** "AFTERGLOW → Row 5 · IRONCLAD → Row 6" pieces: [[teamId, row], [teamId, row]] for a spot. */
export function spotTeams(spot, r) {
  if (!spot?.rows) return [];
  return [[r?.A, spot.rows[0]], [r?.B, spot.rows[1]]];
}

/** Seating clashes between matches that are live or on deck:
 *  the same row or pod used twice, or a team booked in two matches. */
export function seatConflicts(matches, resolved, teamById, label = 'Row') {
  const busy = matches.filter(m => m.status === 'live' || m.status === 'ondeck');
  const uses = new Map();
  const add = (key, m) => { if (!uses.has(key)) uses.set(key, new Set()); uses.get(key).add(m.id); };
  for (const m of busy) {
    const r = resolved.get(m.id);
    const spot = matchSpot(m, r, teamById, label);
    if (spot?.rows) spot.rows.filter(x => x != null).forEach(x => add(`${label} ${x}`, m));
    else if (spot?.pod) add(spot.pod, m);
    for (const t of [r?.A, r?.B]) if (t && t !== 'BYE') add(`team:${t}`, m);
  }
  const out = [];
  for (const [key, ids] of uses) {
    if (ids.size < 2) continue;
    const live = [...ids].filter(id => busy.find(m => m.id === id).status === 'live');
    // two on-deck matches sharing a row is fine (one plays after the other); clash only if 2+ are live
    if (live.length < 2) continue;
    out.push({ key, team: key.startsWith('team:') ? key.slice(5) : null, matches: [...ids] });
  }
  return out;
}

/** Rows held by live bracket matches (optionally ignoring one match). */
export function busyRows(matches, exceptId = null) {
  const out = new Set();
  for (const m of matches) {
    if (m.status !== 'live' || m.id === exceptId || m.stage === 'group') continue;
    if (m.row_a != null) out.add(Number(m.row_a));
    if (m.row_b != null) out.add(Number(m.row_b));
  }
  return out;
}

/** The row a team last played on in the bracket (live first, then the most recent final). */
export function teamRow(team, matches, resolved, exceptId = null) {
  if (!team || team === 'BYE') return null;
  const hit = matches
    .filter(x => x.stage !== 'group' && x.id !== exceptId && (x.status === 'live' || x.status === 'final'))
    .map(x => { const r = resolved.get(x.id); return { x, row: r?.A === team ? x.row_a : r?.B === team ? x.row_b : null }; })
    .filter(o => o.row != null)
    .sort((a, b) => (b.x.status === 'live') - (a.x.status === 'live') || (b.x.updated_at || '').localeCompare(a.x.updated_at || '') || (b.x.queue_pos ?? 0) - (a.x.queue_pos ?? 0))[0];
  return hit ? Number(hit.row) : null;
}

const mate = r => (r % 2 ? r + 1 : r - 1); // 1↔2, 3↔4, 5↔6 …

/** Two free rows for a bracket match: [rowA, rowB] or null.
 *  Keeps each team on the row it wants (prefer = [a, b]) when free, otherwise takes a free side-by-side pair. */
export function freeRowPair(nRows, busy, prefer = [null, null]) {
  const free = r => r >= 1 && r <= nRows && !busy.has(r);
  let [a, b] = prefer.map(x => (x != null && free(Number(x)) ? Number(x) : null));
  if (a != null && a === b) b = null;
  if (a != null && b == null && free(mate(a)) && mate(a) !== a) b = mate(a);
  if (b != null && a == null && free(mate(b)) && mate(b) !== b) a = mate(b);
  if (a == null && b == null) {
    for (let r = 1; r < nRows; r += 2) if (free(r) && free(r + 1)) return [r, r + 1];
  }
  const rest = [];
  for (let r = 1; r <= nRows; r++) if (free(r) && r !== a && r !== b) rest.push(r);
  if (a == null) a = rest.shift() ?? null;
  if (b == null) b = rest.shift() ?? null;
  return a != null && b != null ? [a, b] : null;
}

// ---------- live map score ----------

/** The map being played right now: { game_no, mode, map, a, b, started }.
 *  match.live holds the running score; mode/map come from the vetoed games or the mode order. */
export function liveMap(m, games = [], settings = {}) {
  const decided = games.filter(g => gameWinner(g)).length;
  const no = m.live?.game_no || decided + 1;
  const g = games.find(x => x.game_no === no);
  const order = settings.mode_order || [];
  return {
    game_no: no,
    mode: m.live?.mode || g?.mode || order[(no - 1) % (order.length || 1)] || null,
    map: m.live?.map || g?.map || null,
    a: Number(m.live?.a) || 0, b: Number(m.live?.b) || 0,
    started: !!m.live,
  };
}

// ---------- category leaders (display ticker) ----------

/** One leader per category, e.g. [{ cat: 'HP K/D', name, team, value }]. */
export function categoryLeaders(data, settings, idx = indexEvent(data), minGames = 1) {
  const out = [];
  const pick = (rows, val, fmt, cat) => {
    const best = rows.filter(r => r.games >= minGames && (val(r) ?? 0) > 0).sort((a, b) => val(b) - val(a) || b.kills - a.kills)[0];
    if (best) out.push({ cat, name: best.name, team: best.team, value: fmt(val(best)), key: best.key });
  };
  const short = m => ({ 'Hardpoint': 'HP', 'Search & Destroy': 'SnD', 'Hijack': 'Hijack', 'Control': 'Control' }[m] || m);
  const t = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const all = playerBoard(data, {}, idx);
  pick(all, r => r.kd, v => v.toFixed(2), 'Overall K/D');
  for (const mode of settings.modes || []) {
    const rows = playerBoard(data, { mode }, idx);
    pick(rows, r => r.kd, v => v.toFixed(2), `${short(mode)} K/D`);
    if (mode === 'Hardpoint') pick(rows, r => r.objpg, t, 'HP obj time / map');
    if (mode === 'Search & Destroy') {
      pick(rows, r => r.first_bloods, v => String(v), 'SnD first bloods');
      pick(rows, r => r.plants + r.defuses, v => String(v), 'SnD plants + defuses');
    }
  }
  pick(all, r => r.kills, v => String(v), 'Most kills');
  pick(all.filter(r => r.dmgpg), r => r.dmgpg, v => Math.round(v).toLocaleString(), 'Damage / map');
  return out;
}

// ---------- bracket seating helper ----------
// Keeping a team on the same setup between back-to-back matches saves the time it takes to move,
// log in and fix settings. This only suggests rows for each bracket match; staff decide.

/**
 * For every upcoming bracket match: a row for each team that lets anyone who just played stay put.
 * A team stays on the row it last played on in the bracket. A team that isn't known yet
 * ("Winner of U2-1") stays on whichever of that match's rows it's on, so its row is decided when that match ends.
 * Rows promised to a match earlier in the queue aren't offered again; clash = { full: true } when no rows are free.
 * Returns [{ match, rows: [a, b], current: [a, b], ok, sides: [{ who, team, row, stays, waits, takesFrom }], clash }] in queue order.
 * takesFrom = { code, rows }: no row is free, so this team takes the row the other team of that match leaves.
 */
export function bracketRowHelp(matches, resolved, nRows = 8) {
  const bracket = matches.filter(m => m.stage !== 'group');
  const byCode = new Map(bracket.filter(m => m.code).map(m => [m.code, m]));
  const order = m => (m.status === 'ondeck' ? 0 : 1) * 1e4 + (m.queue_pos ?? 9999);
  const open = bracket.filter(m => {
    const r = resolved.get(m.id);
    return m.status !== 'final' && m.status !== 'live' && !r?.result?.done && r?.A !== 'BYE' && r?.B !== 'BYE';
  }).sort((a, b) => order(a) - order(b));

  const out = [];
  const taken = new Map(); // row → earlier open match suggested there
  for (const m of open) {
    const r = resolved.get(m.id) || {};
    const sides = [[m.src_a, r.A], [m.src_b, r.B]].map(([src, team]) => {
      const [kind, ref] = (src || '').split(':');
      const feeder = (kind === 'W' || kind === 'L') ? byCode.get(ref) : null;
      if (team && team !== 'BYE') {
        const row = teamRow(team, bracket, resolved, m.id);
        return { who: team, team, row, stays: row != null, waits: null };
      }
      const who = feeder ? `${kind === 'W' ? 'Winner' : 'Loser'} of ${feeder.code}` : null;
      const fromRows = feeder && (feeder.row_a != null || feeder.row_b != null) ? [feeder.row_a, feeder.row_b] : null;
      return { who, team: null, row: null, stays: false, waits: fromRows ? feeder.code : null, fromRows };
    });
    if (!sides.some(x => x.stays || x.waits)) continue;
    // rows other live matches are holding (not the ones these teams are leaving)
    const busy = new Set();
    for (const x of bracket) {
      if (x.status !== 'live') continue;
      const xr = resolved.get(x.id);
      if (sides.some(sd => sd.team && (xr?.A === sd.team || xr?.B === sd.team))) continue;
      if (sides.some(sd => sd.waits && x.code === sd.waits)) continue;
      if (x.row_a != null) busy.add(Number(x.row_a));
      if (x.row_b != null) busy.add(Number(x.row_b));
    }
    // rows already promised to matches earlier in the queue are not free either
    for (const x of taken.keys()) busy.add(x);
    const want = sides.map(sd => (sd.stays ? sd.row : null));
    if (want[0] != null && want[0] === want[1]) want[1] = null;
    // keep the rows a still-to-be-decided team will come from out of the other side's way
    const hold = new Set(sides.flatMap(sd => (sd.fromRows || []).filter(x => x != null).map(Number)));
    const pick = freeRowPair(nRows, new Set([...busy, ...[...hold].filter(x => !want.includes(x))]), want);
    // no free row, but the opponent comes out of a match that's still on: take the row its other team leaves
    const feeder = !pick && sides.find(sd => sd.waits && sd.fromRows);
    const rows = pick ? sides.map((sd, k) => (sd.waits ? null : pick[k])) : [null, null];
    sides.forEach((sd, k) => {
      sd.stays = sd.stays && rows[k] != null && rows[k] === sd.row; sd.row = rows[k];
      if (feeder && sd !== feeder) sd.takesFrom = { code: feeder.waits, rows: feeder.fromRows.filter(x => x != null).map(Number) };
    });
    // nothing free: the match waits for a live one to finish
    const clash = !pick && !feeder ? { full: true } : null;
    rows.forEach(x => { if (x != null) taken.set(x, m); });
    const current = [m.row_a ?? null, m.row_b ?? null];
    const ok = !clash && rows.every((x, k) => x == null || Number(current[k]) === x);
    out.push({ match: m, rows, current, ok, sides, clash });
  }
  return out;
}

// ---------- estimated start times ----------
// The day is simulated forward. A match takes its maps (15 min each). A team's next match starts after a break
// (15–30 min, which is also log-in and setup time) and at least an hour after its last match started:
// a 3–0 = 3 × 15 + 15 = 1 h, every extra map adds 15 min. Both teams ready early → no break, no minimum.
// Teams that are only waiting on other matches start as soon as those finish. Rows are free when a match ends.
// Pace starts from the settings and learns from finished matches.

export const EST_DEFAULTS = { setup_minutes: 0, map_minutes: 15, break_minutes: 15, slot_minutes: 60, day_start: '', session_starts: {}, public: true };
const median = xs => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

/** Minutes per map and maps per series: the settings, blended with what finished matches show (weight grows with samples). */
export function pace(matches, games, settings = {}) {
  const est = { ...EST_DEFAULTS, ...(settings.est || {}) };
  const gbm = gamesByMatch(games);
  const perMap = [];
  const mapsByBo = {};
  for (const m of matches) {
    if (m.status !== 'final') continue;
    const n = (gbm.get(m.id) || []).filter(g => gameWinner(g)).length;
    if (n) (mapsByBo[m.best_of] ||= []).push(n);
    if (!m.started_at || !m.ended_at || !n) continue;
    const mins = (new Date(m.ended_at) - new Date(m.started_at)) / 60000 - (Number(est.setup_minutes) || 0);
    if (mins > 2 && mins < n * 45) perMap.push(mins / n); // ignore matches marked final by mistake / left running
  }
  const k = perMap.length, w = k / (k + 3);
  const mapMin = k ? w * median(perMap) + (1 - w) * est.map_minutes : est.map_minutes;
  const expMaps = bo => {
    const need = Math.floor(bo / 2) + 1;
    const guess = need + (bo - need) * 0.5;
    const xs = mapsByBo[bo] || [];
    if (!xs.length) return guess;
    const ww = xs.length / (xs.length + 3);
    return ww * (xs.reduce((a, b) => a + b, 0) / xs.length) + (1 - ww) * guess;
  };
  const brk = Math.min(30, Math.max(0, Number(est.break_minutes ?? 15)));
  const slot = Math.max(0, Number(est.slot_minutes ?? 60));
  return { mapMin, setup: Math.max(0, Number(est.setup_minutes ?? 0)), brk, slot, expMaps, samples: k, learned: k ? median(perMap) : null };
}

/** "HH:MM" on the event's date (YYYY-MM-DD) → Date, or null. */
export function timeOn(dateStr, hhmm) {
  if (hhmm && /^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}/.test(hhmm)) { const d = new Date(hhmm); return isNaN(d) ? null : d; } // full date + time
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const day = dateStr || new Date().toLocaleDateString('en-CA');
  const d = new Date(`${day}T${hhmm.padStart(5, '0')}:00`);
  return isNaN(d) ? null : d;
}

/**
 * Expected start / end of every match that isn't final: Map id → { start: Date, end: Date, live }.
 * opts: { now: Date, settings, teamById, eventDate }
 */
export function estimateTimes(matches, resolved, games, { now = new Date(), settings = {}, teamById = new Map(), eventDate = null, sunday = null } = {}) {
  const p = pace(matches, games, settings);
  const est = { ...EST_DEFAULTS, ...(settings.est || {}) };
  const MIN = 60000;
  const gbm = gamesByMatch(games);
  const out = new Map();
  const t0 = now.getTime();
  const anyStarted = matches.some(m => m.status === 'live' || m.status === 'final');
  const firstSession = (settings.seating?.sessions || [])[0]?.id;
  const dayStart = timeOn(eventDate, est.session_starts?.[firstSession]) || timeOn(eventDate, est.day_start);
  const base = !anyStarted && dayStart && dayStart.getTime() > t0 ? dayStart.getTime() : t0;
  const brk = p.brk * MIN, setup = p.setup * MIN, slot = p.slot * MIN;
  // per team: when its last match started and ended (its next one waits for the break and the minimum slot)
  const teamEnd = new Map(), teamStart = new Map(), rowFree = new Map(), endOf = new Map(), startOf = new Map();
  const nextOk = (start, end, early) => (early ? end : Math.max(end + brk, start + slot));
  const bump = (map, key, t) => { if (key != null) map.set(key, Math.max(map.get(key) || 0, t)); };
  const seat = settings.seating || {};
  const nRows = Math.max(2, seat.group_rows || 8);
  const sessions = (seat.sessions || []).map(x => x.id);
  // phases: group sessions in order (0, 1 …), then the bracket (1000), then the final day (2000)
  const sesOf = m => {
    if (m.stage !== 'group') return sunday?.has(m.id) ? 2e3 : 1e3;
    const i = sessions.indexOf(seat.plan?.[m.group_label]?.session);
    return i < 0 ? 0 : i;
  };
  const rowsOf = (m, r) => {
    if (m.stage === 'group') return [teamById.get(r?.A)?.row_no, teamById.get(r?.B)?.row_no].filter(x => x != null).map(x => `g${sesOf(m)}:${x}`);
    return [m.row_a, m.row_b].filter(x => x != null).map(x => `b:${x}`);
  };
  const phaseEnd = new Map(); // session index (1000 = bracket) → latest expected end
  const bumpPhase = (m, t) => phaseEnd.set(sesOf(m), Math.max(phaseEnd.get(sesOf(m)) || 0, t));

  // finished matches: teams and rows rest until a gap after they ended
  for (const m of matches) {
    if (m.status !== 'final' && !resolved.get(m.id)?.result?.done) continue;
    const r = resolved.get(m.id) || {};
    const t = m.ended_at ? new Date(m.ended_at).getTime() : 0;
    const st = m.started_at ? new Date(m.started_at).getTime() : t;
    endOf.set(m.id, t); startOf.set(m.id, st);
    bumpPhase(m, t);
    if (nextOk(st, t, false) > base) {
      bump(teamEnd, r.A, t); bump(teamEnd, r.B, t); bump(teamStart, r.A, st); bump(teamStart, r.B, st);
      rowsOf(m, r).forEach(x => bump(rowFree, x, t));
    }
  }
  // live matches: the rest of the series from now (the map in play counts as half done)
  for (const m of matches) {
    if (m.status !== 'live') continue;
    const r = resolved.get(m.id) || {};
    const played = (gbm.get(m.id) || []).filter(g => gameWinner(g)).length;
    const start = m.started_at ? new Date(m.started_at).getTime() : t0;
    // still in setup: the rest of setup, then all the maps; otherwise the map in play counts as half done
    const setupLeft = played ? 0 : Math.max(0, start + setup - t0);
    const left = setupLeft > 0 ? p.expMaps(m.best_of) : Math.max(0.5, p.expMaps(m.best_of) - played - 0.5);
    const end = t0 + setupLeft + left * p.mapMin * MIN;
    out.set(m.id, { start: new Date(start), end: new Date(end), live: true });
    endOf.set(m.id, end); startOf.set(m.id, start);
    bumpPhase(m, end);
    bump(teamEnd, r.A, end); bump(teamEnd, r.B, end); bump(teamStart, r.A, start); bump(teamStart, r.B, start);
    rowsOf(m, r).forEach(x => bump(rowFree, x, end));
  }
  // everything else, phase by phase (sessions in order, then the bracket), on-deck first, then the queue
  const byCode = new Map(matches.filter(m => m.code).map(m => [m.code, m]));
  let todo = matches.filter(m => m.status !== 'final' && m.status !== 'live' && !resolved.get(m.id)?.result?.done
    && resolved.get(m.id)?.A !== 'BYE' && resolved.get(m.id)?.B !== 'BYE')
    .sort((a, b) => sesOf(a) - sesOf(b) || (a.status === 'ondeck' ? 0 : 1) - (b.status === 'ondeck' ? 0 : 1) || (a.queue_pos ?? 1e4) - (b.queue_pos ?? 1e4));
  const gateFor = m => {
    const s = sesOf(m);
    let g = base;
    for (const [ph, t] of phaseEnd) if (ph < s) g = Math.max(g, t);
    const st = s < 1e3 ? timeOn(eventDate, est.session_starts?.[sessions[s]]) : timeOn(eventDate, s === 2e3 ? est.sunday_start || est.bracket_start : est.bracket_start);
    if (st) g = Math.max(g, st.getTime());
    return g;
  };
  for (let pass = 0; pass < 4 && todo.length; pass++) {
    const later = [];
    for (const m of todo) {
      const r = resolved.get(m.id) || {};
      // a team still to be decided is free when the match it comes from ends
      // both teams readied up early: no break
      const early = !!(r.A && r.B && m.checkin?.[r.A] && m.checkin?.[r.B]);
      let ready = gateFor(m), waiting = false;
      for (const [team, src] of [[r.A, m.src_a], [r.B, m.src_b]]) {
        if (team) { if (teamEnd.has(team)) ready = Math.max(ready, nextOk(teamStart.get(team) ?? teamEnd.get(team), teamEnd.get(team), early)); continue; }
        const [kind, ref] = (src || '').split(':');
        const f = (kind === 'W' || kind === 'L') ? byCode.get(ref) : null;
        if (f && endOf.has(f.id)) ready = Math.max(ready, nextOk(startOf.get(f.id) ?? endOf.get(f.id), endOf.get(f.id), early));
        else if (f) waiting = true;
      }
      if (waiting) { later.push(m); continue; }
      let rows = rowsOf(m, r);
      if (m.stage !== 'group' && rows.length < 2) {
        // no rows set yet: the two rows that free up first
        const free = Array.from({ length: nRows }, (_, i) => `b:${i + 1}`).filter(x => !rows.includes(x))
          .sort((a, b) => (rowFree.get(a) || 0) - (rowFree.get(b) || 0));
        rows = [...rows, ...free.slice(0, 2 - rows.length)];
      }
      for (const x of rows) ready = Math.max(ready, rowFree.get(x) || 0);
      const start = ready;
      const end = start + setup + p.expMaps(m.best_of) * p.mapMin * MIN;
      out.set(m.id, { start: new Date(start), end: new Date(end), live: false, early });
      endOf.set(m.id, end); startOf.set(m.id, start);
      bumpPhase(m, end);
      bump(teamEnd, r.A, end); bump(teamEnd, r.B, end); bump(teamStart, r.A, start); bump(teamStart, r.B, start);
      rows.forEach(x => bump(rowFree, x, end));
    }
    if (later.length === todo.length) break;
    todo = later;
  }
  return out;
}

/** "2:40 PM" (rounded to 5 minutes), or "Now" when it's due. */
export function fmtEst(d, now = new Date()) {
  if (!d) return '';
  if (d.getTime() - now.getTime() < 3 * 60000) return 'Now';
  const r = new Date(Math.round(d.getTime() / 300000) * 300000);
  return r.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** A team's break after its last match (the break, and at least the minimum slot from its start): { until, left } or null. */
export function teamBreak(teamId, matches, resolved, settings = {}, now = new Date()) {
  const est = { ...EST_DEFAULTS, ...(settings.est || {}) };
  const brk = Math.min(30, Math.max(0, Number(est.break_minutes ?? 15))) * 60000;
  const slot = Math.max(0, Number(est.slot_minutes ?? 60)) * 60000;
  let last = 0, lastStart = 0;
  for (const m of matches) {
    if (m.status !== 'final' || !m.ended_at) continue;
    const r = resolved.get(m.id);
    if ((r?.A === teamId || r?.B === teamId) && new Date(m.ended_at).getTime() > last) {
      last = new Date(m.ended_at).getTime();
      lastStart = m.started_at ? new Date(m.started_at).getTime() : last;
    }
  }
  const until = Math.max(last + brk, lastStart + slot);
  return last && until > now.getTime() ? { until: new Date(until), left: Math.ceil((until - now.getTime()) / 60000) } : null;
}

// ---------- the final day (top N) ----------

/**
 * Which bracket matches are played on the final day (Sunday, top 6), and what Saturday matches mean for it.
 * Double elimination: Sunday starts with the 2 teams in the winners final and the rest in the lower bracket
 * (top 6 = winners final + losers quarterfinals). So:
 *  - sunday:    winners final, every lower round after the cut, grand final
 *  - both:      Saturday matches whose two teams are already through (upper semis: winner → winners final,
 *               loser → losers quarterfinals). They still play them on Saturday.
 *  - qualifies: Saturday matches whose winner makes it (upper quarters, the last Saturday lower round)
 *  - qualified: teams that are through (in a Sunday or "both" match)
 * The cut is the lower round after which `top` teams are left. Returns null when there's no cut.
 * pickedRounds: ['upper:4', 'lower:4', …] (roundKey) to use the rounds staff ticked instead of working them out.
 */
export const roundKey = m => `${m.stage}:${m.stage === 'grand' ? 1 : m.round}`;

export function finalDayPlan(matches, resolved, top = 6, pickedRounds = null) {
  const bm = matches.filter(m => m.stage !== 'group');
  if (!top || bm.length < 2) return null;
  const next = (m, kind) => bm.find(x => x.src_a === `${kind}:${m.code}` || x.src_b === `${kind}:${m.code}`) || null;
  const sunday = new Set();
  let auto = true;
  if (pickedRounds?.length) {
    // staff picked the Sunday rounds themselves
    const keys = new Set(pickedRounds);
    for (const m of bm) if (keys.has(roundKey(m))) sunday.add(m.id);
    auto = false;
  }
  const real = m => { const r = resolved.get(m.id); return r?.A !== 'BYE' && r?.B !== 'BYE'; };
  const teams = new Set();
  for (const m of bm) for (const src of [m.src_a, m.src_b]) if (src?.startsWith('S:')) {
    const r = resolved.get(m.id); const t = src === m.src_a ? r?.A : r?.B;
    if (t && t !== 'BYE') teams.add(t); else if (!t) teams.add(src);
  }
  const n = teams.size;
  if (auto && n <= top) return null;
  const lower = bm.filter(m => m.stage === 'lower');
  const cutAt = list => {
    const rounds = [...new Set(list.map(m => m.round))].sort((a, b) => a - b);
    let alive = n, prev = null;
    for (const r of rounds) {
      alive -= list.filter(m => m.round === r && real(m)).length;
      if (alive === top) return r;
      if (alive < top) return prev;
      prev = r;
    }
    return null;
  };
  if (!auto) { /* rounds picked by staff */ } else if (lower.length) {
    const cut = cutAt(lower);
    if (cut == null) return null;
    const upperRounds = bm.filter(m => m.stage === 'upper').map(m => m.round);
    const lastUpper = Math.max(...upperRounds);
    for (const m of bm) {
      if (m.stage === 'grand') sunday.add(m.id);
      else if (m.stage === 'lower' && m.round > cut) sunday.add(m.id);
      else if (m.stage === 'upper') {
        const drop = next(m, 'L')?.round ?? Infinity;
        if (m.round === lastUpper || drop > cut + 1) sunday.add(m.id);
      }
    }
  } else {
    const cut = cutAt(bm);
    if (cut == null) return null;
    for (const m of bm) if (m.round > cut) sunday.add(m.id);
  }
  if (!sunday.size) return null;
  // Saturday matches whose winner and loser both end up on Sunday (or in another such match)
  const both = new Set();
  const through = x => x && (sunday.has(x.id) || both.has(x.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const m of bm) {
      if (sunday.has(m.id) || both.has(m.id) || !m.code) continue;
      if (through(next(m, 'W')) && through(next(m, 'L'))) { both.add(m.id); changed = true; }
    }
  }
  const qualifies = new Set();
  for (const m of bm) {
    if (sunday.has(m.id) || both.has(m.id) || !m.code) continue;
    if (through(next(m, 'W'))) qualifies.add(m.id);
  }
  const qualified = new Set();
  for (const id of [...sunday, ...both]) {
    const r = resolved.get(id);
    for (const t of [r?.A, r?.B]) if (t && t !== 'BYE') qualified.add(t);
  }
  return { sunday, both, qualifies, qualified, top, auto };
}
