import { h, toast, fmtDate, confirmDialog } from '../ui.js';
import { state, go } from '../state.js';
import { DEFAULT_EVENT_SETTINGS } from '../event-state.js';

export async function eventsView() {
  const events = await state.store.listEvents();
  const local = state.store.mode === 'local';
  // practice events: made from the samples (older ones are found by their sample names)
  const isPractice = e => !!e.settings?.practice || /^Practice · /.test(e.name) || e.name === 'Sample LAN';
  const practice = events.filter(e => isPractice(e) && e.role === 'owner');
  const roleName = { owner: 'Owner', admin: 'Admin', staff: 'Staff' };

  const name = h('input', { required: true, maxlength: 80, placeholder: 'Winter LAN 2026' });
  const display = h('input', { maxlength: 30, placeholder: 'Your name' });
  const code = h('input', { required: true, maxlength: 8, placeholder: 'ABCD1234', style: { textTransform: 'uppercase' } });

  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'LAN events'), h('h1', {}, 'Events'))),
    events.length
      ? h('div', { class: 'list' }, events.map(e => h('a', { class: 'list-row', href: `#/e/${e.id}` },
        h('div', {}, h('strong', {}, e.name), h('div', { class: 'muted small' }, [e.starts_on && fmtDate(e.starts_on), e.venue].filter(Boolean).join(' · ') || 'No date set')),
        isPractice(e) ? h('span', { class: 'chip' }, 'Practice') : null,
        h('span', { class: 'muted small' }, roleName[e.role] || 'Admin'), h('span', { class: 'chev' }, '→'))))
      : h('p', { class: 'muted' }, 'No events yet. Create one for your LAN — you add the teams, and the groups, bracket, stats and venue display build themselves.'),
    h('div', { class: 'grid-2 gap-lg' },
      h('form', {
        class: 'panel', onsubmit: async e => {
          e.preventDefault();
          try {
            const ev = await state.store.createEvent({ name: name.value.trim(), display_name: display.value.trim() });
            await state.store.updateEvent(ev.id, { settings: DEFAULT_EVENT_SETTINGS });
            toast('Event created', 'success');
            go(`#/e/${ev.id}/setup`);
          } catch (err) { toast(err.message, 'error'); }
        },
      }, h('h3', {}, 'Create an event'),
      h('label', {}, 'Event name', name),
      local ? null : h('label', {}, 'Your name', display),
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create event')),
      local ? null : h('form', {
        class: 'panel', onsubmit: async e => {
          e.preventDefault();
          try {
            const ev = await state.store.joinEventAdmin(code.value, display.value.trim());
            toast(`You're now an admin of ${ev.name}`, 'success');
            go(`#/e/${ev.id}/control`);
          } catch (err) { toast(err.message, 'error'); }
        },
      }, h('h3', {}, 'Help run an event'),
      h('p', { class: 'muted small' }, 'Enter the staff or admin code the event owner gave you. Staff run matches and scores; admins can change everything.'),
      h('label', {}, 'Staff or admin code', code),
      h('button', { class: 'btn', type: 'submit' }, 'Join as admin'))),
    h('div', { class: 'panel sample-card' },
      h('div', {}, h('strong', {}, 'Practice runs'),
        h('p', { class: 'muted small' }, 'Load a made-up LAN with 16 teams and rosters already created, then run it like the real day: control panel, captain links, display.'),
        practice.length ? h('button', {
          class: 'btn btn-sm btn-ghost btn-danger-text', onclick: async e => {
            if (!(await confirmDialog(`Delete ${practice.length} practice event${practice.length === 1 ? '' : 's'}? ${practice.map(x => x.name).join(', ')}. Your real events stay.`, 'Delete practice events'))) return;
            const btn = e.target; btn.disabled = true;
            let done = 0;
            for (const x of practice) { try { await state.store.deleteEvent(x.id); done++; } catch (err) { toast(`${x.name}: ${err.message}`, 'error'); } }
            toast(`Deleted ${done} practice event${done === 1 ? '' : 's'}`, 'success');
            go('#/events');
          },
        }, `Delete all practice events (${practice.length})`) : null),
      h('div', { class: 'sample-opts' }, [
        ['start', 'Start of event', 'Teams, groups, seating and captain links ready. Nothing played.'],
        ['mid', 'Mid group stage', 'Morning session on its last round: live and on-deck matches.'],
        ['playoffs', 'Playoffs under way', 'Groups done, bracket live with rows, reports and a staff call.'],
      ].map(([stage, title, text]) => h('button', {
        class: 'sample-opt', 'data-stage': stage, onclick: async e => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            const { loadSampleEvent } = await import('../sample-event.js');
            const evt = await loadSampleEvent(state.store, 16, null, stage);
            toast('Practice event ready', 'success');
            go(`#/e/${evt.id}${stage === 'playoffs' ? '' : '/control'}`);
          } catch (err) { btn.disabled = false; toast(err.message, 'error'); }
        },
      }, h('strong', {}, title), h('span', { class: 'muted small' }, text))))));
}
