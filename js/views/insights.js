// Team Insights: pick/ban assistant + "what wins us maps" + player impact.
import { h, clear, fmtPct } from '../ui.js';
import { state, teamPath } from '../state.js';
import { MATCH_TYPES } from '../config.js';
import { mapStrength, vetoAdvice, winFactors, playerImpact } from '../analytics.js';
import { playerKey } from '../stats.js';
import { section, resultBadge } from './dashboard.js';
import { hpAggregate, sndAggregate, breakdownFeatures, hpSummary, sndSummary, modeKind, TEAM_SIZE } from '../breakdown.js';
import { sortTable } from './table.js';
import { fmtDate } from '../ui.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v); kids.flat().forEach(k => k && el.append(k)); return el; };
const LABEL_CLASS = { 'Strong': 'good', 'Leaning strong': 'good-soft', 'Weak': 'bad', 'Leaning weak': 'bad-soft', 'Even': '', 'Low sample': 'muted' };

export async function insightsView() {
  let type = sessionStorage.getItem('kf-ins-type') || '';
  let since = sessionStorage.getItem('kf-ins-since') || '';
  let factorMode = null;
  const notes = await state.store.listNotes(state.team.id).catch(() => []);
  const breakdowns = await state.store.listBreakdowns(state.team.id).catch(() => []);
  const bdByGame = new Map(breakdowns.map(b => [b.game_id, b]));
  const root = h('div', { class: 'page' });

  const paint = () => {
    const games = state.joined.filter(g => (!type || g.match.type === type) && (!since || (g.match.played_on || '') >= since));
    const strength = mapStrength(games);
    const modes = Object.keys(strength).sort((a, b) => (state.team.modes || []).indexOf(a) - (state.team.modes || []).indexOf(b));
    factorMode = factorMode && modes.includes(factorMode) ? factorMode : modes[0] || null;

    clear(root).append(...[
      h('div', { class: 'page-head' },
        h('div', {}, h('div', { class: 'eyebrow' }, 'Team analytics'), h('h1', {}, 'Insights')),
        h('div', { class: 'toolbar' },
          h('div', { class: 'seg' }, [['', 'All'], ...MATCH_TYPES.map(t => [t.id, t.label])].map(([v, l]) => h('button', {
            class: type === v ? 'on' : '', onclick: () => { type = v; sessionStorage.setItem('kf-ins-type', v); paint(); },
          }, l))),
          h('label', { class: 'inline' }, 'Since', h('input', {
            type: 'date', value: since, onchange: e => { since = e.target.value; sessionStorage.setItem('kf-ins-since', since); paint(); },
          })))),
      games.length ? null : h('div', { class: 'empty' }, h('p', {}, 'No maps with results for this filter yet.')),
      games.length ? section('Pick/ban assistant', 'Win rate per map with an 80% range. Small samples are pulled toward 50%.', pickBan(strength, modes, notes)) : null,
      games.length && factorMode ? section('What wins us maps', 'Stats that differ most between maps you won and lost', factorsView(games, modes)) : null,
      games.length ? section('Player impact', 'Win rate when each player goes positive (K/D ≥ 1) vs negative', impactView(games)) : null,
      ...breakdownSections(games),
    ].filter(Boolean));
  };

  // ---------- pick / ban ----------
  function pickBan(strength, modes, notesList) {
    if (!modes.length) return h('div', { class: 'empty-sm' }, 'Log a few maps with scores to see this.');
    const pool = state.team.maps || [];
    return h('div', { class: 'pb-grid' }, modes.map(mode => {
      const rows = strength[mode];
      const adv = vetoAdvice(rows, pool);
      const noteCount = map => notesList.filter(n => n.map === map && (!n.mode || n.mode === mode)).length;
      return h('div', { class: 'pb-card' },
        h('div', { class: 'pb-head' }, h('h3', {}, mode), h('span', { class: 'muted small' }, `${rows.reduce((s, r) => s + r.n, 0)} maps`)),
        h('div', { class: 'pb-advice' },
          adv.pick ? h('div', {}, h('span', { class: 'pb-tag pick' }, 'Pick'), h('strong', {}, adv.pick.map), h('span', { class: 'muted small' }, ` ${adv.pick.w}–${adv.pick.l} · ${adv.pick.label.toLowerCase()}`)) : null,
          adv.ban ? h('div', {}, h('span', { class: 'pb-tag ban' }, 'Ban'), h('strong', {}, adv.ban.map), h('span', { class: 'muted small' }, ` ${adv.ban.w}–${adv.ban.l} · ${adv.ban.label.toLowerCase()}`)) : null,
          adv.unplayed.length ? h('div', { class: 'small muted' }, `No data yet: ${adv.unplayed.join(', ')}`) : null),
        intervalChart(rows),
        h('div', { class: 'pb-rows' }, rows.map(r => h('div', { class: 'pb-row' },
          h('span', { class: 'pb-map' }, r.map),
          h('span', { class: `pb-label ${LABEL_CLASS[r.label] || ''}` }, r.label),
          h('span', { class: 'muted small' }, `${r.w}–${r.l} · ${r.avgDiff > 0 ? '+' : ''}${Math.round(r.avgDiff)} avg`),
          noteCount(r.map) ? h('a', { class: 'small', href: teamPath(`notes?map=${encodeURIComponent(r.map)}`) }, `Notes (${noteCount(r.map)})`) : h('span')))));
    }));
  }

  /** Dot = smoothed win rate, line = 80% range, dashed line = 50%. */
  function intervalChart(rows) {
    const W = 380, rowH = 26, P = { l: 92, r: 12, t: 20, b: 6 };
    const H = P.t + rows.length * rowH + P.b;
    const x = v => P.l + v * (W - P.l - P.r);
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ci-chart', role: 'img', 'aria-label': 'Win rate by map with uncertainty ranges' },
      [0, 0.25, 0.5, 0.75, 1].map(v => [
        svg('line', { x1: x(v), x2: x(v), y1: P.t - 6, y2: H - P.b, class: v === 0.5 ? 'ref' : 'grid' }),
        svg('text', { x: x(v), y: 12, class: 'axis', 'text-anchor': 'middle' }, document.createTextNode(`${v * 100}%`)),
      ]),
      rows.map((r, i) => {
        const y = P.t + i * rowH + rowH / 2;
        const g = svg('g', { 'data-tip': `${r.map}: ${r.w}–${r.l} (${fmtPct(r.rate)})\nLikely between ${fmtPct(r.lo)} and ${fmtPct(r.hi)}\nAvg score diff ${r.avgDiff > 0 ? '+' : ''}${Math.round(r.avgDiff)}` },
          svg('rect', { x: 0, y: y - rowH / 2, width: W, height: rowH, class: 'hit' }),
          svg('text', { x: P.l - 10, y: y + 4, class: 'lbl', 'text-anchor': 'end' }, document.createTextNode(r.map)),
          svg('line', { x1: x(r.lo), x2: x(r.hi), y1: y, y2: y, class: 'ci' }),
          svg('circle', { cx: x(r.post), cy: y, r: 5, class: 'pt' }));
        return g;
      }));
    return h('div', { class: 'chart' }, s);
  }

  // ---------- what wins us maps ----------
  function factorsView(games, modes) {
    const res = winFactors(games, state.statsIdx, factorMode, g => breakdownFeatures(g.mode, bdByGame.get(g.id)?.data));
    const top = res.factors.slice(0, 6);
    const maxE = Math.max(0.5, ...top.map(f => Math.abs(f.effect)));
    return h('div', { class: 'stack-sm' },
      h('div', { class: 'toolbar' },
        h('div', { class: 'seg' }, modes.map(m => h('button', { class: factorMode === m ? 'on' : '', onclick: () => { factorMode = m; paint(); } }, m))),
        h('span', { class: 'muted small' }, `${res.n} maps · ${res.wins} won · ${res.losses} lost`)),
      res.n < 8 ? h('p', { class: 'note-warn' }, 'Early read: fewer than 8 maps in this mode with stats. Treat these as hints, not conclusions.') : null,
      !top.length ? h('div', { class: 'empty-sm' }, 'Needs at least 2 won and 2 lost maps with player stats in this mode.')
        : h('div', { class: 'factors' },
          h('div', { class: 'factor factor-head' }, h('span', {}, 'Stat'), h('span', {}, 'Won maps'), h('span', {}, 'Lost maps'), h('span', {}, 'Difference'), h('span', {}, 'Rule of thumb')),
          top.map(f => {
            const pos = f.effect >= 0;
            const goodDir = (f.better === 'lower') ? !pos : pos;
            return h('div', { class: 'factor' },
              h('span', { class: 'f-label' }, f.label),
              h('span', { class: 'f-val' }, f.fmt(f.winMean)),
              h('span', { class: 'f-val muted' }, f.fmt(f.lossMean)),
              h('span', { class: 'f-bar', 'data-tip': `Effect size ${f.effect.toFixed(2)} (difference in standard deviations).\n${pos ? 'Higher' : 'Lower'} in wins.` },
                h('i', { class: `f-axis` }),
                h('i', { class: `f-fill ${pos ? 'pos' : 'neg'}`, style: { width: `${(Math.abs(f.effect) / maxE) * 50}%`, [pos ? 'left' : 'right']: '50%' } })),
              h('span', { class: 'f-rule small' }, f.threshold
                ? `${f.label} ${f.threshold.dir} ${f.fmt(f.threshold.t)}: won ${f.threshold.goodW} of ${f.threshold.goodN}. Otherwise ${f.threshold.badW} of ${f.threshold.badN}.`
                : (goodDir ? 'Helps, no clear cut-off yet' : '—')));
          })),
      h('p', { class: 'hint' }, 'Bars show how far apart wins and losses are, in standard deviations. Rules of thumb are the single cut-off that best separates your wins from your losses (at least 3 maps on each side). They describe your past results; they don’t prove cause.'));
  }

  // ---------- player impact ----------
  function impactView(games) {
    const rows = playerImpact(games, state.statsIdx, null, s => playerKey(s));
    if (!rows.length) return h('div', { class: 'empty-sm' }, 'Needs players with at least 2 positive and 2 negative maps.');
    return h('div', { class: 'impact' }, rows.map(r => h('div', { class: 'impact-row', 'data-tip': `${r.name}: positive in ${r.pos[1]} maps (won ${r.pos[0]}), negative in ${r.neg[1]} (won ${r.neg[0]})` },
      h('span', { class: 'f-label' }, r.name),
      h('span', { class: 'impact-bar' },
        h('i', { class: 'ib-neg', style: { left: `${r.negRate * 100}%` } }),
        h('i', { class: 'ib-span', style: { left: `${Math.min(r.negRate, r.posRate) * 100}%`, width: `${Math.abs(r.posRate - r.negRate) * 100}%` } }),
        h('i', { class: 'ib-pos', style: { left: `${r.posRate * 100}%` } })),
      h('span', { class: 'small' }, h('b', {}, fmtPct(r.posRate)), h('span', { class: 'muted' }, ` vs ${fmtPct(r.negRate)}`)))),
    h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'lg-pos' }), 'Win rate when positive'), h('span', {}, h('i', { class: 'lg-neg' }), 'when negative')));
  }

  // ---------- VOD breakdowns (tagged hills / rounds) ----------
  function breakdownSections(games) {
    const tagged = games.map(g => ({ game: g, b: bdByGame.get(g.id) })).filter(x => x.b && x.b.data);
    const hp = tagged.filter(x => modeKind(x.game.mode) === 'hp' && (x.b.data.hills || []).some(h => h.first)).map(x => ({ game: x.game, data: x.b.data, source: x.b.source }));
    const snd = tagged.filter(x => modeKind(x.game.mode) === 'snd' && (x.b.data.rounds || []).some(r => r.result)).map(x => ({ game: x.game, data: x.b.data, source: x.b.source }));
    const out = [];
    if (hp.length) out.push(section('Hill by hill', `From ${hp.length} tagged Hardpoint map${hp.length === 1 ? '' : 's'}`, hillView(hp)));
    if (snd.length) out.push(section('S&D rounds', `From ${snd.length} tagged S&D map${snd.length === 1 ? '' : 's'}`, sndView(snd)));
    out.push(section('Breakdown log', 'Every tagged map. Stats update automatically as you tag.', logView(tagged)));
    return out;
  }

  function kpis(list) { return h('div', { class: 'kpis' }, list.map(([l, v, s]) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, l), h('div', { class: 'kpi-value' }, v), s ? h('div', { class: 'kpi-sub' }, s) : null))); }

  function hillView(list) {
    const a = hpAggregate(list);
    const t = a.total;
    return h('div', { class: 'stack-sm' },
      kpis([
        ['Rotations won', fmtPct(t.rotationRate), `${t.rotations} of ${t.hills} hills`],
        ['Hold %', fmtPct(t.holdRate), `${t.held} held, ${t.got_broken} broken`],
        ['Break %', fmtPct(t.breakRate), `${t.broke} of ${t.hills - t.rotations} of theirs`],
      ]),
      sortTable([
        { key: 'n', label: 'Hill', render: r => `Hill ${r.n}` },
        { key: 'hills', label: 'Tagged', num: true },
        { key: 'rotationRate', label: 'Rotation won', num: true, bar: true, fmt: fmtPct },
        { key: 'holdRate', label: 'Held', num: true, fmt: fmtPct, tip: 'Of hills we rotated to first' },
        { key: 'got_broken', label: 'Got broken', num: true },
        { key: 'breakRate', label: 'Broke them', num: true, fmt: fmtPct, tip: 'Of hills they rotated to first' },
      ], a.byHill, { sort: 'n', desc: false }),
      h('p', { class: 'hint' }, 'Hill numbers follow the order you tagged them. Look for hills you keep losing the rotation on: that’s usually a spawn or timing problem, not a gunfight one.'));
  }

  function sndView(list) {
    const s = sndAggregate(list);
    const st = k => s.states[k];
    const cell = (u, t) => {
      const x = st(`${u}v${t}`);
      if (!x) return h('td', { class: 'cell-empty' }, '·');
      const rate = x.w / x.n, alpha = 0.1 + 0.62 * rate;
      return h('td', { class: `cell ${(u === 3 && t === 2) || (u === 2 && t === 3) ? 'hl' : ''}`, style: { background: `rgba(57,135,229,${alpha.toFixed(2)})` },
        'data-tip': `${u}v${t}: won ${x.w} of ${x.n} rounds that reached it` }, h('strong', {}, fmtPct(rate)), h('span', {}, `${x.w}/${x.n}`));
    };
    const n = TEAM_SIZE;
    return h('div', { class: 'stack-sm' },
      kpis([
        ['Round win', fmtPct(s.rounds ? s.won / s.rounds : null), `${s.won}–${s.rounds - s.won}`],
        ['First blood', fmtPct(s.fbRate), `won ${fmtPct(s.fbConv)} after ours · ${fmtPct(s.fbThemSurvive)} after theirs`],
        ['Post-plant', fmtPct(s.postPlantRate), `${s.plants} plants on attack`],
        ['Retake', fmtPct(s.retakeRate), `${s.retakes} enemy plants`],
        ['3v2', st('3v2') ? fmtPct(st('3v2').w / st('3v2').n) : '–', st('3v2') ? `${st('3v2').w} of ${st('3v2').n}` : 'not reached yet'],
        ['2v3', st('2v3') ? fmtPct(st('2v3').w / st('2v3').n) : '–', st('2v3') ? `${st('2v3').w} of ${st('2v3').n}` : 'not reached yet'],
      ]),
      h('div', { class: 'grid-2 gap-lg' },
        h('div', {}, h('div', { class: 'eyebrow' }, 'Win % from each player-count state (us v them)'),
          h('div', { class: 'table-wrap' }, h('table', { class: 'matrix' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Us ↓ · Them →'), Array.from({ length: n }, (_, i) => h('th', {}, n - i)))),
            h('tbody', {}, Array.from({ length: n }, (_, i) => h('tr', {}, h('th', { scope: 'row' }, `${n - i} alive`), Array.from({ length: n }, (_, j) => cell(n - i, n - j)))))))),
        h('div', {}, h('div', { class: 'eyebrow' }, 'By side'),
          sortTable([
            { key: 'side', label: 'Side' }, { key: 'rate', label: 'Round win', num: true, bar: true, fmt: fmtPct },
          ], [{ side: 'Attack', rate: s.atkRate }, { side: 'Defense', rate: s.defRate }], { sort: null }))),
      h('p', { class: 'hint' }, 'A round counts toward every state it passed through. 3v2 and 2v3 are outlined.'));
  }

  function logView(tagged) {
    if (!tagged.length) return h('div', { class: 'empty-sm' }, 'No tagged maps yet. Open any map from Matches and use the Map breakdown panel under the VOD.');
    return sortTable([
      { key: 'date', label: 'Date', get: x => x.game.match.played_on, fmt: v => fmtDate(v) },
      { key: 'res', label: '', render: x => resultBadge(x.game) },
      { key: 'opp', label: 'Opponent', get: x => x.game.match.opponent || '—' },
      { key: 'map', label: 'Map', get: x => `${x.game.map || '?'} · ${x.game.mode || ''}` },
      { key: 'src', label: 'Source', get: x => (x.b.source === 'caster' ? 'CODCaster' : 'Player POV') },
      { key: 'sum', label: 'Summary', render: x => {
        const k = modeKind(x.game.mode);
        if (k === 'hp') { const s = hpSummary(x.b.data); return `Rotations ${s.rotations}/${s.hills} · held ${s.held} · broken ${s.got_broken} · broke ${s.broke}${s.unsure ? ` · ${s.unsure} unsure` : ''}`; }
        if (k === 'snd') { const s = sndSummary(x.b.data); return `Rounds ${s.won}–${s.rounds - s.won} · FB ${fmtPct(s.fbRate)} · post-plant ${s.plants ? `${Math.round(s.postPlantRate * s.plants)}/${s.plants}` : '–'}${s.unsure ? ` · ${s.unsure} unsure` : ''}`; }
        return `${(x.b.data.events || []).length} events`;
      } },
    ], tagged, { sort: 'date', onRow: x => { location.hash = teamPath(`game/${x.game.id}`); } });
  }

  paint();
  return root;
}
