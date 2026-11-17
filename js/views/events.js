import { h, toast, fmtDate } from '../ui.js';
import { state, go } from '../state.js';
import { DEFAULT_EVENT_SETTINGS } from '../event-state.js';

export async function eventsView() {
  const events = await state.store.listEvents();
  const local = state.store.mode === 'local';

  const name = h('input', { required: true, maxlength: 80, placeholder: 'Winter LAN 2026' });
  const display = h('input', { maxlength: 30, placeholder: 'Your name' });
  const code = h('input', { required: true, maxlength: 8, placeholder: 'ABCD1234', style: { textTransform: 'uppercase' } });

  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'LAN events'), h('h1', {}, 'Events'))),
    events.length
      ? h('div', { class: 'list' }, events.map(e => h('a', { class: 'list-row', href: `#/e/${e.id}` },
        h('div', {}, h('strong', {}, e.name), h('div', { class: 'muted small' }, [e.starts_on && fmtDate(e.starts_on), e.venue].filter(Boolean).join(' · ') || 'No date set')),
        h('span', { class: 'muted small' }, e.role === 'owner' ? 'Owner' : 'Admin'), h('span', { class: 'chev' }, '→'))))
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
      h('p', { class: 'muted small' }, 'Enter the admin code from the event owner to enter scores and run the queue.'),
      h('label', {}, 'Admin code', code),
      h('button', { class: 'btn', type: 'submit' }, 'Join as admin'))),
    local ? h('div', { class: 'panel sample-card' },
      h('div', {}, h('strong', {}, 'Want to see it in action?'), h('p', { class: 'muted small' }, 'Load a sample LAN with 8 teams, a finished group stage and playoffs under way. Then open its Display.')),
      h('button', {
        class: 'btn', onclick: async e => {
          e.target.disabled = true;
          const { loadSampleEvent } = await import('../sample-event.js');
          const evt = await loadSampleEvent(state.store);
          go(`#/e/${evt.id}`);
        },
      }, 'Load sample event')) : null);
}
