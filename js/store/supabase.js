// Cloud store backed by Supabase (Postgres + Auth + Storage). Same API as LocalStore.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { uid } from '../ui.js';

const BUCKET = 'media';

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export class SupabaseStore {
  mode = 'cloud';

  async init() {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    this.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

  // ---- auth ----
  async currentUser() {
    const { data } = await this.sb.auth.getSession();
    return data.session?.user || null;
  }
  onAuthChange(cb) { this.sb.auth.onAuthStateChange((_e, session) => cb(session?.user || null)); }
  async signIn(email, password) { check(await this.sb.auth.signInWithPassword({ email, password })); }
  async signUp(email, password) {
    const data = check(await this.sb.auth.signUp({
      email, password, options: { emailRedirectTo: location.origin + location.pathname },
    }));
    return { needsConfirm: !data.session };
  }
  async magicLink(email) {
    check(await this.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } }));
  }
  async resetPassword(email) {
    check(await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
  }
  async signOut() { await this.sb.auth.signOut(); }

  // ---- teams ----
  async listTeams() {
    const user = await this.currentUser();
    const rows = check(await this.sb.from('team_members').select('role, teams(*)').eq('user_id', user.id));
    return rows.filter(r => r.teams).map(r => ({ ...r.teams, role: r.role }));
  }
  async createTeam({ name, tag, display_name }) {
    return check(await this.sb.rpc('create_team', { p_name: name, p_tag: tag || '', p_display: display_name || '' }));
  }
  async joinTeam(code, display_name) {
    return check(await this.sb.rpc('join_team', { p_code: code, p_display: display_name || '' }));
  }
  async updateTeam(id, patch) { check(await this.sb.from('teams').update(patch).eq('id', id)); }
  async deleteTeam(id) {
    // remove stored files first (DB rows cascade)
    const media = check(await this.sb.from('media').select('path').eq('team_id', id));
    if (media.length) await this.sb.storage.from(BUCKET).remove(media.map(m => m.path));
    check(await this.sb.from('teams').delete().eq('id', id));
  }
  async rotateInvite(id) { return check(await this.sb.rpc('rotate_invite', { p_team: id })); }
  async listMembers(teamId) {
    return check(await this.sb.from('team_members').select('*').eq('team_id', teamId).order('joined_at'));
  }
  async setMemberRole(teamId, userId, role) {
    check(await this.sb.from('team_members').update({ role }).eq('team_id', teamId).eq('user_id', userId));
  }
  async removeMember(teamId, userId) {
    check(await this.sb.from('team_members').delete().eq('team_id', teamId).eq('user_id', userId));
  }

  // ---- data ----
  async fetchAll(table, teamId) {
    const out = []; const page = 1000;
    for (let from = 0; ; from += page) {
      const rows = check(await this.sb.from(table).select('*').eq('team_id', teamId).range(from, from + page - 1));
      out.push(...rows);
      if (rows.length < page) return out;
    }
  }
  async loadTeamData(teamId) {
    const [players, matches, games, stats] = await Promise.all(
      ['players', 'matches', 'games', 'stats'].map(t => this.fetchAll(t, teamId)));
    return { players, matches, games, stats };
  }
  async savePlayer(teamId, p) {
    if (p.id) check(await this.sb.from('players').update({ gamertag: p.gamertag, role: p.role, active: p.active }).eq('id', p.id));
    else check(await this.sb.from('players').insert({ team_id: teamId, gamertag: p.gamertag, role: p.role || null, active: true }));
  }
  async deletePlayer(id) { check(await this.sb.from('players').delete().eq('id', id)); }

  async saveMatch(teamId, match, games) {
    const id = match.id || uid();
    const { id: _ignore, created_at, created_by, ...m } = match;
    check(await this.sb.from('matches').upsert({ ...m, id, team_id: teamId }));

    const existing = check(await this.sb.from('games').select('id').eq('match_id', id));
    const keep = new Set(games.map(g => g.id));
    const removed = existing.map(g => g.id).filter(gid => !keep.has(gid));
    if (removed.length) {
      const media = check(await this.sb.from('media').select('path').in('game_id', removed));
      if (media.length) await this.sb.storage.from(BUCKET).remove(media.map(x => x.path));
      check(await this.sb.from('games').delete().in('id', removed));
    }
    if (games.length) {
      const gameRows = games.map(({ stats, match, created_at, ...g }) => ({ ...g, team_id: teamId, match_id: id }));
      check(await this.sb.from('games').upsert(gameRows));
      check(await this.sb.from('stats').delete().in('game_id', games.map(g => g.id)));
      const statRows = games.flatMap(g => (g.stats || []).map(({ id: _s, ...s }) => ({ ...s, team_id: teamId, game_id: g.id })));
      if (statRows.length) check(await this.sb.from('stats').insert(statRows));
    }
    return id;
  }
  async deleteMatch(id) {
    const media = check(await this.sb.from('media').select('path, games!inner(match_id)').eq('games.match_id', id));
    if (media.length) await this.sb.storage.from(BUCKET).remove(media.map(m => m.path));
    check(await this.sb.from('matches').delete().eq('id', id));
  }

  // ---- media ----
  async listMedia(gameId) {
    return check(await this.sb.from('media').select('*').eq('game_id', gameId).order('created_at'));
  }
  async addScreenshot(teamId, gameId, blob) {
    const path = `${teamId}/${gameId}/${uid()}.jpg`;
    check(await this.sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' }));
    return check(await this.sb.from('media').insert({ team_id: teamId, game_id: gameId, kind: 'screenshot', path }).select().single());
  }
  async mediaUrl(m) {
    const data = check(await this.sb.storage.from(BUCKET).createSignedUrl(m.path, 3600));
    return data.signedUrl;
  }
  async deleteMedia(m) {
    await this.sb.storage.from(BUCKET).remove([m.path]);
    check(await this.sb.from('media').delete().eq('id', m.id));
  }

  // ---- VOD marks ----
  async listMarks(gameId) {
    return check(await this.sb.from('vod_marks').select('*').eq('game_id', gameId).order('t_seconds'));
  }
  async addMark(teamId, gameId, mark) {
    check(await this.sb.from('vod_marks').insert({ ...mark, team_id: teamId, game_id: gameId }));
  }
  async deleteMark(id) { check(await this.sb.from('vod_marks').delete().eq('id', id)); }
}
