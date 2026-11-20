// Auto-timestamp walkthrough for Map breakdown: mark the HUD boxes → scan → review → apply.
// Works on a local video file (the browser can't read pixels from YouTube/Twitch players).
import { h, clear, toast, modal, fmtTime } from '../ui.js';
import { state, teamPath, go } from '../state.js';
import { REGION_KEYS, loadRegions, saveRegions, openVideo, seek, frameCanvas, prepCrop, scanVideo, canvasBlob } from '../vod-scan.js';
import { detectSnd, detectHp, detectHj, mergeScan, splitSeries, SCAN_DEFAULTS } from '../vod-detect.js';
import { modeKind, emptyData } from '../breakdown.js';

const SOURCE_NOTE = {
  pov: 'Player POV: a value must be read twice in a row, and anything that happens while the HUD is hidden (deathcam, killcam) is marked unsure.',
  caster: 'CODCaster: the HUD is always on screen, so every clean read counts.',
};

/**
 * g: the map. src: object URL of the local video. row: the breakdown row. kind: 'hp' | 'snd' | 'hj'.
 * onApply(newData): called with the merged breakdown data.
 */
export async function autoTimestamp({ g, src, row, kind, startAt = 0, onApply }) {
  const source = row.source === 'caster' ? 'caster' : 'pov';
  // the series this map belongs to: a full-series VOD is split into these maps in order, starting with this one
  const seriesGames = state.joined.filter(x => x.match_id === g.match_id).sort((a, b) => a.game_no - b.game_no);
  const fromHere = seriesGames.filter(x => x.game_no >= g.game_no);
  let nMaps = 1;
  let assign = [g.id]; // map in the VOD → game id
  const kindOf = id => { const k = modeKind(state.joined.find(x => x.id === id)?.mode); return ['hp', 'snd', 'hj'].includes(k) ? k : null; };
  const wantsFor = () => ['us', 'them', ...(assign.some(id => kindOf(id) === 'snd') ? ['feed', 'banner'] : [])];
  let wants = wantsFor();
  let regions = loadRegions(state.team.id, source);
  const opts = { step: 1, hillSeconds: SCAN_DEFAULTS.hillSeconds, startSide: row.data.start_side || 'atk' };
  const body = h('div', { class: 'va' });
  const finished = modal(`Auto-timestamp · ${source === 'caster' ? 'CODCaster' : 'Player POV'}`, body, []);
  const gameLabel = x => `Map ${x.game_no} · ${x.mode || '?'}${x.map ? ` · ${x.map}` : ''}`;
  const closeModal = () => body.closest('.modal-overlay')?.querySelector('.modal-head .icon-btn')?.click();

  let video;
  try { video = await openVideo(src); } catch (e) { clear(body).append(h('p', {}, e.message)); return; }
  const dur = video.duration || 0;

  // ---------- step 1: boxes ----------
  let active = 'us';
  let frameT = Math.min(dur - 1, Math.max(startAt, Math.min(60, dur / 3)));
  const frame = document.createElement('canvas');
  const view = h('canvas', { class: 'va-canvas' });
  const crops = h('div', { class: 'va-crops' });
  const drawView = () => {
    const ctx = view.getContext('2d');
    view.width = frame.width; view.height = frame.height;
    ctx.drawImage(frame, 0, 0);
    for (const k of wants) {
      const r = regions[k]; if (!r) continue;
      ctx.lineWidth = Math.max(2, frame.width / 480);
      ctx.strokeStyle = REGION_KEYS[k].color;
      ctx.setLineDash(k === active ? [] : [8, 6]);
      ctx.strokeRect(r.x * frame.width, r.y * frame.height, r.w * frame.width, r.h * frame.height);
      ctx.fillStyle = REGION_KEYS[k].color; ctx.font = `${Math.round(frame.height / 40)}px system-ui`;
      ctx.fillText({ us: 'Us', them: 'Them', feed: 'Killfeed', banner: 'Banner' }[k], r.x * frame.width, k === 'them' ? (r.y + r.h) * frame.height + frame.height / 32 : r.y * frame.height - 6);
    }
    clear(crops).append(...wants.filter(k => regions[k]).map(k => {
      const { canvas } = prepCrop(frame, regions[k], { scale: k === 'feed' || k === 'banner' ? 1 : 2 });
      canvas.className = 'va-crop';
      return h('div', { class: 'va-crop-box' }, h('span', { class: 'small', style: { color: REGION_KEYS[k].color } }, REGION_KEYS[k].label), canvas);
    }));
  };
  const loadFrame = async t => { await seek(video, t); frameCanvas(video, frame); drawView(); };
  // drag a box
  let drag = null;
  const pos = e => { const b = view.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) }; };
  view.addEventListener('pointerdown', e => { view.setPointerCapture(e.pointerId); drag = pos(e); });
  view.addEventListener('pointermove', e => {
    if (!drag) return; const p = pos(e);
    regions = { ...regions, [active]: { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) } };
    drawView();
  });
  view.addEventListener('pointerup', () => {
    if (drag && regions[active] && (regions[active].w < 0.005 || regions[active].h < 0.005)) regions = { ...regions, [active]: loadRegions(state.team.id, source)[active] };
    drag = null; drawView();
  });

  const scrub = h('input', { type: 'range', min: 0, max: Math.floor(dur), value: Math.floor(frameT), class: 'grow', 'aria-label': 'Pick a frame', oninput: e => { frameT = +e.target.value; tLabel.textContent = fmtTime(frameT); clearTimeout(scrub.t); scrub.t = setTimeout(() => loadFrame(frameT), 120); } });
  const tLabel = h('span', { class: 'small muted' }, fmtTime(frameT));
  const pickers = h('div', { class: 'seg' }, wants.map(k => h('button', {
    class: k === active ? 'on' : '', onclick: e => { active = k; [...e.currentTarget.parentNode.children].forEach(b => b.classList.toggle('on', b === e.currentTarget)); drawView(); },
  }, REGION_KEYS[k].label)));

  const stepBoxes = () => clear(body).append(
    h('p', { class: 'small' }, 'Pick a frame where the HUD is showing, then drag a box over each item. The black-on-white previews are what gets read: the number should be crisp and alone in its box. Boxes are saved for your team, so you only do this once per HUD layout.'),
    h('p', { class: 'small muted' }, SOURCE_NOTE[source]),
    h('div', { class: 'row wrap' }, pickers, h('span', { class: 'spacer' }), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { regions = loadRegions('__defaults__', source); drawView(); } }, 'Reset boxes')),
    h('div', { class: 'va-stage' }, view),
    h('div', { class: 'row' }, h('span', { class: 'small' }, 'Frame'), scrub, tLabel),
    crops,
    h('div', { class: 'va-opts row wrap' },
      h('label', { class: 'inline small' }, 'Maps in this VOD', h('select', {
        'aria-label': 'Maps in this VOD', onchange: e => {
          nMaps = +e.target.value;
          assign = Array.from({ length: nMaps }, (_, i) => (fromHere[i] || fromHere[fromHere.length - 1] || g).id);
          wants = wantsFor(); stepBoxes(); requestAnimationFrame(drawView);
        },
      }, Array.from({ length: 7 }, (_, i) => i + 1).map(v => h('option', { value: v, selected: nMaps === v }, v === 1 ? '1 (just this map)' : `${v} maps`)))),
      h('label', { class: 'inline small' }, 'Read every', h('select', { onchange: e => { opts.step = +e.target.value; } },
        [[1, '1 second (best)'], [2, '2 seconds (faster)']].map(([v, l]) => h('option', { value: v, selected: opts.step === v }, l)))),
      kind === 'hp' ? h('label', { class: 'inline small' }, 'Hill lasts', h('input', { type: 'number', class: 'in-num', min: 20, max: 180, value: opts.hillSeconds, onchange: e => { opts.hillSeconds = Math.max(20, +e.target.value || 60); } }), 'seconds') : null,
      kind === 'snd' ? h('label', { class: 'inline small' }, 'We start on', h('select', { onchange: e => { opts.startSide = e.target.value; } },
        h('option', { value: 'atk', selected: opts.startSide === 'atk' }, 'Attack'), h('option', { value: 'def', selected: opts.startSide === 'def' }, 'Defense'))) : null,
      kind === 'snd' && !state.data.players.length ? h('span', { class: 'small warn-text' }, 'Add your players to the roster so killfeed names can be matched.') : null),
    nMaps > 1 ? h('p', { class: 'small' }, `The VOD is split at each 0–0 reset and the parts go to: `,
      assign.map((id, i) => { const x = state.joined.find(y => y.id === id); return h('span', { class: 'chip' }, `${i + 1} → ${gameLabel(x)}${kindOf(id) ? '' : ' (not tagged)'}`); }),
      nMaps > fromHere.length ? h('span', { class: 'warn-text' }, ` This scrim only has ${fromHere.length} map${fromHere.length === 1 ? '' : 's'} from here: log the rest in the match editor first, or change them after the scan.`) : null,
      h('span', { class: 'muted' }, ' You can change these after the scan.')) : null,
    h('div', { class: 'modal-foot' },
      h('button', { class: 'btn', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'btn btn-primary', onclick: () => { saveRegions(state.team.id, source, regions); runScan(); } }, nMaps > 1 ? `Scan ${fmtTime(dur)} · ${nMaps} maps` : `Scan ${fmtTime(dur)} of video`)));

  // ---------- step 2: scan ----------
  const ctrl = new AbortController();
  async function runScan() {
    const bar = h('div', { class: 'progress' }, h('div', { class: 'progress-fill' }));
    const label = h('p', { class: 'muted' }, 'Starting…');
    clear(body).append(label, bar, h('p', { class: 'small muted' }, 'Keep this tab open. The video stays on your computer.'),
      h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: () => ctrl.abort() }, 'Stop')));
    let readings;
    try {
      readings = await scanVideo(src, regions, {
        step: opts.step, wants, signal: ctrl.signal, reader: window.__kfScanReader || null,
        onProgress: (p, msg, eta) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; label.textContent = `${msg}${eta != null ? ` · about ${eta > 90 ? `${Math.round(eta / 60)} min` : `${eta} s`} left` : ''}`; },
      });
    } catch (e) {
      if (e.name === 'AbortError') { toast('Scan stopped'); return stepBoxes(); }
      clear(body).append(h('p', {}, `Scan failed: ${e.message}`), h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: stepBoxes }, 'Back')));
      return;
    }
    if (nMaps > 1) seriesReview(readings); else review(readings);
  }

  // ---------- step 3: review ----------
  let lastReadings = [];
  function review(readings) {
    lastReadings = readings;
    const roster = state.data.players;
    const res = kind === 'snd' ? detectSnd(readings, { source, roster, startSide: opts.startSide })
      : kind === 'hp' ? detectHp(readings, { source, hillSeconds: opts.hillSeconds })
        : detectHj(readings, { source });
    const rp = res.report;
    const read = readings.filter(r => r.us != null && r.them != null).length;
    const mapScore = g.team_score != null && g.opp_score != null ? { us: g.team_score, them: g.opp_score } : null;
    const scoreOk = rp.final && mapScore ? rp.final.us === mapScore.us && rp.final.them === mapScore.them : null;
    const facts = [];
    if (kind === 'snd') {
      facts.push(['Rounds', `${res.data.rounds.filter(r => r.result === 'W').length}–${res.data.rounds.filter(r => r.result === 'L').length}`],
        ['First bloods', `${rp.firstBloods}`], ['First deaths', `${rp.firstDeaths}`],
        ['Our kills / deaths', `${rp.kills} / ${rp.deaths}`], ['Plants', `${rp.plants}`]);
    } else if (kind === 'hp') {
      facts.push(['Hills', `${rp.hills}`], ['Rotations won', `${res.data.hills.filter(x => x.first === 'us').length}`], ['Held', `${rp.held}`], ['Broke them', `${rp.broke}`]);
    } else {
      facts.push(['Dunks', `${rp.dunks.us} – ${rp.dunks.them}`], ['Throws', `${rp.throws.us} – ${rp.throws.them}`], ['Capture time', `${fmtTime(rp.hold.us)} – ${fmtTime(rp.hold.them)}`]);
    }
    if (rp.unsure) facts.push(['Unsure', `${rp.unsure}`]);

    // killfeed vs the map's scoreboard stats (the scoreboard is the truth for totals)
    const statRows = state.statsIdx.get(g.id) || [];
    const recon = kind === 'snd' && statRows.length ? statRows.filter(s => s.player_name).map(s => {
      const f = rp.byPlayer[Object.keys(rp.byPlayer).find(n => n.toLowerCase() === s.player_name.toLowerCase())] || { kills: 0, deaths: 0 };
      return { name: s.player_name, fk: f.kills, sk: s.kills, fd: f.deaths, sd: s.deaths };
    }) : [];

    const hasManual = kind === 'hp' ? row.data.hills.some(x => !x.auto) : kind === 'snd' ? row.data.rounds.some(x => !x.auto) : row.data.events.some(x => !x.auto);
    clear(body).append(...[
      h('div', { class: 'bd-summary' }, facts.map(([l, v]) => h('div', { class: 'bd-stat' }, h('div', { class: 'eyebrow' }, l), h('div', { class: 'bd-val' }, v)))),
      h('p', { class: 'small' },
        rp.final ? `Final score read: ${rp.final.us}–${rp.final.them}. ` : 'No score could be read. ',
        scoreOk === true ? h('span', { class: 'ok-text' }, '✓ Matches the map score.') : scoreOk === false ? h('span', { class: 'warn-text' }, `The map score says ${mapScore.us}–${mapScore.them}: check the boxes, or the recording may be cut short.`) : null,
        ` Score read in ${read} of ${readings.length} frames.`,
        rp.startedMidMap ? h('span', { class: 'warn-text' }, ' The recording starts mid-map, so the first rounds aren’t tagged.') : null),
      !read ? h('p', { class: 'warn-text small' }, 'Nothing was read. Go back and check that each box covers only the number, and the preview shows dark digits on white.') : null,
      recon.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data tight' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Player'), h('th', { class: 'num' }, 'Kills placed'), h('th', { class: 'num' }, 'Scoreboard'), h('th', { class: 'num' }, 'Deaths placed'), h('th', { class: 'num' }, 'Scoreboard'))),
        h('tbody', {}, recon.map(x => h('tr', {}, h('td', {}, x.name),
          h('td', { class: 'num' }, x.fk), h('td', { class: `num ${x.sk != null && x.sk !== x.fk ? 'warn-text' : ''}` }, x.sk ?? '–'),
          h('td', { class: 'num' }, x.fd), h('td', { class: `num ${x.sd != null && x.sd !== x.fd ? 'warn-text' : ''}` }, x.sd ?? '–')))))) : null,
      recon.length ? h('p', { class: 'small muted' }, 'Totals always come from the scoreboard. Kills the killfeed missed stay off the round timeline rather than being guessed.') : null,
      hasManual ? h('p', { class: 'small muted' }, 'Tags you added by hand are kept. Tags from an earlier scan are replaced.') : null,
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn btn-ghost', onclick: stepBoxes }, 'Adjust boxes and rescan'),
        h('button', { class: 'btn', onclick: () => grabScoreboard() }, 'Use a frame as the scoreboard screenshot'),
        h('button', {
          class: 'btn btn-primary', disabled: !read, onclick: () => {
            onApply(mergeScan(kind, row.data, res.data));
            closeModal(); toast('Tags added from the VOD · stats updated', 'success');
          },
        }, 'Apply tags'))].filter(Boolean));
  }

  // ---------- series: split into maps, tag each one ----------
  const detectFor = (k, rd, startSide) => (k === 'snd' ? detectSnd(rd, { source, roster: state.data.players, startSide })
    : k === 'hp' ? detectHp(rd, { source, hillSeconds: opts.hillSeconds }) : detectHj(rd, { source }));
  async function seriesReview(readings) {
    lastReadings = readings;
    const sp = splitSeries(readings, nMaps);
    const frames = new Map(); // segment index → { t, canvas }
    const send = { on: true };
    const parts = () => sp.segments.map((seg, i) => {
      const id = assign[i]; const x = state.joined.find(y => y.id === id); const k = kindOf(id);
      const rd = readings.filter(r => r.t >= seg.from && r.t < seg.to);
      const res = k ? detectFor(k, rd, i === 0 ? opts.startSide : 'atk') : null;
      return { i, seg, id, x, k, res };
    });
    const summaryOf = p => {
      if (!p.res) return 'Not tagged (only Hardpoint, S&D and Hijack are)';
      const r = p.res.report, d = p.res.data;
      if (p.k === 'hp') return `${r.hills} hills · rotations ${d.hills.filter(x => x.first === 'us').length}/${r.hills} · held ${r.held} · broke ${r.broke}${r.unsure ? ` · ${r.unsure} unsure` : ''}`;
      if (p.k === 'snd') return `Rounds ${d.rounds.filter(x => x.result === 'W').length}–${d.rounds.filter(x => x.result === 'L').length} · FB ${r.firstBloods} · FD ${r.firstDeaths} · kills ${r.kills} / deaths ${r.deaths}${r.unsure ? ` · ${r.unsure} unsure` : ''}`;
      return `Dunks ${r.dunks.us}–${r.dunks.them} · throws ${r.throws.us}–${r.throws.them}`;
    };
    const frameBox = i => {
      const seg = sp.segments[i];
      const box = h('div', { class: 'va-sb' });
      const draw = async t => {
        t = Math.max(seg.from, Math.min(seg.to - 0.5, t));
        await seek(video, t);
        const c = frameCanvas(video); c.className = 'va-sb-img';
        frames.set(i, { t, canvas: c });
        clear(box).append(c, h('div', { class: 'row' },
          h('button', { class: 'icon-btn', 'aria-label': 'Earlier', onclick: () => draw(t - 2) }, '◀'),
          h('span', { class: 'small muted' }, fmtTime(t)),
          h('button', { class: 'icon-btn', 'aria-label': 'Later', onclick: () => draw(t + 2) }, '▶')));
      };
      queue = queue.then(() => draw(frames.get(i)?.t ?? seg.end + 4));
      return box;
    };
    let queue = Promise.resolve();
    const paint = () => {
      const ps = parts();
      clear(body).append(...[
        h('p', { class: 'small' }, sp.found === nMaps ? `Found ${nMaps} maps.`
          : sp.found < nMaps ? h('span', { class: 'warn-text' }, `Only found ${sp.found} of ${nMaps} maps. Check the score boxes, or the VOD may hold fewer maps.`)
            : `Found ${sp.found} score resets and used the ${nMaps} clearest as map changes.`,
        ' Each map keeps the real time in this video, so clicking a tag jumps to the right spot.'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data va-series' },
          h('thead', {}, h('tr', {}, h('th', {}, 'In VOD'), h('th', {}, 'Goes to'), h('th', {}, 'Score read'), h('th', {}, 'Tags'), h('th', {}, 'Scoreboard frame'))),
          h('tbody', {}, ps.map(p => {
            const fin = p.res?.report.final;
            const logged = p.x && p.x.team_score != null ? `${p.x.team_score}–${p.x.opp_score}` : null;
            const match = fin && logged ? `${fin.us}–${fin.them}` === logged : null;
            return h('tr', {},
              h('td', {}, h('strong', {}, `${p.i + 1}`), h('div', { class: 'small muted' }, `${fmtTime(p.seg.from)}–${fmtTime(p.seg.to)}`)),
              h('td', {}, h('select', { 'aria-label': `VOD map ${p.i + 1} goes to`, onchange: e => { assign[p.i] = e.target.value; paint(); } },
                seriesGames.map(x => h('option', { value: x.id, selected: x.id === p.id }, gameLabel(x))))),
              h('td', {}, fin ? `${fin.us}–${fin.them}` : '—',
                match === true ? h('div', { class: 'small ok-text' }, '✓ matches logged score') : match === false ? h('div', { class: 'small warn-text' }, `logged ${logged}`) : null),
              h('td', { class: 'small' }, summaryOf(p)),
              h('td', {}, frameBox(p.i)));
          })))),
        new Set(assign).size < assign.length ? h('p', { class: 'small warn-text' }, 'Two parts go to the same map. Change one before applying.') : null,
        h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: send.on, onchange: e => { send.on = e.target.checked; } }),
          'Send each scoreboard frame to its map in the match editor, to read player stats (kills, deaths, hill time)'),
        h('div', { class: 'modal-foot' },
          h('button', { class: 'btn btn-ghost', onclick: stepBoxes }, 'Adjust boxes and rescan'),
          h('button', {
            class: 'btn btn-primary', disabled: new Set(assign).size < assign.length, onclick: async e => {
              e.currentTarget.disabled = true;
              let n = 0;
              for (const p of parts()) {
                if (!p.res) continue;
                if (p.id === g.id) { onApply(mergeScan(p.k, row.data, p.res.data)); n++; continue; }
                const cur = await state.store.getBreakdown(p.id) || { game_id: p.id, mode: p.x.mode, source, data: emptyData(p.x.mode) };
                cur.data ||= emptyData(p.x.mode);
                await state.store.saveBreakdown(state.team.id, { ...cur, source, mode: p.x.mode, data: mergeScan(p.k, cur.data, p.res.data) });
                n++;
              }
              if (send.on && frames.size) {
                const list = [];
                for (const [i, f] of frames) list.push({ gameId: assign[i], blob: await canvasBlob(f.canvas) });
                state.vodScoreboard = list;
              }
              closeModal();
              toast(`Tagged ${n} map${n === 1 ? '' : 's'} from the VOD · stats updated`, 'success');
              if (send.on && frames.size) go(teamPath(`match/${g.match_id}/edit`));
            },
          }, `Apply to ${nMaps} maps`))].filter(Boolean));
    };
    paint();
  }

  // ---------- final scoreboard frame → the match editor (player stats) ----------
  async function grabScoreboard() {
    let t = Math.max(0, dur - 8);
    const prev = h('canvas', { class: 'va-canvas' });
    const show = async () => { await seek(video, t); frameCanvas(video, prev); };
    const s = h('input', { type: 'range', min: 0, max: Math.floor(dur), value: Math.floor(t), class: 'grow', oninput: e => { t = +e.target.value; lab.textContent = fmtTime(t); clearTimeout(s.t); s.t = setTimeout(show, 120); } });
    const lab = h('span', { class: 'small muted' }, fmtTime(t));
    await show();
    clear(body).append(h('p', { class: 'small' }, 'Find the frame with the full end-of-map scoreboard. It goes to this map in the match editor as a screenshot, where Read fills the player stats.'),
      h('div', { class: 'va-stage' }, prev), h('div', { class: 'row' }, s, lab),
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn btn-ghost', onclick: () => review(lastReadings) }, 'Back'),
        h('button', {
          class: 'btn btn-primary', onclick: async () => {
            const blob = await canvasBlob(prev);
            state.vodScoreboard = { gameId: g.id, blob };
            closeModal(); go(teamPath(`match/${g.match_id}/edit`));
          },
        }, 'Send to match editor')));
  }
  await loadFrame(frameT);
  stepBoxes();
  await finished;
  ctrl.abort();
  video.removeAttribute('src'); video.load();
}
