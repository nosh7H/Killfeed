// Demo store: everything lives in this browser (IndexedDB). Same API as the cloud store.
import { uid } from '../ui.js';
import { DEFAULT_MODES } from '../config.js';
import { applyVeto } from '../veto.js';

const DB_NAME = 'killfeed-demo';
const TABLES = ['teams', 'team_members', 'players', 'matches', 'games', 'stats', 'media', 'vod_marks', 'team_notes', 'game_breakdowns', 'schedule_events', 'player_timeoff',
  'events', 'event_admins', 'event_teams', 'event_players', 'event_matches', 'event_games', 'event_stats', 'event_media', 'event_vetoes', 'event_veto_keys'];
const EV_CHILD = ['event_teams', 'event_players', 'event_matches', 'event_games', 'event_stats', 'event_media', 'event_vetoes', 'event_veto_keys'];
const LOCAL_USER = { id: 'local-user', email: 'demo@local' };

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('blobs'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function idb(db, store, mode, fn) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}

export class LocalStore {
  mode = 'local';
  async init() {
    this.db = await openDB();
    const saved = await idb(this.db, 'kv', 'readonly', s => s.get('db'));
    this.t = saved || Object.fromEntries(TABLES.map(t => [t, []]));
    for (const t of TABLES) this.t[t] = this.t[t] || [];
    this.listeners = new Set();
    if ('BroadcastChannel' in window) {
      this.chan = new BroadcastChannel('killfeed-demo');
      this.chan.onmessage = async () => { await this.reload(); this.listeners.forEach(fn => fn()); };
    }
  }
  async persist() {
    await idb(this.db, 'kv', 'readwrite', s => s.put(this.t, 'db'));
    this.chan?.postMessage('changed'); // tell other tabs (e.g. the display screen) to reload
  }
  async reload() {
    const saved = await idb(this.db, 'kv', 'readonly', s => s.get('db'));
    if (saved) { this.t = saved; for (const t of TABLES) this.t[t] = this.t[t] || []; }
  }
  now() { return new Date().toISOString(); }

  // ---- auth (single local user) ----
  async currentUser() { return LOCAL_USER; }
  onAuthChange() {}
  async signOut() {}

  // ---- teams ----
  async listTeams() {
    return this.t.team_members.filter(m => m.user_id === LOCAL_USER.id)
      .map(m => ({ ...this.t.teams.find(t => t.id === m.team_id), role: m.role }))
      .filter(t => t.id);
  }
  async createTeam({ name, tag, display_name }) {
    const team = {
      id: uid(), name, tag: tag || null, maps: [], modes: [...DEFAULT_MODES],
      invite_code: Math.random().toString(36).slice(2, 10).toUpperCase(), created_by: LOCAL_USER.id, created_at: this.now(),
    };
    this.t.teams.push(team);
    this.t.team_members.push({ team_id: team.id, user_id: LOCAL_USER.id, role: 'owner', display_name: display_name || 'You', joined_at: this.now() });
    await this.persist();
    return team;
  }
  async joinTeam(code) {
    const team = this.t.teams.find(t => t.invite_code === code.trim().toUpperCase());
    if (!team) throw new Error('Invalid invite code. (In demo mode, teams only exist in this browser.)');
    return team;
  }
  async updateTeam(id, patch) {
    Object.assign(this.t.teams.find(t => t.id === id), patch);
    await this.persist();
  }
  async deleteTeam(id) {
    const gameIds = new Set(this.t.games.filter(g => g.team_id === id).map(g => g.id));
    for (const m of this.t.media.filter(m => m.team_id === id)) await this.deleteBlob(m.path);
    for (const tb of TABLES) {
      this.t[tb] = this.t[tb].filter(r => (tb === 'teams' ? r.id : r.team_id) !== id && !gameIds.has(r.game_id));
    }
    await this.persist();
  }
  async rotateInvite(id) {
    const code = Math.random().toString(36).slice(2, 10).toUpperCase();
    await this.updateTeam(id, { invite_code: code });
    return code;
  }
  async listMembers(teamId) {
    return this.t.team_members.filter(m => m.team_id === teamId).map(m => ({ ...m, email: LOCAL_USER.email }));
  }
  async setMemberRole() { throw new Error('Member management needs cloud mode.'); }
  async removeMember() { throw new Error('Member management needs cloud mode.'); }

  // ---- data ----
  async loadTeamData(teamId) {
    const pick = tb => this.t[tb].filter(r => r.team_id === teamId).map(r => ({ ...r }));
    return { players: pick('players'), matches: pick('matches'), games: pick('games'), stats: pick('stats') };
  }
  async savePlayer(teamId, p) {
    if (p.id) Object.assign(this.t.players.find(x => x.id === p.id), p);
    else this.t.players.push({ active: true, ...p, id: uid(), team_id: teamId, created_at: this.now() });
    await this.persist();
  }
  async deletePlayer(id) {
    this.t.players = this.t.players.filter(p => p.id !== id);
    this.t.stats.forEach(s => { if (s.player_id === id) s.player_id = null; });
    await this.persist();
  }

  /** match: {...}, games: [{..., stats: [...]}] */
  async saveMatch(teamId, match, games) {
    const id = match.id || uid();
    const existing = this.t.matches.find(m => m.id === id);
    const row = { ...existing, ...match, id, team_id: teamId, created_at: existing?.created_at || this.now() };
    this.t.matches = this.t.matches.filter(m => m.id !== id).concat(row);

    const keepIds = new Set(games.map(g => g.id));
    const removed = this.t.games.filter(g => g.match_id === id && !keepIds.has(g.id)).map(g => g.id);
    for (const gid of removed) await this.purgeGame(gid);

    for (const g of games) {
      const { stats = [], ...gameRow } = g;
      this.t.games = this.t.games.filter(x => x.id !== g.id)
        .concat({ ...gameRow, team_id: teamId, match_id: id, created_at: gameRow.created_at || this.now() });
      this.t.stats = this.t.stats.filter(s => s.game_id !== g.id)
        .concat(stats.map(s => ({ ...s, id: uid(), team_id: teamId, game_id: g.id })));
    }
    await this.persist();
    return id;
  }
  async purgeGame(gid) {
    for (const m of this.t.media.filter(m => m.game_id === gid)) await this.deleteBlob(m.path);
    for (const tb of ['games', 'stats', 'media', 'vod_marks', 'game_breakdowns']) {
      this.t[tb] = this.t[tb].filter(r => (tb === 'games' ? r.id : r.game_id) !== gid);
    }
  }
  async deleteMatch(id) {
    for (const g of this.t.games.filter(g => g.match_id === id)) await this.purgeGame(g.id);
    this.t.matches = this.t.matches.filter(m => m.id !== id);
    await this.persist();
  }

  // ---- media ----
  async listMedia(gameId) { return this.t.media.filter(m => m.game_id === gameId); }
  async addScreenshot(teamId, gameId, blob) {
    const path = `${teamId}/${gameId}/${uid()}.jpg`;
    await idb(this.db, 'blobs', 'readwrite', s => s.put(blob, path));
    const m = { id: uid(), team_id: teamId, game_id: gameId, kind: 'screenshot', path, created_at: this.now() };
    this.t.media.push(m);
    await this.persist();
    return m;
  }
  async mediaUrl(m) {
    const blob = await idb(this.db, 'blobs', 'readonly', s => s.get(m.path));
    return blob ? URL.createObjectURL(blob) : '';
  }
  async deleteBlob(path) { await idb(this.db, 'blobs', 'readwrite', s => s.delete(path)); }
  async deleteMedia(m) {
    await this.deleteBlob(m.path);
    this.t.media = this.t.media.filter(x => x.id !== m.id);
    await this.persist();
  }

  // ---- schedule ----
  async listSchedule(teamId) {
    await this.reload();
    return { events: this.t.schedule_events.filter(e => e.team_id === teamId).map(e => ({ ...e })), timeoff: this.t.player_timeoff.filter(t => t.team_id === teamId).map(t => ({ ...t })) };
  }
  async saveScheduleEvent(teamId, ev) {
    const row = { status: 'scheduled', history: [], ...ev, id: ev.id || uid(), team_id: teamId, updated_at: this.now() };
    this.t.schedule_events = this.t.schedule_events.filter(e => e.id !== row.id).concat(row);
    await this.persist(); return row;
  }
  async deleteScheduleEvent(id) { this.t.schedule_events = this.t.schedule_events.filter(e => e.id !== id); await this.persist(); }
  async saveTimeOff(teamId, t) {
    const row = { repeat: 'none', ...t, id: t.id || uid(), team_id: teamId, created_at: t.created_at || this.now() };
    this.t.player_timeoff = this.t.player_timeoff.filter(x => x.id !== row.id).concat(row);
    await this.persist(); return row;
  }
  async deleteTimeOff(id) { this.t.player_timeoff = this.t.player_timeoff.filter(x => x.id !== id); await this.persist(); }

  // ---- VOD breakdowns ----
  async listBreakdowns(teamId) { return this.t.game_breakdowns.filter(b => b.team_id === teamId).map(b => ({ ...b })); }
  async getBreakdown(gameId) { const b = this.t.game_breakdowns.find(x => x.game_id === gameId); return b ? JSON.parse(JSON.stringify(b)) : null; }
  async saveBreakdown(teamId, row) {
    const existing = this.t.game_breakdowns.find(x => x.game_id === row.game_id);
    const out = { ...existing, ...row, id: existing?.id || row.id || uid(), team_id: teamId, updated_at: this.now() };
    this.t.game_breakdowns = this.t.game_breakdowns.filter(x => x.game_id !== row.game_id).concat(out);
    await this.persist();
    return out;
  }
  async deleteBreakdown(gameId) { this.t.game_breakdowns = this.t.game_breakdowns.filter(x => x.game_id !== gameId); await this.persist(); }

  // ---- notes ----
  async listNotes(teamId) {
    await this.reload();
    return this.t.team_notes.filter(n => n.team_id === teamId).map(n => ({ ...n }))
      .sort((a, b) => (b.pinned - a.pinned) || (b.updated_at || '').localeCompare(a.updated_at || ''));
  }
  async saveNote(teamId, note) {
    const row = { ...note, id: note.id || uid(), team_id: teamId, updated_at: this.now(), created_at: note.created_at || this.now() };
    this.t.team_notes = this.t.team_notes.filter(n => n.id !== row.id).concat(row);
    await this.persist();
    return row;
  }
  async deleteNote(id) { this.t.team_notes = this.t.team_notes.filter(n => n.id !== id); await this.persist(); }
  // event team logos
  async evUploadLogo(eventId, teamId, blob) {
    const path = `${eventId}/logos/${teamId}-${uid().slice(0, 8)}.png`;
    await idb(this.db, 'blobs', 'readwrite', s => s.put(blob, path));
    return path;
  }
  async evLogoUrls(paths) {
    const out = {};
    for (const p of paths) { const b = await idb(this.db, 'blobs', 'readonly', s => s.get(p)); if (b) out[p] = URL.createObjectURL(b); }
    return out;
  }

  // ---- VOD marks ----
  async listMarks(gameId) { return this.t.vod_marks.filter(m => m.game_id === gameId).sort((a, b) => a.t_seconds - b.t_seconds); }
  async addMark(teamId, gameId, mark) {
    this.t.vod_marks.push({ ...mark, id: uid(), team_id: teamId, game_id: gameId, created_at: this.now() });
    await this.persist();
  }
  async deleteMark(id) { this.t.vod_marks = this.t.vod_marks.filter(m => m.id !== id); await this.persist(); }

  // ================= LAN events =================
  async listEvents() {
    return this.t.events.map(e => ({ ...e, role: 'owner' })).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }
  async getEvent(id) { const e = this.t.events.find(x => x.id === id); return e ? { ...e } : null; }
  async isEventAdmin() { return true; }
  async eventAdminCode(id) { return this.t.events.find(e => e.id === id)?.admin_code || null; }
  async createEvent({ name }) {
    const ev = { id: uid(), name, starts_on: null, venue: null, is_public: true, accent: null, settings: {},
      admin_code: Math.random().toString(36).slice(2, 10).toUpperCase(), created_at: this.now() };
    this.t.events.push(ev);
    await this.persist();
    return ev;
  }
  async joinEventAdmin() { throw new Error('Co-admins need cloud mode.'); }
  async updateEvent(id, patch) { Object.assign(this.t.events.find(e => e.id === id), patch); await this.persist(); }
  async deleteEvent(id) {
    for (const m of this.t.event_media.filter(m => m.event_id === id)) await this.deleteBlob(m.path);
    this.t.events = this.t.events.filter(e => e.id !== id);
    for (const tb of EV_CHILD) this.t[tb] = this.t[tb].filter(r => r.event_id !== id);
    await this.persist();
  }
  async evLoad(eventId) {
    const pick = tb => this.t[tb].filter(r => r.event_id === eventId).map(r => ({ ...r }));
    return { teams: pick('event_teams'), players: pick('event_players'), matches: pick('event_matches'), games: pick('event_games'), stats: pick('event_stats'), vetoes: pick('event_vetoes') };
  }
  async evUpsert(table, rows) {
    rows = [].concat(rows);
    for (const r of rows) {
      if (!r.id) r.id = uid();
      const i = this.t[table].findIndex(x => x.id === r.id);
      if (i >= 0) this.t[table][i] = { ...this.t[table][i], ...r }; else this.t[table].push({ ...r });
    }
    await this.persist();
    return rows;
  }
  async evDelete(table, ids) {
    ids = new Set([].concat(ids));
    const cascade = { event_teams: [['event_players', 'team_id']], event_matches: [['event_games', 'match_id'], ['event_vetoes', 'match_id']], event_games: [['event_stats', 'game_id'], ['event_media', 'game_id']], event_vetoes: [['event_veto_keys', 'veto_id']] };
    const drop = (tb, set) => {
      const gone = this.t[tb].filter(r => set.has(r.id));
      this.t[tb] = this.t[tb].filter(r => !set.has(r.id));
      for (const [child, col] of cascade[tb] || []) drop(child, new Set(this.t[child].filter(r => set.has(r[col])).map(r => r.id)));
      return gone;
    };
    const gone = drop(table, ids);
    if (table === 'event_media') for (const m of gone) await this.deleteBlob(m.path);
    await this.persist();
  }
  async evListMedia(gameId) { return this.t.event_media.filter(m => m.game_id === gameId); }
  async evAddScreenshot(eventId, gameId, blob) {
    const path = `${eventId}/${gameId}/${uid()}.jpg`;
    await idb(this.db, 'blobs', 'readwrite', s => s.put(blob, path));
    const m = { id: uid(), event_id: eventId, game_id: gameId, path, created_at: this.now() };
    this.t.event_media.push(m);
    await this.persist();
    return m;
  }
  // ---- map veto ----
  async getVeto(id) { const v = this.t.event_vetoes.find(x => x.id === id); return v ? { ...v } : null; }
  async vetoKeys(id) { return this.t.event_veto_keys.find(k => k.veto_id === id) || null; }
  async vetoWhoami(id, key) {
    await this.reload();
    const k = this.t.event_veto_keys.find(x => x.veto_id === id);
    return !k || !key ? null : key === k.key_a ? 'a' : key === k.key_b ? 'b' : null;
  }
  async vetoAct(id, key, choice) {
    await this.reload(); // another tab may have acted
    const side = await this.vetoWhoami(id, key);
    if (!side) throw new Error('This captain link is not valid');
    const i = this.t.event_vetoes.findIndex(x => x.id === id);
    const v = applyVeto(this.t.event_vetoes[i], side, choice);
    v.updated_at = this.now();
    this.t.event_vetoes[i] = v;
    if (v.status === 'done') {
      for (const a of v.actions.filter(x => x.kind === 'pick' || x.kind === 'decider')) {
        const g = this.t.event_games.find(x => x.match_id === v.match_id && x.game_no === a.slot);
        if (g) Object.assign(g, { map: a.choice, mode: a.mode });
        else this.t.event_games.push({ id: uid(), event_id: v.event_id, match_id: v.match_id, game_no: a.slot, map: a.choice, mode: a.mode, a_score: null, b_score: null });
      }
    }
    await this.persist();
    this.listeners.forEach(fn => fn()); // update this tab too
    return v;
  }

  /** Live updates across tabs in this browser. Returns an unsubscribe function. */
  subscribeEvent(_eventId, cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
}
