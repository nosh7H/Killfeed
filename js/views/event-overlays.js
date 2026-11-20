// Admin → Stream overlays: OBS browser sources that put team names/logos and the series score over the
// CODCaster POV, plus a scrolling bar (live scores, results, top stat leaders). Drag/resize in the preview.
import { h, clear, toast, confirmDialog } from '../ui.js';
import { state } from '../state.js';
import { ev, refreshEvent, eventSettings, watchEvent, teamTag, bracketMatches } from '../event-state.js';
import { roundName } from '../event-logic.js';
import { eventShell } from './event.js';
import { ELEMENTS, LEADER_STATS, DEFAULT_STYLE, newStation, overlaySettings, overlayStage, stationMatch, boxOf, isOn, styleOf, elOpt } from '../overlay.js';

const bgKey = () => `kf-ov-bg-${ev.event.id}`;
const clone = x => JSON.parse(JSON.stringify(x));

export function eventOverlays() {
  if (!ev.isAdmin) return eventShell('overlays', h('div', { class: 'empty' }, h('p', {}, 'Only event admins and staff can see this page.')));
  const root = h('div');
  let stations = clone(overlaySettings().stations);
  let cur = 0, selected = 'plateA', dirty = false;
  let bg = (() => { try { return localStorage.getItem(bgKey()) || ''; } catch { return ''; } })();
  let stage = null;
  let zoom = 1;
  let bgAdj = (() => { try { return JSON.parse(localStorage.getItem(`${bgKey()}-adj`) || 'null') || { z: 1, x: 0, y: 0 }; } catch { return { z: 1, x: 0, y: 0 }; } })();
  let live = false, liveTimer = null;
  let committed = JSON.stringify(stations); const undo = [], redo = [];
  const st = () => stations[cur];
  // every finished change becomes one undo step; with "Live to OBS" it is also saved straight away
  function commit() {
    const now = JSON.stringify(stations);
    if (now === committed) return;
    undo.push(committed); if (undo.length > 100) undo.shift();
    redo.length = 0; committed = now;
    syncDirty();
    if (live) { clearTimeout(liveTimer); liveTimer = setTimeout(() => save(true), 600); }
  }
  function stepHistory(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(stations));
    stations = JSON.parse(from.pop()); committed = JSON.stringify(stations);
    cur = Math.min(cur, stations.length - 1); dirty = true;
    paint();
    if (live) { clearTimeout(liveTimer); liveTimer = setTimeout(() => save(true), 600); }
  }
  const dirtyEls = { save: null, undo: null, note: h('span', { class: 'small warn-text' }) };
  const syncDirty = () => {
    if (dirtyEls.save) dirtyEls.save.disabled = !dirty;
    if (dirtyEls.undo) dirtyEls.undo.disabled = !dirty;
    dirtyEls.note.textContent = live ? (dirty ? 'Sending to OBS…' : 'Live in OBS') : dirty ? 'Unsaved changes' : '';
    dirtyEls.note.className = `small ${live && !dirty ? 'ov-live-on' : 'warn-text'}`;
    if (dirtyEls.undoStep) dirtyEls.undoStep.disabled = !undo.length;
    if (dirtyEls.redoStep) dirtyEls.redoStep.disabled = !redo.length;
  };
  const touch = (repaintAll = false) => { dirty = true; repaintAll ? paint() : refreshPreview(); commit(); syncDirty(); };

  async function save(quiet = false) {
    try {
      await state.store.updateEvent(ev.event.id, { settings: { ...eventSettings(ev.event), overlays: { stations } } });
      await refreshEvent(); dirty = false; syncDirty();
      if (!quiet) { toast('Overlays saved · OBS updates in a few seconds', 'success'); paint(); }
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---------- preview with drag / resize ----------
  const editBox = h('div', { class: 'ov-edit', tabIndex: 0 });
  const editWrap = h('div', { class: 'ov-edit-wrap' }, editBox);
  const snapLayer = h('div');
  function refreshPreview() {
    stage = overlayStage(st(), { selected });
    editBox.style.width = `${zoom * 100}%`;
    clear(editBox).append(
      bg ? h('img', { class: 'ov-edit-bg', src: bg, alt: '', style: { transform: `translate(${bgAdj.x}%, ${bgAdj.y}%) scale(${bgAdj.z})` } }) : guideHud(),
      h('div', { class: 'ov-edit-fit' }, stage.el), snapLayer);
    fitPreview();
    // resize handle on the selected element
    const node = stage.el.querySelector(`[data-el="${selected}"]`);
    if (node) node.append(h('span', { class: 'ov-handle', 'data-handle': '1' }));
    paintSide();
  }
  const fitPreview = () => requestAnimationFrame(() => { stage.el.style.transform = `scale(${editBox.clientWidth / 1920})`; });
  addEventListener('resize', fitPreview);
  let drag = null;
  editBox.addEventListener('pointerdown', e => {
    const node = e.target.closest('[data-el]');
    if (!node) return;
    const k = node.dataset.el;
    if (k !== selected) { selected = k; refreshPreview(); }
    const rect = editBox.getBoundingClientRect();
    drag = { k, resize: !!e.target.dataset.handle, sx: e.clientX, sy: e.clientY, box: boxOf(st(), k), rect };
    editBox.setPointerCapture(e.pointerId); e.preventDefault();
  });
  editBox.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = ((e.clientX - drag.sx) / drag.rect.width) * 100, dy = ((e.clientY - drag.sy) / drag.rect.height) * 100;
    const b = { ...drag.box };
    if (drag.resize) { b.w = Math.max(0.5, drag.box.w + dx); b.h = Math.max(0.5, drag.box.h + dy); }
    else { b.x = Math.min(100 - b.w, Math.max(0, drag.box.x + dx)); b.y = Math.min(100 - b.h, Math.max(0, drag.box.y + dy)); }
    const guides = e.altKey ? [] : snap(drag.k, b, drag.resize);
    clear(snapLayer).append(...guides.map(g => h('div', { class: `ov-snap ${g.v ? 'v' : 'h'}`, style: g.v ? { left: `${g.at}%` } : { top: `${g.at}%` } })));
    setBox(drag.k, b, false);
    const node = stage.el.querySelector(`[data-el="${drag.k}"]`);
    if (node) Object.assign(node.style, { left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` });
  });
  editBox.addEventListener('pointerup', () => { if (drag) { drag = null; clear(snapLayer); refreshPreview(); commit(); } });
  // snap edges and centres to the frame centre and to other elements (hold Alt to place freely)
  function snap(k, b, resize) {
    const T = 0.35 / zoom;
    const xs = [0, 50, 100], ys = [0, 50, 100];
    for (const o of Object.keys(ELEMENTS)) {
      if (o === k || !isOn(st(), o)) continue;
      const q = boxOf(st(), o);
      xs.push(q.x, q.x + q.w / 2, q.x + q.w); ys.push(q.y, q.y + q.h / 2, q.y + q.h);
    }
    const out = [];
    const best = (vals, targets) => {
      let hit = null;
      for (const [i, v] of vals.entries()) for (const t of targets) if (Math.abs(v - t) < T && (!hit || Math.abs(v - t) < Math.abs(hit.d))) hit = { i, d: t - v, t };
      return hit;
    };
    if (resize) {
      const hx = best([b.x + b.w], xs); if (hx) { b.w += hx.d; out.push({ v: true, at: hx.t }); }
      const hy = best([b.y + b.h], ys); if (hy) { b.h += hy.d; out.push({ v: false, at: hy.t }); }
    } else {
      const hx = best([b.x, b.x + b.w / 2, b.x + b.w], xs); if (hx) { b.x += hx.d; out.push({ v: true, at: hx.t }); }
      const hy = best([b.y, b.y + b.h / 2, b.y + b.h], ys); if (hy) { b.y += hy.d; out.push({ v: false, at: hy.t }); }
    }
    return out;
  }
  const onKey = e => {
    if (!root.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.target.matches?.('input, select, textarea') || document.querySelector('.modal-overlay')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? stepHistory(redo, undo) : stepHistory(undo, redo); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); stepHistory(redo, undo); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const step = e.shiftKey ? 1 : 0.1, b = boxOf(st(), selected);
    if (e.key === 'ArrowLeft') b.x -= step; if (e.key === 'ArrowRight') b.x += step;
    if (e.key === 'ArrowUp') b.y -= step; if (e.key === 'ArrowDown') b.y += step;
    setBox(selected, b); commit();
  };
  document.addEventListener('keydown', onKey);
  const round1 = v => Math.round(v * 10) / 10;
  function setBox(k, b, repaint = true) {
    const s = st();
    s.layout ||= {};
    s.layout[k] = { ...(s.layout[k] || {}), x: round1(b.x), y: round1(b.y), w: round1(b.w), h: round1(b.h) };
    dirty = true; syncDirty();
    if (repaint) refreshPreview();
  }

  // a faint sketch of the CODCaster HUD, so you can line things up without a screenshot
  function guideHud() {
    const box = (x, y, w, hh, label) => h('div', { class: 'ov-guide-box', style: { left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${hh}%` } }, label ? h('span', {}, label) : null);
    return h('div', { class: 'ov-guide' },
      box(2.3, 6.9, 31.7, 18.7, 'CODCaster team panel'), box(66, 6.9, 31.7, 18.7, 'CODCaster team panel'),
      box(41, 6.9, 18, 16, 'Score · timer · mode'),
      h('div', { class: 'ov-guide-note' }, 'Upload a screenshot of your CODCaster feed to line things up exactly'));
  }

  // options for the selected element: text size, alignment, space for the logo, logo fit
  function elementOptions(s) {
    const d = ELEMENTS[selected], o = elOpt(s, selected);
    const set = (k, v) => { s.layout ||= {}; s.layout[selected] = { ...(s.layout[selected] || {}), [k]: v }; touch(); };
    const row = (label, ...kids) => h('label', { class: 'ov-row' }, h('span', {}, label), ...kids);
    return h('div', { class: 'stack-sm', style: { marginTop: '.5rem' } },
      d.text ? row('Text size', h('input', { type: 'range', min: 0.4, max: 2.5, step: 0.05, value: o.size, oninput: e => set('size', +e.target.value) }), h('span', { class: 'small muted' }, `${Math.round(o.size * 100)}%`)) : null,
      d.plate || d.align ? row('Align text', h('select', { onchange: e => set('align', e.target.value) }, [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']].map(([v, l]) => h('option', { value: v, selected: o.align === v }, l)))) : null,
      d.plate ? row('Space for the logo', h('input', { type: 'range', min: 0, max: 200, step: 2, value: o.indent, oninput: e => set('indent', +e.target.value) }), h('span', { class: 'small muted' }, `${o.indent}px`)) : null,
      d.logo ? row('Logo fit', h('select', { onchange: e => set('fit', e.target.value) }, [['contain', 'Whole logo'], ['cover', 'Fill the box (crop)'], ['fill', 'Stretch']].map(([v, l]) => h('option', { value: v, selected: o.fit === v }, l)))) : null);
  }

  // ---------- side panels ----------
  const side = h('div', { class: 'stack ov-side' });
  function paintSide() {
    const s = st(), sty = styleOf(s);
    const setStyle = (k, v) => { s.style = { ...(s.style || {}), [k]: v }; touch(); };
    const row = (label, ...kids) => h('label', { class: 'ov-row' }, h('span', {}, label), ...kids);
    const color = (k, label) => row(label, h('input', { type: 'color', value: /^#/.test(sty[k]) ? sty[k] : '#ffffff', oninput: e => setStyle(k, e.target.value) }));
    const check = (k, label) => h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: !!sty[k], onchange: e => setStyle(k, e.target.checked) }), label);
    const sel = (k, label, opts) => row(label, h('select', { onchange: e => setStyle(k, isNaN(+e.target.value) || e.target.value === '' ? e.target.value : +e.target.value) },
      opts.map(([v, l]) => h('option', { value: v, selected: String(sty[k]) === String(v) }, l))));
    const num = (k, label, min, max, step = 1) => row(label, h('input', { type: 'number', class: 'in-num', min, max, step, value: sty[k], onchange: e => setStyle(k, Math.min(max, Math.max(min, +e.target.value || min))) }));
    const b = boxOf(s, selected);
    clear(side).append(
      // elements
      h('section', { class: 'block' },
        h('h3', {}, 'Elements'),
        h('p', { class: 'small muted' }, 'Click one to select it, drag it in the preview, and pull the corner to resize. Arrow keys nudge it (Shift for bigger steps).'),
        h('div', { class: 'ov-el-list' }, Object.entries(ELEMENTS).map(([k, d]) => h('div', { class: `ov-el-row ${k === selected ? 'on' : ''}` },
          h('input', { type: 'checkbox', checked: isOn(s, k), 'aria-label': `Show ${d.label}`, onchange: e => { s.layout ||= {}; s.layout[k] = { ...(s.layout[k] || {}), on: e.target.checked }; touch(); } }),
          h('button', { class: 'linklike', onclick: () => { selected = k; refreshPreview(); } }, d.label)))),
        h('div', { class: 'ov-xywh' }, ['x', 'y', 'w', 'h'].map(f => h('label', { class: 'small' }, { x: 'Left %', y: 'Top %', w: 'Width %', h: 'Height %' }[f],
          h('input', { type: 'number', class: 'in-num', step: 0.1, value: b[f], onchange: e => { setBox(selected, { ...b, [f]: +e.target.value || 0 }); commit(); } })))),
        elementOptions(s),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { if (s.layout?.[selected]) { const on = s.layout[selected].on; s.layout[selected] = on == null ? {} : { on }; touch(); } } }, 'Reset this element'),
          h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { if (await confirmDialog('Put every element back where it started?', 'Reset all')) { s.layout = {}; touch(); } } }, 'Reset all'),
          stations.length > 1 ? h('select', { 'aria-label': 'Copy the layout from another stream', onchange: e => { const src = stations.find(x => x.id === e.target.value); if (src) { s.layout = clone(src.layout || {}); s.style = clone(src.style || {}); touch(); } e.target.value = ''; } },
            h('option', { value: '' }, 'Copy layout from…'), stations.filter(x => x !== s).map(x => h('option', { value: x.id }, x.name))) : null)),
      // names & logos
      h('section', { class: 'block stack-sm' },
        h('h3', {}, 'Names, logos & series'),
        sel('nameStyle', 'Show', [['name', 'Team name'], ['tag', 'Tag only'], ['both', 'Name · tag']]),
        row('Plate colour', h('select', { onchange: e => setStyle('plateBg', e.target.value === 'team' ? 'team' : sty.plateColor) },
          h('option', { value: 'team', selected: sty.plateBg === 'team' }, 'Each team’s colour'), h('option', { value: 'custom', selected: sty.plateBg !== 'team' }, 'One colour'))),
        sty.plateBg !== 'team' ? row('Colour', h('input', { type: 'color', value: /^#/.test(sty.plateBg) ? sty.plateBg : '#0f1117', oninput: e => setStyle('plateBg', e.target.value) })) : color('plateColor', 'If a team has no colour'),
        row('Opacity', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: sty.plateOpacity, oninput: e => setStyle('plateOpacity', +e.target.value) })),
        color('text', 'Text colour'),
        row('Text size', h('input', { type: 'range', min: 0.6, max: 1.6, step: 0.05, value: sty.textScale, oninput: e => setStyle('textScale', +e.target.value) })),
        check('upper', 'Capitals'),
        sel('seriesStyle', 'Series score as', [['score', 'Numbers (1 – 0)'], ['pips', 'Pips (●○○ BO5 ●○○)']]),
        check('seriesLabel', 'Label under the numbers (“Maps · Best of 5”)')),
      // ticker
      h('section', { class: 'block stack-sm' },
        h('h3', {}, 'Bottom bar'),
        check('showLive', 'Live matches (maps won, e.g. 1–1)'),
        check('showResults', 'Previous match results'),
        sty.showResults ? num('resultsCount', 'How many results', 1, 20) : null,
        check('showLeaders', 'Top stat leaders'),
        sty.showLeaders ? sel('leaderStat', 'Stat', Object.entries(LEADER_STATS).map(([k, v]) => [k, v.label])) : null,
        sty.showLeaders ? num('leaderCount', 'How many players', 1, 10) : null,
        sty.showLeaders ? num('leaderMinMaps', 'Minimum maps played', 1, 20) : null,
        row('Speed', h('input', { type: 'range', min: 30, max: 200, step: 5, value: sty.tickerSpeed, oninput: e => setStyle('tickerSpeed', +e.target.value) })),
        color('tickerBg', 'Background'),
        row('Accent', h('input', { type: 'color', value: sty.tickerAccent || '#a78bfa', oninput: e => setStyle('tickerAccent', e.target.value) }),
          sty.tickerAccent ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => setStyle('tickerAccent', '') }, 'Use event colour') : h('span', { class: 'small muted' }, 'Event colour'))),
    );
  }

  // ---------- page ----------
  function matchLabel(m) {
    const r = ev.resolved.get(m.id) || {};
    return `${m.match_no ? `#${m.match_no} · ` : ''}${teamTag(r.A)} vs ${teamTag(r.B)} · ${roundName(m, bracketMatches())}${m.status === 'live' ? ' · LIVE' : m.status === 'final' ? ' · final' : ''}`;
  }
  function paint() {
    const s = st();
    const url = `${location.origin}${location.pathname}#/overlay/${ev.event.id}/${s.id}`;
    const showing = stationMatch(s);
    const pickable = [...ev.data.matches].filter(m => ev.resolved.get(m.id)?.A || ev.resolved.get(m.id)?.B)
      .sort((a, b) => ({ live: 0, ondeck: 1, scheduled: 2, final: 3 }[a.status] ?? 2) - ({ live: 0, ondeck: 1, scheduled: 2, final: 3 }[b.status] ?? 2) || (a.match_no || 0) - (b.match_no || 0));
    clear(root).append(eventShell('overlays', h('div', { class: 'stack' },
      h('div', { class: 'row wrap ov-stations' },
        stations.map((x, i) => h('button', { class: `chip chip-btn ${i === cur ? 'chip-live' : ''}`, onclick: () => { cur = i; paint(); } }, x.name)),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { stations.push(newStation(stations.length + 1)); cur = stations.length - 1; touch(true); } }, '＋ Add a stream'),
        h('span', { class: 'spacer' }),
        dirtyEls.note,
        (dirtyEls.undo = h('button', { class: 'btn btn-sm', onclick: () => { stations = clone(overlaySettings().stations); cur = Math.min(cur, stations.length - 1); dirty = false; committed = JSON.stringify(stations); paint(); } }, 'Revert to saved')),
        (dirtyEls.save = h('button', { class: 'btn btn-primary btn-sm', onclick: save }, 'Save'))),
      h('section', { class: 'block stack-sm' },
        h('div', { class: 'row wrap' },
          h('label', { class: 'ov-row' }, h('span', {}, 'Name'), h('input', { value: s.name, onchange: e => { s.name = e.target.value.trim() || s.name; touch(true); } })),
          h('label', { class: 'ov-row' }, h('span', {}, 'Shows'), h('select', {
            onchange: e => { if (e.target.value === 'auto') { s.follow = 'auto'; s.match_id = null; } else { s.follow = 'match'; s.match_id = e.target.value; } touch(true); },
          }, h('option', { value: 'auto', selected: s.follow !== 'match' }, 'Automatic: the casted live match'),
            pickable.map(m => h('option', { value: m.id, selected: s.follow === 'match' && s.match_id === m.id }, matchLabel(m))))),
          h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: !!s.swap, onchange: e => { s.swap = e.target.checked; touch(); } }), 'Swap sides'),
          h('label', { class: 'ov-row' }, h('span', {}, 'Title'), h('input', { placeholder: 'Automatic (round · map)', value: s.title || '', onchange: e => { s.title = e.target.value; touch(); } }))),
        h('p', { class: 'small muted' },
          s.follow === 'match' ? 'Pinned to this match until you change it.' : 'Follows the live match marked Casted in the Control panel (or the first live match, then whoever is on deck). Swaps to the next match on its own.',
          ' Now showing: ', h('strong', {}, showing ? matchLabel(showing) : 'nothing yet'), '.',
          ' Use Swap sides if the CODCaster has the teams the other way round.'),
        h('div', { class: 'row wrap' },
          h('code', { class: 'invite ov-url' }, url),
          h('button', { class: 'btn btn-sm', onclick: () => { navigator.clipboard.writeText(url); toast('OBS link copied'); } }, 'Copy OBS link'),
          h('a', { class: 'btn btn-sm btn-ghost', href: url, target: '_blank', rel: 'noopener' }, 'Open ↗'),
          stations.length > 1 ? h('button', {
            class: 'btn btn-sm btn-ghost btn-danger-text', onclick: async () => {
              if (!(await confirmDialog(`Remove ${s.name}? Its OBS link will stop working.`, 'Remove'))) return;
              stations.splice(cur, 1); cur = 0; touch(true);
            },
          }, 'Remove stream') : null),
        h('details', { class: 'small' }, h('summary', {}, 'How to add it in OBS'),
          h('ol', { class: 'small' },
            h('li', {}, 'Sources → + → Browser. Paste the OBS link as the URL.'),
            h('li', {}, 'Width 1920, height 1080. Leave “Custom CSS” as is (the background is transparent).'),
            h('li', {}, 'Put it above your CODCaster capture in the source list.'),
            h('li', {}, 'Untick “Shutdown source when not visible” so the bar keeps scrolling between scenes.'),
            h('li', {}, 'Changes you save here (and new scores) show up on stream within a few seconds. The event must be public for OBS to read it.')))),
      h('div', { class: 'ov-layout' },
        h('div', { class: 'stack-sm' },
          h('div', { class: 'ov-tools' },
            h('div', { class: 'seg', role: 'group', 'aria-label': 'Preview zoom' }, [1, 1.5, 2, 3].map(z => h('button', { class: zoom === z ? 'on' : '', onclick: () => {
              const sel = stage?.el.querySelector(`[data-el="${selected}"]`)?.getBoundingClientRect();
              zoom = z; paint();
              // keep the selected element in view after zooming
              requestAnimationFrame(() => { const b = boxOf(st(), selected); editWrap.scrollLeft = (b.x / 100) * editBox.clientWidth - editWrap.clientWidth / 3; editWrap.scrollTop = (b.y / 100) * editBox.clientHeight - editWrap.clientHeight / 3; });
              void sel;
            } }, `${Math.round(z * 100)}%`))),
            (dirtyEls.undoStep = h('button', { class: 'btn btn-sm btn-ghost', 'data-tip': 'Undo (Ctrl+Z)', onclick: () => stepHistory(undo, redo) }, '↶ Undo')),
            (dirtyEls.redoStep = h('button', { class: 'btn btn-sm btn-ghost', 'data-tip': 'Redo (Ctrl+Shift+Z)', onclick: () => stepHistory(redo, undo) }, '↷ Redo')),
            h('span', { class: 'spacer' }),
            h('label', { class: 'check small', 'data-tip': 'Every change goes to OBS straight away, so you can line things up against the real CODCaster feed in the OBS preview' },
              h('input', { type: 'checkbox', checked: live, onchange: e => { live = e.target.checked; if (live && dirty) save(true); syncDirty(); } }), 'Live to OBS')),
          editWrap,
          bg ? h('div', { class: 'ov-bgadj' },
            ...[['z', 'Screenshot zoom', 0.8, 1.6, 0.005], ['x', 'Move left / right', -15, 15, 0.05], ['y', 'Move up / down', -15, 15, 0.05]].map(([k, label, min, max, step]) => h('label', {}, label,
              h('input', { type: 'range', min, max, step, value: bgAdj[k], oninput: e => { bgAdj = { ...bgAdj, [k]: +e.target.value }; const img = editBox.querySelector('.ov-edit-bg'); if (img) img.style.transform = `translate(${bgAdj.x}%, ${bgAdj.y}%) scale(${bgAdj.z})`; try { localStorage.setItem(`${bgKey()}-adj`, JSON.stringify(bgAdj)); } catch {} } })))) : null,
          bg ? h('p', { class: 'small muted' }, 'If the screenshot has black bars or is slightly off, zoom and move it until the game fills the frame. It only moves the reference picture, not the overlay.') : null,
          h('div', { class: 'row wrap small' },
            h('label', { class: 'btn btn-sm' }, bg ? 'Change background screenshot' : 'Upload a CODCaster screenshot',
              h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: e => loadBg(e.target.files[0]) })),
            bg ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { bg = ''; bgAdj = { z: 1, x: 0, y: 0 }; try { localStorage.removeItem(bgKey()); localStorage.removeItem(`${bgKey()}-adj`); } catch {} paint(); } }, 'Remove background') : null,
            h('span', { class: 'muted' }, 'The screenshot is only for lining things up. It stays on this computer and never shows on stream.'))),
        side))));
    refreshPreview();
    syncDirty();
  }

  function loadBg(file) {
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
      const r = Math.max(1280 / img.width, 720 / img.height);
      c.getContext('2d').drawImage(img, (1280 - img.width * r) / 2, (720 - img.height * r) / 2, img.width * r, img.height * r);
      bg = c.toDataURL('image/jpeg', 0.8);
      try { localStorage.setItem(bgKey(), bg); } catch { toast('Background is too big to keep after a reload, but works for now'); }
      URL.revokeObjectURL(img.src); paint();
    };
    img.src = URL.createObjectURL(file);
  }

  watchEvent(() => { if (!root.isConnected) return; if (!dirty) stations = clone(overlaySettings().stations); refreshPreview(); });
  paint();
  root.tabIndex = -1;
  return root;
}
