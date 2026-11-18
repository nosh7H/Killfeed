// Demo store: everything lives in this browser (IndexedDB). Same API as the cloud store.
import { uid } from '../ui.js';
import { DEFAULT_MODES } from '../config.js';

const DB_NAME = 'killfeed-demo';
const TABLES = ['teams', 'team_members', 'players', 'matches', 'games', 'stats', 'media', 'vod_marks'];
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
  }
  async persist() { await idb(this.db, 'kv', 'readwrite', s => s.put(this.t, 'db')); }
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
    for (const tb of ['games', 'stats', 'media', 'vod_marks']) {
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

  // ---- VOD marks ----
  async listMarks(gameId) { return this.t.vod_marks.filter(m => m.game_id === gameId).sort((a, b) => a.t_seconds - b.t_seconds); }
  async addMark(teamId, gameId, mark) {
    this.t.vod_marks.push({ ...mark, id: uid(), team_id: teamId, game_id: gameId, created_at: this.now() });
    await this.persist();
  }
  async deleteMark(id) { this.t.vod_marks = this.t.vod_marks.filter(m => m.id !== id); await this.persist(); }
}
