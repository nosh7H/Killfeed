// Generates a fictional sample team so the dashboard can be explored in demo mode.
import { uid } from './ui.js';

const MAPS = ['Citadel', 'Dockside', 'Ironworks', 'Summit Base', 'Canal'];
const OPPS = ['Night Owls', 'Static Pulse', 'Red Line GG', 'Vanta', 'Grim Coast'];
const ROSTER = [['Vexo', 'AR'], ['Kairo', 'SMG'], ['Trillo', 'Flex'], ['Mendez', 'SMG']];
const BO5 = ['Hardpoint', 'Search & Destroy', 'Control', 'Hardpoint', 'Search & Destroy'];

const rnd = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];

export async function loadSample(store) {
  const team = await store.createTeam({ name: 'Sample Squad', tag: 'SMPL', display_name: 'You' });
  await store.updateTeam(team.id, { maps: MAPS });
  for (const [gt, role] of ROSTER) await store.savePlayer(team.id, { gamertag: gt, role });
  const { players } = await store.loadTeamData(team.id);
  const skill = Object.fromEntries(players.map((p, i) => [p.id, [1.15, 1.0, 0.92, 1.05][i]]));

  const today = new Date();
  for (let d = 0; d < 14; d++) {
    const date = new Date(today); date.setDate(today.getDate() - d * 2 - 1);
    const type = d % 4 === 0 ? 'match' : 'scrim';
    const games = BO5.map((mode, i) => {
      const map = pick(MAPS);
      const mapBias = { Citadel: 0.15, Dockside: -0.1, Ironworks: 0.05, 'Summit Base': -0.05, Canal: 0 }[map];
      const win = Math.random() < 0.5 + mapBias;
      let team_score, opp_score;
      if (mode === 'Hardpoint') { team_score = win ? 250 : rnd(120, 240); opp_score = win ? rnd(120, 240) : 250; }
      else if (mode === 'Search & Destroy') { team_score = win ? 6 : rnd(1, 5); opp_score = win ? rnd(1, 5) : 6; }
      else { team_score = win ? 3 : rnd(0, 2); opp_score = win ? rnd(0, 2) : 3; }
      const base = mode === 'Hardpoint' ? 24 : mode === 'Control' ? 27 : 8;
      return {
        id: uid(), game_no: i + 1, map, mode, team_score, opp_score, vod_url: null, notes: null,
        stats: players.map(p => {
          const k = Math.max(0, Math.round(base * skill[p.id] * (win ? 1.08 : 0.92) + rnd(-5, 5) * (base / 24)));
          const dth = Math.max(1, Math.round(base * (win ? 0.92 : 1.08) / skill[p.id] + rnd(-4, 4) * (base / 24)));
          return {
            player_id: p.id, player_name: p.gamertag, kills: k, deaths: dth, assists: null,
            damage: Math.round(k * rnd(120, 160)),
            obj_time: mode === 'Hardpoint' ? rnd(25, p.gamertag === 'Kairo' || p.gamertag === 'Mendez' ? 110 : 70) : null,
            plants: mode === 'Search & Destroy' ? rnd(0, 2) : null,
            defuses: mode === 'Search & Destroy' ? rnd(0, 1) : null,
            first_bloods: mode === 'Search & Destroy' ? rnd(0, 3) : null,
            captures: mode === 'Control' ? rnd(1, 6) : null,
          };
        }),
      };
    }).slice(0, type === 'scrim' ? rnd(3, 5) : 5);
    await store.saveMatch(team.id, { type, played_on: date.toLocaleDateString('en-CA'), opponent: OPPS[d % OPPS.length], event: type === 'match' ? 'Weekly Cup' : null, notes: null }, games);
  }
  return team;
}
