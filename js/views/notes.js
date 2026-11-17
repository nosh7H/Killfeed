// Shared team notepad: strats, map plans, opponent notes. Autosaves.
import { h, clear, toast, confirmDialog } from '../ui.js';
import { state, canEdit, knownMaps, knownModes } from '../state.js';

const MAP_PLAN = `Spawns / first rotation:\n\nSetups by hill / site:\n\nUtility (who throws what):\n\nCallouts:\n\nWhat beat us last time:\n`;

export async function notesView() {
  let notes = await state.store.listNotes(state.team.id);
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  let q = '', tagMap = params.get('map') || '', current = null, saveTimer = null, dirty = false;
  const root = h('div', { class: 'page' });
  const editable = canEdit();
  const opponents = [...new Set(state.data.matches.map(m => m.opponent).filter(Boolean))].sort();

  const filtered = () => notes.filter(n => (!tagMap || n.map === tagMap)
    && (!q || `${n.title} ${n.body} ${n.map || ''} ${n.mode || ''} ${n.opponent || ''}`.toLowerCase().includes(q.toLowerCase())));

  const select = n => { flush(); current = n; paint(); };

  async function flush() {
    if (!dirty || !current) return;
    clearTimeout(saveTimer); dirty = false;
    try {
      const saved = await state.store.saveNote(state.team.id, current);
      Object.assign(current, saved);
      notes = notes.filter(n => n.id !== saved.id).concat(current);
      const st = root.querySelector('.note-status'); if (st) st.textContent = 'Saved';
      paintList();
    } catch (e) { toast(`Couldn't save: ${e.message}`, 'error'); }
  }
  const touch = () => {
    dirty = true;
    const st = root.querySelector('.note-status'); if (st) st.textContent = 'Saving…';
    clearTimeout(saveTimer); saveTimer = setTimeout(flush, 700);
  };

  const newNote = async (template) => {
    await flush();
    current = { title: template ? 'Map plan' : 'Untitled note', body: template ? MAP_PLAN : '', map: tagMap || null, mode: null, opponent: null, pinned: false };
    current = await state.store.saveNote(state.team.id, current);
    notes.push(current); paint();
    root.querySelector('.note-title')?.select();
  };

  const listEl = h('div', { class: 'note-list' });
  function paintList() {
    const sorted = filtered().sort((a, b) => (b.pinned - a.pinned) || (b.updated_at || '').localeCompare(a.updated_at || ''));
    clear(listEl).append(...(sorted.length ? sorted.map(n => h('button', { class: `note-item ${current?.id === n.id ? 'on' : ''}`, onclick: () => select(n) },
      h('div', { class: 'ni-title' }, n.pinned ? h('span', { class: 'pin' }, '● ') : null, n.title || 'Untitled'),
      h('div', { class: 'ni-tags' }, [n.map, n.mode, n.opponent && `vs ${n.opponent}`].filter(Boolean).join(' · ') || h('span', { class: 'muted' }, 'No tags')),
      h('div', { class: 'ni-date' }, n.updated_at ? new Date(n.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '')))
      : [h('div', { class: 'empty-sm' }, notes.length ? 'No notes match.' : 'No notes yet.')]));
  }

  function editor() {
    if (!current) return h('div', { class: 'note-empty' }, h('p', { class: 'muted' }, 'Pick a note or start a new one. Notes are shared with everyone on the team.'));
    const n = current;
    const bind = key => e => { n[key] = e.target.value || null; touch(); };
    return h('div', { class: 'note-editor' },
      h('input', { class: 'note-title', value: n.title || '', placeholder: 'Title', disabled: !editable, oninput: e => { n.title = e.target.value; touch(); }, onchange: paintList }),
      h('div', { class: 'note-tags' },
        h('input', { list: 'dl-note-maps', value: n.map || '', placeholder: 'Map', disabled: !editable, oninput: bind('map'), onchange: paintList }),
        h('select', { disabled: !editable, onchange: e => { bind('mode')(e); paintList(); } }, h('option', { value: '' }, 'Any mode'), knownModes().map(m => h('option', { value: m, selected: n.mode === m }, m))),
        h('input', { list: 'dl-note-opps', value: n.opponent || '', placeholder: 'Opponent', disabled: !editable, oninput: bind('opponent'), onchange: paintList }),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!n.pinned, disabled: !editable, onchange: e => { n.pinned = e.target.checked; touch(); flush(); } }), 'Pin')),
      h('textarea', { class: 'note-body', placeholder: 'Write anything: setups, rotations, what to fix, opponent tendencies…', disabled: !editable, oninput: e => { n.body = e.target.value; touch(); } }, n.body || ''),
      h('div', { class: 'note-foot' },
        h('span', { class: 'note-status muted small' }, n.updated_at ? `Saved · ${new Date(n.updated_at).toLocaleString()}` : ''),
        editable ? h('button', {
          class: 'btn btn-ghost btn-sm btn-danger-text', onclick: async () => {
            if (!(await confirmDialog('Delete this note?'))) return;
            clearTimeout(saveTimer); dirty = false;
            await state.store.deleteNote(n.id); notes = notes.filter(x => x.id !== n.id); current = null; paint();
          },
        }, 'Delete') : null));
  }

  function paint() {
    clear(root).append(
      h('datalist', { id: 'dl-note-maps' }, knownMaps().map(m => h('option', { value: m }))),
      h('datalist', { id: 'dl-note-opps' }, opponents.map(o => h('option', { value: o }))),
      h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Team notepad'), h('h1', {}, 'Notes')),
        editable ? h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => newNote(true) }, '＋ Map plan'),
          h('button', { class: 'btn btn-primary', onclick: () => newNote(false) }, '＋ New note')) : null),
      h('div', { class: 'notes-layout' },
        h('div', { class: 'stack-sm' },
          h('input', { type: 'search', placeholder: 'Search notes', value: q, oninput: e => { q = e.target.value; paintList(); } }),
          tagMap ? h('div', { class: 'row small' }, h('span', { class: 'muted' }, `Map: ${tagMap}`), h('button', { class: 'link', onclick: () => { tagMap = ''; paintList(); } }, 'Clear')) : null,
          listEl),
        editor()));
    paintList();
  }

  // save on the way out
  window.addEventListener('hashchange', flush, { once: true });
  current = filtered().find(n => n.pinned) || filtered()[0] || null;
  paint();
  return root;
}
