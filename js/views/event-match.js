// One event match: public scoreboard view + admin result entry (both teams, screenshots, OCR).
import { h, clear, toast, modal, uid, fmtTime, parseTime, compressImage, confirmDialog } from '../ui.js';
import { state } from '../state.js';
import { ev, eventPath, refreshEvent, teamName, watchEvent, teamBadge } from '../event-state.js';
import { roundName, gamesByMatch, gameWinner, seriesResult } from '../event-logic.js';
import { STAT_FIELDS, fieldsForMode, MAX_SCREENSHOT_PX, SCREENSHOT_QUALITY } from '../config.js';
import { parseScoreboard, applyMapping } from '../ocr-parse.js';
import { eventShell } from './event.js';
import { statusPill } from './event-parts.js';
import { vetoAdminPanel } from './veto.js';
import { sortTable } from './table.js';

const STAT_KEYS = STAT_FIELDS.map(f => f.key);

export function eventMatch(matchId) {
  const m0 = ev.data.matches.find(m => m.id === matchId);
  if (!m0) return eventShell('', h('div', { class: 'empty' }, 'Match not found.'));
  const root = h('div');
  let editing = false;

  const paint = () => {
    const m = ev.data.matches.find(x => x.id === matchId);
    if (!m) return;
    const r = ev.resolved.get(m.id) || {};
    const bm = ev.data.matches.filter(x => x.stage !== 'group');
    const games = (gamesByMatch(ev.data.games).get(m.id) || []);
    const res = r.result || seriesResult(m, games);
    const head = h('div', { class: 'match-hero' },
      h('div', { class: 'eyebrow' }, roundName(m, bm), ` · Best of ${m.best_of}`, m.station ? ` · ${m.station}` : ''),
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
    const vetoPanel = ready && !editing && (ev.isAdmin || hasVeto) ? vetoAdminPanel(m, r) : null;
    clear(root).append(eventShell('', h('div', { class: 'stack' }, head, vetoPanel, body)));
  };

  // ---------- read-only game card ----------
  function gameCard(g, r) {
    const lines = ev.idx.statsByGame.get(g.id) || [];
    const fields = fieldsForMode(g.mode).filter(f => !f.optional || lines.some(s => s[f.key] != null));
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

    const wrap = h('div', { class: 'stack' });
    const mapLists = s.modes.map(mode => h('datalist', { id: `dl-${mode.replace(/\W/g, '')}` }, (s.maps[mode] || []).map(x => h('option', { value: x }))));
    const rosterList = h('datalist', { id: 'dl-ev-roster' }, roster.map(p => h('option', { value: p.gamertag })));

    function render() {
      clear(wrap).append(...mapLists, rosterList,
        ...games.map((g, i) => gameEditor(g, i)),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { games.push(mk(games.length, s.mode_order[games.length % s.mode_order.length])); render(); } }, '＋ Add map'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn btn-ghost', onclick: () => { editing = false; paint(); } }, 'Cancel'),
          h('button', { class: 'btn btn-primary', onclick: save }, 'Save results')));
    }

    function gameEditor(g, i) {
      const fields = fieldsForMode(g.mode);
      const num = key => e => { g[key] = e.target.value === '' ? null : Number(e.target.value); };
      const drop = h('label', { class: 'dropzone sm', ondragover: e => e.preventDefault(), ondrop: e => { e.preventDefault(); addFiles(g, e.dataTransfer.files); render(); } },
        h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: e => { addFiles(g, e.target.files); render(); } }),
        h('strong', {}, '＋ Screenshot'), h('span', { class: 'hint' }, 'Drop, browse or paste'));
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
        h('div', { class: 'grid-4' },
          h('label', {}, 'Mode', h('select', { onchange: e => { g.mode = e.target.value; render(); } }, s.modes.map(x => h('option', { value: x, selected: g.mode === x }, x)))),
          h('label', {}, 'Map', h('input', { list: `dl-${(g.mode || '').replace(/\W/g, '')}`, value: g.map || '', oninput: e => { g.map = e.target.value; } })),
          h('label', {}, `${teamName(r.A)} score`, h('input', { type: 'number', min: 0, value: g.a_score ?? '', oninput: num('a_score') })),
          h('label', {}, `${teamName(r.B)} score`, h('input', { type: 'number', min: 0, value: g.b_score ?? '', oninput: num('b_score') }))),
        h('div', { class: 'shots' },
          g.media.filter(x => !g.removed.includes(x.id)).map(x => thumb(g, { media: x })),
          g.pending.map(p => thumb(g, { pending: p })), drop),
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
        h('button', { class: 'btn btn-sm btn-primary', onclick: async () => ocr(g, pending ? pending.file : await (await fetch(img.src)).blob(), img.src) }, 'Read stats'),
        h('button', { class: 'icon-btn', 'aria-label': 'Remove', onclick: () => { if (pending) g.pending = g.pending.filter(p => p !== pending); else g.removed.push(media.id); render(); } }, '✕')));
    }

    async function ocr(g, blob, previewUrl) {
      const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-fill' }));
      const label = h('p', { class: 'muted' }, 'Loading OCR engine…');
      const body = h('div', {}, label, bar);
      modal('Read stats from screenshot', body, []);
      let text;
      try {
        const { recognize } = await import('../ocr.js');
        text = await recognize(blob, (p, msg) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; label.textContent = msg; });
      } catch (e) { clear(body).append(h('p', {}, e.message)); return; }
      let rows = parseScoreboard(text, roster);
      if (!rows.length) { clear(body).append(h('p', {}, 'No scoreboard rows recognised. Enter the numbers manually or try a sharper screenshot.'), h('pre', {}, text)); return; }
      const fields = fieldsForMode(g.mode);
      const width = Math.max(...rows.map(x => x.numbers.length));
      const key = `kf-ocr-map-${g.mode || 'any'}`;
      let mapping = JSON.parse(localStorage.getItem(key) || 'null') || ['kills', 'deaths'];
      mapping = Array.from({ length: width }, (_, i) => mapping[i] || '');
      rows = rows.map(x => ({ ...x, include: !!x.player?.id }));
      clear(body).append(h('div', { class: 'ocr-layout' },
        h('img', { class: 'ocr-preview', src: previewUrl, alt: '' }),
        h('div', {},
          h('p', { class: 'small' }, 'Tick the rows to use and set what each number column is. Matched players go to their own team automatically.'),
          h('div', { class: 'table-wrap' }, h('table', { class: 'data ocr-table' },
            h('thead', {}, h('tr', {}, h('th', {}), h('th', {}, 'Player'), mapping.map((k, ci) => h('th', {}, h('select', { onchange: e => { mapping[ci] = e.target.value; } },
              h('option', { value: '' }, 'ignore'), fields.map(f => h('option', { value: f.key, selected: k === f.key }, f.long))))))),
            h('tbody', {}, rows.map(x => h('tr', {},
              h('td', {}, h('input', { type: 'checkbox', checked: x.include, onchange: e => { x.include = e.target.checked; } })),
              h('td', {}, x.player.gamertag, x.player.team_id ? h('span', { class: 'tag-sm' }, teamName(x.player.team_id)) : h('span', { class: 'muted small' }, ' (not on roster)')),
              Array.from({ length: width }, (_, ci) => h('td', { class: 'num' }, x.numbers[ci]?.raw ?? ''))))))),
          h('div', { class: 'modal-foot' }, h('button', {
            class: 'btn btn-primary', onclick: () => {
              localStorage.setItem(key, JSON.stringify(mapping));
              const chosen = rows.filter(x => x.include);
              const vals = applyMapping(chosen, mapping);
              let n = 0;
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
              document.querySelector('.modal-overlay .modal-head .icon-btn')?.click();
              render(); toast(`Filled ${n} players — check before saving`, 'success');
            },
          }, 'Fill stats')))));
    }

    async function save() {
      try {
        const has = st => (st.player_name || '').trim() && STAT_KEYS.some(k => st[k] != null && st[k] !== '');
        const used = games.filter(g => g.map || g.a_score != null || g.b_score != null || g.pending.length || g.media.length || g.stats.some(has));
        const byTag = new Map(roster.map(p => [`${p.team_id}:${p.gamertag.toLowerCase()}`, p.id]));
        const rows = used.map((g, i) => ({ id: g.id, event_id: ev.event.id, match_id: m.id, game_no: i + 1, map: (g.map || '').trim() || null, mode: g.mode || null, a_score: g.a_score ?? null, b_score: g.b_score ?? null }));
        const removedGames = existing.filter(x => !used.some(g => g.id === x.id)).map(x => x.id);
        if (removedGames.length) await state.store.evDelete('event_games', removedGames);
        if (rows.length) await state.store.evUpsert('event_games', rows);
        const oldStats = ev.data.stats.filter(st => used.some(g => g.id === st.game_id)).map(st => st.id);
        if (oldStats.length) await state.store.evDelete('event_stats', oldStats);
        const statRows = used.flatMap(g => g.stats.filter(has).map(st => {
          const out = { id: uid(), event_id: ev.event.id, game_id: g.id, team_id: st.team_id, player_name: st.player_name.trim(),
            player_id: byTag.get(`${st.team_id}:${st.player_name.trim().toLowerCase()}`) || null };
          for (const k of STAT_KEYS) out[k] = st[k] == null || st[k] === '' || isNaN(st[k]) ? null : Number(st[k]);
          out.kills ??= 0; out.deaths ??= 0;
          return out;
        }));
        if (statRows.length) await state.store.evUpsert('event_stats', statRows);
        for (const g of used) {
          for (const id of g.removed) await state.store.evDelete('event_media', id);
          for (const p of g.pending) await state.store.evAddScreenshot(ev.event.id, g.id, await compressImage(p.file, MAX_SCREENSHOT_PX, SCREENSHOT_QUALITY));
        }
        // auto-final when the series is decided
        const result = seriesResult(m, rows);
        if (result.done && m.status !== 'final') {
          await state.store.evUpsert('event_matches', { ...m, status: 'final', updated_at: new Date().toISOString() });
          toast(`${teamName(result.winner === 'a' ? r.A : r.B)} win ${Math.max(result.a, result.b)}–${Math.min(result.a, result.b)} · marked final`, 'success');
        } else toast('Results saved', 'success');
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
