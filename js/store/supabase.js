// Cloud store backed by Supabase (Postgres + Auth + Storage). Same API as LocalStore.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { uid } from '../ui.js';

const BUCKET = 'media';

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// columns that are NOT NULL with a default in supabase/schema.sql
const nowIso = () => new Date().toISOString();
const NOT_NULL_DEFAULTS = {
  events: { is_public: true, settings: {}, created_at: nowIso },
  event_admins: { role: 'admin' },
  event_teams: { created_at: nowIso },
  event_matches: { round: 1, slot: 1, best_of: 5, status: 'scheduled', casted: false, checkin: {}, reports: {}, updated_at: nowIso },
  event_games: { game_no: 1 },
  event_media: { created_at: nowIso },
  event_vetoes: { actions: [], status: 'pending', source: 'online', created_at: nowIso, updated_at: nowIso },
  event_log: { at: nowIso },
  event_report_shots: { created_at: nowIso },
};

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
      const statRows = games.flatMap(g => (g.stats || []).map(({ id: _s, ...s }) => ({ ...s, kills: s.kills ?? 0, deaths: s.deaths ?? 0, team_id: teamId, game_id: g.id })));
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

  // ---- schedule ----
  async listSchedule(teamId) {
    const [events, timeoff] = await Promise.all([
      this.sb.from('schedule_events').select('*').eq('team_id', teamId).order('starts_at').then(check),
      this.sb.from('player_timeoff').select('*').eq('team_id', teamId).then(check)]);
    return { events, timeoff };
  }
  async saveScheduleEvent(teamId, ev) {
    const { created_by, ...e } = ev;
    return check(await this.sb.from('schedule_events').upsert({ ...e, id: e.id || uid(), team_id: teamId, updated_at: new Date().toISOString() }).select().single());
  }
  async deleteScheduleEvent(id) { check(await this.sb.from('schedule_events').delete().eq('id', id)); }
  async saveTimeOff(teamId, t) {
    const { created_by, created_at, ...x } = t;
    return check(await this.sb.from('player_timeoff').upsert({ ...x, id: x.id || uid(), team_id: teamId }).select().single());
  }
  async deleteTimeOff(id) { check(await this.sb.from('player_timeoff').delete().eq('id', id)); }

  // ---- VOD breakdowns ----
  async listBreakdowns(teamId) { return check(await this.sb.from('game_breakdowns').select('*').eq('team_id', teamId)); }
  async getBreakdown(gameId) { return check(await this.sb.from('game_breakdowns').select('*').eq('game_id', gameId).maybeSingle()); }
  async saveBreakdown(teamId, row) {
    const { updated_by, updated_at, ...r } = row;
    return check(await this.sb.from('game_breakdowns').upsert({ ...r, team_id: teamId, updated_at: new Date().toISOString() }, { onConflict: 'game_id' }).select().single());
  }
  async deleteBreakdown(gameId) { check(await this.sb.from('game_breakdowns').delete().eq('game_id', gameId)); }

  // ---- notes ----
  async listNotes(teamId) {
    return check(await this.sb.from('team_notes').select('*').eq('team_id', teamId).order('pinned', { ascending: false }).order('updated_at', { ascending: false }));
  }
  async saveNote(teamId, note) {
    const { created_at, updated_by, ...n } = note;
    return check(await this.sb.from('team_notes').upsert({ ...n, id: n.id || uid(), team_id: teamId, updated_at: new Date().toISOString() }).select().single());
  }
  async deleteNote(id) { check(await this.sb.from('team_notes').delete().eq('id', id)); }
  // event team logos (stored under <event_id>/logos/ in the media bucket)
  async evUploadLogo(eventId, teamId, blob) {
    const path = `${eventId}/logos/${teamId}-${uid().slice(0, 8)}.png`;
    check(await this.sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/png' }));
    return path;
  }
  async evLogoUrls(paths) {
    if (!paths.length) return {};
    const data = check(await this.sb.storage.from(BUCKET).createSignedUrls(paths, 60 * 60 * 12));
    return Object.fromEntries(data.filter(d => d.signedUrl).map(d => [d.path, d.signedUrl]));
  }

  // ---- VOD marks ----
  async listMarks(gameId) {
    return check(await this.sb.from('vod_marks').select('*').eq('game_id', gameId).order('t_seconds'));
  }
  async addMark(teamId, gameId, mark) {
    check(await this.sb.from('vod_marks').insert({ ...mark, team_id: teamId, game_id: gameId }));
  }
  async deleteMark(id) { check(await this.sb.from('vod_marks').delete().eq('id', id)); }

  // ================= LAN events =================
  async listEvents() {
    const user = await this.currentUser();
    if (!user) return [];
    const rows = check(await this.sb.from('event_admins').select('role, events(*)').eq('user_id', user.id));
    return rows.filter(r => r.events).map(r => ({ ...r.events, role: r.role }));
  }
  async getEvent(id) {
    return check(await this.sb.from('events').select('*').eq('id', id).maybeSingle());
  }
  async eventAdminCode(eventId) {
    const r = check(await this.sb.from('event_secrets').select('admin_code').eq('event_id', eventId).maybeSingle());
    return r?.admin_code || null;
  }
  async isEventAdmin(eventId) {
    const user = await this.currentUser();
    if (!user) return false;
    const rows = check(await this.sb.from('event_admins').select('role').eq('event_id', eventId).eq('user_id', user.id));
    return rows.length > 0;
  }
  async createEvent({ name, display_name }) {
    return check(await this.sb.rpc('create_event', { p_name: name, p_display: display_name || '' }));
  }
  async joinEventAdmin(code, display_name) {
    return check(await this.sb.rpc('join_event_admin', { p_code: code, p_display: display_name || '' }));
  }
  async updateEvent(id, patch) { check(await this.sb.from('events').update(patch).eq('id', id)); }
  async deleteEvent(id) {
    const media = check(await this.sb.from('event_media').select('path').eq('event_id', id));
    if (media.length) await this.sb.storage.from(BUCKET).remove(media.map(m => m.path));
    check(await this.sb.from('events').delete().eq('id', id));
  }
  async evFetchAll(table, eventId) {
    const out = []; const page = 1000;
    for (let from = 0; ; from += page) {
      const rows = check(await this.sb.from(table).select('*').eq('event_id', eventId).range(from, from + page - 1));
      out.push(...rows);
      if (rows.length < page) return out;
    }
  }
  async evLoad(eventId) {
    const [teams, players, matches, games, stats, vetoes] = await Promise.all(
      ['event_teams', 'event_players', 'event_matches', 'event_games', 'event_stats', 'event_vetoes'].map(t => this.evFetchAll(t, eventId)));
    return { teams, players, matches, games, stats, vetoes };
  }
  async evUpsert(table, rows) {
    rows = [].concat(rows).map(r => (table === 'event_veto_keys' || table === 'event_team_keys' ? (({ id, ...rest }) => rest)(r) : r.id ? r : { ...r, id: uid() }));
    // When rows in one batch have different fields, Supabase sends the missing ones as null, and null isn't
    // allowed in these columns. Fill in the same defaults the database would use (schema.sql).
    const defs = NOT_NULL_DEFAULTS[table];
    if (defs) {
      const keys = new Set(rows.flatMap(r => Object.keys(r)));
      rows = rows.map(r => {
        const out = { ...r };
        for (const [k, v] of Object.entries(defs)) if (out[k] == null && (keys.has(k) || k in out)) out[k] = typeof v === 'function' ? v() : structuredClone(v);
        return out;
      });
    }
    if (rows.length) check(await this.sb.from(table).upsert(rows));
    return rows;
  }
  async evDelete(table, ids) {
    ids = [].concat(ids);
    if (!ids.length) return;
    if (table === 'event_media') {
      const rows = check(await this.sb.from('event_media').select('path').in('id', ids));
      if (rows.length) await this.sb.storage.from(BUCKET).remove(rows.map(r => r.path));
    }
    if (table === 'event_games' || table === 'event_matches') {
      const col = table === 'event_games' ? 'id' : 'match_id';
      const gameIds = table === 'event_games' ? ids : check(await this.sb.from('event_games').select('id').in('match_id', ids)).map(g => g.id);
      if (gameIds.length) {
        const media = check(await this.sb.from('event_media').select('path').in('game_id', gameIds));
        if (media.length) await this.sb.storage.from(BUCKET).remove(media.map(m => m.path));
      }
    }
    check(await this.sb.from(table).delete().in('id', ids));
  }
  async evListMedia(gameId) {
    return check(await this.sb.from('event_media').select('*').eq('game_id', gameId).order('created_at'));
  }
  async evAddScreenshot(eventId, gameId, blob) {
    const path = `${eventId}/${gameId}/${uid()}.jpg`;
    check(await this.sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' }));
    return check(await this.sb.from('event_media').insert({ event_id: eventId, game_id: gameId, path }).select().single());
  }
  // ---- map veto ----
  async getVeto(id) { return check(await this.sb.from('event_vetoes').select('*').eq('id', id).maybeSingle()); }
  async vetoKeys(id) { return check(await this.sb.from('event_veto_keys').select('*').eq('veto_id', id).maybeSingle()); }
  async vetoWhoami(id, key) { return key ? check(await this.sb.rpc('veto_whoami', { p_veto: id, p_key: key })) : null; }
  async vetoAct(id, key, choice) { return check(await this.sb.rpc('veto_act', { p_veto: id, p_key: key, p_choice: choice })); }

  // ---- captains: everything goes through functions that check the captain key ----
  async evLog(eventId, limit = 500) {
    return check(await this.sb.from('event_log').select('*').eq('event_id', eventId).order('at', { ascending: false }).limit(limit));
  }
  async evLogAdd(row) { check(await this.sb.from('event_log').insert(row)); }
  async myEventName(eventId) {
    const user = await this.currentUser();
    if (!user) return null;
    const r = check(await this.sb.from('event_admins').select('display_name').eq('event_id', eventId).eq('user_id', user.id).maybeSingle());
    return r?.display_name || user.email?.split('@')[0] || 'Staff';
  }
  async teamKeys(eventId) { return check(await this.sb.from('event_team_keys').select('*').eq('event_id', eventId)); }
  async captainTeam(eventId, key) { return key ? check(await this.sb.rpc('captain_team', { p_event: eventId, p_key: key })) : null; }
  async captainCheckin(key, matchId, ready) { check(await this.sb.rpc('captain_checkin', { p_key: key, p_match: matchId, p_ready: ready })); }
  async captainReport(key, matchId, games) { check(await this.sb.rpc('captain_report', { p_key: key, p_match: matchId, p_games: games })); }
  async captainMapWon(key, matchId, gameNo, weWon) { return check(await this.sb.rpc('captain_map_won', { p_key: key, p_match: matchId, p_game: gameNo, p_we_won: weWon })); }
  async captainMapCheck(key, matchId, gameNo, ok) { check(await this.sb.rpc('captain_map_check', { p_key: key, p_match: matchId, p_game: gameNo, p_ok: ok })); }
  async captainHelp(key, note) { check(await this.sb.rpc('captain_help', { p_key: key, p_note: note })); }
  async captainShot(key, matchId, gameNo, image) { return check(await this.sb.rpc('captain_shot', { p_key: key, p_match: matchId, p_game: gameNo, p_image: image })); }
  async reportShots(matchId) { return check(await this.sb.from('event_report_shots').select('*').eq('match_id', matchId).order('created_at')); }
  async captainRoster(key, names) { check(await this.sb.rpc('captain_roster', { p_key: key, p_names: names })); }

  /** Realtime: calls cb whenever anything in this event changes. Returns an unsubscribe function. */
  subscribeEvent(eventId, cb) {
    let timer = null;
    const fire = () => { clearTimeout(timer); timer = setTimeout(cb, 250); }; // batch bursts (a saved match = many rows)
    const ch = this.sb.channel(`event-${eventId}-${Math.random().toString(36).slice(2)}`);
    for (const table of ['event_teams', 'event_players', 'event_matches', 'event_games', 'event_stats', 'event_vetoes']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `event_id=eq.${eventId}` }, fire);
    }
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter: `id=eq.${eventId}` }, fire);
    ch.subscribe();
    return () => { clearTimeout(timer); this.sb.removeChannel(ch); };
  }
}
