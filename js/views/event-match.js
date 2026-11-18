// One event match: public scoreboard view + admin result entry (both teams, screenshots, OCR).
import { h, clear, toast, modal, uid, fmtTime, parseTime, compressImage, confirmDialog } from '../ui.js';
import { state } from '../state.js';
import { ev, eventPath, refreshEvent, teamName, watchEvent, teamBadge, spotOf, matchNo, estText } from '../event-state.js';
import { roundName, gamesByMatch, gameWinner, seriesResult } from '../event-logic.js';
import { EVENT_STAT_FIELDS, eventFields, MAX_SCREENSHOT_PX, SCREENSHOT_QUALITY } from '../config.js';
import { parseScoreboard, applyMapping, pickMapScore } from '../ocr-parse.js';
import { eventShell } from './event.js';
import { statusPill } from './event-parts.js';
import { vetoAdminPanel } from './veto.js';
import { sortTable } from './table.js';
import { groupLog, logCard, revertAction } from './event-log.js';

const STAT_KEYS = EVENT_STAT_FIELDS.map(f => f.key);
const ADV_KEYS = EVENT_STAT_FIELDS.filter(f => f.advanced).map(f => f.key);

export function eventMatch(matchId) {
  const m0 = ev.data.matches.find(m => m.id === matchId);
  if (!m0) return eventShell('', h('div', { class: 'empty' }, 'Match not found.'));
  const root = h('div');
  let editing = false;
  let vetoEl = null; // kept between live repaints so a half-typed in-person veto isn't lost
  // from the Control panel: captain photos + scores to finish here
  const handoff = ev.handoff?.matchId === matchId ? ev.handoff : null;
  if (handoff && ev.isAdmin) { editing = true; ev.handoff = null; }

  const paint = () => {
    const m = ev.data.matches.find(x => x.id === matchId);
    if (!m) return;
    const r = ev.resolved.get(m.id) || {};
    const bm = ev.data.matches.filter(x => x.stage !== 'group');
    const games = (gamesByMatch(ev.data.games).get(m.id) || []);
    const res = r.result || seriesResult(m, games);
    const head = h('div', { class: 'match-hero' },
      h('div', { class: 'eyebrow' }, m.match_no ? `${matchNo(m)} · ` : '', roundName(m, bm), ` · Best of ${m.best_of}`, spotOf(m) ? ` · ${spotOf(m).full}` : '', m.casted || ev.settings.caster === 'all' ? ' · Casted' : '', m.status !== 'live' && m.status !== 'final' && estText(m, { staff: ev.isAdmin }) ? ` · Est. start ${estText(m, { staff: ev.isAdmin })}` : ''),
      h('div', { class: 'mh-row' },
        h('div', { class: `mh-team ${r.winner && r.winner === r.A ? 'win' : ''}` }, teamBadge(r.A, 'lg'), teamName(r.A) || 'TBD'),
        h('div', { class: 'mh-score' },
          h('b', { class: res.winner === 'a' ? 'win' : res.winner === 'b' ? 'lose' : res.a > res.b ? 'win' : res.b > res.a ? 'lose' : '' }, res.a),
          h('span', {}, '–'),
          h('b', { class: res.winner === 'b' ? 'win' : res.winner === 'a' ? 'lose' : res.b > res.a ? 'win' : res.a > res.b ? 'lose' : '' }, res.b)),
        h('div', { class: `mh-team right ${r.winner && r.winner === r.B ? 'win' : ''}` }, teamName(r.B) || 'TBD', teamBadge(r.B, 'lg'))),
      h('div', { class: 'mh-status' }, statusPill(m.status),
        ev.isAdmin && !editing ? h('button', { class: 'btn btn-primary btn-sm', onclick: () => { editing = true; paint(); } }, games.length ? 'Edit results' : 'Enter results') : null));

    const ready = r.A && r.B && r.A !== 'BYE' && r.B !== 'BYE';
    const body = editing && ready
      ? editor(m, r, games)
      : h('div', { class: 'stack' }, games.length ? games.map(g => gameCard(g, r)) : h('div', { class: 'empty-sm' }, ready ? 'No maps played yet.' : 'Teams are decided by earlier results.'));
    const hasVeto = ev.data.vetoes.some(x => x.match_id === m.id);
    let vetoPanel = null;
    if (ready && !editing && (ev.isAdmin || hasVeto)) {
      if (!vetoEl) vetoEl = vetoAdminPanel(m, r); else vetoEl.refresh();
      vetoPanel = vetoEl;
    }
    if (ev.isAdmin && !editing) {
      if (!historyEl) { historyEl = h('details', { class: 'block match-history' }); loadHistory(); }
      else loadHistory();
    }
    clear(root).append(eventShell('', h('div', { class: 'stack' }, head, vetoPanel, body, ev.isAdmin && !editing ? historyEl : null)));
  };

  // ---------- staff only: everything that happened to this match ----------
  let historyEl = null, historyOpen = false;
  async function loadHistory() {
    let rows = [];
    try { rows = (await state.store.evLog(ev.event.id, 1000)).filter(x => x.match_id === matchId); } catch { /* log not set up yet */ }
    const groups = groupLog(rows);
    clear(historyEl).append(
      h('summary', {}, h('strong', {}, 'History'), h('span', { class: 'muted small' }, ` · ${groups.length} action${groups.length === 1 ? '' : 's'} on this match`)),
      h('div', { class: 'log-list', style: { marginTop: '.7rem' } }, groups.length
        ? groups.map(g => logCard(g, { compact: true, onRevert: x => revertAction(x, () => { paint(); }) }))
        : h('div', { class: 'empty-sm' }, 'Nothing logged for this match yet.')));
    historyEl.open = historyOpen;
    historyEl.ontoggle = () => { historyOpen = historyEl.open; };
  }

  // ---------- read-only game card ----------
  function gameCard(g, r) {
    const lines = ev.idx.statsByGame.get(g.id) || [];
    // caster-only columns appear only when someone entered them (casted maps)
    const fields = eventFields(g.mode, true).filter(f => !f.advanced || lines.some(s => s[f.key] != null));
    const w = gameWinner(g);
    const kdOf = s => (s.deaths ? s.kills / s.deaths : s.kills);
    const leadMax = { kd: Math.max(0, ...lines.map(kdOf)), ...Object.fromEntries(fields.map(f => [f.key, Math.max(0, ...lines.map(s => Number(s[f.key]) || 0))])) };
    const table = teamId => sortTable([
      { key: 'player_name', label: teamName(teamId) || '' },
      ...fields.map(f => ({ key: f.key, label: f.label, tip: f.long, num: true, lead: f.key !== 'deaths', fmt: v => (f.time ? fmtTime(v) : v ?? '–') })),
      { key: 'kd', label: 'K/D', num: true, lead: true, get: kdOf, fmt: v => Number(v).toFixed(2) },
    ], lines.filter(s => s.team_id === teamId), { sort: 'kills', empty: 'No stats', leadMax });
    return h('section', { class: 'block' },
      h('div', { class: 'block-head' }, h('h2', {}, `Map ${g.game_no} · ${g.map || '?'}`), h('span', { class: 'muted' }, g.mode || ''),
        h('span', { class: 'game-score' }, h('b', { class: w === 'a' ? 'win' : '' }, g.a_score ?? '–'), '–', h('b', { class: w === 'b' ? 'win' : '' }, g.b_score ?? '–'))),
      h('div', { class: 'grid-2 gap-lg' }, table(r.A), table(r.B)));
  }

  // ---------- admin editor ----------
  function editor(m, r, existing) {
    const s = ev.settings;
    const roster = ev.data.players.filter(p => p.team_id === r.A || p.team_id === r.B);
    const blank = teamId => (roster.filter(p => p.team_id === teamId).length ? roster.filter(p => p.team_id === teamId) : [{}, {}, {}, {}])
      .map(p => ({ team_id: teamId, player_name: p.gamertag || '' }));
    const mk = (i, mode) => ({ id: uid(), game_no: i + 1, map: '', mode, a_score: null, b_score: null, stats: [...blank(r.A), ...blank(r.B)], pending: [], media: [], removed: [] });
    let games = existing.length
      ? existing.map(g => ({ ...g, stats: (ev.idx.statsByGame.get(g.id) || []).map(x => ({ ...x })), pending: [], media: [], removed: [] }))
      : Array.from({ length: m.best_of }, (_, i) => mk(i, s.mode_order[i % s.mode_order.length] || s.modes[0]));
    Promise.all(games.map(async g => { if (existing.length) g.media = await state.store.evListMedia(g.id); })).then(() => { if (existing.length) render(); });
    if (handoff) {
      const slot = no => {
        while (games.length < no) games.push(mk(games.length, s.mode_order[games.length % s.mode_order.length] || s.modes[0]));
        return games[no - 1];
      };
      for (const x of handoff.shots) {
        const file = new File([x.blob], `map${x.game_no}-captain.jpg`, { type: 'image/jpeg' });
        slot(x.game_no).pending.push({ file, url: URL.createObjectURL(file) });
      }
      for (const x of handoff.scores) { const g = slot(x.game_no); if (g.a_score == null && g.b_score == null) { g.a_score = x.a; g.b_score = x.b; } }
      setTimeout(() => toast(`${handoff.shots.length} captain photo${handoff.shots.length === 1 ? '' : 's'} added — click Read on each to fill player stats, then Save`, 'success'), 300);
    }

    const wrap = h('div', { class: 'stack' });
    // advanced (caster POV) stats: always, never, or ticked per match
    let casted = s.caster === 'all' || (s.caster !== 'none' && !!m.casted);
    const castBox = () => s.caster !== 'some' ? null : h('label', { class: `check cast-toggle ${casted ? 'on' : ''}` },
      h('input', { type: 'checkbox', checked: casted, onchange: e => { casted = e.target.checked; render(); } }),
      h('span', {}, h('strong', {}, 'Casted match'), ' — enter caster stats too (damage, assists, non-traded kills, streak, hill stats, first bloods). Leave off for player POV.'));
    const mapLists = s.modes.map(mode => h('datalist', { id: `dl-${mode.replace(/\W/g, '')}` }, (s.maps[mode] || []).map(x => h('option', { value: x }))));
    const rosterList = h('datalist', { id: 'dl-ev-roster' }, roster.map(p => h('option', { value: p.gamertag })));

    function render() {
      clear(wrap).append(...[castBox(), ...mapLists, rosterList,
        ...games.map((g, i) => gameEditor(g, i)),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { games.push(mk(games.length, s.mode_order[games.length % s.mode_order.length])); render(); } }, '＋ Add map'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn-ghost', onclick: () => { editing = false; paint(); } }, 'Cancel'),
          h('button', { class: 'btn btn-primary', onclick: save }, 'Save results'))].filter(Boolean));
    }

    function gameEditor(g, i) {
      const fields = eventFields(g.mode, casted);
      const num = key => e => { g[key] = e.target.value === '' ? null : Number(e.target.value); };
      const drop = h('label', { class: 'dropzone sm', ondragover: e => e.preventDefault(), ondrop: e => { e.preventDefault(); addFiles(g, e.dataTransfer.files); render(); } },
        h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: e => { addFiles(g, e.target.files); render(); } }),
        h('strong', {}, '＋ Screenshot'), h('span', { class: 'hint' }, 'Drop, browse or paste'));
      // phones: open the camera straight away
      const cam = h('label', { class: 'dropzone sm cam' },
        h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: e => { addFiles(g, e.target.files); render(); } }),
        h('strong', {}, '📷 Add photo'), h('span', { class: 'hint' }, 'Take a picture of the screen'));
      const statTable = teamId => h('div', { class: 'table-wrap' }, h('table', { class: 'data edit-table' },
        h('thead', {}, h('tr', {}, h('th', {}, teamName(teamId)), fields.map(f => h('th', { class: 'num', 'data-tip': f.long }, f.label)), h('th', {}))),
        h('tbody', {}, g.stats.filter(x => x.team_id === teamId).map(st => h('tr', {},
          h('td', {}, h('input', { class: 'in-name', list: 'dl-ev-roster', value: st.player_name || '', oninput: e => { st.player_name = e.target.value; } })),
          fields.map(f => h('td', { class: 'num' }, h('input', {
            class: 'in-num', inputmode: f.time ? 'text' : 'numeric', placeholder: f.time ? 'm:ss' : '',
            value: st[f.key] == null ? '' : (f.time ? fmtTime(st[f.key]) : st[f.key]),
            onchange: e => { st[f.key] = f.time ? parseTime(e.target.value) : (e.target.value === '' ? null : Number(e.target.value)); },
          }))),
          h('td', {}, h('button', { class: 'icon-btn', 'aria-label': 'Remove row', onclick: () => { g.stats.splice(g.stats.indexOf(st), 1); render(); } }, '✕')))))),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { g.stats.push({ team_id: teamId, player_name: '' }); render(); } }, '＋ Row'));

      return h('section', { class: 'block game-edit', onclick: () => { activeGame = g; } },
        h('div', { class: 'block-head' }, h('h2', {}, `Map ${i + 1}`),
          h('span', { class: 'spacer' }),
          games.length > 1 ? h('button', { class: 'icon-btn', 'aria-label': 'Remove map', onclick: () => { games.splice(i, 1); render(); } }, '✕') : null),
        h('div', { class: 'grid-5' },
          h('label', {}, 'Mode', h('select', { onchange: e => { g.mode = e.target.value; render(); } }, s.modes.map(x => h('option', { value: x, selected: g.mode === x }, x)))),
          h('label', {}, 'Map', h('input', { list: `dl-${(g.mode || '').replace(/\W/g, '')}`, value: g.map || '', oninput: e => { g.map = e.target.value; } })),
          h('label', {}, `${teamName(r.A)} score`, h('input', { type: 'number', min: 0, value: g.a_score ?? '', oninput: num('a_score') })),
          h('label', {}, `${teamName(r.B)} score`, h('input', { type: 'number', min: 0, value: g.b_score ?? '', oninput: num('b_score') })),
          h('label', { 'data-tip': 'Used when the final score isn’t known. A score, if entered, decides the winner.' }, 'Won by', h('select', { onchange: e => { g.winner = e.target.value || null; } },
            h('option', { value: '' }, '—'), h('option', { value: 'a', selected: g.winner === 'a' }, teamName(r.A)), h('option', { value: 'b', selected: g.winner === 'b' }, teamName(r.B))))),
        h('div', { class: 'shots' },
          g.media.filter(x => !g.removed.includes(x.id)).map(x => thumb(g, { media: x })),
          g.pending.map(p => thumb(g, { pending: p })), drop, cam),
        h('div', { class: 'grid-2 gap-lg' }, statTable(r.A), statTable(r.B)));
    }

    let activeGame = games[0];
    const onPaste = e => {
      if (!wrap.isConnected) return document.removeEventListener('paste', onPaste);
      const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
      if (files.length && activeGame) { addFiles(activeGame, files); render(); toast('Screenshot pasted'); }
    };
    document.addEventListener('paste', onPaste);

    function addFiles(g, files) { for (const f of files) if (f.type.startsWith('image/')) g.pending.push({ file: f, url: URL.createObjectURL(f) }); }

    function thumb(g, { media, pending }) {
      const img = h('img', { alt: 'Scoreboard screenshot' });
      if (pending) img.src = pending.url; else state.store.mediaUrl(media).then(u => { img.src = u; });
      return h('div', { class: 'thumb' }, img, h('div', { class: 'thumb-actions' },
        h('button', { class: 'btn btn-sm btn-primary', onclick: async () => ocr(g, pending ? pending.file : await (await fetch(img.src)).blob(), img.src) }, 'Read'),
        h('button', { class: 'icon-btn', 'aria-label': 'Remove', onclick: () => { if (pending) g.pending = g.pending.filter(p => p !== pending); else g.removed.push(media.id); render(); } }, '✕')));
    }

    async function ocr(g, blob, previewUrl) {
      const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-fill' }));
      const label = h('p', { class: 'muted' }, 'Loading OCR engine…');
      const body = h('div', {}, label, bar);
      modal('Read score and stats from screenshot', body, []);
      let text, scorePasses;
      try {
        const { readScoreboard } = await import('../ocr.js');
        ({ text, scorePasses } = await readScoreboard(blob, (p, msg) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; label.textContent = msg; }));
      } catch (e) { clear(body).append(h('p', {}, e.message)); return; }
      let rows = parseScoreboard(text, roster);
      const found = pickMapScore(scorePasses, g.mode);
      // the left / top score belongs to the team whose players are listed first
      const firstTeam = rows.find(x => x.player?.team_id)?.player.team_id;
      const sc = found ? { use: true, a: firstTeam === r.B ? found.right : found.left, b: firstTeam === r.B ? found.left : found.right } : null;
      if (!rows.length && !found) { clear(body).append(h('p', {}, 'Nothing recognised. Enter the numbers manually or try a sharper screenshot.'), h('pre', {}, text)); return; }
      const fields = eventFields(g.mode, casted);
      const width = Math.max(0, ...rows.map(x => x.numbers.length));
      const key = `kf-ocr-map-${g.mode || 'any'}-${casted ? 'caster' : 'pov'}`; // caster and player POV boards have different columns
      let mapping = JSON.parse(localStorage.getItem(key) || 'null') || ['kills', 'deaths'];
      mapping = Array.from({ length: width }, (_, i) => mapping[i] || '');
      rows = rows.map(x => ({ ...x, include: !!x.player?.id }));
      const scoreBox = h('div', { class: 'ocr-score' });
      const drawScore = () => clear(scoreBox).append(...(sc ? [
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: sc.use, onchange: e => { sc.use = e.target.checked; } }), h('strong', {}, 'Map score')),
        h('span', { class: 'ocr-score-line' }, teamName(r.A), h('input', { type: 'number', min: 0, class: 'in-score', value: sc.a, oninput: e => { sc.a = +e.target.value; } }), '–',
          h('input', { type: 'number', min: 0, class: 'in-score', value: sc.b, oninput: e => { sc.b = +e.target.value; } }), teamName(r.B)),
        h('button', { class: 'btn btn-sm btn-ghost', 'data-tip': 'The scores belong the other way round', onclick: () => { [sc.a, sc.b] = [sc.b, sc.a]; drawScore(); } }, '⇄ Swap'),
        found.adjusted ? h('span', { class: 'small warn-text' }, 'Read as a 2x0 number and set to 250 (Hardpoint ends at 250). Check the image.')
          : !found.sure ? h('span', { class: 'small muted' }, 'Check this against the image.') : null,
      ] : [h('span', { class: 'small muted' }, 'Couldn’t read the map score. Type it in on the map.')]));
      drawScore();
      clear(body).append(h('div', { class: 'ocr-layout' },
        h('img', { class: 'ocr-preview', src: previewUrl, alt: '' }),
        h('div', {},
          scoreBox,
          rows.length ? h('p', { class: 'small' }, 'Tick the rows to use and set what each number column is. Matched players go to their own team automatically.')
            : h('p', { class: 'small muted' }, 'No player rows recognised in this image — only the score.'),
          rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data ocr-table' },
            h('thead', {}, h('tr', {}, h('th', {}), h('th', {}, 'Player'), mapping.map((k, ci) => h('th', {}, h('select', { onchange: e => { mapping[ci] = e.target.value; } },
              h('option', { value: '' }, 'ignore'), fields.map(f => h('option', { value: f.key, selected: k === f.key }, f.long))))))),
            h('tbody', {}, rows.map(x => h('tr', {},
              h('td', {}, h('input', { type: 'checkbox', checked: x.include, onchange: e => { x.include = e.target.checked; } })),
              h('td', {}, x.player.gamertag, x.player.team_id ? h('span', { class: 'tag-sm' }, teamName(x.player.team_id)) : h('span', { class: 'muted small' }, ' (not on roster)')),
              Array.from({ length: width }, (_, ci) => h('td', { class: 'num' }, x.numbers[ci]?.raw ?? ''))))))) : null,
          h('div', { class: 'modal-foot' }, h('button', {
            class: 'btn btn-primary', onclick: () => {
              let n = 0;
              if (rows.length) {
                localStorage.setItem(key, JSON.stringify(mapping));
                const chosen = rows.filter(x => x.include);
                const vals = applyMapping(chosen, mapping);
                vals.forEach((v, i) => {
                  const teamId = chosen[i].player.team_id;
                  if (!teamId || !v.player_name) return;
                  let line = g.stats.find(st => st.team_id === teamId && (st.player_name || '').toLowerCase() === v.player_name.toLowerCase())
                    || g.stats.find(st => st.team_id === teamId && !st.player_name);
                  if (!line) { line = { team_id: teamId }; g.stats.push(line); }
                  line.player_name = v.player_name;
                  for (const k of STAT_KEYS) if (v[k] != null) line[k] = v[k];
                  n++;
                });
              }
              if (sc?.use) { g.a_score = sc.a; g.b_score = sc.b; }
              document.querySelector('.modal-overlay .modal-head .icon-btn')?.click();
              render(); toast([sc?.use ? `Score ${sc.a}–${sc.b}` : null, n ? `${n} players` : null].filter(Boolean).join(' · ') + ' filled — check before saving', 'success');
            },
          }, sc && rows.length ? 'Fill score + stats' : sc ? 'Fill score' : 'Fill stats')))));
    }

    async function save() {
      try {
        const has = st => (st.player_name || '').trim() && STAT_KEYS.some(k => st[k] != null && st[k] !== '');
        const used = games.filter(g => g.map || g.winner || g.a_score != null || g.b_score != null || g.pending.length || g.media.length || g.stats.some(has));
        const byTag = new Map(roster.map(p => [`${p.team_id}:${p.gamertag.toLowerCase()}`, p.id]));
        const rows = used.map((g, i) => ({ id: g.id, event_id: ev.event.id, match_id: m.id, game_no: i + 1, map: (g.map || '').trim() || null, mode: g.mode || null, a_score: g.a_score ?? null, b_score: g.b_score ?? null, winner: g.winner ?? null }));
        const removedGames = existing.filter(x => !used.some(g => g.id === x.id)).map(x => x.id);
        if (removedGames.length) await state.store.evDelete('event_games', removedGames);
        if (rows.length) await state.store.evUpsert('event_games', rows);
        const oldStats = ev.data.stats.filter(st => used.some(g => g.id === st.game_id)).map(st => st.id);
        if (oldStats.length) await state.store.evDelete('event_stats', oldStats);
        const statRows = used.flatMap(g => g.stats.filter(has).map(st => {
          const out = { id: uid(), event_id: ev.event.id, game_id: g.id, team_id: st.team_id, player_name: st.player_name.trim(),
            player_id: byTag.get(`${st.team_id}:${st.player_name.trim().toLowerCase()}`) || null };
          for (const k of STAT_KEYS) out[k] = st[k] == null || st[k] === '' || isNaN(st[k]) ? null : Number(st[k]);
          if (!casted) for (const k of ADV_KEYS) out[k] = null; // player POV: no caster numbers
          out.kills ??= 0; out.deaths ??= 0;
          return out;
        }));
        if (statRows.length) await state.store.evUpsert('event_stats', statRows);
        // captain photos are now saved as this match's screenshots
        if (handoff?.shotIds?.length) { await state.store.evDelete('event_report_shots', handoff.shotIds); handoff.shotIds = []; }
        for (const g of used) {
          for (const id of g.removed) await state.store.evDelete('event_media', id);
          for (const p of g.pending) await state.store.evAddScreenshot(ev.event.id, g.id, await compressImage(p.file, MAX_SCREENSHOT_PX, SCREENSHOT_QUALITY));
        }
        // auto-final when the series is decided
        const result = seriesResult(m, rows);
        if (result.done && m.status !== 'final') {
          await state.store.evUpsert('event_matches', { ...m, casted, status: 'final', live: null, ...(handoff ? { reports: {} } : {}), updated_at: new Date().toISOString() });
          toast(`${teamName(result.winner === 'a' ? r.A : r.B)} win ${Math.max(result.a, result.b)}–${Math.min(result.a, result.b)} · marked final`, 'success');
        } else {
          if (!!m.casted !== casted || handoff) await state.store.evUpsert('event_matches', { ...m, casted, ...(handoff ? { reports: {} } : {}), updated_at: new Date().toISOString() });
          toast('Results saved', 'success');
        }
        await refreshEvent();
        editing = false; paint();
      } catch (e) { console.error(e); toast(`Save failed: ${e.message}`, 'error'); }
    }

    render();
    return wrap;
  }

  paint();
  watchEvent(() => { if (root.isConnected && !editing) paint(); });
  return root;
}

export { confirmDialog };
