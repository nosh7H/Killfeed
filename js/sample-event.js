// Builds a fictional LAN event so the event pages, the control panel and the display can be practised
// before the real thing. Three starting points:
//   'start'    teams, rosters, groups, seating and captain links ready; nothing played
//   'mid'      group stage half way: the first session's groups are on their last round
//   'playoffs' group stage done, playoffs under way (default)
import { uid } from './ui.js';
import { MAP_POOL } from './config.js';
import { DEFAULT_EVENT_SETTINGS, eventSettings } from './event-state.js';
import { randomKey } from './veto.js';
import { snakeGroups, roundRobin, buildBracket, resolveMatches, groupStandings, playoffSeeds, groupCount, advanceCount, GROUP_LABELS, autoPlan, planRows, gameWinner, numberMatches } from './event-logic.js';

const TEAMS = [
  ['Night Owls', 'NOWL'], ['Vanta', 'VNTA'], ['Static Pulse', 'SPLS'], ['Red Line', 'RDLN'],
  ['Grim Coast', 'GRIM'], ['Halcyon', 'HLCN'], ['Ironclad', 'IRON'], ['Low Orbit', 'LORB'],
  ['Afterglow', 'AFTR'], ['Black Pine', 'BKPN'], ['Cold Front', 'CDFT'], ['Deadlock', 'DLCK'],
  ['Echo Six', 'ECHO'], ['Foxtrot', 'FXTR'], ['Gravity', 'GRAV'], ['Hollow Point', 'HLPT'],
];
const NAMES = ['Kairo', 'Vexo', 'Trillo', 'Mendez', 'Askr', 'Pyro', 'Lumen', 'Dace', 'Nox', 'Brisk', 'Calyx', 'Fenn', 'Juno', 'Kite', 'Rook', 'Sable',
  'Talon', 'Wren', 'Zeal', 'Ember', 'Haze', 'Ion', 'Jett', 'Koda', 'Lynx', 'Mako', 'Nyx', 'Onyx', 'Pike', 'Quill', 'Rift', 'Sly',
  'Arlo', 'Bex', 'Cade', 'Drift', 'Echo', 'Flux', 'Grit', 'Hex', 'Ivo', 'Jinx', 'Kaze', 'Loki', 'Mox', 'Neon', 'Ozzy', 'Prism',
  'Quake', 'Raze', 'Shade', 'Tox', 'Umbra', 'Vigil', 'Wisp', 'Xeno', 'Yuki', 'Zion', 'Ace', 'Blitz', 'Crux', 'Dusk', 'Envy', 'Frost'];
const MAPS = MAP_POOL;
const rnd = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

export const SAMPLE_STAGES = {
  start: 'Practice · start of event',
  mid: 'Practice · mid group stage',
  playoffs: 'Sample LAN',
};

export async function loadSampleEvent(store, teamCount = 16, name = null, stage = 'playoffs') {
  name ||= SAMPLE_STAGES[stage] || 'Sample LAN';
  const event = await store.createEvent({ name, display_name: 'You' });
  const settings = { ...DEFAULT_EVENT_SETTINGS, maps: MAPS, practice: true };
  await store.updateEvent(event.id, { settings, starts_on: new Date().toLocaleDateString('en-CA'), venue: 'Main hall' });
  const e = event.id;

  // teams + rosters
  const teams = TEAMS.slice(0, Math.max(8, Math.min(16, teamCount))).map(([nm, tag], i) => ({ id: uid(), event_id: e, name: nm, tag, seed: i + 1, group_label: null }));
  const nGroups = groupCount(settings.groups, teams.length);
  const groups = snakeGroups(teams, nGroups);
  teams.forEach(t => { t.group_label = groups[t.id]; });
  // group stage in two sessions: groups fill the morning rows first, then the evening
  settings.seating = { ...settings.seating, plan: autoPlan(teams, settings.seating) };
  const rows = planRows(teams, settings.seating.plan);
  teams.forEach(t => { t.row_no = rows[t.id]; });
  await store.evUpsert('event_teams', teams);
  const players = teams.flatMap((t, i) => NAMES.slice(i * 4, i * 4 + 4).map(g => ({ id: uid(), event_id: e, team_id: t.id, gamertag: g })));
  await store.evUpsert('event_players', players);
  const strength = Object.fromEntries(teams.map((t, i) => [t.id, 1.2 - i * (0.5 / teams.length) + Math.random() * 0.12]));
  const skill = Object.fromEntries(players.map(p => [p.id, 0.85 + Math.random() * 0.35]));

  // group matches
  const matches = [];
  let q = 0;
  const rr = Object.fromEntries(GROUP_LABELS.slice(0, nGroups).map(g => [g, roundRobin(teams.filter(t => t.group_label === g).map(t => t.id))]));
  const rounds = Math.max(...Object.values(rr).map(x => x.length));
  for (let r = 0; r < rounds; r++) {
    for (const g of Object.keys(rr)) (rr[g][r] || []).forEach(([a, b], i) => matches.push({
      id: uid(), event_id: e, stage: 'group', group_label: g, round: r + 1, slot: i + 1, code: `G${g}${r + 1}-${i + 1}`,
      team_a: a, team_b: b, best_of: settings.group_bo, status: 'scheduled', queue_pos: ++q,
    }));
  }
  const keys = () => store.evUpsert('event_team_keys', teams.map(t => ({ team_id: t.id, event_id: e, captain_key: randomKey() + randomKey() })));
  // start / end times so estimated start times have a real pace to learn from (about 11–14 min a map)
  const stampTimes = all => {
    const t = Date.now();
    const played = id => games.filter(g => g.match_id === id && gameWinner(g)).length;
    const done = all.filter(m => m.status === 'final').sort((a, b) => (b.queue_pos ?? 0) - (a.queue_pos ?? 0));
    done.forEach((m, i) => {
      const end = t - (10 + Math.floor(i / 4) * 40 + rnd(0, 8)) * 60000; // four matches at a time, newest first
      m.ended_at = new Date(end).toISOString();
      m.started_at = new Date(end - played(m.id) * rnd(11, 14) * 60000).toISOString();
    });
    for (const m of all.filter(x => x.status === 'live')) m.started_at = new Date(t - (played(m.id) * 12 + rnd(3, 8)) * 60000).toISOString();
  };
  const save = async (all, extra = {}) => {
    stampTimes(all);
    numberMatches(all).forEach(n => { all.find(m => m.id === n.id).match_no = n.match_no; });
    await store.evUpsert('event_teams', teams);
    await keys();
    await store.evUpsert('event_matches', all);
    if (games.length) await store.evUpsert('event_games', games);
    if (stats.length) await store.evUpsert('event_stats', stats);
    await store.updateEvent(e, { settings: { ...eventSettings({ settings }), ...extra } });
    return event;
  };
  const games = [], stats = [];
  const playSeries = (m, A, B, maxMaps = 99) => {
    let a = 0, b = 0, n = 0;
    const need = Math.floor(m.best_of / 2) + 1;
    while (a < need && b < need && n < maxMaps) {
      const mode = settings.mode_order[n % settings.mode_order.length];
      const aWin = Math.random() < strength[A] / (strength[A] + strength[B]);
      const g = { id: uid(), event_id: e, match_id: m.id, game_no: ++n, mode, map: MAPS[mode][rnd(0, MAPS[mode].length - 1)] };
      if (mode === 'Hardpoint') { g.a_score = aWin ? 250 : rnd(140, 240); g.b_score = aWin ? rnd(140, 240) : 250; }
      else if (mode === 'Search & Destroy') { g.a_score = aWin ? 6 : rnd(2, 5); g.b_score = aWin ? rnd(2, 5) : 6; }
      else { g.a_score = aWin ? 4 : rnd(0, 3); g.b_score = aWin ? rnd(0, 3) : 4; }
      aWin ? a++ : b++;
      games.push(g);
      const base = mode === 'Hardpoint' ? 24 : mode === 'Search & Destroy' ? 8 : 20;
      for (const [tid, won] of [[A, aWin], [B, !aWin]]) {
        for (const p of players.filter(x => x.team_id === tid)) {
          const k = Math.max(0, Math.round(base * skill[p.id] * (won ? 1.1 : 0.9) + rnd(-4, 4) * base / 24));
          const d = Math.max(1, Math.round(base * (won ? 0.9 : 1.1) / skill[p.id] + rnd(-4, 4) * base / 24));
          const hp = mode === 'Hardpoint', snd = mode === 'Search & Destroy';
          const line = {
            id: uid(), event_id: e, game_id: g.id, team_id: tid, player_id: p.id, player_name: p.gamertag, kills: k, deaths: d,
            obj_time: hp ? rnd(20, 110) : null, plants: snd ? rnd(0, 2) : null, defuses: snd ? rnd(0, 1) : null, captures: null,
          };
          // caster POV (playoff matches in the sample) adds the advanced columns
          if (m.casted) Object.assign(line, {
            damage: k * rnd(115, 150), assists: rnd(2, 10), non_traded_kills: Math.max(0, k - rnd(3, 8)), highest_streak: rnd(2, 6),
            avg_hill_time: hp ? rnd(3, 15) : null, obj_kills: hp ? rnd(1, 11) : null, contested_time: hp ? rnd(0, 13) : null,
            first_bloods: snd ? rnd(0, 2) : null,
          });
          stats.push(line);
        }
      }
    }
  };
  const liveNow = m => {
    const no = games.filter(g => g.match_id === m.id && gameWinner(g)).length + 1;
    const mode = settings.mode_order[(no - 1) % settings.mode_order.length];
    m.status = 'live';
    m.live = { game_no: no, mode, map: MAPS[mode][rnd(0, MAPS[mode].length - 1)] };
  };

  if (stage === 'start') {
    // doors open: the first match of each group is on deck, nobody has checked in yet
    const firstSession = settings.seating.sessions?.[0]?.id;
    const inFirst = m => !firstSession || settings.seating.plan?.[m.group_label]?.session === firstSession;
    settings.seating.current = firstSession || '';
    const seen = new Set();
    for (const m of matches) if (m.round === 1 && inFirst(m) && !seen.has(m.group_label)) { seen.add(m.group_label); m.status = 'ondeck'; }
    return save(matches);
  }

  if (stage === 'mid') {
    // the first session's groups are on their last round: earlier rounds final, last round live / on deck
    const firstSession = settings.seating.sessions?.[0]?.id;
    const inFirst = m => !firstSession || settings.seating.plan?.[m.group_label]?.session === firstSession;
    settings.seating.current = firstSession || '';
    const mine = matches.filter(inFirst);
    const last = Math.max(...mine.map(m => m.round));
    const seen = new Set();
    for (const m of mine) {
      if (m.round < last) { playSeries(m, m.team_a, m.team_b); m.status = 'final'; continue; }
      if (!seen.has(m.group_label)) { seen.add(m.group_label); playSeries(m, m.team_a, m.team_b, 1); liveNow(m); }
      else m.status = 'ondeck';
    }
    const lv = mine.find(m => m.status === 'live');
    if (lv) lv.checkin = { [lv.team_a]: new Date().toISOString(), [lv.team_b]: new Date().toISOString() };
    return save(matches);
  }

  for (const m of matches) { playSeries(m, m.team_a, m.team_b); m.status = 'final'; }

  // playoffs: generate, play the first round, leave the rest live / queued
  const standings = groupStandings(teams, matches, games);
  const seeds = playoffSeeds(standings, advanceCount(settings.advance));
  const bracket = buildBracket(seeds.length, settings.bracket).map((m, i) => ({
    ...m, id: uid(), event_id: e, team_a: null, team_b: null, best_of: m.stage === 'grand' ? settings.final_bo : settings.playoff_bo, status: 'scheduled', queue_pos: q + i + 1, casted: true,
  }));
  const all = [...matches, ...bracket];
  let res = resolveMatches(all, games, seeds);
  // Saturday so far: upper round 1 and lower round 1 are done
  let pair = 0;
  for (const stage of [['upper', 1], ['lower', 1]]) {
    for (const m of bracket.filter(x => x.stage === stage[0] && x.round === stage[1])) {
      const r = res.get(m.id);
      if (r.A && r.B && r.A !== 'BYE' && r.B !== 'BYE') { playSeries(m, r.A, r.B); m.status = 'final'; m.row_a = (pair % 4) * 2 + 1; m.row_b = (pair % 4) * 2 + 2; pair++; }
    }
    res = resolveMatches(all, games, seeds);
  }
  // one series live on stage, one on deck
  const open = bracket.filter(m => { const r = res.get(m.id); return r.A && r.B && r.A !== 'BYE' && r.B !== 'BYE' && !r.result?.done; });
  open.slice(0, 3).forEach((m, i) => {
    m.row_a = i * 2 + 1; m.row_b = i * 2 + 2;
    playSeries(m, res.get(m.id).A, res.get(m.id).B, Math.min(i + 1, 2));
    liveNow(m); // the map in progress (no running score at the event)
  });
  if (open[3]) {
    open[3].status = 'ondeck'; open[3].row_a = 7; open[3].row_b = 8;
    open[3].checkin = { [res.get(open[3].id).A]: new Date().toISOString() }; // one captain already checked in
  }
  // captains tap who won each map: the last map of one live series is waiting for the other captain to confirm,
  // another one is disputed (staff decide); a third team called staff
  const tapped = (m, check) => {
    const r0 = res.get(m.id);
    const last = games.filter(g => g.match_id === m.id && gameWinner(g)).sort((x, y) => y.game_no - x.game_no)[0];
    if (!last) return;
    const w = gameWinner(last);
    Object.assign(last, { winner: w, a_score: null, b_score: null, win_by: w === 'a' ? r0.A : r0.B, win_check: check, win_at: new Date().toISOString() });
  };
  if (open[0]) tapped(open[0], null);
  if (open[2]) tapped(open[2], 'disputed');
  if (open[1]) {
    const t = teams.find(x => x.id === res.get(open[1].id).B);
    if (t) t.help = { at: new Date(Date.now() - 120000).toISOString(), note: 'Tech / PC issue' };
  }

  return save(all, { seeds });
}
