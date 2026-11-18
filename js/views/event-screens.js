// Admin → Display: choose what the venue TV / stream shows, in what order, with presets
// for each part of the day (doors open → group stage → playoffs) and a live preview.
import { h, clear, toast } from '../ui.js';
import { state } from '../state.js';
import { ev, refreshEvent, eventSettings, watchEvent } from '../event-state.js';
import { eventShell } from './event.js';
import { FONT_STYLES } from '../theme.js';

export const SCENES = [
  ['seating', 'Seating chart', 'Which row every team sits at (group stage, by session)'],
  ['groups', 'Group standings', 'Every group with series and map records'],
  ['live', 'Live matches', 'Live scores, current map, who’s on deck and where to report'],
  ['kd:*', 'K/D leaders', 'One screen per mode (HP, S&D, Hijack…)'],
  ['teams', 'Team stats', 'Series, maps and K/D per team'],
  ['bracket', 'Bracket', 'Playoff bracket'],
  ['awards', 'Awards', 'MVP, Slayer, Obj King…'],
  ['queue', 'Up next (full screen)', 'The match queue on its own'],
];

export const PRESETS = [
  { id: 'start', name: 'Doors open', blurb: 'Seating + groups, before anything is played', scenes: ['seating', 'groups'] },
  { id: 'groups', name: 'Group stage', blurb: 'Live, seating, groups and stats', scenes: ['live', 'seating', 'groups', 'kd:*', 'teams'] },
  { id: 'playoffs', name: 'Playoffs', blurb: 'Live, bracket, stats and awards', scenes: ['live', 'bracket', 'kd:*', 'teams', 'awards'] },
];

const base = k => (k.startsWith('kd:') ? 'kd:*' : k);
const expand = keys => keys.flatMap(k => (k === 'kd:*' ? ev.settings.modes.map(m => `kd:${m}`) : [k]));

export function eventScreens() {
  if (!ev.isAdmin) return eventShell('screens', h('div', { class: 'empty' }, h('p', {}, 'Only event admins can see this page.')));
  const root = h('div');
  let draft = null;     // { order: [...keys], on: Set, seconds, min_games, ticker, leaders, font }
  let preview = null;   // scene key being previewed
  let frameEl = null, frameKey = '';

  const fromSettings = () => {
    const d = ev.settings.display;
    const on = new Set(d.scenes.map(base));
    const order = [...new Set([...d.scenes.map(base), ...SCENES.map(([k]) => k)])];
    return { order, on, seconds: d.seconds, min_games: d.min_games, ticker: d.ticker !== false, leaders: d.leaders !== false, font: d.font || 'mix', dirty: false };
  };

  const paint = () => {
    if (!draft) draft = fromSettings();
    const d = ev.settings.display;
    const url = `${location.origin}${location.pathname}#/display/${ev.event.id}`;
    const active = draft.order.filter(k => draft.on.has(k));
    if (!preview || !draft.on.has(preview)) preview = active[0] || 'groups';
    const matchesPreset = p => p.scenes.length === active.length && p.scenes.every((k, i) => active[i] === k);
    const touch = () => { draft.dirty = true; paint(); };

    const list = h('ol', { class: 'screen-list' }, draft.order.map((k, i) => {
      const [, name, blurb] = SCENES.find(x => x[0] === k) || [k, k, ''];
      const on = draft.on.has(k);
      return h('li', { class: `${on ? 'on' : ''} ${preview === k ? 'previewing' : ''}` },
        h('label', { class: 'switch', 'data-tip': on ? 'Showing — click to hide' : 'Hidden — click to show' },
          h('input', { type: 'checkbox', checked: on, onchange: e => { e.target.checked ? draft.on.add(k) : draft.on.delete(k); touch(); } }), h('i')),
        h('button', { class: 'screen-name', onclick: () => { preview = k; paint(); } },
          h('strong', {}, name), h('span', { class: 'muted small' }, blurb)),
        on ? h('span', { class: 'screen-n' }, `#${active.indexOf(k) + 1}`) : h('span', { class: 'screen-n muted' }, 'off'),
        h('span', { class: 'row' },
          h('button', { class: 'icon-btn', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [draft.order[i - 1], draft.order[i]] = [draft.order[i], draft.order[i - 1]]; touch(); } }, '↑'),
          h('button', { class: 'icon-btn', 'aria-label': 'Move down', disabled: i === draft.order.length - 1, onclick: () => { [draft.order[i + 1], draft.order[i]] = [draft.order[i], draft.order[i + 1]]; touch(); } }, '↓')));
    }));

    const previewKey = preview === 'kd:*' ? `kd:${ev.settings.modes[0]}` : preview;
    // keep the same iframe between repaints (it updates itself live); only swap it when the screen changes
    if (!frameEl || frameKey !== previewKey) {
      frameKey = previewKey;
      const ifr = h('iframe', { src: `#/display/${ev.event.id}?scene=${encodeURIComponent(previewKey)}&t=600`, title: 'Display preview', tabindex: '-1' });
      frameEl = h('div', { class: 'screen-preview' }, ifr);
      // scale the 1920×1080 screen down to the box
      new ResizeObserver(([e]) => { ifr.style.transform = `scale(${e.contentRect.width / 1920})`; }).observe(frameEl);
    }
    const frame = frameEl;

    const secsOut = h('strong', {}, `${draft.seconds}s`);
    clear(root).append(eventShell('screens', h('div', { class: 'stack' },
      h('section', { class: 'block' },
        h('div', { class: 'block-head' }, h('h2', {}, 'Presets'), h('span', { class: 'muted small' }, 'One click per part of the day. Then fine-tune below.')),
        h('div', { class: 'preset-grid' }, PRESETS.map(p => h('button', {
          class: `preset ${matchesPreset(p) ? 'on' : ''}`,
          onclick: () => {
            draft.order = [...p.scenes, ...draft.order.filter(k => !p.scenes.includes(k))];
            draft.on = new Set(p.scenes); preview = p.scenes[0]; touch();
          },
        }, h('strong', {}, p.name), h('span', { class: 'small muted' }, p.blurb),
        h('span', { class: 'preset-steps' }, p.scenes.map(k => h('i', {}, SCENES.find(x => x[0] === k)?.[1] || k))))))),

      h('div', { class: 'screens-layout' },
        h('section', { class: 'block' },
          h('div', { class: 'block-head' }, h('h2', {}, 'Screens'), h('span', { class: 'muted small' }, `${active.length} showing · rotates every ${draft.seconds}s`)),
          list,
          h('p', { class: 'hint' }, 'Click a screen’s name to preview it. Turn screens on as the day goes on — stats once maps are played, the bracket once playoffs are set.')),
        h('section', { class: 'block' },
          h('div', { class: 'block-head' }, h('h2', {}, 'Preview'), h('span', { class: 'muted small' }, SCENES.find(x => x[0] === preview)?.[1] || '')),
          frame,
          h('div', { class: 'stack-sm' },
            h('label', {}, h('span', {}, 'Time per screen: ', secsOut),
              h('input', { type: 'range', min: 10, max: 60, step: 5, value: draft.seconds, oninput: e => { draft.seconds = +e.target.value; secsOut.textContent = `${draft.seconds}s`; draft.dirty = true; } })),
            h('div', { class: 'grid-2' },
              h('label', {}, 'Min. maps on K/D boards', h('input', { type: 'number', min: 1, max: 20, value: draft.min_games, class: 'in-num', onchange: e => { draft.min_games = Math.max(1, +e.target.value || 1); draft.dirty = true; } })),
              h('label', {}, 'Font', h('select', { onchange: e => { draft.font = e.target.value; draft.dirty = true; } }, FONT_STYLES.map(([k, l]) => h('option', { value: k, selected: draft.font === k }, l))))),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: draft.ticker, onchange: e => { draft.ticker = e.target.checked; draft.dirty = true; } }), 'Live / up next bar along the bottom'),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: draft.leaders, onchange: e => { draft.leaders = e.target.checked; draft.dirty = true; } }), 'Scroll category leaders in that bar'),
            h('div', { class: 'row' }, h('code', { class: 'url' }, url),
              h('button', { class: 'btn btn-sm', onclick: () => { navigator.clipboard.writeText(url); toast('Copied'); } }, 'Copy link'),
              h('a', { class: 'btn btn-sm btn-ghost', href: `#/display/${ev.event.id}`, target: '_blank', rel: 'noopener' }, 'Open ↗')),
            h('p', { class: 'hint' }, 'OBS: Browser Source at 1920×1080. Add ?bg=transparent for a transparent background.')))),

      h('div', { class: 'save-bar' },
        draft.dirty ? h('span', { class: 'small muted' }, 'Unsaved changes') : h('span', { class: 'small muted' }, d.pin ? 'The display is pinned to one screen from the Control panel.' : 'Saved. Open displays update by themselves.'),
        h('span', { class: 'spacer' }),
        draft.dirty ? h('button', { class: 'btn btn-ghost', onclick: () => { draft = null; paint(); } }, 'Discard') : null,
        h('button', {
          class: 'btn btn-primary', disabled: !active.length, onclick: async () => {
            const scenes = expand(active);
            await state.store.updateEvent(ev.event.id, {
              settings: { ...eventSettings(ev.event), display: { ...ev.settings.display, scenes, scenes_v: 2, seconds: draft.seconds, min_games: draft.min_games, ticker: draft.ticker, leaders: draft.leaders, font: draft.font } },
            });
            await refreshEvent(); draft = null;
            toast('Display updated — open screens switch over automatically', 'success'); paint();
          },
        }, 'Save display')))));
  };

  paint();
  watchEvent(() => { if (root.isConnected && !draft?.dirty && !root.contains(document.activeElement)) { draft = null; paint(); } });
  return root;
}
