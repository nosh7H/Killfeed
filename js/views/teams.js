import { h, toast, confirmDialog } from '../ui.js';
import { state, refreshTeams, go } from '../state.js';
import { inDemoSession } from '../store/index.js';

export async function teamsView() {
  await refreshTeams();
  const local = state.store.mode === 'local';

  const name = h('input', { required: true, maxlength: 60, placeholder: 'e.g. Midnight Esports' });
  const tag = h('input', { maxlength: 6, placeholder: 'MDNT' });
  const display = h('input', { maxlength: 30, placeholder: 'Your gamertag' });
  const code = h('input', { required: true, maxlength: 8, placeholder: 'ABCD1234', style: { textTransform: 'uppercase' } });
  const display2 = h('input', { maxlength: 30, placeholder: 'Your gamertag' });

  const create = h('form', {
    class: 'card', onsubmit: async e => {
      e.preventDefault();
      try {
        const t = await state.store.createTeam({ name: name.value.trim(), tag: tag.value.trim().toUpperCase(), display_name: display.value.trim() });
        await refreshTeams();
        toast(`Team "${t.name}" created`, 'success');
        go(`#/t/${t.id}/settings`);
      } catch (err) { toast(err.message, 'error'); }
    },
  }, h('h3', {}, 'Create a team'),
  h('div', { class: 'grid-2' }, h('label', {}, 'Team name', name), h('label', {}, 'Tag', tag)),
  h('label', {}, 'Your name on this team', display),
  h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create team'));

  const join = h('form', {
    class: 'card', onsubmit: async e => {
      e.preventDefault();
      try {
        const t = await state.store.joinTeam(code.value, display2.value.trim());
        await refreshTeams();
        toast(`Joined ${t.name}`, 'success');
        go(`#/t/${t.id}/home`);
      } catch (err) { toast(err.message, 'error'); }
    },
  }, h('h3', {}, 'Join with invite code'),
  h('label', {}, 'Invite code', code),
  h('label', {}, 'Your name on this team', display2),
  h('button', { class: 'btn', type: 'submit', disabled: local }, 'Join team'),
  local ? h('p', { class: 'muted small' }, inDemoSession() ? 'Sign up to join a real team.' : 'Joining other teams needs cloud mode (see README).') : null);

  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', {}, 'Your teams')),
    state.teams.length
      ? h('div', { class: 'team-grid' }, state.teams.map(t => h('a', { class: 'card team-card', href: `#/t/${t.id}/home` },
        h('div', { class: 'team-tag', style: t.accent ? { color: t.accent, borderColor: t.accent } : null }, t.tag || t.name.slice(0, 3).toUpperCase()),
        h('div', {}, h('strong', {}, t.name), h('div', { class: 'muted small' }, roleLabel(t.role))))))
      : h('p', { class: 'muted' }, 'You are not on a team yet. Create one or join with a code from your team owner.'),
    h('div', { class: 'grid-2 gap-lg' }, create, join),
    h('div', { class: 'card sample-card' },
      h('div', {}, h('strong', {}, 'Sample team'),
        h('p', { class: 'muted small' }, local
          ? 'Load a fictional team with two weeks of scrims to see how the dashboard works. You can delete it any time.'
          : 'Load “Sample Squad”, a fictional team with two weeks of scrims, into your account to try things out or show people around. Only you can see it unless you invite someone. Delete it any time in its Settings.')),
      h('button', {
        class: 'btn', onclick: async e => {
          const btn = e.currentTarget;
          if (state.teams.some(t => t.name === 'Sample Squad') && !(await confirmDialog('You already have a Sample Squad. Load another one?', 'Load another'))) return;
          btn.disabled = true; btn.textContent = 'Loading…';
          try {
            const { loadSample } = await import('../sample.js');
            const t = await loadSample(state.store);
            await refreshTeams();
            toast('Sample team ready', 'success');
            go(`#/t/${t.id}/home`);
          } catch (err) { btn.disabled = false; btn.textContent = 'Load sample team'; toast(err.message, 'error'); }
        },
      }, 'Load sample team')));
}

export const roleLabel = r => ({ owner: 'Owner', coach: 'Coach', player: 'Player', viewer: 'Viewer' }[r] || r);
