// Map breakdown tagger: hill-by-hill (Hardpoint) or round-by-round (S&D) with hotkeys.
// Stats are recalculated on every tag and saved automatically.
import { h, clear, toast, fmtTime, fmtPct, confirmDialog } from '../ui.js';
import { state, canEdit } from '../state.js';
import { modeKind, emptyData, hpSummary, sndSummary, sndRound, sideFor, hillOutcome, HILL_LABEL } from '../breakdown.js';

const SOURCES = [['pov', 'Player POV'], ['caster', 'CODCaster']];

export async function breakdownPanel(g, vod) {
  const kind = modeKind(g.mode);
  const editable = canEdit();
  let row = await state.store.getBreakdown(g.id) || { game_id: g.id, mode: g.mode, source: 'pov', data: emptyData(g.mode) };
  row.data ||= emptyData(g.mode);
  let hotkeys = editable && localStorage.getItem('kf-hotkeys') !== 'off';
  let selected = null;            // index of the hill / round the hotkeys act on (default: last)
  const undo = [];
  let saveTimer = null;
  const wrap = h('div', { class: 'bd' });
  const statusEl = h('span', { class: 'muted small bd-status' });

  const now = () => { const t = vod.player?.getTime?.(); return t == null || isNaN(t) ? null : Math.floor(t); };
  const items = () => (kind === 'hp' ? row.data.hills : kind === 'snd' ? row.data.rounds : row.data.events);
  const cur = () => { const list = items(); return list[selected ?? list.length - 1]; };

  function change(fn) {
    if (!editable) return;
    undo.push(JSON.stringify(row.data)); if (undo.length > 100) undo.shift();
    fn();
    paint();
    statusEl.textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  }
  async function save() {
    try {
      row = { ...row, ...(await state.store.saveBreakdown(state.team.id, { ...row, mode: g.mode })) };
      statusEl.textContent = 'Saved · stats updated';
    } catch (e) { statusEl.textContent = ''; toast(`Couldn't save breakdown: ${e.message}`, 'error'); }
  }

  // ---------- actions ----------
  const A = {
    newHill: () => change(() => { row.data.hills.push({ n: row.data.hills.length + 1, t: now(), first: null, broken: false, us: null, them: null, unsure: false }); selected = null; }),
    first: who => change(() => { const x = cur() || (A.newHillRaw(), cur()); x.first = x.first === who ? null : who; }),
    newHillRaw: () => row.data.hills.push({ n: row.data.hills.length + 1, t: now(), first: null, broken: false, us: null, them: null, unsure: false }),
    broken: () => change(() => { const x = cur(); if (x) x.broken = !x.broken; }),
    newRound: () => change(() => { const n = row.data.rounds.length + 1; row.data.rounds.push({ n, t: now(), side: sideFor(row.data.start_side || 'atk', n), events: [], result: null, unsure: false }); selected = null; }),
    ev: k => change(() => {
      if (!row.data.rounds.length) { const n = 1; row.data.rounds.push({ n, t: now(), side: sideFor(row.data.start_side || 'atk', n), events: [], result: null, unsure: false }); }
      const r = cur(); r.events.push({ k, t: now() });
    }),
    result: res => change(() => { const r = cur(); if (r) r.result = r.result === res ? null : res; }),
    unsure: () => change(() => { const x = cur(); if (x) x.unsure = !x.unsure; }),
    undo: () => { if (!undo.length) return toast('Nothing to undo'); row.data = JSON.parse(undo.pop()); paint(); clearTimeout(saveTimer); saveTimer = setTimeout(save, 600); },
    seek: t => { if (t != null && vod.player) vod.player.seek(t); },
  };

  const KEYS = kind === 'hp'
    ? [['N', 'New hill', A.newHill], ['1', 'We rotated first', () => A.first('us')], ['2', 'They rotated first', () => A.first('them')], ['B', 'Hill got broken / we broke it', A.broken], ['U', 'Mark unsure', A.unsure], ['Z', 'Undo', A.undo]]
    : kind === 'snd'
      ? [['R', 'New round', A.newRound], ['K', 'We got a kill', () => A.ev('kill')], ['D', 'Teammate died', () => A.ev('death')], ['P', 'Bomb planted', () => A.ev('plant')], ['E', 'Bomb defused', () => A.ev('defuse')], ['W', 'Round won', () => A.result('W')], ['L', 'Round lost', () => A.result('L')], ['U', 'Mark unsure', A.unsure], ['Z', 'Undo', A.undo]]
      : [];

  const onKey = e => {
    if (!wrap.isConnected) return document.removeEventListener('keydown', onKey);
    if (!hotkeys || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const t = now(); if (t != null) { e.preventDefault(); A.seek(Math.max(0, t + (e.key === 'ArrowLeft' ? -5 : 5))); } return;
    }
    const k = KEYS.find(([key]) => key.toLowerCase() === e.key.toLowerCase());
    if (k) { e.preventDefault(); k[2](); flash(k[1]); }
  };
  document.addEventListener('keydown', onKey);
  const flashEl = h('span', { class: 'bd-flash' });
  let flashT;
  const flash = msg => { flashEl.textContent = msg; flashEl.classList.add('on'); clearTimeout(flashT); flashT = setTimeout(() => flashEl.classList.remove('on'), 900); };

  // ---------- render ----------
  function paint() {
    clear(wrap).append(...[
      h('div', { class: 'bd-head' },
        h('div', { class: 'seg' }, SOURCES.map(([k, l]) => h('button', {
          class: row.source === k ? 'on' : '', disabled: !editable,
          'data-tip': k === 'pov' ? 'Recording from one of our players. Mark anything you couldn’t see as unsure.' : 'Observer recording: everything is visible.',
          onclick: () => change(() => { row.source = k; }),
        }, l))),
        kind === 'snd' ? h('label', { class: 'inline small' }, 'We start on', h('select', {
          disabled: !editable, onchange: e => change(() => { row.data.start_side = e.target.value; row.data.rounds.forEach(r => { r.side = sideFor(e.target.value, r.n); }); }),
        }, h('option', { value: 'atk', selected: row.data.start_side !== 'def' }, 'Attack'), h('option', { value: 'def', selected: row.data.start_side === 'def' }, 'Defense'))) : null,
        h('span', { class: 'spacer' }),
        editable && KEYS.length ? h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: hotkeys, onchange: e => { hotkeys = e.target.checked; localStorage.setItem('kf-hotkeys', hotkeys ? 'on' : 'off'); } }), 'Hotkeys') : null,
        flashEl, statusEl),
      summary(),
      KEYS.length && editable ? h('div', { class: 'bd-keys' }, KEYS.map(([k, l]) => h('span', {}, h('kbd', {}, k), l)), h('span', {}, h('kbd', {}, '← →'), '5 s')) : null,
      kind === 'hp' ? hillList() : kind === 'snd' ? roundList() : eventList(),
    ].filter(Boolean));
  }

  function summary() {
    if (kind === 'hp') {
      const s = hpSummary(row.data);
      return h('div', { class: 'bd-summary' },
        stat('Rotations won', s.hills ? `${s.rotations}/${s.hills}` : '–', fmtPct(s.rotationRate)),
        stat('Held', s.held, s.rotations ? `${fmtPct(s.holdRate)} of ours` : ''),
        stat('Got broken', s.got_broken),
        stat('Broke them', s.broke, s.hills - s.rotations ? `${fmtPct(s.breakRate)} of theirs` : ''),
        stat('Lost clean', s.lost),
        s.unsure ? stat('Unsure', s.unsure) : null);
    }
    if (kind === 'snd') {
      const s = sndSummary(row.data);
      const st = k => (s.states[k] ? `${s.states[k].w}/${s.states[k].n}` : '–');
      return h('div', { class: 'bd-summary' },
        stat('Rounds', s.rounds ? `${s.won}–${s.rounds - s.won}` : '–'),
        stat('First blood', fmtPct(s.fbRate), s.fbConv != null ? `${fmtPct(s.fbConv)} won after` : ''),
        stat('Post-plant', s.plants ? `${Math.round(s.postPlantRate * s.plants)}/${s.plants}` : '–', 'attack, planted'),
        stat('Retake', s.retakes ? `${Math.round(s.retakeRate * s.retakes)}/${s.retakes}` : '–', 'defense, they planted'),
        stat('3v2', st('3v2'), 'rounds won'),
        stat('2v3', st('2v3'), 'rounds won'),
        s.unsure ? stat('Unsure', s.unsure) : null);
    }
    return h('p', { class: 'hint' }, 'Hijack breakdowns: log moments as events for now. Tell us which numbers matter and they can get their own stats like Hardpoint and S&D.');
  }
  const stat = (label, val, sub) => h('div', { class: 'bd-stat' }, h('div', { class: 'eyebrow' }, label), h('div', { class: 'bd-val' }, val ?? '–'), sub ? h('div', { class: 'muted small' }, sub) : null);

  const timeBtn = t => (t == null ? h('span', { class: 'muted small' }, '—') : h('button', { class: 'mark-time', onclick: () => A.seek(t) }, fmtTime(t)));
  const isSel = i => (selected ?? items().length - 1) === i;

  function hillList() {
    const hills = row.data.hills;
    return h('div', { class: 'bd-list' },
      hills.length ? hills.map((x, i) => h('div', { class: `bd-row ${isSel(i) ? 'sel' : ''} ${x.unsure ? 'unsure' : ''}`, onclick: e => { if (!e.target.closest('button,input,select')) { selected = i; paint(); } } },
        h('span', { class: 'bd-n' }, `Hill ${x.n}`),
        timeBtn(x.t),
        h('div', { class: 'seg seg-sm' }, [['us', 'We rotated'], ['them', 'They rotated']].map(([k, l]) => h('button', { class: x.first === k ? 'on' : '', disabled: !editable, onclick: () => change(() => { x.first = x.first === k ? null : k; }) }, l))),
        h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: x.broken, disabled: !editable, onchange: () => change(() => { x.broken = !x.broken; }) }), 'Broken'),
        h('span', { class: `bd-out o-${hillOutcome(x)}` }, HILL_LABEL[hillOutcome(x)]),
        h('span', { class: 'bd-pts' },
          h('input', { class: 'in-num', type: 'number', min: 0, placeholder: row.source === 'caster' ? 'Us' : 'Us (opt)', value: x.us ?? '', disabled: !editable, onchange: e => change(() => { x.us = e.target.value === '' ? null : +e.target.value; }) }),
          h('input', { class: 'in-num', type: 'number', min: 0, placeholder: row.source === 'caster' ? 'Them' : 'Them', value: x.them ?? '', disabled: !editable, onchange: e => change(() => { x.them = e.target.value === '' ? null : +e.target.value; }) })),
        editable ? h('button', { class: 'icon-btn', 'aria-label': 'Delete hill', onclick: () => change(() => { hills.splice(i, 1); hills.forEach((y, j) => { y.n = j + 1; }); selected = null; }) }, '✕') : null))
        : h('div', { class: 'empty-sm' }, editable ? 'Press N (or the button) when the first hill starts.' : 'Not tagged yet.'),
      editable ? h('button', { class: 'btn btn-sm', onclick: A.newHill }, '＋ Hill') : null);
  }

  function roundList() {
    const rounds = row.data.rounds;
    const evLabel = { kill: '+1', death: '−1', plant: 'Plant', defuse: 'Defuse' };
    return h('div', { class: 'bd-list' },
      rounds.length ? rounds.map((r, i) => {
        const d = sndRound(r);
        return h('div', { class: `bd-row ${isSel(i) ? 'sel' : ''} ${r.unsure ? 'unsure' : ''}`, onclick: e => { if (!e.target.closest('button,input,select')) { selected = i; paint(); } } },
          h('span', { class: 'bd-n' }, `R${r.n}`),
          h('button', { class: `side side-${r.side}`, disabled: !editable, 'data-tip': 'Click to swap side', onclick: () => change(() => { r.side = r.side === 'atk' ? 'def' : 'atk'; }) }, r.side === 'atk' ? 'ATK' : 'DEF'),
          h('span', { class: 'bd-events' }, r.events.length ? r.events.map((e, j) => h('button', {
            class: `ev ev-${e.k}`, 'data-tip': `${{ kill: 'We got a kill', death: 'Teammate died', plant: 'Bomb planted', defuse: 'Bomb defused' }[e.k]}${e.t != null ? ' · ' + fmtTime(e.t) : ''}\nClick to jump · right-click to remove`,
            onclick: () => A.seek(e.t), oncontextmenu: ev => { ev.preventDefault(); if (editable) change(() => { r.events.splice(j, 1); }); },
          }, evLabel[e.k])) : h('span', { class: 'muted small' }, 'K / D / P / E')),
          h('span', { class: 'bd-state', 'data-tip': `States: ${d.states.join(' → ')}` }, d.states[d.states.length - 1], d.fb ? h('em', {}, d.fb === 'us' ? ' · our FB' : ' · their FB') : null),
          h('div', { class: 'seg seg-sm' }, ['W', 'L'].map(x => h('button', { class: r.result === x ? `on res-${x}` : '', disabled: !editable, onclick: () => change(() => { r.result = r.result === x ? null : x; }) }, x))),
          editable ? h('button', { class: 'icon-btn', 'aria-label': 'Delete round', onclick: () => change(() => { rounds.splice(i, 1); rounds.forEach((y, j) => { y.n = j + 1; }); selected = null; }) }, '✕') : null);
      }) : h('div', { class: 'empty-sm' }, editable ? 'Press R when round 1 starts, then K for each kill and D for each teammate death as they happen in the killfeed.' : 'Not tagged yet.'),
      editable ? h('button', { class: 'btn btn-sm', onclick: A.newRound }, '＋ Round') : null);
  }

  function eventList() {
    const evs = row.data.events;
    const label = h('input', { placeholder: 'What happened? (e.g. lost the escort at checkpoint 2)' });
    return h('div', { class: 'bd-list' },
      evs.map((e, i) => h('div', { class: 'bd-row' }, timeBtn(e.t), h('span', { class: `tag ${e.side ? 'side-' + e.side : ''}` }, e.side === 'us' ? 'Us' : e.side === 'them' ? 'Them' : '—'), h('span', {}, e.label),
        editable ? h('button', { class: 'icon-btn', 'aria-label': 'Delete', onclick: () => change(() => { evs.splice(i, 1); }) }, '✕') : null)),
      editable ? h('div', { class: 'row' }, label,
        h('button', { class: 'btn btn-sm', onclick: () => { if (label.value.trim()) change(() => { evs.push({ t: now(), label: label.value.trim(), side: 'us' }); }); } }, '＋ Us'),
        h('button', { class: 'btn btn-sm', onclick: () => { if (label.value.trim()) change(() => { evs.push({ t: now(), label: label.value.trim(), side: 'them' }); }); } }, '＋ Them')) : null);
  }

  paint();
  if (row.updated_at) statusEl.textContent = `Saved · ${new Date(row.updated_at).toLocaleString()}`;
  return wrap;
}

export { confirmDialog };
