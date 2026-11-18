// Team Home: a customizable dashboard of widgets (stats, charts, schedule, notes).
// Layout is saved for the whole team (owner) or just for you (this browser).
import { h, clear, toast, modal, fmtPct, fmtNum, fmtTime, fmtDate } from '../ui.js';
import { state, teamPath, isOwner, canEdit, refreshTeams } from '../state.js';
import { MATCH_TYPES } from '../config.js';
import {
  WIDGETS, SIZES, METRICS, TEAM_STATS, KPI_ITEMS, DEFAULT_LAYOUT, normalizeLayout, newWidget, moveWidget,
  homeGames, seriesList, teamStat, winRateBy, kdTrend, playerMetric,
} from '../home.js';
import { scheduleCfg, eventColor } from '../schedule.js';
import { hpAggregate, sndAggregate, modeKind } from '../breakdown.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v); kids.flat(Infinity).forEach(k => k != null && el.append(typeof k === 'string' ? document.createTextNode(k) : k)); return el; };

export function fmtVal(v, fmt) {
  if (v == null || (typeof v === 'number' && Number.isNaN(v))) return '–';
  switch (fmt) {
    case 'pct': return fmtPct(v);
    case 'ratio': return Number(v).toFixed(2);
    case 'num0': return fmtNum(v);
    case 'num1': return fmtNum(v, 1);
    case 'time': return fmtTime(v);
    case 'signed': return v > 0 ? `+${v}` : String(v);
    case 'signed1': return `${v > 0 ? '+' : ''}${fmtNum(v, 1)}`;
    default: return String(v);
  }
}

const TYPE_PLURAL = { scrim: 'Scrims', match: 'Matches', tournament: 'Tournaments', pug: 'PUGs / 8s' };
const personalKey = () => `kf-home-${state.team.id}-${state.user?.id || 'me'}`;

export async function homeView() {
  const [sched, notes, breakdowns] = await Promise.all([
    state.store.listSchedule(state.team.id).catch(() => ({ events: [] })),
    state.store.listNotes(state.team.id).catch(() => []),
    state.store.listBreakdowns(state.team.id).catch(() => []),
  ]);
  const bdByGame = new Map(breakdowns.map(b => [b.game_id, b]));
  const personal = (() => { try { return JSON.parse(localStorage.getItem(personalKey()) || 'null'); } catch { return null; } })();
  let source = personal ? 'me' : 'team';
  let layout = normalizeLayout(personal || state.team.home_cfg);
  let editing = false, draft = null, dragId = null;
  let filt = JSON.parse(sessionStorage.getItem('kf-home-filt') || '{"type":"","days":0}');
  const modes = () => [...new Set([...(state.team.modes || []), ...state.joined.map(g => g.mode).filter(Boolean)])];
  const root = h('div', { class: 'page home' });

  const paint = () => {
    const games = homeGames(state.joined, filt);
    const L = editing ? draft : layout;
    clear(root).append(...[
      h('div', { class: 'page-head' },
        h('div', {}, h('div', { class: 'eyebrow' }, 'Home'), h('h1', {}, state.team.name),
          h('p', { class: 'muted small' }, editing ? 'Drag widgets to reorder, change their size, or open ⚙ to pick the stat and mode.'
            : source === 'me' ? 'Your own layout (only you see it).' : 'Team layout.')),
        h('div', { class: 'actions' }, editing ? editBar() : [
          h('button', { class: 'btn btn-ghost', onclick: () => { editing = true; draft = structuredClone(layout); paint(); } }, '⚙ Customize'),
          canEdit() ? h('a', { class: 'btn btn-primary', href: teamPath('match/new') }, '＋ Log match') : null])),
      h('div', { class: 'toolbar' },
        h('div', { class: 'seg' }, [['', 'All types'], ...MATCH_TYPES.map(t => [t.id, TYPE_PLURAL[t.id] || t.label])].map(([id, label]) => h('button', { class: filt.type === id ? 'on' : '', onclick: () => setFilt({ type: id }) }, label))),
        h('div', { class: 'seg' }, [[0, 'All time'], [30, '30 days'], [14, '14 days'], [7, '7 days']].map(([d, label]) => h('button', { class: filt.days === d ? 'on' : '', onclick: () => setFilt({ days: d }) }, label))),
        h('span', { class: 'muted small' }, `${games.length} map${games.length === 1 ? '' : 's'}`)),
      !state.joined.length && !editing ? h('div', { class: 'empty' }, h('h2', {}, 'Nothing logged yet'),
        h('p', {}, 'Your home fills up as you log scrims and matches.'), canEdit() ? h('a', { class: 'btn btn-primary', href: teamPath('match/new') }, '＋ Log your first match') : null) : null,
      h('div', { class: `home-grid ${editing ? 'editing' : ''}` }, L.widgets.map(w => frame(w, games))),
      editing ? h('button', { class: 'home-add', onclick: addDialog }, '＋ Add widget') : null].filter(Boolean));
  };
  const setFilt = patch => { filt = { ...filt, ...patch }; sessionStorage.setItem('kf-home-filt', JSON.stringify(filt)); paint(); };

  // ---------- edit mode ----------
  function editBar() {
    const save = async where => {
      if (where === 'team') {
        try {
          await state.store.updateTeam(state.team.id, { home_cfg: draft });
          state.team.home_cfg = draft; await refreshTeams();
          localStorage.removeItem(personalKey()); source = 'team';
          toast('Saved for the whole team', 'success');
        } catch (e) { return toast(`Could not save: ${e.message}`, 'error'); }
      } else {
        localStorage.setItem(personalKey(), JSON.stringify(draft)); source = 'me';
        toast('Saved for you on this browser', 'success');
      }
      layout = draft; editing = false; paint();
    };
    return [
      h('button', { class: 'btn btn-ghost', onclick: () => { editing = false; paint(); } }, 'Cancel'),
      h('button', { class: 'btn btn-ghost', 'data-tip': 'Back to the starter layout', onclick: () => { draft = normalizeLayout(DEFAULT_LAYOUT); paint(); } }, 'Reset'),
      source === 'me' && state.team.home_cfg?.widgets?.length ? h('button', { class: 'btn btn-ghost', onclick: () => { draft = normalizeLayout(state.team.home_cfg); paint(); } }, 'Use team layout') : null,
      h('button', { class: `btn ${isOwner() ? '' : 'btn-primary'}`, onclick: () => save('me') }, 'Save just for me'),
      isOwner() ? h('button', { class: 'btn btn-primary', onclick: () => save('team') }, 'Save for the team') : null,
    ];
  }

  function addDialog() {
    const body = h('div', { class: 'widget-catalog' }, Object.entries(WIDGETS).map(([type, d]) => h('button', {
      class: 'catalog-item', onclick: () => {
        draft.widgets.push(newWidget(type));
        document.querySelector('.modal-overlay')?.remove();
        paint();
        requestAnimationFrame(() => root.querySelector('.home-grid > :last-child')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      },
    }, h('strong', {}, d.title), h('span', { class: 'muted small' }, d.blurb))));
    modal('Add a widget', body, []);
  }

  // ---------- widget frame ----------
  function frame(w, games) {
    const def = WIDGETS[w.type];
    const title = w.type === 'text' ? (w.cfg.title || def.title)
      : w.type === 'stat' ? TEAM_STATS[w.cfg.stat] || def.title
        : w.type === 'leaders' || w.type === 'player_bars' ? `${def.title} · ${METRICS[w.cfg.metric]?.label || ''}` : def.title;
    const modeTag = w.cfg.mode ? w.cfg.mode : null;
    let body;
    try { body = render(w, games); } catch (e) { console.error(e); body = h('div', { class: 'empty-sm' }, 'Could not draw this widget.'); }
    const el = h('section', {
      class: `card widget w-${w.size} w-type-${w.type}`, 'data-id': w.id,
      draggable: editing ? 'true' : null,
      ondragstart: editing ? e => { dragId = w.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', w.id); el.classList.add('dragging'); } : null,
      ondragend: editing ? () => el.classList.remove('dragging') : null,
      ondragover: editing ? e => { e.preventDefault(); el.classList.add('drop-target'); } : null,
      ondragleave: editing ? () => el.classList.remove('drop-target') : null,
      ondrop: editing ? e => {
        e.preventDefault(); el.classList.remove('drop-target');
        const id = e.dataTransfer.getData('text/plain') || dragId;
        if (!id || id === w.id) return;
        draft = moveWidget(draft, id, draft.widgets.findIndex(x => x.id === w.id));
        paint();
      } : null,
    },
    h('div', { class: 'widget-head' },
      editing ? h('span', { class: 'grip', 'aria-hidden': 'true' }, '⠿') : null,
      h('h2', {}, title),
      modeTag ? h('span', { class: 'tag-sm' }, modeTag) : null,
      h('span', { class: 'spacer' }),
      editing ? editTools(w) : null),
    editing && w.open ? settingsForm(w) : null,
    h('div', { class: 'widget-body' }, body));
    return el;
  }

  function editTools(w) {
    const i = draft.widgets.findIndex(x => x.id === w.id);
    const def = WIDGETS[w.type];
    return h('div', { class: 'widget-tools' },
      def.sizes.length > 1 ? h('div', { class: 'seg seg-sm' }, def.sizes.map(sz => h('button', { class: w.size === sz ? 'on' : '', 'data-tip': SIZES[sz], onclick: () => { w.size = sz; paint(); } }, sz.toUpperCase()))) : null,
      h('button', { class: 'icon-btn', 'aria-label': 'Move earlier', onclick: () => { draft = moveWidget(draft, w.id, i - 1); paint(); } }, '←'),
      h('button', { class: 'icon-btn', 'aria-label': 'Move later', onclick: () => { draft = moveWidget(draft, w.id, i + 1); paint(); } }, '→'),
      hasSettings(w.type) ? h('button', { class: `icon-btn ${w.open ? 'on' : ''}`, 'aria-label': 'Widget settings', onclick: () => { w.open = !w.open; paint(); } }, '⚙') : null,
      h('button', { class: 'icon-btn', 'aria-label': 'Remove widget', onclick: () => { draft.widgets = draft.widgets.filter(x => x.id !== w.id); paint(); } }, '✕'));
  }
  const hasSettings = t => ['kpis', 'stat', 'form', 'kd_trend', 'map_wr', 'leaders', 'player_bars', 'upcoming', 'recent', 'text'].includes(t);

  function settingsForm(w) {
    const c = w.cfg;
    const set = (k, v) => { c[k] = v; paint(); };
    const modeSel = (allLabel = 'All modes') => h('label', {}, 'Mode', h('select', { onchange: e => set('mode', e.target.value) },
      h('option', { value: '' }, allLabel), modes().map(m => h('option', { value: m, selected: c.mode === m }, m))));
    const nIn = (label, max) => h('label', {}, label, h('input', { type: 'number', min: 1, max, value: c.n, class: 'in-num', onchange: e => set('n', Math.max(1, Math.min(max, +e.target.value || 1))) }));
    const metricSel = () => h('label', {}, 'Stat', h('select', {
      onchange: e => { const m = METRICS[e.target.value]; c.metric = e.target.value; if (m.mode) c.mode = m.mode; paint(); },
    }, Object.entries(METRICS).map(([k, m]) => h('option', { value: k, selected: c.metric === k }, m.label))));
    let fields = [];
    if (w.type === 'kpis') fields = [h('div', { class: 'field' }, h('span', {}, 'Show'), h('div', { class: 'row wrap' }, KPI_ITEMS.map(k => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: c.items.includes(k), onchange: e => set('items', e.target.checked ? [...c.items, k] : c.items.filter(x => x !== k)) }), TEAM_STATS[k]))))];
    if (w.type === 'stat') fields = [h('label', {}, 'Stat', h('select', { onchange: e => set('stat', e.target.value) }, Object.entries(TEAM_STATS).map(([k, l]) => h('option', { value: k, selected: c.stat === k }, l)))), modeSel()];
    if (w.type === 'form') fields = [nIn('Series', 20)];
    if (w.type === 'kd_trend') fields = [modeSel(), nIn('Last N series', 60)];
    if (w.type === 'map_wr') fields = [modeSel()];
    if (w.type === 'leaders') fields = [metricSel(), modeSel(), nIn('Players', 10)];
    if (w.type === 'player_bars') fields = [metricSel(), modeSel()];
    if (w.type === 'upcoming' || w.type === 'recent') fields = [nIn('How many', 12)];
    if (w.type === 'text') fields = [
      h('label', {}, 'Title', h('input', { value: c.title, maxlength: 40, onchange: e => set('title', e.target.value) })),
      h('label', { class: 'grow' }, 'Text', h('textarea', { rows: 3, maxlength: 600, onchange: e => set('text', e.target.value) }, c.text))];
    return h('div', { class: 'widget-settings' }, fields);
  }

  // ---------- widget bodies ----------
  function render(w, games) {
    const c = w.cfg;
    const gm = c.mode ? games.filter(g => g.mode === c.mode) : games;
    switch (w.type) {
      case 'kpis': return h('div', { class: 'kpis' }, c.items.map(k => { const s = teamStat(k, games, state.statsIdx); return kpi(TEAM_STATS[k], fmtVal(s.value, s.fmt), s.sub); }));
      case 'stat': {
        const s = teamStat(c.stat, gm, state.statsIdx);
        return h('div', { class: 'big-stat' }, h('div', { class: 'big-val' }, fmtVal(s.value, s.fmt)), h('div', { class: 'muted small' }, [c.mode || 'All modes', s.sub].filter(Boolean).join(' · ')));
      }
      case 'form': return formStrip(seriesList(games).slice(-c.n));
      case 'kd_trend': return lineChart(kdTrend(gm, state.statsIdx, c.n));
      case 'mode_wr': return barList(winRateBy(games, 'mode').map(x => ({ label: x.label, value: x.rate, text: fmtPct(x.rate), sub: `${x.w}–${x.l}`, tip: `${x.label}: ${x.w}–${x.l}${x.t ? `–${x.t}` : ''} (${fmtPct(x.rate)})` })), { max: 1, ref: 0.5 });
      case 'map_wr': {
        const rows = winRateBy(gm, 'map').slice(0, 8);
        return barList(rows.map(x => ({ label: x.label, value: x.rate, text: fmtPct(x.rate), sub: `${x.w}–${x.l}`, tip: `${x.label}${c.mode ? ` · ${c.mode}` : ''}: ${x.w}–${x.l} in ${x.n} maps` })), { max: 1, ref: 0.5, empty: c.mode ? `No ${c.mode} maps yet.` : 'No maps yet.' });
      }
      case 'leaders': {
        const m = METRICS[c.metric];
        const rows = playerMetric(games, state.statsIdx, state.data.players, c.metric, c.mode).slice(0, c.n);
        if (!rows.length) return h('div', { class: 'empty-sm' }, 'No stats yet.');
        return h('ol', { class: 'leader-list' }, rows.map((r, i) => h('li', { class: i === 0 ? 'top' : '' },
          h('span', { class: 'lr-rank' }, i + 1),
          h('a', { href: teamPath(`player/${encodeURIComponent(r.key)}`) }, r.name),
          h('span', { class: 'muted small' }, `${r.games} maps`),
          h('b', { class: i === 0 ? 'is-lead' : '' }, fmtVal(r.value, m.fmt)))));
      }
      case 'player_bars': {
        const m = METRICS[c.metric];
        const rows = playerMetric(games, state.statsIdx, state.data.players, c.metric, c.mode);
        const max = Math.max(...rows.map(r => r.value), m.fmt === 'ratio' ? 1.5 : 0);
        return barList(rows.map(r => ({ label: r.name, value: Math.max(0, r.value), text: fmtVal(r.value, m.fmt), sub: `${r.games} maps`, tip: `${r.name}: ${fmtVal(r.value, m.fmt)} ${m.label} in ${r.games} maps` })),
          { max, ref: m.fmt === 'ratio' ? 1 : null, empty: 'No stats yet.' });
      }
      case 'upcoming': {
        const cfg = scheduleCfg(state.team);
        const nowIso = new Date().toISOString();
        const list = (sched.events || []).filter(e => (e.ends_at || e.starts_at) >= nowIso && e.status !== 'cancelled' && e.status !== 'done').sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, c.n);
        if (!list.length) return h('div', { class: 'empty-sm' }, 'Nothing scheduled. ', h('a', { href: teamPath('schedule') }, 'Open the schedule'));
        return h('ul', { class: 'up-list' }, list.map(e => {
          const d = new Date(e.starts_at);
          return h('li', { style: { '--ec': eventColor(e, cfg) } },
            h('span', { class: 'up-when' }, d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }), h('b', {}, d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))),
            h('a', { href: teamPath('schedule') }, e.title || (e.opponent ? `vs ${e.opponent}` : 'Event')));
        }));
      }
      case 'recent': {
        const list = seriesList(games).slice(-c.n).reverse();
        if (!list.length) return h('div', { class: 'empty-sm' }, 'No matches yet.');
        return h('ul', { class: 'recent-list' }, list.map(s => h('li', {},
          h('span', { class: `badge badge-${s.result || ''}` }, s.result || '—'),
          h('a', { href: teamPath(`match/${s.match.id}`) }, s.match.opponent || 'Unknown'),
          h('span', { class: 'muted small' }, `${fmtDate(s.match.played_on)} · ${MATCH_TYPES.find(t => t.id === s.match.type)?.label || ''}`),
          h('b', {}, `${s.w}–${s.l}`))));
      }
      case 'notes': {
        const pinned = notes.filter(n => n.pinned).slice(0, 4);
        if (!pinned.length) return h('div', { class: 'empty-sm' }, 'Pin a note on the ', h('a', { href: teamPath('notes') }, 'Notes'), ' page to show it here.');
        return h('ul', { class: 'note-list' }, pinned.map(n => h('li', {}, h('a', { href: teamPath('notes') }, h('strong', {}, n.title || 'Untitled')),
          h('p', { class: 'small muted' }, (n.body || '').slice(0, 140) + ((n.body || '').length > 140 ? '…' : '')))));
      }
      case 'snd_rounds': {
        const list = games.filter(g => modeKind(g.mode) === 'snd').map(g => ({ game: g, b: bdByGame.get(g.id) })).filter(x => x.b?.data?.rounds?.some(r => r.result)).map(x => ({ game: x.game, data: x.b.data }));
        if (!list.length) return h('div', { class: 'empty-sm' }, 'Tag an S&D VOD (Map breakdown on any map) to fill this in.');
        const s = sndAggregate(list);
        const st = k => s.states[k];
        const rate = x => (x?.n ? `${fmtPct(x.w / x.n)}` : '–');
        return h('div', { class: 'mini-kpis' },
          mini('First blood %', fmtPct(s.fbRate), `${s.rounds} rounds`),
          mini('FB → round win', fmtPct(s.fbConv)),
          mini('Post-plant win', fmtPct(s.postPlantRate), `${s.plants} plants`),
          mini('3v2 win', rate(st('3v2')), st('3v2') ? `${st('3v2').w}/${st('3v2').n}` : ''),
          mini('2v3 win', rate(st('2v3')), st('2v3') ? `${st('2v3').w}/${st('2v3').n}` : ''),
          mini('Attack / defense', `${fmtPct(s.atkRate)} / ${fmtPct(s.defRate)}`));
      }
      case 'hp_hills': {
        const list = games.filter(g => modeKind(g.mode) === 'hp').map(g => ({ game: g, b: bdByGame.get(g.id) })).filter(x => x.b?.data?.hills?.some(hh => hh.first)).map(x => ({ game: x.game, data: x.b.data }));
        if (!list.length) return h('div', { class: 'empty-sm' }, 'Tag a Hardpoint VOD to fill this in.');
        const t = hpAggregate(list).total;
        return h('div', { class: 'mini-kpis' },
          mini('Rotations won', fmtPct(t.rotationRate), `${t.rotations}/${t.hills}`),
          mini('Hold %', fmtPct(t.holdRate)), mini('Break %', fmtPct(t.breakRate)));
      }
      case 'text': return c.text ? h('p', { class: 'home-text' }, c.text) : h('div', { class: 'empty-sm' }, editing ? 'Open ⚙ to write the message.' : 'No message yet.');
      default: return h('div');
    }
  }

  paint();
  return root;
}

function kpi(label, value, sub) {
  return h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null);
}
function mini(label, value, sub) {
  return h('div', { class: 'mini' }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'mini-val' }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null);
}

/** W/L chips for each series, oldest → newest. */
function formStrip(list) {
  if (!list.length) return h('div', { class: 'empty-sm' }, 'No series yet.');
  const w = list.filter(s => s.result === 'W').length, l = list.filter(s => s.result === 'L').length;
  return h('div', { class: 'stack-sm' },
    h('div', { class: 'form-strip' }, list.map(s => h('span', {
      class: `form-chip r-${s.result || 'N'}`,
      'data-tip': `${fmtDate(s.match.played_on)} vs ${s.match.opponent || '?'}\n${s.w}–${s.l} · ${s.result === 'W' ? 'Won' : s.result === 'L' ? 'Lost' : 'Even'}`,
    }, s.result || '–'))),
    h('div', { class: 'muted small' }, `${w}–${l} in the last ${list.length} series`));
}

/** Horizontal bars: one hue, thin, rounded data end, value label at the end. */
function barList(rows, { max = null, ref = null, empty = 'No data yet.' } = {}) {
  if (!rows.length) return h('div', { class: 'empty-sm' }, empty);
  const top = max ?? Math.max(...rows.map(r => r.value), 0) ?? 1;
  return h('div', { class: 'bars' },
    rows.map(r => h('div', { class: 'bar-row', 'data-tip': r.tip || null },
      h('span', { class: 'bar-label' }, r.label),
      h('span', { class: 'bar-track' },
        h('i', { class: 'bar-fill', style: { width: `${Math.max(0, Math.min(1, r.value / (top || 1))) * 100}%` } }),
        ref != null ? h('i', { class: 'bar-ref', style: { left: `${(ref / (top || 1)) * 100}%` } }) : null),
      h('span', { class: 'bar-val' }, r.text, r.sub ? h('small', {}, r.sub) : null))));
}

/** Single-series line: team K/D per series, 1.0 reference, hover per point. */
function lineChart(points) {
  if (points.length < 2) return h('div', { class: 'empty-sm' }, 'Needs at least two series.');
  const W = 640, H = 200, P = { l: 34, r: 10, t: 10, b: 22 };
  const hi = Math.max(1.5, Math.ceil(Math.max(...points.map(p => p.kd)) * 4) / 4);
  const lo = Math.min(0.5, Math.floor(Math.min(...points.map(p => p.kd)) * 4) / 4);
  const x = i => P.l + (i / (points.length - 1)) * (W - P.l - P.r);
  const y = v => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += (hi - lo) > 1.5 ? 0.5 : 0.25) ticks.push(+v.toFixed(2));
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'trend', role: 'img', 'aria-label': `Team K/D over the last ${points.length} series` },
    ticks.map(v => [svg('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid' }), svg('text', { x: P.l - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, v.toFixed(2))]),
    svg('line', { x1: P.l, x2: W - P.r, y1: y(1), y2: y(1), class: 'ref' }),
    svg('path', { d: points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.kd).toFixed(1)}`).join(''), class: 'line' }),
    points.map((p, i) => svg('g', { 'data-tip': `${fmtDate(p.match.played_on)} vs ${p.match.opponent || '?'}\nTeam K/D ${p.kd.toFixed(2)} (${p.kills}–${p.deaths}) · maps ${p.w}–${p.l}` },
      svg('rect', { x: x(i) - (W / points.length) / 2, y: 0, width: W / points.length, height: H, class: 'hit' }),
      svg('circle', { cx: x(i), cy: y(p.kd), r: 4, class: `dot ${p.result === 'L' ? 'dot-l' : ''}` }))),
    svg('text', { x: P.l, y: H - 4, class: 'axis' }, fmtDate(points[0].match.played_on)),
    svg('text', { x: W - P.r, y: H - 4, class: 'axis', 'text-anchor': 'end' }, fmtDate(points[points.length - 1].match.played_on)));
  return h('div', { class: 'chart' }, s,
    h('div', { class: 'chart-key small muted' }, h('span', { class: 'key-dot' }), 'Series won', h('span', { class: 'key-dot hollow' }), 'Series lost', h('span', { class: 'key-dash' }), 'K/D 1.00'));
}
