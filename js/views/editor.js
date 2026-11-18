import { h, clear, toast, modal, uid, fmtTime, parseTime, compressImage } from '../ui.js';
import { state, teamPath, go, canEdit, isOwner, refreshData, knownMaps, knownModes } from '../state.js';
import { MATCH_TYPES, STAT_FIELDS, fieldsForMode, MAX_SCREENSHOT_PX, SCREENSHOT_QUALITY } from '../config.js';
import { parseScoreboard, applyMapping, pickMapScore, teamSide } from '../ocr-parse.js';

const CDL_BO5 = ['Hardpoint', 'Search & Destroy', 'Hijack', 'Hardpoint', 'Search & Destroy'];
const STAT_KEYS = STAT_FIELDS.map(f => f.key);

export async function editorView(matchId) {
  if (!canEdit()) return h('div', { class: 'empty' }, h('p', {}, 'Viewers cannot edit matches.'));
  const existing = matchId ? state.data.matches.find(m => m.id === matchId) : null;
  if (matchId && !existing) return h('div', { class: 'empty' }, h('p', {}, 'Match not found.'));

  const roster = state.data.players.filter(p => p.active !== false);
  const prefill = !existing ? JSON.parse(sessionStorage.getItem('kf-prefill') || 'null') : null;
  sessionStorage.removeItem('kf-prefill');
  const match = existing ? { ...existing } : {
    type: prefill?.type || 'scrim', played_on: prefill?.played_on || new Date().toLocaleDateString('en-CA'), opponent: prefill?.opponent || '', event: '', notes: '',
  };

  const blankStats = () => (roster.length ? roster : [{}, {}, {}, {}]).map(p => ({ player_name: p.gamertag || '', kills: null, deaths: null }));
  const newGame = (mode = '') => ({
    id: uid(), game_no: 0, map: '', mode, team_score: null, opp_score: null, vod_url: '', notes: '',
    stats: blankStats(), pending: [], media: [], removedMedia: [],
  });

  let games;
  if (existing) {
    games = state.data.games.filter(g => g.match_id === matchId).sort((a, b) => a.game_no - b.game_no).map(g => ({
      ...g, stats: (state.statsIdx.get(g.id) || []).map(s => ({ ...s })), pending: [], media: [], removedMedia: [],
    }));
    await Promise.all(games.map(async g => { g.media = await state.store.listMedia(g.id); }));
  } else games = [newGame()];

  let activeGame = 0;
  const root = h('div', { class: 'page editor' });

  // Ctrl+V a screenshot straight into the active map
  const onPaste = e => {
    if (!document.body.contains(root)) return document.removeEventListener('paste', onPaste);
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length && games[activeGame]) { addFiles(games[activeGame], files); render(); toast('Screenshot pasted'); }
  };
  document.addEventListener('paste', onPaste);

  const maps = knownMaps(), modes = knownModes();
  const mapList = h('datalist', { id: 'dl-maps' }, maps.map(m => h('option', { value: m })));
  const opponents = [...new Set(state.data.matches.map(m => m.opponent).filter(Boolean))];
  const oppList = h('datalist', { id: 'dl-opps' }, opponents.map(o => h('option', { value: o })));
  const rosterList = h('datalist', { id: 'dl-roster' }, roster.map(p => h('option', { value: p.gamertag })));

  function addFiles(g, files) {
    for (const f of files) if (f.type.startsWith('image/')) g.pending.push({ file: f, url: URL.createObjectURL(f) });
  }

  function render() {
    clear(root);
    games.forEach((g, i) => { g.game_no = i + 1; });
    root.append(mapList, oppList, rosterList,
      h('div', { class: 'page-head' },
        h('h1', {}, existing ? 'Edit match' : 'Log match'),
        h('div', { class: 'actions' },
          h('a', { class: 'btn btn-ghost', href: existing ? teamPath(`match/${matchId}`) : teamPath('dashboard') }, 'Cancel'),
          h('button', { class: 'btn btn-primary', onclick: save }, 'Save match'))),
      seriesCard(),
      ...games.map((g, i) => gameCard(g, i)),
      h('div', { class: 'add-row' },
        h('button', { class: 'btn', onclick: () => { games.push(newGame()); activeGame = games.length - 1; render(); } }, '＋ Add map'),
        !existing && games.length === 1 && !games[0].map ? h('button', {
          class: 'btn btn-ghost', 'data-tip': 'Hardpoint, S&D, Hijack, Hardpoint, S&D',
          onclick: () => { games = CDL_BO5.map(m => newGame(m)); render(); },
        }, 'Use Bo5 template') : null),
      h('div', { class: 'save-bar' }, h('button', { class: 'btn btn-primary btn-lg', onclick: save }, 'Save match')));
  }

  function seriesCard() {
    const bind = key => e => { match[key] = e.target.value; };
    return h('div', { class: 'card' },
      h('div', { class: 'grid-4' },
        h('label', {}, 'Type', h('select', { onchange: bind('type') }, MATCH_TYPES.map(t => h('option', { value: t.id, selected: match.type === t.id }, t.label)))),
        h('label', {}, 'Date', h('input', { type: 'date', value: match.played_on || '', onchange: bind('played_on') })),
        h('label', {}, 'Opponent', h('input', { list: 'dl-opps', value: match.opponent || '', placeholder: 'Team name', oninput: bind('opponent') })),
        h('label', {}, 'Event', h('input', { value: match.event || '', placeholder: 'Optional — e.g. Challengers Qualifier', oninput: bind('event') }))),
      h('label', {}, 'Notes', h('textarea', { rows: 2, placeholder: 'Anything worth remembering about this block', oninput: bind('notes') }, match.notes || '')));
  }

  function gameCard(g, i) {
    const bind = (key, num) => e => { g[key] = num ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value; };
    const drop = h('label', {
      class: 'dropzone',
      ondragover: e => { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: () => drop.classList.remove('over'),
      ondrop: e => { e.preventDefault(); addFiles(g, e.dataTransfer.files); render(); },
    }, h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: e => { addFiles(g, e.target.files); render(); } }),
    h('strong', {}, 'Add scoreboard screenshots'), h('span', { class: 'muted small' }, 'Drop, click to browse, or paste with Ctrl+V'));
    // phones: open the camera straight away
    const cam = h('label', { class: 'dropzone cam' },
      h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: e => { addFiles(g, e.target.files); render(); } }),
      h('strong', {}, '📷 Add photo'), h('span', { class: 'muted small' }, 'Take a picture of the screen'));

    return h('div', { class: `card game-card ${activeGame === i ? 'active' : ''}`, onfocusin: () => { activeGame = i; }, onclick: () => { activeGame = i; } },
      h('div', { class: 'game-head' },
        h('h3', {}, `Map ${i + 1}`),
        h('div', { class: 'actions' },
          i > 0 ? h('button', { class: 'icon-btn', 'aria-label': 'Move up', onclick: () => { [games[i - 1], games[i]] = [games[i], games[i - 1]]; render(); } }, '↑') : null,
          i < games.length - 1 ? h('button', { class: 'icon-btn', 'aria-label': 'Move down', onclick: () => { [games[i + 1], games[i]] = [games[i], games[i + 1]]; render(); } }, '↓') : null,
          games.length > 1 ? h('button', { class: 'icon-btn', 'aria-label': 'Remove map', onclick: () => { games.splice(i, 1); activeGame = 0; render(); } }, '✕') : null)),
      h('div', { class: 'grid-5' },
        h('label', {}, 'Map', h('input', { list: 'dl-maps', value: g.map || '', placeholder: maps.length ? 'Pick or type' : 'Type map name', oninput: bind('map') })),
        h('label', {}, 'Mode', h('select', { onchange: e => { g.mode = e.target.value; render(); } },
          h('option', { value: '' }, '—'), modes.map(m => h('option', { value: m, selected: g.mode === m }, m)))),
        h('label', {}, 'Our score', h('input', { type: 'number', min: 0, value: g.team_score ?? '', oninput: bind('team_score', true) })),
        h('label', {}, 'Their score', h('input', { type: 'number', min: 0, value: g.opp_score ?? '', oninput: bind('opp_score', true) })),
        h('label', {}, 'VOD link', h('input', { type: 'url', value: g.vod_url || '', placeholder: 'YouTube / Twitch URL', oninput: bind('vod_url') }))),
      h('div', { class: 'shots' },
        g.media.filter(m => !g.removedMedia.includes(m.id)).map(m => thumb(g, { media: m })),
        g.pending.map(p => thumb(g, { pending: p })),
        h('div', { class: 'drop-pair' }, drop, cam)),
      statsTable(g));
  }

  function thumb(g, { media, pending }) {
    const img = h('img', { alt: 'Scoreboard screenshot', loading: 'lazy' });
    if (pending) img.src = pending.url;
    else state.store.mediaUrl(media).then(u => { img.src = u; });
    return h('div', { class: 'thumb' }, img,
      h('div', { class: 'thumb-actions' },
        h('button', {
          class: 'btn btn-sm btn-primary', onclick: async () => {
            const blob = pending ? pending.file : await (await fetch(img.src)).blob();
            runOcr(g, blob, img.src);
          },
        }, 'Read score + stats'),
        h('button', {
          class: 'icon-btn', 'aria-label': 'Remove screenshot', onclick: () => {
            if (pending) g.pending = g.pending.filter(p => p !== pending);
            else g.removedMedia.push(media.id);
            render();
          },
        }, '✕')));
  }

  function statsTable(g) {
    const fields = fieldsForMode(g.mode);
    const tbody = h('tbody', {}, g.stats.map((s, r) => h('tr', {},
      h('td', {}, h('input', { class: 'in-name', list: 'dl-roster', value: s.player_name || '', placeholder: 'Gamertag', oninput: e => { s.player_name = e.target.value; } })),
      fields.map(f => h('td', { class: 'num' }, h('input', {
        class: 'in-num', inputmode: f.time ? 'text' : 'numeric', placeholder: f.time ? 'm:ss' : '',
        value: s[f.key] == null ? '' : (f.time ? fmtTime(s[f.key]) : s[f.key]),
        'aria-label': `${s.player_name || 'Player'} ${f.long}`,
        onchange: e => { s[f.key] = f.time ? parseTime(e.target.value) : (e.target.value === '' ? null : Number(e.target.value)); },
      }))),
      h('td', {}, h('button', { class: 'icon-btn', 'aria-label': 'Remove row', onclick: () => { g.stats.splice(r, 1); render(); } }, '✕')))));
    return h('div', { class: 'table-wrap' }, h('table', { class: 'data edit-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Player'), fields.map(f => h('th', { class: 'num', 'data-tip': f.long + (f.time ? ' (m:ss)' : '') }, f.label)), h('th', {}))),
      tbody),
    h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { g.stats.push({ player_name: '' }); render(); } }, '＋ Add player row'));
  }

  // ---------- OCR ----------
  async function runOcr(g, blob, previewUrl) {
    const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-fill' }));
    const label = h('p', { class: 'muted' }, 'Loading OCR engine…');
    const body = h('div', { class: 'ocr' }, label, bar);
    const done = modal('Read score and stats from screenshot', body, []);
    let text, scorePasses;
    try {
      const { readScoreboard } = await import('../ocr.js');
      ({ text, scorePasses } = await readScoreboard(blob, (p, msg) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; label.textContent = msg; }));
    } catch (e) {
      clear(body).append(h('p', {}, e.message));
      return;
    }
    const allRoster = state.data.players;
    let rows = parseScoreboard(text, allRoster);
    // map score: left/top belongs to whichever side our players are on
    const found = pickMapScore(scorePasses, g.mode);
    const side = teamSide(rows, p => !!p.id);
    const sc = found ? { use: true, us: side === 'right' ? found.right : found.left, them: side === 'right' ? found.left : found.right, guessed: !side } : null;
    const scoreBox = h('div', { class: 'ocr-score' });
    const drawScore = () => clear(scoreBox).append(...(sc ? [
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: sc.use, onchange: e => { sc.use = e.target.checked; } }), h('strong', {}, 'Map score')),
      h('span', { class: 'ocr-score-line' }, 'Us', h('input', { type: 'number', min: 0, class: 'in-score', value: sc.us, oninput: e => { sc.us = +e.target.value; } }), '–',
        h('input', { type: 'number', min: 0, class: 'in-score', value: sc.them, oninput: e => { sc.them = +e.target.value; } }), 'Them'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { [sc.us, sc.them] = [sc.them, sc.us]; drawScore(); } }, '⇄ Swap'),
      found.adjusted ? h('span', { class: 'small warn-text' }, 'Read as a 2x0 number and set to 250 (Hardpoint ends at 250). Check the image.')
        : sc.guessed ? h('span', { class: 'small muted' }, 'Couldn’t tell which side you’re on — check it.')
          : !found.sure ? h('span', { class: 'small muted' }, 'Check this against the image.') : null,
    ] : [h('span', { class: 'small muted' }, 'Couldn’t read the map score. Type it in on the map.')]));
    drawScore();
    if (!rows.length && sc) {
      clear(body).append(h('div', { class: 'ocr-layout' }, h('img', { class: 'ocr-preview', src: previewUrl, alt: 'Screenshot' }),
        h('div', {}, scoreBox, h('p', { class: 'small muted' }, 'No player rows recognised — only the score.'),
          h('div', { class: 'modal-foot' }, h('button', {
            class: 'btn btn-primary', onclick: () => {
              if (sc.use) { g.team_score = sc.us; g.opp_score = sc.them; }
              document.querySelector('.modal-overlay .modal-head .icon-btn')?.click(); render(); toast(`Score ${sc.us}–${sc.them} filled — check before saving`, 'success');
            },
          }, 'Fill score')))));
      await done; return;
    }
    if (!rows.length) {
      clear(body).append(h('p', {}, 'No scoreboard rows were recognised. Try a sharper, full-resolution screenshot of the scoreboard, or enter the numbers manually.'),
        h('details', {}, h('summary', {}, 'Show raw text'), h('pre', {}, text)));
      return;
    }
    const fields = fieldsForMode(g.mode);
    const width = Math.max(...rows.map(r => r.numbers.length));
    const storeKey = `kf-ocr-map-${g.mode || 'any'}`;
    let mapping = JSON.parse(localStorage.getItem(storeKey) || 'null') || ['kills', 'deaths'];
    mapping = Array.from({ length: width }, (_, i) => mapping[i] || '');
    rows = rows.map(r => ({ ...r, include: !!r.player?.id }));

    const renderGrid = () => {
      clear(body).append(
        h('div', { class: 'ocr-layout' },
          h('img', { class: 'ocr-preview', src: previewUrl, alt: 'Screenshot' }),
          h('div', {},
            scoreBox,
            h('p', { class: 'small' }, 'Check the rows, then tell us what each number column is (remembered for ', h('strong', {}, g.mode || 'this mode'), '). Rows matched to your roster are ticked.'),
            h('div', { class: 'table-wrap' }, h('table', { class: 'data ocr-table' },
              h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Player'),
                mapping.map((key, ci) => h('th', {}, h('select', {
                  'aria-label': `Column ${ci + 1}`, onchange: e => { mapping[ci] = e.target.value; },
                }, h('option', { value: '' }, 'ignore'), fields.map(f => h('option', { value: f.key, selected: key === f.key }, f.long))))))),
              h('tbody', {}, rows.map(r => h('tr', { class: r.include ? '' : 'dim' },
                h('td', {}, h('input', { type: 'checkbox', checked: r.include, onchange: e => { r.include = e.target.checked; e.target.closest('tr').classList.toggle('dim', !r.include); } })),
                h('td', {}, h('select', {
                  onchange: e => {
                    const p = allRoster.find(x => x.id === e.target.value);
                    r.player = p || { id: null, gamertag: e.target.selectedOptions[0].dataset.name };
                  },
                }, allRoster.map(p => h('option', { value: p.id, selected: r.player?.id === p.id }, p.gamertag)),
                !r.player?.id ? h('option', { value: '', selected: true, 'data-name': r.player.gamertag }, `${r.player.gamertag || '?'} (not on roster)`) : null)),
                Array.from({ length: width }, (_, ci) => h('td', { class: 'num' }, r.numbers[ci]?.raw ?? '')))))),
            h('details', {}, h('summary', { class: 'small' }, 'Raw OCR text'), h('pre', {}, text)),
            h('div', { class: 'modal-foot' },
              h('button', { class: 'btn btn-primary', onclick: apply }, sc ? 'Fill score + stats' : 'Fill stats'))))));
    };

    const apply = () => {
      localStorage.setItem(storeKey, JSON.stringify(mapping));
      const chosen = applyMapping(rows.filter(r => r.include), mapping);
      let filled = 0;
      for (const c of chosen) {
        if (!c.player_name) continue;
        let line = g.stats.find(s => (s.player_name || '').toLowerCase() === c.player_name.toLowerCase());
        if (!line) line = g.stats.find(s => !s.player_name);
        if (!line) { line = {}; g.stats.push(line); }
        line.player_name = c.player_name;
        for (const k of STAT_KEYS) if (c[k] != null) line[k] = c[k];
        filled++;
      }
      if (sc?.use) { g.team_score = sc.us; g.opp_score = sc.them; }
      document.querySelector('.modal-overlay .modal-head .icon-btn')?.click();
      render();
      toast(`${sc?.use ? `Score ${sc.us}–${sc.them} · ` : ''}Filled stats for ${filled} player${filled === 1 ? '' : 's'} — double-check before saving`, 'success');
    };
    renderGrid();
    await done;
  }

  // ---------- Save ----------
  async function save() {
    const btns = root.querySelectorAll('.btn-primary');
    btns.forEach(b => { b.disabled = true; });
    try {
      const rosterByName = new Map(state.data.players.map(p => [p.gamertag.toLowerCase(), p.id]));
      const hasStats = s => (s.player_name || '').trim() && STAT_KEYS.some(k => s[k] != null && s[k] !== '');
      // skip maps that were never filled in (e.g. unplayed maps from the Bo5 template)
      const used = games.filter(g => g.map || g.team_score != null || g.opp_score != null || g.vod_url
        || g.pending.length || g.media.length || g.stats.some(hasStats));
      if (!used.length) throw new Error('Fill in at least one map');
      games = used;
      const payloadGames = games.map((g, gi) => ({
        id: g.id, game_no: gi + 1, map: (g.map || '').trim() || null, mode: g.mode || null,
        team_score: g.team_score ?? null, opp_score: g.opp_score ?? null, vod_url: (g.vod_url || '').trim() || null, notes: g.notes || null,
        stats: g.stats.filter(hasStats).map(s => {
          const name = s.player_name.trim();
          const out = { player_name: name, player_id: rosterByName.get(name.toLowerCase()) || null };
          for (const k of STAT_KEYS) out[k] = s[k] == null || s[k] === '' || isNaN(s[k]) ? null : Number(s[k]);
          out.kills = out.kills ?? 0; out.deaths = out.deaths ?? 0;
          return out;
        }),
      }));
      const matchRow = {
        id: existing?.id, type: match.type, played_on: match.played_on || null,
        opponent: (match.opponent || '').trim() || null, event: (match.event || '').trim() || null, notes: (match.notes || '').trim() || null,
      };
      const id = await state.store.saveMatch(state.team.id, matchRow, payloadGames);

      // screenshots
      let uploaded = 0;
      for (const g of games) {
        for (const mid of g.removedMedia) {
          const m = g.media.find(x => x.id === mid);
          if (m) await state.store.deleteMedia(m);
        }
        for (const p of g.pending) {
          const blob = await compressImage(p.file, MAX_SCREENSHOT_PX, SCREENSHOT_QUALITY);
          await state.store.addScreenshot(state.team.id, g.id, blob);
          uploaded++;
        }
      }

      // remember new maps in the team's map pool
      const newMaps = payloadGames.map(g => g.map).filter(m => m && !(state.team.maps || []).includes(m));
      if (newMaps.length && isOwner()) {
        const merged = [...new Set([...(state.team.maps || []), ...newMaps])];
        await state.store.updateTeam(state.team.id, { maps: merged });
        state.team.maps = merged;
      }

      // link back to the schedule entry this result came from
      if (prefill?.sched_id) {
        try {
          const { events } = await state.store.listSchedule(state.team.id);
          const se = events.find(e => e.id === prefill.sched_id);
          if (se) await state.store.saveScheduleEvent(state.team.id, { ...se, match_id: id, status: 'done' });
        } catch { /* schedule link is optional */ }
      }

      await refreshData();
      toast(`Match saved${uploaded ? ` · ${uploaded} screenshot${uploaded === 1 ? '' : 's'} uploaded` : ''}`, 'success');
      go(teamPath(`match/${id}`));
    } catch (e) {
      console.error(e);
      toast(`Save failed: ${e.message}`, 'error');
      btns.forEach(b => { b.disabled = false; });
    }
  }

  render();
  return root;
}
