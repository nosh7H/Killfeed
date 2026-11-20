// Public event pages: overview, bracket, stats, teams. Live-updating.
import { h, clear, fmtDate, fmtTime, fmtNum, fmtPct } from '../ui.js';
import { ev, eventPath, watchEvent, teamName, teamBadge, exportEvent, setMyTeam, setPreview, leaveCaptain, dismissedPicker, ROLE_LABEL, finalDayName } from '../event-state.js';
import { go } from '../state.js';
import { playerBoard } from '../event-logic.js';
import { allStandings, bracketView, queueList, leaderRows, modeColumns, teamRows, statusPill, awardsGrid } from './event-parts.js';
import { sortTable } from './table.js';
import { roundName, seriesResult, gamesByMatch } from '../event-logic.js';

const ADMIN_TABS = [['control', 'Control panel'], ['seating', 'Rows'], ['screens', 'Display'], ['overlays', 'Stream overlays'], ['log', 'Activity'], ['setup', 'Setup']];
const PUBLIC_TABS = [['', 'Overview'], ['bracket', 'Bracket'], ['stats', 'Stats'], ['teams', 'Teams']];

/** Page frame for every event page. Admins get a second, separate admin view
 *  (control panel, rows & pods, display, setup); everyone else only sees the public pages,
 *  plus "My team" for players and captains. */
export function eventShell(active, body) {
  const admin = ev.isAdmin && ADMIN_TABS.some(([k]) => k === active);
  const mine = (ev.role === 'player' || ev.role === 'captain') && ev.myTeam;
  const tabs = admin ? ADMIN_TABS : [...(mine ? [['me', ev.role === 'captain' ? 'My team · Captain' : 'My team']] : []), ...PUBLIC_TABS];
  const e = ev.event;
  return h('div', { class: `page event-page ${admin ? 'is-admin' : ''}` },
    admin ? h('div', { class: 'admin-strip' }, h('span', { class: 'admin-badge' }, ev.manager ? 'Admin' : 'Staff'),
      ev.manager ? 'Only event admins and staff can see these pages. Changes go live on the display right away.'
        : 'You’re staff: run matches, rows, vetoes, results, the display and coin flips. Groups, seeding, teams and links are set by event admins.') : null,
    ev.preview ? h('div', { class: 'admin-strip preview-strip' }, h('span', { class: 'admin-badge' }, 'Preview'),
      ev.preview.role === 'staff' ? 'You’re seeing what a staff member sees.'
        : `You’re seeing what ${ev.role === 'viewer' ? 'a viewer' : `${ev.role === 'captain' ? 'the captain' : 'a player'} of ${teamName(ev.myTeam)}`} sees.`,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-sm', onclick: async () => { await setPreview(null); go(eventPath('control')); } }, 'Exit preview')) : null,
    h('div', { class: 'event-head' },
      h('div', {},
        h('div', { class: 'eyebrow' }, [e.starts_on && fmtDate(e.starts_on), e.venue].filter(Boolean).join(' · ') || 'LAN event'),
        h('h1', {}, e.name)),
      h('div', { class: 'row' },
        ev.isAdmin ? h('div', { class: 'seg', role: 'tablist', 'aria-label': 'View' },
          h('a', { class: admin ? '' : 'on', href: eventPath('') }, 'Public view'),
          h('a', { class: admin ? 'on' : '', href: eventPath('control') }, 'Admin')) : null,
        roleSwitch(),
        h('a', { class: 'btn btn-ghost', href: `#/display/${e.id}`, target: '_blank', rel: 'noopener', 'data-tip': 'Open the rotating TV / stream screen in a new tab' }, 'Display ↗'))),
    h('nav', { class: 'tabs' }, tabs.map(([sub, label]) => h('a', { href: eventPath(sub), class: active === sub ? 'active' : '' }, label))),
    body);
}

/** Who you are on this event. Admins get "Preview as"; everyone else picks their team or keeps watching. */
function roleSwitch() {
  const teams = ev.data.teams.slice().sort((a, b) => a.name.localeCompare(b.name));
  if (ev.realAdmin) {
    const cur = ev.preview ? `${ev.preview.role}:${ev.preview.team || ''}` : 'admin:';
    return h('label', { class: 'role-switch', 'data-tip': 'See the site the way each role does' },
      h('span', { class: 'role-dot r-admin' }), h('select', {
        'aria-label': 'Preview as',
        onchange: async e => {
          const [role, team] = e.target.value.split(':');
          await setPreview(role === 'admin' ? null : { role, team: team || null });
          go(role === 'admin' || role === 'staff' ? eventPath('control') : role === 'viewer' ? eventPath('') : eventPath('me'));
        },
      },
      h('option', { value: 'admin:', selected: cur === 'admin:' }, ev.memberRole === 'staff' ? 'Staff' : 'Admin'),
      ev.memberRole !== 'staff' ? h('option', { value: 'staff:', selected: cur === 'staff:' }, 'Preview as staff') : null,
      h('option', { value: 'viewer:', selected: cur === 'viewer:' }, 'Preview as viewer'),
      h('optgroup', { label: 'Preview as player' }, teams.map(t => h('option', { value: `player:${t.id}`, selected: cur === `player:${t.id}` }, t.name))),
      h('optgroup', { label: 'Preview as captain' }, teams.map(t => h('option', { value: `captain:${t.id}`, selected: cur === `captain:${t.id}` }, t.name)))));
  }
  if (ev.role === 'captain') {
    return h('label', { class: 'role-switch' }, h('span', { class: 'role-dot r-captain' }), h('select', {
      'aria-label': 'Your role',
      onchange: e => { if (e.target.value === 'leave') { leaveCaptain(); go(eventPath('me')); } },
    }, h('option', { value: '' }, `Captain · ${teamName(ev.myTeam)}`), h('option', { value: 'leave' }, 'Stop using the captain link on this device')));
  }
  return h('label', { class: 'role-switch' }, h('span', { class: `role-dot r-${ev.role}` }), h('select', {
    'aria-label': 'Your team',
    onchange: e => { setMyTeam(e.target.value || null); go(e.target.value ? eventPath('me') : eventPath('')); },
  }, h('option', { value: '', selected: !ev.myTeam }, 'Viewer · just watching'),
  h('optgroup', { label: 'I play for…' }, teams.map(t => h('option', { value: t.id, selected: ev.myTeam === t.id }, `Player · ${t.name}`)))));
}

/** First visit: ask players which team they're on (no login). */
function teamPrompt() {
  if (ev.role !== 'viewer' || ev.realAdmin || dismissedPicker() || !ev.data.teams.length) return null;
  const sel = h('select', { 'aria-label': 'Your team' }, h('option', { value: '' }, 'Choose your team…'),
    ev.data.teams.slice().sort((a, b) => a.name.localeCompare(b.name)).map(t => h('option', { value: t.id }, t.name)));
  return h('section', { class: 'block team-prompt' },
    h('div', {}, h('strong', {}, 'Playing in this event?'),
      h('p', { class: 'small muted' }, 'Pick your team to see where you sit, when you play and your live score. Captains: open the link the staff sent you.')),
    h('div', { class: 'row' }, sel,
      h('button', { class: 'btn btn-primary', 'data-submit': '', onclick: () => { if (!sel.value) return; setMyTeam(sel.value); go(eventPath('me')); } }, 'That’s my team'),
      h('button', { class: 'btn btn-ghost', onclick: () => { setMyTeam(null); go(eventPath('')); } }, 'Just watching')));
}

/** Wrap a render function so the page re-renders whenever event data changes. */
export function live(render) {
  const root = h('div');
  const paint = () => clear(root).append(render());
  paint();
  const unsub = watchEvent(() => {
    if (!root.isConnected) { unsub(); return; }
    paint();
  });
  return root;
}

// ---------- overview ----------
export function eventOverview() {
  return live(() => eventShell('', h('div', { class: 'stack' },
    teamPrompt(),
    qualifiedBanner(),
    h('div', { class: 'grid-2 gap-lg' },
      section('Live and up next', queueList({ limit: 8 })),
      section('Top performers', topPerformers())),
    section('Group stage', allStandings()),
    section(ev.projected ? 'Playoffs (projected)' : 'Playoffs', bracketView()),
    section('Awards', awardsGrid()))));
}

function section(title, body, extra) {
  return h('section', { class: 'block' }, h('div', { class: 'block-head' }, h('h2', {}, title), extra || null), body);
}

function topPerformers() {
  const cards = ev.settings.modes.map(mode => {
    const top = leaderRows(mode, 'kd', 1)[0];
    return h('div', { class: 'perf' },
      h('div', { class: 'eyebrow' }, `Best K/D · ${mode}`),
      top ? h('div', {}, h('div', { class: 'perf-name' }, top.name, h('span', { class: 'tag-sm' }, top.team?.tag || '')),
        h('div', { class: 'perf-val' }, top.kd.toFixed(2), h('span', { class: 'muted small' }, ` ${top.kills}–${top.deaths} · ${top.games} maps`)))
        : h('div', { class: 'muted small' }, 'No maps played yet'));
  });
  return h('div', { class: 'perf-grid' }, cards);
}

// ---------- bracket ----------
export function eventBracket() {
  return live(() => eventShell('bracket', h('div', { class: 'stack' }, bracketView(), section('Group stage', allStandings()))));
}

// ---------- stats ----------
export function eventStats() {
  let mode = ev.settings.modes[0] || '';
  let minGames = ev.settings.display.min_games;
  const root = h('div');
  const paint = () => {
    const modes = ['', ...ev.settings.modes];
    const rows = playerBoard(ev.data, { mode }, ev.idx).filter(r => r.games >= minGames);
    const cols = [
      { key: 'name', label: 'Player', render: r => h('span', {}, r.name, r.team ? h('a', { class: 'tag-sm', href: eventPath(`team/${r.team.id}`) }, r.team.tag || r.team.name) : null) },
      { key: 'games', label: 'Maps', num: true },
      { key: 'kd', label: 'K/D', num: true, bar: true, lead: true, fmt: v => v.toFixed(2) },
      { key: 'kills', label: 'K', num: true, lead: true }, { key: 'deaths', label: 'D', num: true },
      { key: 'kpg', label: 'K/map', num: true, lead: true, fmt: v => fmtNum(v, 1) },
      ...(mode ? modeColumns(mode) : [{ key: 'objpg', label: 'OBJ/HP', fmt: fmtTime }, { key: 'plants', label: 'PL' }, { key: 'defuses', label: 'DEF' }])
        .map(c => ({ ...c, num: true, lead: true })),
    ];
    clear(root).append(eventShell('stats', h('div', { class: 'stack' },
      h('div', { class: 'toolbar' },
        h('div', { class: 'seg' }, modes.map(m => h('button', { class: mode === m ? 'on' : '', onclick: () => { mode = m; paint(); } }, m || 'All modes'))),
        h('div', { class: 'row' },
          h('label', { class: 'inline' }, 'Min maps', h('input', { type: 'number', min: 1, value: minGames, class: 'in-num', onchange: e => { minGames = Math.max(1, +e.target.value || 1); paint(); } })),
          h('button', { class: 'btn btn-sm', onclick: () => exportEvent(), 'data-tip': 'All stats as CSV files in a ZIP' }, 'Export stats ↓'))),
      section(mode ? `Players · ${mode}` : 'Players · all modes', sortTable(cols, rows, { sort: 'kd', empty: 'No stats yet.' })),
      section('Teams', teamTable()))));
  };
  paint();
  watchEvent(() => { if (root.isConnected) paint(); });
  return root;
}

export function teamTable() {
  const modes = ev.settings.modes;
  return sortTable([
    { key: 'name', label: 'Team', get: r => r.team.name, render: r => h('span', { class: 'team-cell' }, teamBadge(r.team.id), h('a', { href: eventPath(`team/${r.team.id}`) }, r.team.name)) },
    { key: 'sw', label: 'Series', num: true, render: r => `${r.sw}–${r.sl}` },
    { key: 'mw', label: 'Maps', num: true, render: r => `${r.mw}–${r.ml}` },
    { key: 'md', label: '+/-', num: true, fmt: v => (v > 0 ? `+${v}` : v) },
    { key: 'kd', label: 'K/D', num: true, bar: true, lead: true, fmt: v => (v == null ? '–' : v.toFixed(2)) },
    ...modes.map(m => ({ key: `m:${m}`, label: shortMode(m), num: true, tip: `${m} map record`, get: r => (r.modes[m] ? r.modes[m].w - r.modes[m].l : null), render: r => (r.modes[m] ? `${r.modes[m].w}–${r.modes[m].l}` : '–') })),
  ], teamRows(), { sort: 'sw' });
}

export const shortMode = m => ({ 'Hardpoint': 'HP', 'Search & Destroy': 'SnD', 'Control': 'CTRL', 'Overload': 'OVL', 'Hijack': 'HJK' }[m] || m.slice(0, 4).toUpperCase());

// ---------- teams ----------
export function eventTeams() {
  return live(() => eventShell('teams', h('div', { class: 'team-cards' }, ev.data.teams
    .slice().sort((a, b) => (a.group_label || '').localeCompare(b.group_label || '') || (a.seed ?? 99) - (b.seed ?? 99))
    .map(t => h('a', { class: 'team-tile', href: eventPath(`team/${t.id}`) },
      teamBadge(t.id, 'lg'),
      h('div', {}, h('strong', {}, t.name), h('div', { class: 'muted small' }, t.group_label ? `Group ${t.group_label}` : 'No group'),
        h('div', { class: 'small roster-line' }, ev.data.players.filter(p => p.team_id === t.id).map(p => p.gamertag).join(' · ') || 'No roster')))))));
}

export function eventTeam(teamId) {
  return live(() => {
    const t = ev.teamById.get(teamId);
    if (!t) return eventShell('teams', h('div', { class: 'empty' }, 'Team not found.'));
    const gbm = gamesByMatch(ev.data.games);
    const matches = ev.data.matches.filter(m => { const r = ev.resolved.get(m.id); return r && (r.A === teamId || r.B === teamId); });
    const players = playerBoard(ev.data, { team: teamId }, ev.idx);
    const perMode = ev.settings.modes.map(mode => ({ mode, rows: playerBoard(ev.data, { team: teamId, mode }, ev.idx) }));
    const bm = ev.data.matches.filter(m => m.stage !== 'group');
    return eventShell('teams', h('div', { class: 'stack' },
      h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'eyebrow' }, t.group_label ? `Group ${t.group_label}` : 'Team'), h('h2', { class: 'h-xl' }, t.name, t.tag ? h('span', { class: 'tag-sm' }, t.tag) : null))),
      section('Players · all modes', sortTable([
        { key: 'name', label: 'Player' }, { key: 'games', label: 'Maps', num: true },
        { key: 'kd', label: 'K/D', num: true, bar: true, lead: true, fmt: v => v.toFixed(2) }, { key: 'kills', label: 'K', num: true, lead: true }, { key: 'deaths', label: 'D', num: true },
        { key: 'objpg', label: 'OBJ/HP', num: true, lead: true, fmt: fmtTime }, { key: 'plants', label: 'PL', num: true, lead: true }, { key: 'defuses', label: 'DEF', num: true, lead: true },
      ], players, { sort: 'kd', empty: 'No maps played yet.' })),
      h('div', { class: 'grid-3 gap-lg' }, perMode.map(({ mode, rows }) => section(mode, sortTable([
        { key: 'name', label: 'Player' }, { key: 'kd', label: 'K/D', num: true, lead: true, fmt: v => v.toFixed(2) },
        ...modeColumns(mode).map(c => ({ ...c, num: true, lead: true })),
      ], rows, { sort: 'kd', empty: '—' })))),
      section('Matches', sortTable([
        { key: 'round', label: 'Round', get: m => (m.stage === 'group' ? 0 : 1) * 100 + m.round, render: m => roundName(m, bm) },
        { key: 'opp', label: 'Opponent', get: m => { const r = ev.resolved.get(m.id); return teamName(r.A === teamId ? r.B : r.A) || 'TBD'; } },
        { key: 'score', label: 'Result', num: true, get: m => { const r = ev.resolved.get(m.id); const s = r.result || seriesResult(m, gbm.get(m.id) || []); return r.A === teamId ? s.a - s.b : s.b - s.a; },
          render: m => { const r = ev.resolved.get(m.id); const s = r.result || seriesResult(m, gbm.get(m.id) || []); return r.A === teamId ? `${s.a}–${s.b}` : `${s.b}–${s.a}`; } },
        { key: 'status', label: '', get: m => m.status, render: m => statusPill(m.status) },
      ], matches, { sort: 'round', desc: false, onRow: m => { location.hash = eventPath(`match/${m.id}`); } }))));
  });
}

export { fmtPct };

/** "Qualified for Sunday: NOWL, VNTA …" once teams have made the final day (they can go home for today). */
export function qualifiedBanner() {
  const q = ev.finalDay ? [...ev.finalDay.qualified] : [];
  if (!q.length) return null;
  const day = finalDayName();
  return h('div', { class: 'qualified-banner' },
    h('strong', {}, `Qualified for ${day}`),
    h('span', { class: 'row wrap' }, q.map(id => h('span', { class: 'chip' }, teamBadge(id, 'xs'), teamName(id)))),
    h('span', { class: 'muted small' }, `${q.length} of ${ev.finalDay.top} spots taken. These teams are done for today.`));
}
