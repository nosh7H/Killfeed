// Stream overlays for OBS: team names/logos over the CODCaster HUD + a scrolling bar at the bottom.
// One renderer for both the OBS page (#/overlay/<event>/<station>) and the admin editor preview.
// Everything is laid out on a 1920×1080 stage; positions are % of that frame so they survive any scale.
import { h, clear } from './ui.js';
import { ev, teamName, teamTag, bracketMatches } from './event-state.js';
import { roundName, liveMap, gamesByMatch, seriesResult, playerBoard } from './event-logic.js';

// Default boxes line up with the CODCaster HUD (team name bars top-left/right, logos beside the centre score).
export const ELEMENTS = {
  plateA: { label: 'Left team name', box: { x: 2.3, y: 6.9, w: 31.7, h: 4.6 }, text: true, plate: true },
  plateB: { label: 'Right team name', box: { x: 66, y: 6.9, w: 31.7, h: 4.6 }, text: true, plate: true },
  plogoA: { label: 'Left name-plate logo', box: { x: 2.7, y: 7.15, w: 2.3, h: 4.1 }, logo: true },
  plogoB: { label: 'Right name-plate logo', box: { x: 95.0, y: 7.15, w: 2.3, h: 4.1 }, logo: true },
  logoA: { label: 'Left logo (centre)', box: { x: 38.1, y: 11.7, w: 4.6, h: 7.6 }, logo: true },
  logoB: { label: 'Right logo (centre)', box: { x: 57.3, y: 11.7, w: 4.6, h: 7.6 }, logo: true },
  title: { label: 'Match title', box: { x: 41.9, y: 6.9, w: 16.2, h: 2.7 }, text: true, align: true },
  series: { label: 'Series score (maps won)', box: { x: 37.6, y: 23.4, w: 24.7, h: 5.6 }, text: true },
  bug: { label: 'Event name', box: { x: 1.2, y: 1.3, w: 16, h: 3.4 }, off: true, text: true },
  ticker: { label: 'Bottom bar', box: { x: 0, y: 95.3, w: 100, h: 4.7 }, text: true },
};

export const LEADER_STATS = {
  kd: { label: 'K/D', val: r => r.kd, fmt: v => v.toFixed(2) },
  kills: { label: 'Kills', val: r => r.kills, fmt: v => String(v) },
  kpg: { label: 'Kills per map', val: r => r.kpg, fmt: v => v.toFixed(1) },
  dmgpg: { label: 'Damage per map', val: r => r.dmgpg, fmt: v => String(Math.round(v)) },
};

export const DEFAULT_STYLE = {
  plateBg: 'team',        // 'team' (team color) or a hex color
  plateColor: '#0f1117',
  plateOpacity: 0.92,
  text: '#ffffff',
  textScale: 1,
  upper: true,
  nameStyle: 'name',      // 'name' | 'tag' | 'both'
  seriesStyle: 'score',   // 'score' (1 – 0) or 'pips' (●○○  ●○○)
  seriesLabel: true,      // "Maps" / "Best of 5" under the series score
  tickerBg: '#0b0d12',
  tickerAccent: '',       // '' = event accent
  tickerSpeed: 90,        // px per second
  showResults: true, resultsCount: 6,
  showLive: true,
  showLeaders: true, leaderStat: 'kd', leaderCount: 5, leaderMinMaps: 1,
};

export function newStation(n = 1) {
  return { id: `s${Math.random().toString(36).slice(2, 8)}`, name: `Stream ${n}`, follow: 'auto', match_id: null, swap: false, title: '', layout: {}, style: {} };
}
export function overlaySettings() {
  const o = ev.settings.overlays || {};
  return { stations: (o.stations && o.stations.length ? o.stations : [newStation(1)]) };
}
export const boxOf = (st, k) => { const l = st.layout?.[k] || {}; const b = ELEMENTS[k].box; return { x: l.x ?? b.x, y: l.y ?? b.y, w: l.w ?? b.w, h: l.h ?? b.h }; };
// per-element look: size (text scale), align, indent (px of empty space before the name, for a logo), fit (logos)
export const elOpt = (st, k) => ({ size: 1, align: k === 'plateB' ? 'right' : k === 'plateA' ? 'left' : 'center', indent: k.startsWith('plate') ? 64 : 0, fit: 'contain', ...(st.layout?.[k] || {}) });
export const isOn = (st, k) => {
  const v = st.layout?.[k]?.on;
  if (v != null) return v;
  if ((k === 'plogoA' || k === 'plogoB') && st.style?.plateLogo === false) return false; // older setting
  return !ELEMENTS[k].off;
};
export const styleOf = st => ({ ...DEFAULT_STYLE, ...(st.style || {}) });

/** The match this station shows: a pinned one, or (auto) the casted live match, any live match, then what's on deck. */
export function stationMatch(st) {
  const ms = ev.data.matches;
  if (st.follow === 'match' && st.match_id) return ms.find(m => m.id === st.match_id) || null;
  const byNo = (a, b) => (a.match_no || 999) - (b.match_no || 999);
  const live = ms.filter(m => m.status === 'live').sort(byNo);
  const ondeck = ms.filter(m => m.status === 'ondeck').sort(byNo);
  return live.find(m => m.casted) || live[0] || ondeck.find(m => m.casted) || ondeck[0] || null;
}

const hexA = (hex, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex;
  const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const logoEl = (team, cls) => {
  if (!team) return h('span', { class: `${cls} ov-logo-empty` });
  const url = team.logo_path && ev.logoUrls[team.logo_path];
  return url ? h('img', { class: cls, src: url, alt: '' })
    : h('span', { class: `${cls} ov-logo-tag`, style: { background: team.color || 'var(--accent)' } }, (team.tag || team.name.slice(0, 3)).slice(0, 4).toUpperCase());
};

/** Items for the bottom bar. */
export function tickerItems(st) {
  const s = styleOf(st);
  const items = [];
  const gbm = gamesByMatch(ev.data.games);
  const bm = bracketMatches();
  const short = m => ({ 'Hardpoint': 'HP', 'Search & Destroy': 'SnD', 'Hijack': 'Hijack', 'Control': 'Control' }[m] || m || '');
  if (s.showLive) {
    for (const m of ev.data.matches.filter(x => x.status === 'live').sort((a, b) => (a.match_no || 0) - (b.match_no || 0))) {
      const r = ev.resolved.get(m.id) || {};
      const games = gbm.get(m.id) || [];
      const res = seriesResult(m, games);
      // maps won only (the game shows the map score)
      items.push({ k: `L${m.id}`, kind: 'live', label: 'Live', text: `${teamTag(r.A)} ${res.a}–${res.b} ${teamTag(r.B)}` });
    }
  }
  if (s.showResults) {
    const done = ev.data.matches.filter(m => m.status === 'final')
      .sort((a, b) => String(b.ended_at || '').localeCompare(String(a.ended_at || '')) || (b.match_no || 0) - (a.match_no || 0))
      .slice(0, Math.max(1, s.resultsCount));
    if (done.length) items.push({ k: 'H-res', kind: 'head', label: 'Results' });
    for (const m of done) {
      const r = ev.resolved.get(m.id) || {};
      const res = seriesResult(m, gbm.get(m.id) || []);
      const aWon = res.winner === 'a';
      items.push({ k: `F${m.id}`, kind: 'final', label: roundName(m, bm), text: `${teamTag(r.A)} ${res.a}–${res.b} ${teamTag(r.B)}`, win: res.winner ? teamTag(aWon ? r.A : r.B) : '' });
    }
  }
  if (s.showLeaders) {
    const stat = LEADER_STATS[s.leaderStat] || LEADER_STATS.kd;
    const rows = playerBoard(ev.data, {}, ev.idx).filter(r => r.games >= (s.leaderMinMaps || 1) && stat.val(r) != null && stat.val(r) > 0)
      .sort((a, b) => stat.val(b) - stat.val(a)).slice(0, Math.max(1, s.leaderCount));
    if (rows.length) {
      items.push({ k: `H-lead-${s.leaderStat}`, kind: 'head', label: `Top ${rows.length} · ${stat.label}` });
      rows.forEach((r, i) => items.push({ k: `P${r.key}`, kind: 'leader', label: `${i + 1}`, text: r.name, team: r.team?.tag || '', sub: stat.fmt(stat.val(r)) }));
    }
  }
  if (!items.length) items.push({ k: 'idle', kind: 'head', label: ev.event.name });
  return items;
}

/**
 * Build the overlay stage (1920×1080, transparent). Returns { el, update } — update() refreshes names and scores
 * in place so the bottom bar keeps scrolling smoothly when data changes.
 * opts.select(k) / opts.selected: editor hooks.
 */
export function overlayStage(st, opts = {}) {
  const el = h('div', { class: 'ov-stage' });
  let tickerKey = '', track = null;

  const place = (node, k) => {
    const b = boxOf(st, k);
    Object.assign(node.style, { left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` });
    node.dataset.el = k;
    const o = elOpt(st, k);
    node.style.setProperty('--ov-el-scale', o.size);
    if (opts.selected === k) node.classList.add('ov-sel');
    return node;
  };

  function teamText(t, s) {
    if (!t) return 'TBD';
    return s.nameStyle === 'tag' ? (t.tag || t.name) : s.nameStyle === 'both' && t.tag ? `${t.name} · ${t.tag}` : t.name;
  }

  function build() {
    const s = styleOf(st);
    const m = stationMatch(st);
    const r = m ? ev.resolved.get(m.id) || {} : {};
    let [A, B] = [ev.teamById.get(r.A), ev.teamById.get(r.B)];
    if (st.swap) [A, B] = [B, A];
    el.style.setProperty('--ov-text', s.text);
    el.style.setProperty('--ov-scale', s.textScale);
    el.style.setProperty('--ov-tk-bg', s.tickerBg);
    el.style.setProperty('--ov-tk-accent', s.tickerAccent || 'var(--accent)');
    el.classList.toggle('ov-upper', !!s.upper);
    const parts = [];
    const plate = (k, t, side) => {
      if (!isOn(st, k)) return;
      const o = elOpt(st, k);
      const bg = s.plateBg === 'team' ? hexA(t?.color || s.plateColor, s.plateOpacity) : hexA(s.plateBg, s.plateOpacity);
      const logoOn = isOn(st, side === 'a' ? 'plogoA' : 'plogoB');
      const pad = logoOn ? o.indent : 0;
      parts.push(place(h('div', { class: `ov-el ov-plate ov-plate-${side}`, style: { background: bg, justifyContent: { left: 'flex-start', center: 'center', right: 'flex-end' }[o.align], [side === 'a' ? 'paddingLeft' : 'paddingRight']: `${18 + pad}px` } },
        h('span', { class: 'ov-plate-name', style: { textAlign: o.align } }, m ? teamText(t, s) : ''),
      ), k));
    };
    plate('plateA', A, 'a');
    plate('plateB', B, 'b');
    const logo = (k, t) => { if (isOn(st, k)) parts.push(place(h('div', { class: `ov-el ov-logo ov-fit-${elOpt(st, k).fit}` }, m ? logoEl(t, 'ov-logo-img') : null), k)); };
    logo('plogoA', A); logo('plogoB', B);
    logo('logoA', A); logo('logoB', B);
    if (isOn(st, 'title')) {
      let text = st.title;
      if (!text && m) {
        const games = gamesByMatch(ev.data.games).get(m.id) || [];
        const lm = liveMap(m, games, ev.settings);
        text = `${roundName(m, bracketMatches())} · Map ${lm.game_no}`;
      }
      const o = elOpt(st, 'title');
      parts.push(place(h('div', { class: 'ov-el ov-title', style: { justifyContent: { left: 'flex-start', center: 'center', right: 'flex-end' }[o.align] } }, h('span', {}, text || '')), 'title'));
    }
    if (isOn(st, 'series')) {
      let node = null;
      if (m) {
        const res = seriesResult(m, gamesByMatch(ev.data.games).get(m.id) || []);
        let [a, b] = [res.a, res.b];
        if (st.swap) [a, b] = [b, a];
        const need = Math.floor((m.best_of || 5) / 2) + 1;
        const pips = (n, side) => h('span', { class: `ov-pips ov-pips-${side}` }, Array.from({ length: need }, (_, i) => h('i', { class: i < n ? 'on' : '' })));
        node = h('div', { class: `ov-el ov-series ov-series-${s.seriesStyle}` },
          s.seriesStyle === 'pips'
            ? h('div', { class: 'ov-series-row' }, pips(a, 'a'), h('span', { class: 'ov-series-mid' }, `BO${m.best_of || 5}`), pips(b, 'b'))
            : h('div', { class: 'ov-series-row' }, h('b', {}, a), h('span', { class: 'ov-series-dash' }, '–'), h('b', {}, b)),
          s.seriesLabel && s.seriesStyle !== 'pips' ? h('div', { class: 'ov-series-lab' }, `Maps · Best of ${m.best_of || 5}`) : null);
      } else node = h('div', { class: 'ov-el ov-series' });
      parts.push(place(node, 'series'));
    }
    if (isOn(st, 'bug')) parts.push(place(h('div', { class: 'ov-el ov-bug' }, h('span', { class: 'ov-bug-mark' }), h('span', {}, ev.event.name)), 'bug'));
    if (isOn(st, 'ticker')) parts.push(place(tickerEl(s), 'ticker'));
    clear(el).append(...parts);
  }

  function itemNode(i) {
    return h('span', { class: `ov-tk-item ov-tk-${i.kind}`, 'data-k': i.k },
      h('span', { class: 'ov-tk-label' }, i.kind === 'live' ? h('i') : null, i.label),
      i.text ? h('b', { class: 'ov-tk-text' }, i.text) : null,
      i.team ? h('span', { class: 'ov-tk-team' }, i.team) : null,
      i.sub ? h('span', { class: 'ov-tk-sub' }, i.sub) : null,
      i.win ? h('span', { class: 'ov-tk-win' }, `▲ ${i.win}`) : null);
  }
  function tickerEl(s) {
    const items = tickerItems(st);
    const key = items.map(i => i.k).join('|') + `|${s.tickerSpeed}`;
    const wrap = h('div', { class: 'ov-el ov-ticker' });
    if (track && key === tickerKey) {
      // same items: refresh the text only, the scroll keeps going
      for (const i of items) track.querySelectorAll(`[data-k="${CSS.escape(i.k)}"]`).forEach(n => n.replaceWith(itemNode(i)));
      wrap.append(track);
      return wrap;
    }
    tickerKey = key;
    track = h('div', { class: 'ov-tk-track' }, items.map(itemNode), items.map(itemNode));
    wrap.append(track);
    requestAnimationFrame(() => {
      const half = track.scrollWidth / 2;
      track.style.setProperty('--ov-tk-dist', `-${half}px`);
      track.style.animationDuration = `${Math.max(12, half / Math.max(20, s.tickerSpeed))}s`;
    });
    return wrap;
  }

  build();
  return { el, update: (o = {}) => { Object.assign(opts, o); build(); } };
}
