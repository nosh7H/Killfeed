// Export every LAN stat as CSV files (and one ZIP with all of them + a JSON backup).
// Pure data builders (Node-testable) + a tiny uncompressed ZIP writer.
import { toCSV } from './stats.js';
import { playerBoard, teamBoard, roundName, gamesByMatch, gameWinner, seriesResult, indexEvent, matchSpot } from './event-logic.js';

const mmss = s => (s == null || s === '' ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const r2 = v => (v == null || !isFinite(v) ? '' : Math.round(v * 100) / 100);

/** Build { filename: csvText } for an event. */
export function eventCsvs(eventRow, data, resolved, standings, settings) {
  const { admin_code, ...event } = eventRow; // never export the admin code
  const idx = indexEvent(data);
  const team = id => data.teams.find(t => t.id === id);
  const teamById = new Map(data.teams.map(t => [t.id, t]));
  const tname = id => (id === 'BYE' ? 'BYE' : team(id)?.name || '');
  const bm = data.matches.filter(m => m.stage !== 'group');
  const rname = m => roundName(m, bm);
  const gbm = gamesByMatch(data.games);
  const files = {};

  // 1. one row per player per map — the raw table for pivots / Sheets / pandas
  const rows = [];
  for (const g of idx.games) {
    const r = resolved.get(g.match_id) || {};
    const w = gameWinner(g);
    for (const s of idx.statsByGame.get(g.id) || []) {
      const mine = s.team_id === r.A ? 'a' : s.team_id === r.B ? 'b' : null;
      rows.push({
        stage: g.match.stage, round: rname(g.match), match_code: g.match.code || '', map_no: g.game_no, map: g.map, mode: g.mode,
        team: tname(s.team_id), opponent: tname(mine === 'a' ? r.B : mine === 'b' ? r.A : null),
        team_score: mine === 'a' ? g.a_score : mine === 'b' ? g.b_score : '', opp_score: mine === 'a' ? g.b_score : mine === 'b' ? g.a_score : '',
        result: !w || !mine ? '' : w === mine ? 'W' : 'L',
        player: s.player_name, kills: s.kills, deaths: s.deaths, kd: r2((s.kills || 0) / Math.max(1, s.deaths || 0)),
        assists: s.assists ?? '', damage: s.damage ?? '', obj_seconds: s.obj_time ?? '', obj: mmss(s.obj_time),
        plants: s.plants ?? '', defuses: s.defuses ?? '', first_bloods: s.first_bloods ?? '', captures: s.captures ?? '',
      });
    }
  }
  const cols = keys => keys.map(k => ({ key: k, label: k }));
  files['player_maps.csv'] = toCSV(rows, cols(['stage', 'round', 'match_code', 'map_no', 'map', 'mode', 'team', 'opponent', 'team_score', 'opp_score', 'result', 'player', 'kills', 'deaths', 'kd', 'assists', 'damage', 'obj_seconds', 'obj', 'plants', 'defuses', 'first_bloods', 'captures']));

  // 2. player totals: all modes + one block per mode
  const totals = [];
  for (const mode of ['', ...settings.modes]) {
    for (const p of playerBoard(data, { mode }, idx)) {
      totals.push({ mode: mode || 'All', player: p.name, team: p.team?.name || '', maps: p.games, kills: p.kills, deaths: p.deaths, kd: r2(p.kd),
        kills_per_map: r2(p.kpg), damage_per_map: r2(p.dmgpg), obj_per_hp_map: mmss(p.objpg), obj_seconds_total: p.obj_time || '',
        plants: p.plants, defuses: p.defuses, first_bloods: p.first_bloods });
    }
  }
  files['player_totals.csv'] = toCSV(totals, cols(['mode', 'player', 'team', 'maps', 'kills', 'deaths', 'kd', 'kills_per_map', 'damage_per_map', 'obj_per_hp_map', 'obj_seconds_total', 'plants', 'defuses', 'first_bloods']));

  // 3. teams
  const tb = teamBoard(data, resolved, idx);
  files['teams.csv'] = toCSV(tb.map(r => ({
    team: r.team.name, tag: r.team.tag || '', group: r.team.group_label || '', seed: r.team.seed ?? '', group_row: r.team.row_no ?? '',
    series_w: r.sw, series_l: r.sl, maps_w: r.mw, maps_l: r.ml, map_diff: r.md, kills: r.kills, deaths: r.deaths, kd: r2(r.kd),
    ...Object.fromEntries(settings.modes.map(m => [`${m} W-L`, r.modes[m] ? `${r.modes[m].w}-${r.modes[m].l}` : ''])),
    roster: data.players.filter(p => p.team_id === r.team.id).map(p => p.gamertag).join(' / '),
  })), cols(['team', 'tag', 'group', 'seed', 'group_row', 'series_w', 'series_l', 'maps_w', 'maps_l', 'map_diff', 'kills', 'deaths', 'kd', ...settings.modes.map(m => `${m} W-L`), 'roster']));

  // 4. group standings
  const st = [];
  for (const [g, list] of Object.entries(standings)) list.forEach((r, i) => st.push({ group: g, place: i + 1, team: r.team.name, series_w: r.sw, series_l: r.sl, maps_w: r.mw, maps_l: r.ml, map_diff: r.md, points_diff: r.pd }));
  files['group_standings.csv'] = toCSV(st, cols(['group', 'place', 'team', 'series_w', 'series_l', 'maps_w', 'maps_l', 'map_diff', 'points_diff']));

  // 5. matches (series)
  files['matches.csv'] = toCSV(data.matches.map(m => {
    const r = resolved.get(m.id) || {};
    const res = r.result || seriesResult(m, gbm.get(m.id) || []);
    return { stage: m.stage, group: m.group_label || '', round: rname(m), code: m.code || '', team_a: tname(r.A), team_b: tname(r.B), maps_a: res.a, maps_b: res.b,
      winner: tname(r.winner), best_of: m.best_of, status: m.status, pod: matchSpot(m, r, teamById, settings.seating?.label || 'Row')?.label || '' };
  }).sort((a, b) => (a.stage === 'group' ? 0 : 1) - (b.stage === 'group' ? 0 : 1)), cols(['stage', 'group', 'round', 'code', 'team_a', 'team_b', 'maps_a', 'maps_b', 'winner', 'best_of', 'status', 'pod']));

  // 6. maps (every game)
  files['maps.csv'] = toCSV(idx.games.map(g => {
    const r = resolved.get(g.match_id) || {}; const w = gameWinner(g);
    return { round: rname(g.match), code: g.match.code || '', map_no: g.game_no, map: g.map, mode: g.mode, team_a: tname(r.A), team_b: tname(r.B), score_a: g.a_score ?? '', score_b: g.b_score ?? '', winner: w === 'a' ? tname(r.A) : w === 'b' ? tname(r.B) : '' };
  }), cols(['round', 'code', 'map_no', 'map', 'mode', 'team_a', 'team_b', 'score_a', 'score_b', 'winner']));

  // 7. vetoes
  const vrows = [];
  for (const v of data.vetoes || []) {
    const m = data.matches.find(x => x.id === v.match_id);
    for (const a of v.actions) vrows.push({ round: m ? rname(m) : '', team_a: tname(v.team_a), team_b: tname(v.team_b), step: a.i + 1,
      team: a.team ? tname(a.team === 'a' ? v.team_a : v.team_b) : 'auto', action: a.kind, mode: a.mode, choice: a.choice, map_no: a.slot ?? '', time: a.at || '' });
  }
  files['vetoes.csv'] = toCSV(vrows, cols(['round', 'team_a', 'team_b', 'step', 'team', 'action', 'mode', 'choice', 'map_no', 'time']));

  files['event_backup.json'] = JSON.stringify({ event, ...data }, null, 2);
  files['README.txt'] = [
    `${event.name} — stats export (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)`, '',
    'player_maps.csv      one row per player per map (best for pivot tables / pandas)',
    'player_totals.csv    per player, all modes and each mode',
    'teams.csv            team records, K/D, map record per mode, roster',
    'group_standings.csv  final group tables',
    'matches.csv          every series with result and pod',
    'maps.csv             every map with score and winner',
    'vetoes.csv           every pick, ban and side choice',
    'event_backup.json    complete raw data (can be re-imported later)',
  ].join('\n');
  return files;
}

// ---------- minimal ZIP (stored, no compression) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** files: { name: string | Uint8Array } → Uint8Array (zip) */
export function makeZip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === 'string' ? enc.encode(content.startsWith('﻿') || !name.endsWith('.csv') ? content : '﻿' + content) : content;
    const nameBytes = enc.encode(name), crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true); local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameBytes.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
    cen.setUint16(12, dosTime, true); cen.setUint16(14, dosDate, true); cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameBytes.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cenSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, Object.keys(files).length, true); end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}
