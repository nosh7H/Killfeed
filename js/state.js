import { joinGames, statsByGame } from './stats.js';

export const state = {
  store: null,
  user: null,
  teams: [],
  team: null,       // current team (with .role)
  data: null,       // { players, matches, games, stats }
  joined: [],       // games joined with their match, newest first
  statsIdx: new Map(),
  filters: JSON.parse(sessionStorage.getItem('kf-filters') || '{}'),
};

export function setFilters(f) {
  state.filters = f;
  sessionStorage.setItem('kf-filters', JSON.stringify(f));
}

export async function refreshTeams() {
  state.teams = await state.store.listTeams();
  return state.teams;
}

export async function selectTeam(teamId, force = false) {
  if (!force && state.team?.id === teamId && state.data) return state.team;
  if (!state.teams.length || !state.teams.find(t => t.id === teamId)) await refreshTeams();
  const team = state.teams.find(t => t.id === teamId);
  if (!team) return null;
  if (state.team?.id !== teamId) setFilters({});
  state.team = team;
  localStorage.setItem('kf-last-team', teamId);
  await refreshData();
  return team;
}

export async function refreshData() {
  state.data = await state.store.loadTeamData(state.team.id);
  state.joined = joinGames(state.data);
  state.statsIdx = statsByGame(state.data.stats);
}

export const canEdit = () => ['owner', 'coach', 'player'].includes(state.team?.role);
export const isOwner = () => state.team?.role === 'owner';

export function teamPath(sub = '') { return `#/t/${state.team.id}/${sub}`; }
export function go(hash) { if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = hash; }

// Maps/modes offered in pickers: team config + anything already used
export function knownMaps() {
  return [...new Set([...(state.team?.maps || []), ...state.data.games.map(g => g.map).filter(Boolean)])].sort();
}
export function knownModes() {
  return [...new Set([...(state.team?.modes || []), ...state.data.games.map(g => g.mode).filter(Boolean)])];
}
