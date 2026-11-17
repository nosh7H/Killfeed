// Tournament logic for LAN events. Pure functions — no DOM, unit-testable in Node.
//
// Data shapes (rows from the event_* tables):
//   team   { id, name, tag, group_label, seed }
//   match  { id, stage: 'group'|'upper'|'lower'|'grand', group_label, round, slot, code,
//            team_a, team_b, src_a, src_b, best_of, status, station, queue_pos }
//   game   { id, match_id, game_no, map, mode, a_score, b_score }
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
  if (g.a_score == null || g.b_score == null || g.a_score === '' || g.b_score === '') return null;
  const a = Number(g.a_score), b = Number(g.b_score);
  return a > b ? 'a' : b > a ? 'b' : null;
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

// ---------- standings ----------

export function groupStandings(teams, matches, games) {
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
  const out = {};
  for (const [label, rows] of Object.entries(groups).sort()) {
    out[label] = [...rows.values()].map(r => ({ ...r, md: r.mw - r.ml, pd: r.pf - r.pa }))
      .sort((x, y) => y.sw - x.sw || x.sl - y.sl || y.md - x.md || y.pd - x.pd || (x.team.seed ?? 99) - (y.team.seed ?? 99));
  }
  return out;
}

/** Number of groups: 'auto' = 2 for ≤8 teams, 3 for ≤12, 4 for 13–16 (and beyond). */
export function groupCount(setting, teamCount) {
  if (setting && setting !== 'auto') return Math.max(1, Number(setting) || 1);
  return teamCount <= 8 ? 2 : teamCount <= 12 ? 3 : 4;
}
export const advanceCount = a => (a === 'all' || a == null ? Infinity : Number(a) || Infinity);

/** Interleave group placings into a seed list: A1, B1, C1, …, A2, B2, … (top `advance` per group). */
export function playoffSeeds(standings, advance) {
  const labels = Object.keys(standings).sort();
  const seeds = [];
  const deepest = Math.max(0, ...labels.map(l => standings[l].length));
  for (let p = 0; p < Math.min(advance, deepest); p++) {
    // alternate group order each placing so A2 doesn't always sit next to A1's path
    const ls = p % 2 ? [...labels].reverse() : labels;
    for (const l of ls) if (standings[l][p]) seeds.push(standings[l][p].team.id);
  }
  return seeds;
}

// ---------- stats ----------

const SUMS = ['kills', 'deaths', 'assists', 'damage', 'obj_time', 'plants', 'defuses', 'first_bloods', 'captures'];

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
      if (!rows.has(key)) rows.set(key, { key, name: s.player_name, team: teamById.get(s.team_id) || null, games: 0, ...Object.fromEntries(SUMS.map(f => [f, 0])), hp: 0 });
      const r = rows.get(key);
      r.games++;
      for (const f of SUMS) r[f] += Number(s[f]) || 0;
      if (g.mode === 'Hardpoint' && s.obj_time != null) r.hp++;
    }
  }
  return [...rows.values()].map(r => ({
    ...r,
    kd: r.deaths ? r.kills / r.deaths : r.kills,
    kpg: r.kills / r.games,
    objpg: r.hp ? r.obj_time / r.hp : null,
    dmgpg: r.damage ? r.damage / r.games : null,
  }));
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
