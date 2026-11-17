// Builds a fictional LAN event (8 teams, 2 groups, group stage played, playoffs under way)
// so the event pages and the display screen can be explored before the real thing.
import { uid } from './ui.js';
import { DEFAULT_EVENT_SETTINGS, eventSettings } from './event-state.js';
import { snakeGroups, roundRobin, buildBracket, resolveMatches, groupStandings, playoffSeeds, groupCount, advanceCount, GROUP_LABELS } from './event-logic.js';

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
const MAPS = { 'Hardpoint': ['Citadel', 'Dockside', 'Ironworks', 'Summit'], 'Hijack': ['Citadel', 'Canal', 'Summit'], 'Search & Destroy': ['Dockside', 'Canal', 'Ironworks', 'Summit'] };
const rnd = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

export async function loadSampleEvent(store, teamCount = 12, name = 'Sample LAN') {
  const event = await store.createEvent({ name, display_name: 'You' });
  const settings = { ...DEFAULT_EVENT_SETTINGS, maps: MAPS };
  await store.updateEvent(event.id, { settings, starts_on: new Date().toLocaleDateString('en-CA'), venue: 'Main hall' });
  const e = event.id;

  // teams + rosters
  const teams = TEAMS.slice(0, Math.max(8, Math.min(16, teamCount))).map(([nm, tag], i) => ({ id: uid(), event_id: e, name: nm, tag, seed: i + 1, group_label: null }));
  const nGroups = groupCount(settings.groups, teams.length);
  const groups = snakeGroups(teams, nGroups);
  teams.forEach(t => { t.group_label = groups[t.id]; });
  await store.evUpsert('event_teams', teams);
  const players = teams.flatMap((t, i) => NAMES.slice(i * 4, i * 4 + 4).map(g => ({ id: uid(), event_id: e, team_id: t.id, gamertag: g })));
  await store.evUpsert('event_players', players);
  const strength = Object.fromEntries(teams.map((t, i) => [t.id, 1.2 - i * (0.5 / teams.length) + Math.random() * 0.12]));
  const skill = Object.fromEntries(players.map(p => [p.id, 0.85 + Math.random() * 0.35]));

  // group matches
  const matches = [];
  let q = 0;
  for (const g of GROUP_LABELS.slice(0, nGroups)) {
    roundRobin(teams.filter(t => t.group_label === g).map(t => t.id)).forEach((pairs, r) => pairs.forEach(([a, b], i) => matches.push({
      id: uid(), event_id: e, stage: 'group', group_label: g, round: r + 1, slot: i + 1, code: `G${g}${r + 1}-${i + 1}`,
      team_a: a, team_b: b, best_of: settings.group_bo, status: 'scheduled', queue_pos: ++q,
    })));
  }
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
          stats.push({
            id: uid(), event_id: e, game_id: g.id, team_id: tid, player_id: p.id, player_name: p.gamertag, kills: k, deaths: d,
            damage: k * rnd(115, 150), obj_time: mode === 'Hardpoint' ? rnd(20, 110) : null,
            plants: mode === 'Search & Destroy' ? rnd(0, 2) : null, defuses: mode === 'Search & Destroy' ? rnd(0, 1) : null,
            first_bloods: mode === 'Search & Destroy' ? rnd(0, 2) : null, captures: null, assists: null,
          });
        }
      }
    }
  };
  for (const m of matches) { playSeries(m, m.team_a, m.team_b); m.status = 'final'; }

  // playoffs: generate, play the first round, leave the rest live / queued
  const standings = groupStandings(teams, matches, games);
  const seeds = playoffSeeds(standings, advanceCount(settings.advance));
  const bracket = buildBracket(seeds.length, settings.bracket).map((m, i) => ({
    ...m, id: uid(), event_id: e, team_a: null, team_b: null, best_of: m.stage === 'grand' ? settings.final_bo : settings.playoff_bo, status: 'scheduled', queue_pos: q + i + 1,
  }));
  const all = [...matches, ...bracket];
  let res = resolveMatches(all, games, seeds);
  // Saturday so far: upper round 1 and lower round 1 are done
  for (const stage of [['upper', 1], ['lower', 1]]) {
    for (const m of bracket.filter(x => x.stage === stage[0] && x.round === stage[1])) {
      const r = res.get(m.id);
      if (r.A && r.B && r.A !== 'BYE' && r.B !== 'BYE') { playSeries(m, r.A, r.B); m.status = 'final'; }
    }
    res = resolveMatches(all, games, seeds);
  }
  // one series live on stage, one on deck
  const open = bracket.filter(m => { const r = res.get(m.id); return r.A && r.B && r.A !== 'BYE' && r.B !== 'BYE' && !r.result?.done; });
  open.slice(0, 3).forEach((m, i) => { m.status = 'live'; m.station = settings.stations[i]; playSeries(m, res.get(m.id).A, res.get(m.id).B, Math.min(i + 1, 2)); });
  if (open[3]) { open[3].status = 'ondeck'; open[3].station = settings.stations[3]; }

  await store.evUpsert('event_matches', all);
  await store.evUpsert('event_games', games);
  await store.evUpsert('event_stats', stats);
  await store.updateEvent(e, { settings: { ...eventSettings({ settings }), seeds } });
  return event;
}
