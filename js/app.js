import { h, $, clear, toast } from './ui.js';
import { SITE_NAME } from './config.js';
import { createStore, cloudConfigured, inDemoSession, exitDemo } from './store/index.js';
import { state, selectTeam, refreshTeams, teamPath, go } from './state.js';
import { authView } from './views/auth.js';
import { teamsView } from './views/teams.js';
import { dashboardView } from './views/dashboard.js';
import { matchesView, matchDetailView } from './views/matches.js';
import { editorView } from './views/editor.js';
import { gameView } from './views/game.js';
import { playerView } from './views/player.js';
import { settingsView } from './views/settings.js';
import { initTooltips } from './tooltip.js';
import { applyAccent } from './theme.js';

const main = () => $('#main');

const routes = [
  [/^#\/teams$/, () => teamsView()],
  [/^#\/t\/([^/]+)\/?(dashboard)?$/, (_, id) => withTeam(id, dashboardView)],
  [/^#\/t\/([^/]+)\/matches$/, (_, id) => withTeam(id, matchesView)],
  [/^#\/t\/([^/]+)\/match\/new$/, (_, id) => withTeam(id, () => editorView(null))],
  [/^#\/t\/([^/]+)\/match\/([^/]+)\/edit$/, (_, id, mid) => withTeam(id, () => editorView(mid))],
  [/^#\/t\/([^/]+)\/match\/([^/]+)$/, (_, id, mid) => withTeam(id, () => matchDetailView(mid))],
  [/^#\/t\/([^/]+)\/game\/([^/]+)$/, (_, id, gid) => withTeam(id, () => gameView(gid))],
  [/^#\/t\/([^/]+)\/player\/(.+)$/, (_, id, key) => withTeam(id, () => playerView(decodeURIComponent(key)))],
  [/^#\/t\/([^/]+)\/settings$/, (_, id) => withTeam(id, settingsView)],
];

async function withTeam(id, view) {
  const team = await selectTeam(id);
  if (!team) { toast('Team not found or you are not a member.', 'error'); return go('#/teams'); }
  return view();
}

async function route() {
  const hash = location.hash || '#/';
  renderNav();
  if (!state.user) { mount(authView()); return; }
  if (hash === '#/' || hash === '#') {
    await refreshTeams();
    if (sessionStorage.getItem('kf-demo-seed') === '1') {
      sessionStorage.removeItem('kf-demo-seed');
      if (!state.teams.length) {
        const { loadSample } = await import('./sample.js');
        const t = await loadSample(state.store);
        await refreshTeams();
        return go(`#/t/${t.id}/dashboard`);
      }
    }
    const last = localStorage.getItem('kf-last-team');
    return go(state.teams.find(t => t.id === last) ? `#/t/${last}/dashboard` : '#/teams');
  }
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      mount(h('div', { class: 'loading' }, 'Loading…'));
      try {
        const view = await fn(...m);
        if (view) mount(view);
      } catch (e) {
        console.error(e);
        mount(h('div', { class: 'empty' }, h('h2', {}, 'Something went wrong'), h('p', {}, e.message)));
      }
      renderNav();
      return;
    }
  }
  go('#/');
}

function mount(node) {
  clear(main()).append(node);
  window.scrollTo(0, 0);
}

function renderNav() {
  const nav = clear($('#nav'));
  const hash = location.hash;
  applyAccent(state.team && hash.startsWith('#/t/') ? state.team.accent : null);
  nav.append(h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark' }, '◣'), SITE_NAME));
  if (!state.user) return;

  if (state.team && hash.startsWith('#/t/')) {
    const link = (sub, label, prefixes) => h('a', {
      href: teamPath(sub), class: prefixes.some(p => hash.startsWith(teamPath(p))) ? 'active' : '',
    }, label);
    nav.append(h('nav', { class: 'nav-links' },
      link('dashboard', 'Dashboard', ['dashboard', 'player']), link('matches', 'Matches', ['match', 'game']), link('settings', 'Team', ['settings'])));
  }

  const right = h('div', { class: 'nav-right' });
  if (state.teams.length) {
    right.append(h('select', {
      class: 'team-switch', 'aria-label': 'Switch team',
      onchange: e => e.target.value === '__manage' ? go('#/teams') : go(`#/t/${e.target.value}/dashboard`),
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
