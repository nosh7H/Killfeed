// "My team": the personal page for players (picked their team) and captains (opened their captain link).
// Kept deliberately simple: one card with where and when you play and the one thing to do next.
// Captains: ready up → map veto → tap who won each map (+ optional scoreboard photo). Everything else is folded away.
import { h, clear, toast, fmtTime, compressImage, confirmDialog } from '../ui.js';
import { state, go } from '../state.js';
import { ev, eventPath, refreshEvent, teamName, teamTag, teamBadge, spotOf, setMyTeam, watchEvent, estText, finalDayRole, finalDayName, isQualified } from '../event-state.js';
import { roundName, gamesByMatch, seriesResult, gameWinner, playerBoard, teamSession, queue, teamBreak } from '../event-logic.js';
import { vetoNext, stepLabel } from '../veto.js';
import { eventShell } from './event.js';
import { hasLeftVeto } from './veto.js';

const HELP_REASONS = ['Tech / PC issue', 'Ready to start', 'Rules question', 'Score dispute', 'Other'];
/** Phone photo → small JPEG data URL (captains send photos through a checked database function). */
async function photoData(file) {
  for (const [px, q] of [[1600, 0.72], [1280, 0.6], [1000, 0.5]]) {
    const blob = await compressImage(file, px, q);
    const url = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
    if (url.length <= 1150000) return url;
  }
  throw new Error('That photo is too large');
}
const clock = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const short = mode => (mode === 'Search & Destroy' ? 'S&D' : mode || '');

export function eventMe() {
  const root = h('div');
  let rosterDraft = null; // gamertags being edited
  let helpOpen = false;   // call-staff reasons showing
  let busy = false;

  const run = async (fn, ok) => {
    if (busy) return;
    busy = true;
    try { await fn(); await refreshEvent(); if (ok) toast(ok, 'success'); } catch (e) { toast(e.message.replace(/^.*?:\s*/, ''), 'error'); }
    busy = false; paint();
  };

  function paint() {
    if (root.contains(document.activeElement) && document.activeElement.matches('input, select, textarea')) return;
    const team = ev.teamById.get(ev.myTeam);
    if (!team) {
      clear(root).append(eventShell('me', h('div', { class: 'empty' }, h('h2', {}, 'Which team are you on?'),
        h('p', {}, 'Tap your team. No login needed.'),
        h('div', { class: 'team-pick' }, ev.data.teams.map(t => h('button', { class: 'btn', onclick: () => { setMyTeam(t.id); paint(); } }, teamBadge(t.id, 'xs'), t.name))))));
      return;
    }
    const captain = ev.role === 'captain' && !!ev.captainKey;
    const gbm = gamesByMatch(ev.data.games);
    const bm = ev.data.matches.filter(m => m.stage !== 'group');
    const mine = ev.data.matches.filter(m => { const r = ev.resolved.get(m.id); return r && (r.A === team.id || r.B === team.id) && r.A !== 'BYE' && r.B !== 'BYE'; });
    const order = queue(mine, ev.resolved);
    const open = m => m.status !== 'final' && !ev.resolved.get(m.id)?.result?.done;
    const known = m => ev.resolved.get(m.id)?.A && ev.resolved.get(m.id)?.B;
    const next = order.find(m => m.status === 'live') || order.find(m => m.status === 'ondeck') || order.find(m => open(m) && known(m));
    // the match that just ended: captains can still add its photos
    // captains: a veto in progress for their match opens by itself (once; if they come back, they stay here)
    if (captain && next) {
      const v = ev.data.vetoes.find(x => x.match_id === next.id);
      if (v && v.status !== 'done' && v.source === 'online' && (v.team_a === team.id || v.team_b === team.id) && !hasLeftVeto(v.id)) {
        // after this page is on screen (the first paint happens before it is)
        setTimeout(() => { if (root.isConnected && location.hash.includes('/me')) location.hash = `#/veto/${v.id}?k=${encodeURIComponent(ev.captainKey)}`; }, 0);
      }
    }
    const justDone = mine.filter(m => m.status === 'final' && m.ended_at && Date.now() - new Date(m.ended_at) < 3 * 3600e3)
      .sort((a, b) => b.ended_at.localeCompare(a.ended_at))[0];

    clear(root).append(eventShell('me', h('div', { class: 'stack me-page' },
      h('section', { class: 'block me-head', style: team.color ? { '--tc': team.color } : null },
        teamBadge(team.id, 'lg'),
        h('div', { class: 'grow' }, h('div', { class: 'eyebrow' }, captain ? 'Captain' : 'Player'), h('h2', { class: 'me-name' }, team.name)),
        captain ? helpBox(team) : null),
      isQualified(team.id) ? qualifiedCard(team, next) : null,
      next ? nowCard(next, team, gbm, bm, captain)
        : h('section', { class: 'block' }, h('div', { class: 'empty-sm' }, mine.length ? 'No match right now. Your next one shows up here as soon as it’s set.' : 'Your matches show up here once the schedule is made.')),
      justDone && justDone.id !== next?.id ? photosCard(justDone, team, gbm, captain) : null,
      fold('Our matches', order.length ? h('div', { class: 'list' }, order.map(m => matchRow(m, team, gbm, bm))) : h('div', { class: 'empty-sm' }, 'None yet.')),
      fold('Roster', rosterBlock(team, captain)),
      statsBlock(team),
      captain ? h('p', { class: 'hint small' }, '🔒 This is your team’s captain link. Don’t share it: anyone with it can play captain for your team.') : null)));
  }

  const opened = new Set(); // folded sections stay open across live updates
  const fold = (title, body) => h('details', { class: 'block fold', open: opened.has(title), ontoggle: e => { e.currentTarget.open ? opened.add(title) : opened.delete(title); } },
    h('summary', {}, h('strong', {}, title)), h('div', { class: 'fold-body' }, body));

  // ---------- the one card that matters ----------
  function nowCard(m, team, gbm, bm, captain) {
    const r = ev.resolved.get(m.id);
    const us = r.A === team.id ? 'a' : 'b', them = us === 'a' ? 'b' : 'a';
    const opp = us === 'a' ? r.B : r.A;
    const games = (gbm.get(m.id) || []).slice().sort((a, b) => a.game_no - b.game_no);
    const res = seriesResult(m, games);
    const spot = spotOf(m);
    const label = ev.settings.seating.label || 'Row';
    const myRow = spot?.rows?.[us === 'a' ? 0 : 1] ?? null;
    const oppRow = spot?.rows?.[us === 'a' ? 1 : 0] ?? null;
    const live = m.status === 'live';
    const readyUs = !!m.checkin?.[team.id], readyThem = !!m.checkin?.[opp];
    const brk = !live ? teamBreak(team.id, ev.data.matches, ev.resolved, ev.settings) : null;
    const est = !live ? estText(m) : '';
    const decided = games.filter(g => gameWinner(g)).length;

    // where + when, big and plain
    const facts = h('div', { class: 'now-facts' },
      h('div', {}, h('span', { class: 'eyebrow' }, live ? 'You’re on' : 'Your row'),
        h('strong', {}, myRow != null ? `${label} ${myRow}` : spot?.pod || 'Not set yet'),
        myRow != null ? h('span', { class: 'muted small' }, `${spot.session ? `${spot.session} · ` : ''}${teamTag(opp)} on ${label} ${oppRow ?? '?'}`) : h('span', { class: 'muted small' }, 'Staff will tell you')),
      live
        ? h('div', {}, h('span', { class: 'eyebrow' }, 'Now playing'), h('strong', {}, `Map ${decided + 1}`), h('span', { class: 'muted small' }, `Best of ${m.best_of}`))
        : h('div', {}, h('span', { class: 'eyebrow' }, brk ? 'Break until' : 'Starts'),
          h('strong', {}, brk ? clock(brk.until) : est || 'Soon'),
          h('span', { class: 'muted small' }, brk ? `${brk.left} min break · both ready early = start sooner` : est && est !== 'Now' ? 'Estimate: be ready 15 min early' : m.status === 'ondeck' ? 'Head to your row' : '')));

    const toSunday = finalDayRole(m) === 'qualifies';
    return h('section', { class: `block next-card now-card s-${m.status} ${toSunday ? 'q-sun' : ''}` },
      h('div', { class: 'now-top' },
        h('span', { class: `now-state s-${m.status}` }, live ? '● Playing now' : m.status === 'ondeck' ? 'On deck' : 'Next match'),
        h('span', { class: 'muted small' }, [m.match_no ? `Match ${m.match_no}` : '', roundName(m, bm)].filter(Boolean).join(' · '))),
      h('div', { class: 'next-vs' },
        h('div', { class: 'nv-team' }, teamBadge(team.id, 'md'), h('strong', {}, team.name)),
        h('div', { class: 'nv-score' }, h('span', { class: 'nv-nums' }, h('b', {}, res[us]), '–', h('b', {}, res[them]))),
        h('div', { class: 'nv-team right' }, h('strong', {}, teamName(opp)), teamBadge(opp, 'md'))),
      facts,
      toSunday ? h('div', { class: 'sun-line' }, h('span', { class: 'sun-chip' }, `Winner → ${finalDayName()}`), `Win this and you’re through to ${finalDayName()} (top ${ev.finalDay.top}).`)
        : finalDayRole(m) === 'both' ? h('div', { class: 'sun-line' }, h('span', { class: 'sun-chip' }, `Both → ${finalDayName()}`), `Win or lose, you’re through. Winner plays the winners final, loser the losers quarterfinals.`) : null,
      !live ? h('div', { class: 'checkin-row' },
        h('span', { class: `ci ${readyUs ? 'ok' : ''}` }, readyUs ? '✓ ' : '○ ', `${teamTag(team.id)} ${readyUs ? 'ready' : 'not ready'}`),
        h('span', { class: `ci ${readyThem ? 'ok' : ''}` }, readyThem ? '✓ ' : '○ ', `${teamTag(opp)} ${readyThem ? 'ready' : 'not ready'}`)) : null,
      captain ? captainSteps(m, team, opp, us, games, readyUs, readyThem) : mapList(m, team, opp, us, games, false));
  }

  // through to the final day: tell them plainly they can go home for today
  function qualifiedCard(team, next) {
    const day = finalDayName();
    const onFinalDay = !next || finalDayRole(next) === 'final';
    const e = next && onFinalDay ? estText(next) : '';
    return h('section', { class: 'qualified-banner' },
      h('strong', {}, `✓ Qualified for ${day}`),
      h('span', {}, onFinalDay ? `You’re done for today.${e && e !== 'Now' ? ` Your next match is on ${day}, around ${e.replace('~', '')}.` : ` Your next match is on ${day}.`}`
        : finalDayRole(next) === 'both' ? 'One more match today (win or lose, you’re through), then you’re done.' : 'Finish today’s match first.'));
  }

  // ---------- captain: only what's needed right now ----------
  function captainSteps(m, team, opp, us, games, readyUs, readyThem) {
    const key = ev.captainKey;
    const live = m.status === 'live';
    const decided = games.filter(g => gameWinner(g)).length;
    const veto = ev.data.vetoes.find(v => v.match_id === m.id);
    const out = [];

    // ready up (until the first map is in)
    if (!live && !decided) {
      out.push(readyUs
        ? h('div', { class: 'cap-do done' }, h('span', {}, '✓ You’re ready', readyThem ? '. Both teams are ready.' : `. Waiting for ${teamTag(opp)}.`),
          h('button', { class: 'link-btn small', onclick: () => run(() => state.store.captainCheckin(key, m.id, false), 'Ready removed') }, 'Undo'))
        : h('div', { class: 'cap-do' },
          h('button', { class: 'btn btn-primary btn-big', 'data-submit': '', onclick: () => run(() => state.store.captainCheckin(key, m.id, true), 'You’re ready. Staff can see it.') }, 'We’re ready'),
          h('span', { class: 'muted small' }, 'Tap when everyone is seated. Ready early to start sooner.')));
    }

    // map veto (only while it's open)
    if (veto && veto.status !== 'done' && veto.source !== 'in_person') {
      const st = vetoNext(veto);
      const ourTurn = st && ((st.team === 'a' && veto.team_a === team.id) || (st.team === 'b' && veto.team_b === team.id));
      out.push(h('div', { class: `cap-do ${ourTurn ? 'hot' : ''}` },
        h('a', { class: `btn btn-big ${ourTurn ? 'btn-primary' : ''}`, href: `#/veto/${veto.id}?k=${encodeURIComponent(key)}` }, ourTurn ? `Veto: ${stepLabel(st)}` : 'Open map veto'),
        h('span', { class: 'muted small' }, ourTurn ? 'It’s your turn.' : `Waiting for ${teamTag(opp)}.`)));
    }

    // maps: tap who won (+ optional photo)
    if (live || decided || (readyUs && readyThem)) out.push(mapList(m, team, opp, us, games, true));
    else if (readyUs) out.push(h('p', { class: 'small muted' }, 'Map results go here once both teams are ready.'));
    return h('div', { class: 'cap-dos' }, out);
  }

  // every map so far + the one being played. Captains tap the winner; players just see it.
  function mapList(m, team, opp, us, games, captain) {
    const key = ev.captainKey;
    const decided = games.filter(g => gameWinner(g)).length;
    const res = seriesResult(m, games);
    if (!decided && !captain && m.status !== 'live') {
      return games.some(g => g.map) ? h('div', { class: 'map-chips' }, games.map(g => h('span', { class: 'chip' }, `${g.game_no}. ${short(g.mode)} ${g.map || ''}`))) : null;
    }
    const rows = [];
    const total = res.done ? decided : Math.min(m.best_of, decided + 1);
    for (let no = 1; no <= total; no++) {
      const g = games.find(x => x.game_no === no) || { game_no: no };
      const mode = g.mode || ev.settings.mode_order[(no - 1) % ev.settings.mode_order.length];
      const w = gameWinner(g);
      const winTeam = w ? (w === us ? team.id : opp) : null;
      const shots = (m.reports?.[team.id]?.shots || []).filter(x => x === no).length;
      const photo = captain ? photoBtn(m, no, shots) : null;
      const what = h('span', { class: 'mp-name' }, h('b', {}, `Map ${no}`), h('span', { class: 'muted' }, ` ${short(mode)}${g.map ? ` · ${g.map}` : ''}`));
      if (!w) {
        rows.push(h('div', { class: 'mp-row current' }, what,
          captain ? h('div', { class: 'mp-tap' },
            h('button', { class: 'btn btn-primary', 'data-submit': '', onclick: () => tap(m, no, true, team.id) }, 'We won'),
            h('button', { class: 'btn', onclick: () => tap(m, no, false, opp) }, 'They won'), photo)
            : h('span', { class: 'muted small' }, 'Playing…')));
        continue;
      }
      // the other team tapped this one: we confirm or dispute
      const ask = captain && g.win_by && g.win_by !== team.id && !g.win_check;
      rows.push(h('div', { class: 'mp-row' }, what,
        h('span', { class: `mp-res ${winTeam === team.id ? 'won' : 'lost'}` }, winTeam === team.id ? 'Won' : 'Lost'),
        g.win_check === 'disputed' ? h('span', { class: 'chip chip-warn' }, 'Disputed: staff will decide') : null,
        ask ? h('span', { class: 'mp-check' }, h('span', { class: 'small muted' }, `${teamTag(g.win_by)} reported this.`),
          h('button', { class: 'btn btn-sm', onclick: () => run(() => state.store.captainMapCheck(key, m.id, no, true), 'Thanks') }, '✓ Right'),
          h('button', { class: 'btn btn-sm btn-ghost', onclick: () => run(() => state.store.captainMapCheck(key, m.id, no, false), 'Sent to staff') }, '✗ Wrong')) : null,
        photo));
    }
    return h('div', { class: 'mp-list' }, rows,
      captain && !res.done ? h('p', { class: 'small muted' }, '📷 is optional: a photo of the end-of-map scoreboard helps staff with stats.') : null,
      res.done ? h('p', { class: 'mp-done' }, (res.winner === us) ? `🏆 You won ${Math.max(res.a, res.b)}–${Math.min(res.a, res.b)}` : `Lost ${Math.min(res.a, res.b)}–${Math.max(res.a, res.b)}`) : null);
  }

  async function tap(m, no, weWon, winner) {
    if (!(await confirmDialog(`Map ${no}: ${teamName(winner)} won?`, `Yes, ${teamTag(winner) || 'they'} won`))) return;
    run(async () => {
      const r = await state.store.captainMapWon(ev.captainKey, m.id, no, weWon);
      if (r?.done) toast('Series over. Results are in.', 'success');
    }, `Map ${no} saved`);
  }

  function photoBtn(m, no, shots) {
    return h('label', { class: `photo-btn ${shots ? 'has' : ''}`, 'data-tip': 'Photo of the scoreboard (optional)' },
      h('input', {
        type: 'file', accept: 'image/*', capture: 'environment', hidden: true,
        onchange: e => {
          const file = e.target.files?.[0];
          if (!file) return;
          run(async () => { await state.store.captainShot(ev.captainKey, m.id, no, await photoData(file)); }, `Photo for map ${no} sent`);
        },
      }), shots ? `📷 ${shots}` : '📷');
  }

  // just finished: photos can still be added
  function photosCard(m, team, gbm, captain) {
    const r = ev.resolved.get(m.id);
    const us = r.A === team.id ? 'a' : 'b', opp = us === 'a' ? r.B : r.A;
    const games = (gbm.get(m.id) || []).filter(g => gameWinner(g)).sort((a, b) => a.game_no - b.game_no);
    return h('section', { class: 'block' },
      h('div', { class: 'now-top' }, h('strong', {}, `Last match vs ${teamName(opp)}`), captain ? h('span', { class: 'muted small' }, 'Add scoreboard photos if you have them (optional)') : null),
      games.length ? mapList(m, team, opp, us, gbm.get(m.id) || [], captain) : null);
  }

  // ---------- call staff ----------
  function helpBox(team) {
    const key = ev.captainKey;
    if (team.help) {
      return h('div', { class: 'help-on' },
        h('span', { class: 'pulse-dot' }), h('div', {}, h('strong', {}, 'Staff called'), h('div', { class: 'small muted' }, team.help.note)),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => run(() => state.store.captainHelp(key, null), 'Cancelled') }, 'Cancel'));
    }
    // one small button; the reasons only show after tapping it (kept open across live updates)
    if (helpOpen) {
      return h('div', { class: 'help-pick' }, HELP_REASONS.map(x => h('button', {
        class: 'btn btn-sm', 'data-submit': '', onclick: () => { helpOpen = false; run(() => state.store.captainHelp(key, x), 'Staff called — someone is on the way'); },
      }, x)), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { helpOpen = false; paint(); } }, 'Cancel'));
    }
    return h('button', { class: 'btn btn-sm', onclick: () => { helpOpen = true; paint(); } }, '🙋 Call staff');
  }

  // ---------- folded away ----------
  function matchRow(m, team, gbm, bm) {
    const r = ev.resolved.get(m.id);
    const us = r.A === team.id ? 'a' : 'b';
    const opp = us === 'a' ? r.B : r.A;
    const res = r.result || seriesResult(m, gbm.get(m.id) || []);
    const done = m.status === 'final' || res.done;
    const won = done && res.winner === us;
    return h('a', { class: 'list-row', href: eventPath(`match/${m.id}`) },
      h('span', {}, done ? h('span', { class: `badge badge-${won ? 'W' : 'L'}` }, won ? 'W' : 'L') : m.status === 'live' ? h('span', { class: 'badge badge-live' }, 'LIVE') : null, ' vs ', teamName(opp) || 'TBD'),
      h('span', { class: 'muted small' }, roundName(m, bm), !done && m.status !== 'live' && estText(m) ? ` · ${estText(m)}` : ''),
      h('b', {}, done || res.a + res.b ? `${res[us]}–${res[us === 'a' ? 'b' : 'a']}` : ''));
  }

  function rosterBlock(team, captain) {
    const players = ev.data.players.filter(p => p.team_id === team.id).sort((a, b) => a.gamertag.localeCompare(b.gamertag));
    if (!captain) return players.length ? h('div', { class: 'row wrap' }, players.map(p => h('span', { class: 'chip' }, p.gamertag))) : h('div', { class: 'empty-sm' }, 'No players listed.');
    if (!rosterDraft) rosterDraft = [...players.map(p => p.gamertag), ...Array(Math.max(0, 4 - players.length)).fill('')];
    return h('div', { class: 'stack-sm' },
      h('p', { class: 'small muted' }, 'Use your exact in-game names so stats match up.'),
      h('div', { class: 'roster-edit' }, rosterDraft.map((n, i) => h('input', { value: n, maxlength: 32, placeholder: `Player ${i + 1}`, oninput: e => { rosterDraft[i] = e.target.value; } }))),
      h('div', { class: 'row' },
        rosterDraft.length < 6 ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { rosterDraft.push(''); paint(); } }, '＋ Sub') : null,
        h('span', { class: 'spacer' }),
        h('button', {
          class: 'btn btn-sm btn-primary', onclick: () => {
            const names = rosterDraft.map(x => x.trim()).filter(Boolean);
            if (!names.length) return toast('Add at least one player', 'error');
            run(async () => { await state.store.captainRoster(ev.captainKey, names); rosterDraft = null; }, 'Roster saved');
          },
        }, 'Save roster')));
  }

  function statsBlock(team) {
    const rows = playerBoard(ev.data, { team: team.id }, ev.idx).sort((a, b) => b.kd - a.kd);
    if (!rows.length) return null;
    return fold('Our stats', h('table', { class: 'data tight' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Player'), h('th', { class: 'num' }, 'Maps'), h('th', { class: 'num' }, 'K/D'), h('th', { class: 'num' }, 'K–D'), h('th', { class: 'num' }, 'Hill/HP'))),
      h('tbody', {}, rows.map(r => h('tr', {}, h('td', {}, r.name), h('td', { class: 'num' }, r.games), h('td', { class: 'num' }, r.kd.toFixed(2)), h('td', { class: 'num' }, `${r.kills}–${r.deaths}`), h('td', { class: 'num' }, r.objpg == null ? '–' : fmtTime(r.objpg)))))));
  }

  paint();
  root.addEventListener('focusout', () => setTimeout(() => { if (!root.contains(document.activeElement)) paint(); }, 0));
  watchEvent(() => { if (root.isConnected) paint(); });
  // the break countdown and estimates move with the clock
  const tick = setInterval(() => { if (!root.isConnected) clearInterval(tick); else if (!busy) paint(); }, 60000);
  return root;
}

export { go };
