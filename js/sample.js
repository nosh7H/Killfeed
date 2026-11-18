// Generates a fictional sample team so the dashboard can be explored in demo mode.
import { uid } from './ui.js';

const MAPS = ['Citadel', 'Dockside', 'Ironworks', 'Summit Base', 'Canal'];
const OPPS = ['Night Owls', 'Static Pulse', 'Red Line GG', 'Vanta', 'Grim Coast'];
const ROSTER = [['Vexo', 'AR'], ['Kairo', 'SMG'], ['Trillo', 'Flex'], ['Mendez', 'SMG']];
const BO5 = ['Hardpoint', 'Search & Destroy', 'Hijack', 'Hardpoint', 'Search & Destroy'];

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
      const base = mode === 'Hardpoint' ? 24 : mode === 'Hijack' ? 22 : 8;
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
            captures: null,
          };
        }),
      };
    }).slice(0, type === 'scrim' ? rnd(3, 5) : 5);
    await store.saveMatch(team.id, { type, played_on: date.toLocaleDateString('en-CA'), opponent: OPPS[d % OPPS.length], event: type === 'match' ? 'Weekly Cup' : null, notes: null }, games);
  }
  await sampleExtras(store, team.id);
  return team;
}

/** Schedule, time off and a few tagged VOD breakdowns for the demo team. */
async function sampleExtras(store, teamId) {
  const { players, games } = await store.loadTeamData(teamId);
  const at = (dayOffset, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d; };
  const ev = (kind, d, hours, extra = {}) => store.saveScheduleEvent(teamId, { kind, starts_at: d.toISOString(), ends_at: new Date(d.getTime() + hours * 3600000).toISOString(), status: 'scheduled', history: [], ...extra });
  await ev('scrim', at(0, 19), 2, { opponent: 'Night Owls' });
  await ev('scrim', at(1, 20), 2, { opponent: 'Vanta', status: 'confirmed' });
  await ev('match', at(2, 21), 1.5, { league_id: 'lg-1', opponent: 'Static Pulse' });
  const moved = at(3, 19);
  await ev('scrim', moved, 2, { opponent: 'Red Line', history: [{ from: at(3, 18).toISOString(), to: moved.toISOString(), at: new Date().toISOString() }] });
  await ev('tournament', at(5, 13), 4, { league_id: 'lg-2', title: 'Weekend Cup' });
  await ev('practice', at(4, 18), 1, { title: 'VOD review' });
  await ev('scrim', at(-2, 19), 2, { opponent: 'Grim Coast', status: 'done' });
  const p = n => players.find(x => x.gamertag === n)?.id;
  const nextTue = (() => { const d = new Date(); d.setDate(d.getDate() + ((2 - d.getDay() + 7) % 7)); d.setHours(18, 0, 0, 0); return d; })();
  await store.saveTimeOff(teamId, { player_id: p('Kairo'), starts_at: nextTue.toISOString(), ends_at: new Date(nextTue.getTime() + 3 * 3600000).toISOString(), repeat: 'weekly', reason: 'Work' });
  await store.saveTimeOff(teamId, { player_id: p('Trillo'), starts_at: at(5, 0).toISOString(), ends_at: at(7, 0).toISOString(), repeat: 'none', reason: 'Travel' });

  // tagged breakdowns for the most recent Hardpoint and S&D maps
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  for (const g of games.filter(x => x.mode === 'Hardpoint').slice(0, 6)) {
    const win = g.team_score > g.opp_score;
    const hills = Array.from({ length: rnd(8, 10) }, (_, i) => {
      const first = Math.random() < (win ? 0.62 : 0.4) ? 'us' : 'them';
      return { n: i + 1, t: 30 + i * 60, first, broken: Math.random() < (first === 'us' ? (win ? 0.25 : 0.45) : (win ? 0.45 : 0.25)), us: null, them: null, unsure: false };
    });
    await store.saveBreakdown(teamId, { game_id: g.id, mode: g.mode, source: Math.random() < 0.5 ? 'pov' : 'caster', data: { hills } });
  }
  for (const g of games.filter(x => x.mode === 'Search & Destroy').slice(0, 6)) {
    const win = g.team_score > g.opp_score;
    const rounds = [];
    const total = (Number(g.team_score) || 0) + (Number(g.opp_score) || 0);
    let us = 0, them = 0;
    for (let n = 1; n <= total; n++) {
      const wantWin = us < g.team_score && (them >= g.opp_score || Math.random() < (win ? 0.6 : 0.4));
      const side = (n - 1) % 2 === 0 ? 'atk' : 'def';
      const events = []; let a = 4, b = 4, t = 8;
      events.push({ k: Math.random() < (wantWin ? 0.65 : 0.35) ? 'kill' : 'death', t }); events[0].k === 'kill' ? b-- : a--;
      while (a > 0 && b > 0) {
        t += rnd(3, 12);
        if (side === 'atk' && t > 35 && !events.some(e => e.k === 'plant') && Math.random() < 0.5) { events.push({ k: 'plant', t }); continue; }
        if (side === 'def' && t > 35 && !events.some(e => e.k === 'plant') && Math.random() < 0.35) { events.push({ k: 'plant', t }); continue; }
        const k = Math.random() < (wantWin ? 0.58 : 0.42) ? 'kill' : 'death';
        if ((k === 'kill' && b === 1 && !wantWin) || (k === 'death' && a === 1 && wantWin)) break;
        events.push({ k, t }); k === 'kill' ? b-- : a--;
      }
      rounds.push({ n, t: n * 95, side, events, result: wantWin ? 'W' : 'L', unsure: false });
      wantWin ? us++ : them++;
    }
    await store.saveBreakdown(teamId, { game_id: g.id, mode: g.mode, source: 'pov', data: { start_side: 'atk', rounds } });
  }
}
