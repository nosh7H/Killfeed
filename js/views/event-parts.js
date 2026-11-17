// Reusable event widgets — used by the event pages and (in large format) by the display screen.
import { h, fmtTime, fmtNum } from '../ui.js';
import { ev, bracketMatches, teamName, teamTag, eventPath, teamBadge } from '../event-state.js';
import { roundName, playerBoard, teamBoard, queue, computeAwards } from '../event-logic.js';

const STATUS_LABEL = { scheduled: 'Scheduled', ondeck: 'On deck', live: 'Live', final: 'Final' };

export function statusPill(status) {
  return h('span', { class: `status status-${status}` }, status === 'live' ? h('i', { class: 'dot' }) : null, STATUS_LABEL[status] || status);
}

// ---------- group standings ----------
export function standingsTable(label, rows, { link = true } = {}) {
  const adv = ev.settings.advance === 'all' ? 0 : Number(ev.settings.advance) || 0;
  return h('div', { class: 'standings' },
    h('div', { class: 'standings-head' }, h('span', { class: 'eyebrow' }, `Group ${label}`)),
    h('table', { class: 'data tight' },
      h('thead', {}, h('tr', {}, h('th', { class: 'num rank' }, '#'), h('th', {}, 'Team'),
        h('th', { class: 'num', 'data-tip': 'Series won–lost' }, 'Series'), h('th', { class: 'num', 'data-tip': 'Maps won–lost' }, 'Maps'),
        h('th', { class: 'num', 'data-tip': 'Map difference' }, '+/-'))),
      h('tbody', {}, rows.map((r, i) => h('tr', { class: i < adv ? 'qualifies' : '' },
        h('td', { class: 'num rank' }, i + 1),
        h('td', { class: 'team-cell' }, teamBadge(r.team.id), link ? h('a', { href: eventPath(`team/${r.team.id}`) }, r.team.name) : r.team.name,
          null),
        h('td', { class: 'num' }, `${r.sw}–${r.sl}`),
        h('td', { class: 'num' }, `${r.mw}–${r.ml}`),
        h('td', { class: 'num' }, r.md > 0 ? `+${r.md}` : r.md))))));
}

export function allStandings(opts) {
  const labels = Object.keys(ev.standings);
  if (!labels.length) return h('div', { class: 'empty-sm' }, 'Groups appear once teams are added and groups are generated.');
  return h('div', { class: 'standings-grid' }, labels.map(l => standingsTable(l, ev.standings[l], opts)));
}

// ---------- bracket ----------
function matchBox(m, { link = true } = {}) {
  const r = ev.resolved.get(m.id) || {};
  const side = (id, maps, isWinner, which) => {
    const name = teamName(id);
    return h('div', { class: `bm-team ${isWinner ? 'win' : ''} ${!name ? 'tbd' : ''} ${id === 'BYE' ? 'bye' : ''}` },
      h('span', { class: 'bm-name' }, id && id !== 'BYE' ? teamBadge(id, 'xs') : null, name || placeholder(m, which)),
      h('span', { class: 'bm-score' }, r.result ? maps : ''));
  };
  const placeholderSide = which => (which === 'a' ? m.src_a : m.src_b);
  function placeholder(match, which) {
    const src = placeholderSide(which) || '';
    const [kind, ref] = src.split(':');
    if (kind === 'S') return `Seed ${ref}`;
    if (kind === 'W') return `Winner ${ref}`;
    if (kind === 'L') return `Loser ${ref}`;
    return 'TBD';
  }
  const live = m.status === 'live';
  const box = h(link && !ev.projected ? 'a' : 'div', {
    class: `bm ${live ? 'live' : ''} ${r.winner && r.winner !== 'BYE' ? 'done' : ''}`,
    href: link && !ev.projected ? eventPath(`match/${m.id}`) : null,
  },
  h('div', { class: 'bm-meta' }, h('span', {}, m.code), live ? statusPill('live') : m.station && m.status !== 'final' ? h('span', {}, m.station) : null),
  side(r.A, r.result?.a, r.winner && r.winner === r.A, 'a'),
  side(r.B, r.result?.b, r.winner && r.winner === r.B, 'b'));
  return box;
}

export function bracketView(opts = {}) {
  const ms = bracketMatches();
  if (!ms.length) return h('div', { class: 'empty-sm' }, 'The bracket appears once group stage teams are set.');
  const stages = [['upper', ms.some(m => m.stage === 'lower') ? 'Upper bracket' : 'Playoffs'], ['lower', 'Lower bracket']]
    .filter(([st]) => !opts.only || opts.only === st);
  const gf = opts.only === 'lower' ? null : ms.find(m => m.stage === 'grand');
  return h('div', { class: 'bracket-wrap' },
    ev.projected ? h('div', { class: 'projected' }, 'Projected from current group standings') : null,
    stages.map(([stage, label]) => {
      const sm = ms.filter(m => m.stage === stage);
      if (!sm.length) return null;
      const rounds = [...new Set(sm.map(m => m.round))].sort((a, b) => a - b);
      return h('div', { class: 'bracket-stage' },
        h('div', { class: 'eyebrow' }, label),
        h('div', { class: 'bracket', style: { gridTemplateColumns: `repeat(${rounds.length + (stage === 'upper' && gf ? 1 : 0)}, minmax(150px, 1fr))`, '--rounds': rounds.length + (stage === 'upper' && gf ? 1 : 0) } },
          rounds.map(r => h('div', { class: 'bracket-col' },
            h('div', { class: 'bracket-round' }, roundName(sm.find(m => m.round === r), ms)),
            h('div', { class: 'bracket-matches' }, sm.filter(m => m.round === r).sort((a, b) => a.slot - b.slot).map(m => matchBox(m, opts))))),
          stage === 'upper' && gf ? h('div', { class: 'bracket-col' },
            h('div', { class: 'bracket-round' }, 'Grand final'),
            h('div', { class: 'bracket-matches' }, matchBox(gf, opts))) : null));
    }));
}

// ---------- queue ----------
export function queueRows(limit = 8) {
  return queue([...ev.data.matches], ev.resolved).slice(0, limit);
}

export function queueList({ limit = 8, link = true } = {}) {
  const rows = queueRows(limit);
  if (!rows.length) return h('div', { class: 'empty-sm' }, 'No matches waiting.');
  return h('div', { class: 'queue' }, rows.map(m => {
    const r = ev.resolved.get(m.id);
    return h(link ? 'a' : 'div', { class: `queue-row q-${m.status}`, href: link ? eventPath(`match/${m.id}`) : null },
      h('span', { class: 'q-station' }, m.station || '—'),
      h('span', { class: 'q-teams' }, teamBadge(r.A, 'xs'), teamName(r.A), h('span', { class: 'vs' }, 'vs'), teamBadge(r.B, 'xs'), teamName(r.B)),
      h('span', { class: 'q-round' }, roundName(m, ev.data.matches.filter(x => x.stage !== 'group'))),
      statusPill(m.status));
  }));
}

// ---------- leaderboards ----------
export function modeColumns(mode) {
  if (mode === 'Hardpoint') return [{ key: 'objpg', label: 'OBJ/G', tip: 'Hill time per Hardpoint map', fmt: fmtTime }];
  if (mode === 'Search & Destroy') return [
    { key: 'plants', label: 'PL', tip: 'Plants' }, { key: 'defuses', label: 'DEF', tip: 'Defuses' }, { key: 'first_bloods', label: 'FB', tip: 'First bloods' }];
  return [{ key: 'dmgpg', label: 'DMG/G', tip: 'Damage per map', fmt: v => fmtNum(v) }];
}

export function leaderRows(mode, sortKey = 'kd', minGames = ev.settings.display.min_games) {
  return playerBoard(ev.data, { mode }, ev.idx)
    .filter(r => r.games >= Math.max(1, minGames))
    .sort((a, b) => (b[sortKey] ?? -1) - (a[sortKey] ?? -1) || b.kills - a.kills);
}

export function teamRows() { return teamBoard(ev.data, ev.resolved, ev.idx); }

// ---------- awards ----------
export function awardsGrid({ large = false } = {}) {
  const minMaps = Math.max(2, (ev.settings.display.min_games || 2) * 2);
  const list = computeAwards(ev.data, ev.idx, minMaps);
  if (!list.length) return h('div', { class: 'empty-sm' }, 'Awards appear once maps have stats.');
  return h('div', { class: `awards ${large ? 'large' : ''}` }, list.map(a => h('div', { class: `award award-${a.key}` },
    h('div', { class: 'award-title' }, a.title),
    h('div', { class: 'award-val' }, a.display),
    h('div', { class: 'award-who' }, a.row.team ? teamBadge(a.row.team.id, 'xs') : null, h('strong', {}, a.row.name)),
    h('div', { class: 'award-blurb' }, a.blurb))));
}
