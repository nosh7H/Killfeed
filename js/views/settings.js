import { h, clear, toast, confirmDialog, download, uid } from '../ui.js';
import { state, isOwner, canEdit, refreshData, refreshTeams, go, teamPath } from '../state.js';
import { section } from './dashboard.js';
import { roleLabel } from './teams.js';
import { toCSV, flatRows, FLAT_COLUMNS } from '../stats.js';

export async function settingsView() {
  const t = state.team;
  const owner = isOwner();
  const root = h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', {}, 'Team settings'), h('span', { class: 'pill' }, `You: ${roleLabel(t.role)}`)));

  // ---- Team info + pools ----
  const name = h('input', { value: t.name, disabled: !owner, maxlength: 60 });
  const tag = h('input', { value: t.tag || '', disabled: !owner, maxlength: 6 });
  const maps = h('textarea', { rows: 8, disabled: !owner, placeholder: 'One map per line' }, (t.maps || []).join('\n'));
  const modes = h('textarea', { rows: 8, disabled: !owner, placeholder: 'One mode per line' }, (t.modes || []).join('\n'));
  const lines = el => [...new Set(el.value.split('\n').map(s => s.trim()).filter(Boolean))];
  root.append(section('Team', owner ? null : 'Only the owner can change these', h('div', {},
    h('div', { class: 'grid-2' }, h('label', {}, 'Name', name), h('label', {}, 'Tag', tag)),
    h('div', { class: 'grid-2' },
      h('label', {}, 'Map pool', maps, h('span', { class: 'muted small' }, 'Shown in map pickers and filters. New maps you log get added automatically.')),
      h('label', {}, 'Modes', modes, h('span', { class: 'muted small' }, 'Stat columns adapt to Hardpoint, Search & Destroy and Control. Other modes show every column.'))),
    owner ? h('button', {
      class: 'btn btn-primary', onclick: async () => {
        const patch = { name: name.value.trim() || t.name, tag: tag.value.trim().toUpperCase() || null, maps: lines(maps), modes: lines(modes) };
        try { await state.store.updateTeam(t.id, patch); Object.assign(t, patch); await refreshTeams(); toast('Saved', 'success'); go(teamPath('settings')); }
        catch (e) { toast(e.message, 'error'); }
      },
    }, 'Save') : null)));

  // ---- Roster ----
  root.append(section('Roster', 'Gamertags are used to match screenshot rows to players', rosterEditor()));

  // ---- Members ----
  root.append(section('Members & invites', null, await membersPanel()));

  // ---- Data ----
  root.append(section('Data', null, h('div', { class: 'actions wrap' },
    h('button', { class: 'btn', onclick: () => download(`${t.name}-all-stats.csv`, toCSV(flatRows(state.joined, state.statsIdx), FLAT_COLUMNS), 'text/csv') }, 'Export all stats (CSV)'),
    h('button', { class: 'btn', onclick: () => download(`${t.name}-backup.json`, JSON.stringify({ version: 1, exported_at: new Date().toISOString(), team: { name: t.name, tag: t.tag, maps: t.maps, modes: t.modes }, ...state.data }, null, 2), 'application/json') }, 'Backup (JSON)'),
    canEdit() ? h('label', { class: 'btn' }, 'Import backup…', h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: e => importBackup(e.target.files[0]) })) : null)));

  // ---- Danger ----
  root.append(section('Leave or delete', null, h('div', { class: 'actions wrap' },
    state.store.mode === 'cloud' && !owner ? h('button', {
      class: 'btn btn-ghost btn-danger-text', onclick: async () => {
        if (!(await confirmDialog(`Leave ${t.name}?`, 'Leave'))) return;
        await state.store.removeMember(t.id, state.user.id); state.team = null; await refreshTeams(); go('#/teams');
      },
    }, 'Leave team') : null,
    owner ? h('button', {
      class: 'btn btn-danger', onclick: async () => {
        if (!(await confirmDialog(`Permanently delete ${t.name} and all of its matches, stats and screenshots?`))) return;
        await state.store.deleteTeam(t.id); state.team = null; localStorage.removeItem('kf-last-team'); await refreshTeams(); go('#/teams');
      },
    }, 'Delete team') : null)));

  return root;
}

function rosterEditor() {
  const wrap = h('div');
  const render = () => {
    clear(wrap);
    const players = [...state.data.players].sort((a, b) => (b.active !== false) - (a.active !== false) || a.gamertag.localeCompare(b.gamertag));
    wrap.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Gamertag'), h('th', {}, 'Role'), h('th', {}, 'Active'), h('th', {}))),
      h('tbody', {}, players.length ? players.map(p => {
        const gt = h('input', { value: p.gamertag, disabled: !canEdit() });
        const role = h('input', { value: p.role || '', placeholder: 'AR / SMG / Flex', disabled: !canEdit() });
        const active = h('input', { type: 'checkbox', checked: p.active !== false, disabled: !canEdit() });
        const saveP = async () => {
          try { await state.store.savePlayer(state.team.id, { ...p, gamertag: gt.value.trim() || p.gamertag, role: role.value.trim() || null, active: active.checked }); await refreshData(); render(); }
          catch (e) { toast(e.message, 'error'); }
        };
        gt.onchange = saveP; role.onchange = saveP; active.onchange = saveP;
        return h('tr', { class: p.active === false ? 'dim' : '' }, h('td', {}, gt), h('td', {}, role), h('td', {}, active),
          h('td', {}, canEdit() ? h('button', {
            class: 'icon-btn', 'aria-label': `Remove ${p.gamertag}`, onclick: async () => {
              if (!(await confirmDialog(`Remove ${p.gamertag} from the roster? Their past stats are kept under their name.`, 'Remove'))) return;
              await state.store.deletePlayer(p.id); await refreshData(); render();
            },
          }, '✕') : null));
      }) : h('tr', {}, h('td', { colspan: 4, class: 'muted' }, 'No players yet.'))))));
    if (canEdit()) {
      const gt = h('input', { placeholder: 'Gamertag', required: true });
      const role = h('input', { placeholder: 'Role (optional)' });
      wrap.append(h('form', {
        class: 'inline-form', onsubmit: async e => {
          e.preventDefault();
          if (state.data.players.some(p => p.gamertag.toLowerCase() === gt.value.trim().toLowerCase())) return toast('Already on the roster', 'error');
          await state.store.savePlayer(state.team.id, { gamertag: gt.value.trim(), role: role.value.trim() || null });
          await refreshData(); render(); wrap.querySelector('input[placeholder="Gamertag"]')?.focus();
        },
      }, gt, role, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Add player')));
    }
  };
  render();
  return wrap;
}

async function membersPanel() {
  const t = state.team;
  const wrap = h('div');
  if (state.store.mode === 'local') {
    wrap.append(h('p', { class: 'muted' }, 'You are in demo mode, so this team lives only in this browser. Connect Supabase (see README) to invite teammates with a code and keep data in the cloud.'));
    return wrap;
  }
  const codeEl = h('code', { class: 'invite' }, t.invite_code);
  wrap.append(h('div', { class: 'invite-row' },
    h('span', {}, 'Invite code: '), codeEl,
    h('button', { class: 'btn btn-sm', onclick: () => { navigator.clipboard.writeText(t.invite_code); toast('Copied'); } }, 'Copy'),
    isOwner() ? h('button', {
      class: 'btn btn-sm btn-ghost', onclick: async () => {
        if (!(await confirmDialog('Generate a new code? The old one stops working.', 'New code'))) return;
        t.invite_code = await state.store.rotateInvite(t.id); codeEl.textContent = t.invite_code;
      },
    }, 'New code') : null),
  h('p', { class: 'muted small' }, 'New members join as Player. Owners can make someone a Coach or a read-only Viewer.'));

  const members = await state.store.listMembers(t.id);
  wrap.append(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Role'), h('th', {}, 'Joined'), h('th', {}))),
    h('tbody', {}, members.map(m => {
      const me = m.user_id === state.user.id;
      return h('tr', {},
        h('td', {}, m.display_name || '(no name)', me ? h('span', { class: 'muted' }, ' (you)') : null),
        h('td', {}, isOwner() && !me ? h('select', {
          onchange: async e => { try { await state.store.setMemberRole(t.id, m.user_id, e.target.value); toast('Role updated'); } catch (err) { toast(err.message, 'error'); } },
        }, ['owner', 'coach', 'player', 'viewer'].map(r => h('option', { value: r, selected: m.role === r }, roleLabel(r)))) : roleLabel(m.role)),
        h('td', { class: 'muted small' }, new Date(m.joined_at).toLocaleDateString()),
        h('td', {}, isOwner() && !me ? h('button', {
          class: 'icon-btn', 'aria-label': 'Remove member', onclick: async e => {
            if (!(await confirmDialog(`Remove ${m.display_name || 'this member'} from the team?`, 'Remove'))) return;
            await state.store.removeMember(t.id, m.user_id); e.target.closest('tr').remove();
          },
        }, '✕') : null));
    })))));
  return wrap;
}

async function importBackup(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.matches) || !Array.isArray(data.games)) throw new Error('Not a valid backup file');
    if (!(await confirmDialog(`Import ${data.matches.length} matches and ${data.games.length} games into ${state.team.name}? Screenshots are not included in backups.`, 'Import'))) return;

    // players: reuse existing gamertags, add missing
    const existing = new Map(state.data.players.map(p => [p.gamertag.toLowerCase(), p]));
    for (const p of data.players || []) {
      if (!existing.has(p.gamertag.toLowerCase())) await state.store.savePlayer(state.team.id, { gamertag: p.gamertag, role: p.role || null });
    }
    await refreshData();
    const byTag = new Map(state.data.players.map(p => [p.gamertag.toLowerCase(), p.id]));
    const oldPlayer = new Map((data.players || []).map(p => [p.id, p.gamertag.toLowerCase()]));

    for (const m of data.matches) {
      const games = data.games.filter(g => g.match_id === m.id).map(g => ({
        id: uid(), game_no: g.game_no, map: g.map, mode: g.mode, team_score: g.team_score, opp_score: g.opp_score, vod_url: g.vod_url || null, notes: g.notes || null,
        stats: (data.stats || []).filter(s => s.game_id === g.id).map(s => ({
          player_name: s.player_name,
          player_id: byTag.get(oldPlayer.get(s.player_id) || s.player_name.toLowerCase()) || null,
          kills: s.kills ?? 0, deaths: s.deaths ?? 0, assists: s.assists ?? null, damage: s.damage ?? null, obj_time: s.obj_time ?? null,
          plants: s.plants ?? null, defuses: s.defuses ?? null, captures: s.captures ?? null, first_bloods: s.first_bloods ?? null,
        })),
      }));
      await state.store.saveMatch(state.team.id, { type: m.type, played_on: m.played_on, opponent: m.opponent, event: m.event, notes: m.notes }, games);
    }
    await refreshData();
    toast(`Imported ${data.matches.length} matches`, 'success');
    go(teamPath('dashboard'));
  } catch (e) { toast(`Import failed: ${e.message}`, 'error'); }
}
