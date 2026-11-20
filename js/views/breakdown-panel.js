// Map breakdown tagger: hill-by-hill (Hardpoint) or round-by-round (S&D) with hotkeys.
// Stats are recalculated on every tag and saved automatically.
import { h, clear, toast, fmtTime, fmtPct, confirmDialog } from '../ui.js';
import { state, canEdit } from '../state.js';
import { modeKind, emptyData, hpSummary, sndSummary, hjSummary, sndRound, sideFor, hillOutcome, HILL_LABEL } from '../breakdown.js';

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
    first: who => change(() => { const x = cur() || (A.newHillRaw(), cur()); delete x.auto; x.first = x.first === who ? null : who; }),
    newHillRaw: () => row.data.hills.push({ n: row.data.hills.length + 1, t: now(), first: null, broken: false, us: null, them: null, unsure: false }),
    broken: () => change(() => { const x = cur(); if (x) { delete x.auto; x.broken = !x.broken; } }),
    newRound: () => change(() => { const n = row.data.rounds.length + 1; row.data.rounds.push({ n, t: now(), side: sideFor(row.data.start_side || 'atk', n), events: [], result: null, unsure: false }); selected = null; }),
    ev: k => change(() => {
      if (!row.data.rounds.length) { const n = 1; row.data.rounds.push({ n, t: now(), side: sideFor(row.data.start_side || 'atk', n), events: [], result: null, unsure: false }); }
      const r = cur(); delete r.auto; r.events.push({ k, t: now() });
    }),
    result: res => change(() => { const r = cur(); if (r) delete r.auto; if (r) r.result = r.result === res ? null : res; }),
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
      autoBlock(),
      summary(),
      row.data.series?.length > 1 ? scoreChart() : null,
      KEYS.length && editable ? h('div', { class: 'bd-keys' }, KEYS.map(([k, l]) => h('span', {}, h('kbd', {}, k), l)), h('span', {}, h('kbd', {}, '← →'), '5 s')) : null,
      kind === 'hp' ? hillList() : kind === 'snd' ? roundList() : kind === 'hj' ? hjList() : eventList(),
    ].filter(Boolean));
  }

  // ---------- auto-timestamp ----------
  function autoBlock() {
    if (!editable || !['hp', 'snd', 'hj'].includes(kind)) return null;
    const src = vod.player?.src;
    const nAuto = kind === 'hp' ? row.data.hills.filter(x => x.auto).length : kind === 'snd' ? row.data.rounds.filter(x => x.auto).length : row.data.events.filter(x => x.auto).length;
    const what = kind === 'hp' ? 'hill starts, who rotated first, holds and breaks' : kind === 'snd' ? 'rounds, results, first bloods, first deaths, kills, deaths and plants' : 'dunks, throws and capture time';
    return h('div', { class: 'bd-auto' },
      h('div', { class: 'grow' }, h('strong', {}, 'Auto-timestamp'),
        h('div', { class: 'small muted' }, `Reads the ${row.source === 'caster' ? 'CODCaster' : 'Player POV'} recording and tags ${what}. You can still add and fix tags by hand.`),
        nAuto ? h('div', { class: 'small' }, `${nAuto} ${kind === 'hp' ? 'hills' : kind === 'snd' ? 'rounds' : 'events'} from the last scan.`) : null),
      src ? h('button', {
        class: 'btn btn-primary btn-sm', onclick: async () => {
          const { autoTimestamp } = await import('./vod-auto.js');
          autoTimestamp({ g, src, row, kind, startAt: now() || 0, onApply: data => change(() => { row.data = data; }) });
        },
      }, nAuto ? 'Scan again' : 'Scan VOD')
        : h('label', { class: 'btn btn-sm', 'data-tip': 'The browser can’t read YouTube or Twitch players. Open the recording file; it stays on your computer.' }, 'Open video file to scan',
          h('input', { type: 'file', accept: 'video/*', hidden: true, onchange: e => { const f = e.target.files[0]; if (f && vod.openLocal) vod.openLocal(f); } })));
  }

  // ---------- score over the map ----------
  function scoreChart() {
    const S = row.data.series;
    const W = 1000, H = 190, P = { l: 34, r: 70, t: 10, b: 22 };
    const t0 = S[0][0], t1 = S[S.length - 1][0] || t0 + 1;
    const top = Math.max(1, ...S.map(p => Math.max(p[1], p[2])));
    const x = t => P.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r);
    const y = v => P.t + (1 - v / top) * (H - P.t - P.b);
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, a = {}, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) if (v != null) n.setAttribute(k, v); kids.flat(Infinity).forEach(c => c != null && n.append(typeof c === 'string' ? document.createTextNode(c) : c)); return n; };
    const step = kind === 'snd'; // S&D score moves in steps
    const path = i => S.map((p, j) => (j ? (step ? `H${x(p[0]).toFixed(1)}V${y(p[i]).toFixed(1)}` : `L${x(p[0]).toFixed(1)},${y(p[i]).toFixed(1)}`) : `M${x(p[0]).toFixed(1)},${y(p[i]).toFixed(1)}`)).join('');
    const marks = kind === 'hp' ? row.data.hills.filter(hl => hl.t != null).map(hl => ({ t: hl.t, label: `H${hl.n}` }))
      : kind === 'snd' ? row.data.rounds.filter(r => r.t != null).map(r => ({ t: r.t, label: `R${r.n}` }))
        : row.data.events.filter(e => e.k).map(e => ({ t: e.t, label: e.k === 'dunk' ? 'D' : 'T' }));
    const ticks = [0, Math.round(top / 2), top];
    const last = S[S.length - 1];
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'trend bd-chart', role: 'img', 'aria-label': `Score over the map, ending ${last[1]}–${last[2]}` },
      ticks.map(v => [el('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid' }), el('text', { x: P.l - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, String(v))]),
      marks.map(m => [el('line', { x1: x(m.t), x2: x(m.t), y1: P.t, y2: H - P.b, class: 'bd-mark' }), el('text', { x: x(m.t) + 3, y: H - P.b - 4, class: 'axis' }, m.label)]),
      el('path', { d: path(2), class: 'line line-them' }),
      el('path', { d: path(1), class: 'line' }),
      el('text', { x: W - P.r + 6, y: y(last[1]) + 4, class: 'axis lbl-us' }, `Us ${last[1]}`),
      el('text', { x: W - P.r + 6, y: y(last[2]) + (Math.abs(y(last[1]) - y(last[2])) < 12 ? 16 : 4), class: 'axis' }, `Them ${last[2]}`),
      el('text', { x: P.l, y: H - 4, class: 'axis' }, fmtTime(t0)), el('text', { x: W - P.r, y: H - 4, class: 'axis', 'text-anchor': 'end' }, fmtTime(t1)),
      // hover / click: score at that time, jump the video there
      S.filter((_, j) => j % Math.max(1, Math.ceil(S.length / 120)) === 0).map((p, j, arr) => {
        const nx = arr[j + 1] ? x(arr[j + 1][0]) : W - P.r;
        return el('rect', { x: x(p[0]), y: 0, width: Math.max(1, nx - x(p[0])), height: H, class: 'hit', 'data-tip': `${fmtTime(p[0])} · Us ${p[1]} – ${p[2]} Them\nClick to jump the video here`, onclick: null, 'data-t': p[0] });
      }));
    svg.addEventListener('click', e => { const t = e.target.getAttribute?.('data-t'); if (t != null) A.seek(+t); });
    return h('div', { class: 'chart' }, svg,
      h('div', { class: 'chart-key small muted' }, h('span', { class: 'key-line' }), 'Us', h('span', { class: 'key-line them' }), 'Them',
        h('span', { class: 'key-dash' }), kind === 'hp' ? 'Hill starts' : kind === 'snd' ? 'Round starts' : 'Dunks (D) and throws (T)'));
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
        stat('First blood', s.rounds ? `${s.firstBloods}/${s.rounds}` : '–', s.fbConv != null ? `${fmtPct(s.fbConv)} won after` : ''),
        stat('First death', s.rounds ? `${s.firstDeaths}/${s.rounds}` : '–', s.fbThemSurvive != null ? `${fmtPct(s.fbThemSurvive)} won anyway` : ''),
        stat('Post-plant', s.plants ? `${Math.round(s.postPlantRate * s.plants)}/${s.plants}` : '–', 'attack, planted'),
        stat('Retake', s.retakes ? `${Math.round(s.retakeRate * s.retakes)}/${s.retakes}` : '–', 'defense, they planted'),
        stat('3v2', st('3v2'), 'rounds won'),
        stat('2v3', st('2v3'), 'rounds won'),
        s.unsure ? stat('Unsure', s.unsure) : null,
        Object.keys(s.fbBy).length || Object.keys(s.fdBy).length ? h('div', { class: 'bd-stat bd-wide' }, h('div', { class: 'eyebrow' }, 'First blood / first death by player'),
          h('div', { class: 'small' }, [...new Set([...Object.keys(s.fbBy), ...Object.keys(s.fdBy)])].map(n => `${n} ${s.fbBy[n] || 0} / ${s.fdBy[n] || 0}`).join(' · '))) : null);
    }
    if (kind === 'hj') {
      const s = hjSummary(row.data);
      return h('div', { class: 'bd-summary' },
        stat('Dunks', `${s.dunks.us} – ${s.dunks.them}`, 'us – them · 30 pts'),
        stat('Throws', `${s.throws.us} – ${s.throws.them}`, 'us – them · 15 pts'),
        stat('Capture time', s.hold.us != null ? `${fmtTime(s.hold.us)} – ${fmtTime(s.hold.them)}` : '–', '1 pt a second'));
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
        h('span', { class: 'bd-n' }, `Hill ${x.n}`, x.auto ? h('span', { class: 'auto-dot', 'data-tip': 'From the scan. Edit it and it becomes yours.' }) : null),
        timeBtn(x.t),
        h('div', { class: 'seg seg-sm' }, [['us', 'We rotated'], ['them', 'They rotated']].map(([k, l]) => h('button', { class: x.first === k ? 'on' : '', disabled: !editable, onclick: () => change(() => { delete x.auto; x.first = x.first === k ? null : k; }) }, l))),
        h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: x.broken, disabled: !editable, onchange: () => change(() => { delete x.auto; x.broken = !x.broken; }) }), 'Broken'),
        h('span', { class: `bd-out o-${hillOutcome(x)}` }, HILL_LABEL[hillOutcome(x)]),
        h('span', { class: 'bd-pts' },
          h('input', { class: 'in-num', type: 'number', min: 0, placeholder: row.source === 'caster' ? 'Us' : 'Us (opt)', value: x.us ?? '', disabled: !editable, onchange: e => change(() => { delete x.auto; x.us = e.target.value === '' ? null : +e.target.value; }) }),
          h('input', { class: 'in-num', type: 'number', min: 0, placeholder: row.source === 'caster' ? 'Them' : 'Them', value: x.them ?? '', disabled: !editable, onchange: e => change(() => { delete x.auto; x.them = e.target.value === '' ? null : +e.target.value; }) })),
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
          h('span', { class: 'bd-n' }, `R${r.n}`, r.auto ? h('span', { class: 'auto-dot', 'data-tip': 'From the scan. Edit it and it becomes yours.' }) : null),
          h('button', { class: `side side-${r.side}`, disabled: !editable, 'data-tip': 'Click to swap side', onclick: () => change(() => { delete r.auto; r.side = r.side === 'atk' ? 'def' : 'atk'; }) }, r.side === 'atk' ? 'ATK' : 'DEF'),
          h('span', { class: 'bd-events' }, r.events.length ? r.events.map((e, j) => h('button', {
            class: `ev ev-${e.k} ${e.auto ? 'is-auto' : ''}`, 'data-tip': `${{ kill: 'We got a kill', death: 'Teammate died', plant: 'Bomb planted', defuse: 'Bomb defused' }[e.k]}${e.player ? ` · ${e.player}` : ''}${e.t != null ? ' · ' + fmtTime(e.t) : ''}${e.auto ? ' · from the scan' : ''}\nClick to jump · right-click to remove`,
            onclick: () => A.seek(e.t), oncontextmenu: ev => { ev.preventDefault(); if (editable) change(() => { delete r.auto; r.events.splice(j, 1); }); },
          }, evLabel[e.k])) : h('span', { class: 'muted small' }, 'K / D / P / E')),
          h('span', { class: 'bd-state', 'data-tip': `States: ${d.states.join(' → ')}` }, d.states[d.states.length - 1], d.fb ? h('em', { class: d.fb === 'us' ? 'fb-us' : 'fb-them' }, d.fb === 'us' ? ` · FB${d.fbPlayer ? ` ${d.fbPlayer}` : ''}` : ` · FD${d.fdPlayer ? ` ${d.fdPlayer}` : ''}`) : null),
          h('div', { class: 'seg seg-sm' }, ['W', 'L'].map(x => h('button', { class: r.result === x ? `on res-${x}` : '', disabled: !editable, onclick: () => change(() => { delete r.auto; r.result = r.result === x ? null : x; }) }, x))),
          editable ? h('button', { class: 'icon-btn', 'aria-label': 'Delete round', onclick: () => change(() => { rounds.splice(i, 1); rounds.forEach((y, j) => { y.n = j + 1; }); selected = null; }) }, '✕') : null);
      }) : h('div', { class: 'empty-sm' }, editable ? 'Press R when round 1 starts, then K for each kill and D for each teammate death as they happen in the killfeed.' : 'Not tagged yet.'),
      editable ? h('button', { class: 'btn btn-sm', onclick: A.newRound }, '＋ Round') : null);
  }

  function hjList() {
    const evs = row.data.events;
    const add = (k, side) => change(() => { evs.push({ t: now(), k, label: k === 'dunk' ? 'Dunk' : 'Throw', side }); evs.sort((a, b) => (a.t ?? 0) - (b.t ?? 0)); });
    return h('div', { class: 'bd-list' },
      evs.length ? evs.map((e, i) => h('div', { class: 'bd-row' }, timeBtn(e.t),
        h('span', { class: `tag ${e.side ? 'side-' + e.side : ''}` }, e.side === 'us' ? 'Us' : e.side === 'them' ? 'Them' : '—'),
        h('span', {}, e.label || e.k, e.auto ? h('span', { class: 'auto-dot', 'data-tip': 'From the scan' }) : null, e.unsure ? h('span', { class: 'muted small' }, ' · unsure') : null),
        editable ? h('button', { class: 'icon-btn', 'aria-label': 'Delete', onclick: () => change(() => { evs.splice(i, 1); }) }, '✕') : null))
        : h('div', { class: 'empty-sm' }, 'No dunks or throws tagged yet.'),
      editable ? h('div', { class: 'row wrap' },
        h('button', { class: 'btn btn-sm', onclick: () => add('dunk', 'us') }, '＋ Our dunk'), h('button', { class: 'btn btn-sm', onclick: () => add('throw', 'us') }, '＋ Our throw'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => add('dunk', 'them') }, '＋ Their dunk'), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => add('throw', 'them') }, '＋ Their throw')) : null);
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

  vod.onPlayer = () => { if (wrap.isConnected) paint(); };
  paint();
  if (row.updated_at) statusEl.textContent = `Saved · ${new Date(row.updated_at).toLocaleString()}`;
  return wrap;
}

export { confirmDialog };
