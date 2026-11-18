import { h, $, clear, toast } from './ui.js';
import { SITE_NAME } from './config.js';
import { createStore, cloudConfigured, inDemoSession, exitDemo } from './store/index.js';
import { state, selectTeam, refreshTeams, teamPath, go } from './state.js';
import { authView } from './views/auth.js';
import { teamsView } from './views/teams.js';
import { dashboardView } from './views/dashboard.js';
import { homeView } from './views/home.js';
import { matchesView, matchDetailView } from './views/matches.js';
import { editorView } from './views/editor.js';
import { gameView } from './views/game.js';
import { playerView } from './views/player.js';
import { settingsView } from './views/settings.js';
import { insightsView } from './views/insights.js';
import { notesView } from './views/notes.js';
import { scheduleView } from './views/schedule.js';
import { eventsView } from './views/events.js';
import { eventOverview, eventBracket, eventStats, eventTeams, eventTeam } from './views/event.js';
import { eventSetup } from './views/event-admin.js';
import { eventControl, eventSeating } from './views/event-control.js';
import { eventScreens } from './views/event-screens.js';
import { eventLog } from './views/event-log.js';
import { eventMe } from './views/event-me.js';
import { eventMatch } from './views/event-match.js';
import { displayView } from './views/display.js';
import { vetoView } from './views/veto.js';
import { loadEvent, ev } from './event-state.js';
import { initTooltips } from './tooltip.js';
import { applyAccent, applyFont, deviceFont } from './theme.js';

const main = () => $('#main');

const routes = [
  [/^#\/teams$/, () => teamsView()],
  [/^#\/t\/([^/]+)\/?(home)?$/, (_, id) => withTeam(id, homeView)],
  [/^#\/t\/([^/]+)\/dashboard$/, (_, id) => withTeam(id, dashboardView)],
  [/^#\/t\/([^/]+)\/matches$/, (_, id) => withTeam(id, matchesView)],
  [/^#\/t\/([^/]+)\/match\/new$/, (_, id) => withTeam(id, () => editorView(null))],
  [/^#\/t\/([^/]+)\/match\/([^/]+)\/edit$/, (_, id, mid) => withTeam(id, () => editorView(mid))],
  [/^#\/t\/([^/]+)\/match\/([^/]+)$/, (_, id, mid) => withTeam(id, () => matchDetailView(mid))],
  [/^#\/t\/([^/]+)\/game\/([^/]+)$/, (_, id, gid) => withTeam(id, () => gameView(gid))],
  [/^#\/t\/([^/]+)\/player\/(.+)$/, (_, id, key) => withTeam(id, () => playerView(decodeURIComponent(key)))],
  [/^#\/t\/([^/]+)\/settings$/, (_, id) => withTeam(id, settingsView)],
  [/^#\/t\/([^/]+)\/insights$/, (_, id) => withTeam(id, insightsView)],
  [/^#\/t\/([^/]+)\/notes$/, (_, id) => withTeam(id, notesView)],
  [/^#\/t\/([^/]+)\/schedule$/, (_, id) => withTeam(id, scheduleView)],
  [/^#\/events$/, () => eventsView()],
];

// Event pages are public (no login needed) so spectators and the venue screen can open them.
const publicRoutes = [
  [/^#\/e\/([^/]+)\/?$/, (_, id) => withEvent(id, eventOverview)],
  [/^#\/e\/([^/]+)\/bracket$/, (_, id) => withEvent(id, eventBracket)],
  [/^#\/e\/([^/]+)\/stats$/, (_, id) => withEvent(id, eventStats)],
  [/^#\/e\/([^/]+)\/teams$/, (_, id) => withEvent(id, eventTeams)],
  [/^#\/e\/([^/]+)\/team\/([^/]+)$/, (_, id, tid) => withEvent(id, () => eventTeam(tid))],
  [/^#\/e\/([^/]+)\/match\/([^/]+)$/, (_, id, mid) => withEvent(id, () => eventMatch(mid))],
  [/^#\/e\/([^/]+)\/setup$/, (_, id) => withEvent(id, eventSetup)],
  [/^#\/e\/([^/]+)\/control$/, (_, id) => withEvent(id, eventControl)],
  [/^#\/e\/([^/]+)\/seating$/, (_, id) => withEvent(id, eventSeating)],
  [/^#\/e\/([^/]+)\/screens$/, (_, id) => withEvent(id, eventScreens)],
  [/^#\/e\/([^/]+)\/log$/, (_, id) => withEvent(id, eventLog)],
  [/^#\/e\/([^/]+)\/me$/, (_, id) => withEvent(id, eventMe)],
  [/^#\/veto\/([^/]+)$/, (_, id) => { markVisitor(); return vetoView(id); }],
];

function markVisitor() { if (!state.user) { try { localStorage.setItem('kf-event-visitor', '1'); } catch { /* private mode */ } } }

async function withEvent(id, view) {
  markVisitor();
  const event = await loadEvent(id, { force: true });
  if (!event) return h('div', { class: 'empty' }, h('h2', {}, 'Event not found'), h('p', {}, 'It may be private, or the link is wrong.'));
  return view();
}

async function withTeam(id, view) {
  const team = await selectTeam(id);
  if (!team) { toast('Team not found or you are not a member.', 'error'); return go('#/teams'); }
  return view();
}

async function route() {
  const [hash, query = ''] = (location.hash || '#/').split('?');
  const disp = hash.match(/^#\/display\/([^/]+)$/);
  document.body.classList.toggle('display-mode', !!disp);
  if (disp) { ev.unsub?.(); mount(await displayView(disp[1], new URLSearchParams(query))); return; }
  if (!hash.startsWith('#/e/') && !hash.startsWith('#/veto/')) ev.unsub?.();
  renderNav();
  for (const [re, fn] of publicRoutes) {
    const m = hash.match(re);
    if (m) return runRoute(fn, m);
  }
  if (!state.user) { mount(authView()); return; }
  if (hash === '#/' || hash === '#') {
    await refreshTeams();
    if (sessionStorage.getItem('kf-demo-seed') === '1') {
      sessionStorage.removeItem('kf-demo-seed');
      if (!state.teams.length) {
        const { loadSample } = await import('./sample.js');
        const t = await loadSample(state.store);
        await refreshTeams();
        return go(`#/t/${t.id}/home`);
      }
    }
    const last = localStorage.getItem('kf-last-team');
    return go(state.teams.find(t => t.id === last) ? `#/t/${last}/home` : '#/teams');
  }
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) return runRoute(fn, m);
  }
  go('#/');
}

async function runRoute(fn, m) {
  mount(h('div', { class: 'loading' }, 'Loading…'));
  try {
    const view = await fn(...m);
    if (view) mount(view);
  } catch (e) {
    console.error(e);
    mount(h('div', { class: 'empty' }, h('h2', {}, 'Something went wrong'), h('p', {}, e.message)));
  }
  renderNav();
}

function mount(node) {
  clear(main()).append(node);
  window.scrollTo(0, 0);
}

function renderNav() {
  const nav = clear($('#nav'));
  const hash = location.hash;
  const inEvent = hash.startsWith('#/e/') && ev.event;
  applyAccent(inEvent ? ev.event.accent : state.team && hash.startsWith('#/t/') ? state.team.accent : null);
  applyFont(inEvent ? ev.event.settings?.font || 'mix' : deviceFont());
  // event visitors (viewers, players, captains: not signed in) only ever see the event. No way into the
  // team analytics side from here; staff sign in from the site's main address.
  const visitor = !state.user && (hash.startsWith('#/e/') || hash.startsWith('#/veto/'));
  const home = visitor ? (ev.event ? `#/e/${ev.event.id}` : location.hash) : '#/';
  nav.append(h('a', { class: 'brand', href: home }, h('span', { class: 'brand-mark' }), SITE_NAME));
  if (!state.user) return;

  const top = h('nav', { class: 'nav-links' },
    h('a', { href: state.team ? teamPath('home') : '#/teams', class: hash.startsWith('#/t/') || hash === '#/teams' ? 'active' : '' }, 'Teams'),
    h('a', { href: '#/events', class: hash.startsWith('#/e') ? 'active' : '' }, 'Events'));
  nav.append(top);

  if (state.team && hash.startsWith('#/t/')) {
    const link = (sub, label, prefixes) => h('a', {
      href: teamPath(sub), class: prefixes.some(p => hash.startsWith(teamPath(p))) ? 'active' : '',
    }, label);
    nav.append(h('nav', { class: 'nav-links sub' },
      link('home', 'Home', ['home']), link('dashboard', 'Dashboard', ['dashboard', 'player']), link('matches', 'Matches', ['match', 'game']), link('schedule', 'Schedule', ['schedule']), link('insights', 'Insights', ['insights']), link('notes', 'Notes', ['notes']), link('settings', 'Team', ['settings'])));
  }

  const right = h('div', { class: 'nav-right' });
  if (state.teams.length && !hash.startsWith('#/e')) {
    right.append(h('select', {
      class: 'team-switch', 'aria-label': 'Switch team',
      onchange: e => e.target.value === '__manage' ? go('#/teams') : go(`#/t/${e.target.value}/home`),
    },
    state.teams.map(t => h('option', { value: t.id, selected: t.id === state.team?.id }, t.tag ? `[${t.tag}] ${t.name}` : t.name)),
    h('option', { value: '__manage' }, '＋ Manage teams…')));
  }
  if (inDemoSession()) {
    right.append(h('span', { class: 'pill pill-demo', 'data-tip': 'You are trying the demo. Nothing here is shared or saved to an account.' }, 'Demo'),
      h('button', { class: 'btn btn-primary btn-sm', onclick: exitDemo }, 'Exit demo · Sign up'));
  } else if (state.store.mode === 'local') right.append(h('span', { class: 'pill pill-demo', 'data-tip': 'Data is saved in this browser only. Add Supabase keys in js/config.js to enable shared teams.' }, 'Demo mode'));
  else right.append(h('button', {
    class: 'btn btn-ghost btn-sm', onclick: async () => { await state.store.signOut(); state.user = null; state.team = null; go('#/'); },
  }, 'Sign out'));
  nav.append(right);
}

async function boot() {
  try {
    state.store = await createStore();
  } catch (e) {
    console.error(e);
    clear(main()).append(h('div', { class: 'empty' }, h('h2', {}, 'Could not start'),
      h('p', {}, cloudConfigured ? 'Could not reach Supabase. Check SUPABASE_URL / key in js/config.js and your connection.' : e.message)));
    return;
  }
  state.user = await state.store.currentUser();
  state.store.onAuthChange(user => {
    const changed = (user?.id || null) !== (state.user?.id || null);
    state.user = user;
    if (changed) { state.team = null; state.teams = []; route(); }
  });
  initTooltips();
  window.addEventListener('hashchange', route);
  route();
}

boot();
