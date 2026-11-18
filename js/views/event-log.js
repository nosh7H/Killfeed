// Admin → Activity: everything staff and captains did, newest first, with Revert.
import { h, clear, toast, confirmDialog } from '../ui.js';
import { state } from '../state.js';
import { ev, eventPath, refreshEvent, watchEvent } from '../event-state.js';
import { eventShell } from './event.js';
import { staffName, setStaffName, revertGroup, revertConflicts, TABLE_LABEL } from '../event-log.js';

const clock = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const ago = iso => {
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString();
};

/** Log rows → groups (one per action), newest first. */
export function groupLog(rows) {
  const out = [];
  const byId = new Map();
  for (const r of rows) {
    const g = byId.get(r.group_id);
    if (g) g.entries.push(r);
    else { const n = { id: r.group_id, entries: [r] }; byId.set(r.group_id, n); out.push(n); }
  }
  const reverted = new Map(rows.filter(r => r.reverts).map(r => [r.reverts, r]));
  for (const g of out) {
    const first = g.entries[0];
    g.at = first.at; g.actor = first.actor; g.kind = first.kind;
    g.matchIds = [...new Set(g.entries.map(e => e.match_id).filter(Boolean))];
    g.revertedBy = reverted.get(g.id) || null;
    g.canRevert = g.kind === 'staff' && !g.revertedBy && g.entries.some(e => e.before || e.after);
  }
  return out;
}

/** One action as a card. compact: on the match page. */
export function logCard(g, { onRevert, compact = false } = {}) {
  const m = g.matchIds.length === 1 ? ev.data.matches.find(x => x.id === g.matchIds[0]) : null;
  const details = h('div', { class: 'log-details', hidden: true }, g.entries.map(diffView));
  return h('div', { class: `log-card k-${g.kind} ${g.revertedBy ? 'is-reverted' : ''}` },
    h('div', { class: 'log-top' },
      h('span', { class: `log-kind k-${g.kind}` }, { staff: 'Staff', captain: 'Captain', revert: 'Revert' }[g.kind] || g.kind),
      h('strong', {}, g.actor || 'Staff'),
      h('span', { class: 'muted small', 'data-tip': new Date(g.at).toLocaleString() }, `${clock(g.at)} · ${ago(g.at)}`),
      h('span', { class: 'spacer' }),
      !compact && m ? h('a', { class: 'small', href: eventPath(`match/${m.id}`) }, m.match_no ? `Match ${m.match_no}` : 'Open match') : null),
    h('div', { class: 'log-lines' }, g.entries.slice().reverse().map(e => h('div', {}, e.summary))),
    g.revertedBy ? h('div', { class: 'small muted' }, `↶ Reverted by ${g.revertedBy.actor} at ${clock(g.revertedBy.at)}`) : null,
    h('div', { class: 'row' },
      g.entries.some(e => e.before || e.after) ? h('button', {
        class: 'btn btn-sm btn-ghost', onclick: e => { details.hidden = !details.hidden; e.currentTarget.textContent = details.hidden ? 'Details' : 'Hide details'; },
      }, 'Details') : null,
      g.canRevert && onRevert ? h('button', { class: 'btn btn-sm', onclick: () => onRevert(g) }, '↶ Revert') : null),
    details);
}

// before → after, field by field
const SKIP = new Set(['updated_at', 'event_id', 'id', 'created_at']);
function diffView(e) {
  const tables = new Set([...Object.keys(e.before || {}), ...Object.keys(e.after || {})]);
  const rows = [];
  for (const t of tables) {
    if (t === 'settings') {
      const b = e.before?.settings || {}, a = e.after?.settings || {};
      for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) rows.push([`setting · ${k}`, short(b[k]), short(a[k])]);
      continue;
    }
    const b = new Map((e.before?.[t] || []).map(r => [r.id, r])), a = new Map((e.after?.[t] || []).map(r => [r.id, r]));
    const ids = [...new Set([...b.keys(), ...a.keys()])].slice(0, 12);
    for (const id of ids) {
      const x = b.get(id), y = a.get(id);
      const label = (TABLE_LABEL[t] || t) + (x?.game_no || y?.game_no ? ` · map ${x?.game_no || y?.game_no}` : '') + (x?.player_name || y?.player_name ? ` · ${x?.player_name || y?.player_name}` : '') + (x?.name || y?.name ? ` · ${x?.name || y?.name}` : '');
      if (!x) { rows.push([label, '—', 'added']); continue; }
      if (!y) { rows.push([label, 'removed', '—']); continue; }
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (SKIP.has(k) || JSON.stringify(x[k] ?? null) === JSON.stringify(y[k] ?? null)) continue;
        rows.push([`${label} · ${k}`, short(x[k]), short(y[k])]);
      }
    }
    if (b.size + a.size > 24) rows.push(['…', '', '']);
  }
  if (!rows.length) return null;
  return h('table', { class: 'data tight log-diff' }, h('tbody', {}, rows.map(([k, b, a]) => h('tr', {}, h('td', { class: 'muted' }, k), h('td', {}, b), h('td', {}, '→'), h('td', {}, a)))));
}
function short(v) {
  if (v == null || v === '') return '—';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

/** Revert one action (asks first; warns if it was changed again since). */
export async function revertAction(g, after) {
  const conflicts = revertConflicts(g.entries);
  const text = g.entries.map(e => e.summary).join(' · ');
  const warn = conflicts.length ? `\n\nHeads up: ${conflicts.join(', ')} changed again after this. Reverting puts them back to how they were before this action.` : '';
  if (!(await confirmDialog(`Revert this?\n\n${text}${warn}`, 'Revert'))) return;
  try {
    await revertGroup(g.entries);
    await refreshEvent();
    toast('Reverted', 'success');
  } catch (err) { toast(err.message, 'error'); }
  after?.();
}

export function eventLog() {
  if (!ev.isAdmin) return eventShell('log', h('div', { class: 'empty' }, h('p', {}, 'Only event admins can see this page.')));
  const root = h('div');
  let rows = [], q = '', who = '', hideCaptains = false, loading = true;

  const load = async () => {
    try { rows = await state.store.evLog(ev.event.id, 1000); } catch (e) { toast(e.message, 'error'); }
    loading = false; paint();
  };
  const paint = () => {
    const groups = groupLog(rows);
    const actors = [...new Set(groups.map(g => g.actor).filter(Boolean))].sort();
    const nameIn = h('input', { value: staffName(), maxlength: 30, class: 'in-name', 'aria-label': 'Your name in the log' });
    const search = h('input', { type: 'search', placeholder: 'Match number, team or text', value: q, oninput: e => { q = e.target.value; paintList(); } });
    const list = h('div', { class: 'log-list' });
    const count = h('p', { class: 'small muted' });
    const paintList = () => {
      const n2 = q.trim().toLowerCase();
      const items = groups.filter(g => (!who || g.actor === who) && (!hideCaptains || g.kind !== 'captain')
        && (!n2 || g.entries.some(e => e.summary?.toLowerCase().includes(n2)) || (g.actor || '').toLowerCase().includes(n2)
          || g.matchIds.some(id => String(ev.data.matches.find(m => m.id === id)?.match_no) === n2.replace(/^#|match /g, ''))));
      count.textContent = `${items.length} action${items.length === 1 ? '' : 's'}${rows.length >= 1000 ? ' (latest 1,000 entries)' : ''}.`;
      clear(list).append(...(items.length ? items.slice(0, 300).map(g => logCard(g, { onRevert: x => revertAction(x, load) }))
        : [h('div', { class: 'empty-sm' }, loading ? 'Loading…' : rows.length ? 'Nothing matches.' : 'Nothing yet. Changes made by staff and captains show up here.')]));
    };
    clear(root).append(eventShell('log', h('div', { class: 'stack' },
      h('section', { class: 'block' },
        h('div', { class: 'block-head' }, h('h2', {}, 'Activity'), h('span', { class: 'muted small' }, 'Every change by staff and captains, newest first. Revert puts things back the way they were.')),
        h('div', { class: 'log-tools' },
          h('label', { class: 'inline' }, 'Your name in the log', nameIn, h('button', {
            class: 'btn btn-sm', onclick: () => { setStaffName(nameIn.value.trim()); toast('Saved on this device', 'success'); },
          }, 'Save')),
          search,
          h('select', { onchange: e => { who = e.target.value; paintList(); } }, h('option', { value: '' }, 'Everyone'), actors.map(a => h('option', { value: a, selected: a === who }, a))),
          h('label', { class: 'inline small' }, h('input', { type: 'checkbox', checked: hideCaptains, onchange: e => { hideCaptains = e.target.checked; paintList(); } }), 'Hide captain actions')),
        count,
        list))));
    paintList();
  };
  paint();
  load();
  watchEvent(() => { if (root.isConnected && !root.contains(document.activeElement)) load(); });
  return root;
}
