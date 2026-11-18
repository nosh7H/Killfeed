import { h, clear, fmtTime, parseTime, fmtDate, toast, modal, confirmDialog } from '../ui.js';
import { state, teamPath, canEdit } from '../state.js';
import { resultBadge, typeLabel, section } from './dashboard.js';
import { scoreboard } from './matches.js';
import { breakdownPanel } from './breakdown-panel.js';

const MARK_TAGS = ['Rotation', 'Trade', 'Utility', 'Comms', 'Spawns', 'Clutch', 'Mistake', 'Highlight'];

export async function gameView(gameId) {
  const g = state.joined.find(x => x.id === gameId);
  if (!g) return h('div', { class: 'empty' }, h('p', {}, 'Game not found.'));
  const [media, marks] = await Promise.all([state.store.listMedia(gameId), state.store.listMarks(gameId)]);
  const shared = { player: null }; // the VOD player, shared with the breakdown tagger

  const root = h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {},
      h('div', { class: 'crumbs' }, h('a', { href: teamPath('matches') }, 'Matches'), ' / ',
        h('a', { href: teamPath(`match/${g.match_id}`) }, `${typeLabel(g.match.type)} vs ${g.match.opponent || 'Unknown'}`), ' /'),
      h('h1', {}, `${g.map || 'Map'} `, h('span', { class: 'muted' }, g.mode || '')),
      h('p', { class: 'muted' }, fmtDate(g.match.played_on), ' · Map ', g.game_no, ' · ', resultBadge(g), ` ${g.team_score ?? '–'}–${g.opp_score ?? '–'}`)),
    canEdit() ? h('a', { class: 'btn', href: teamPath(`match/${g.match_id}/edit`) }, 'Edit') : null),
    section('Scoreboard', null, scoreboard(g)),
    section('Screenshots', `${media.length}`, gallery(media)),
    section('VOD review', 'Timestamped notes for this map', await vodPanel(g, marks, shared)),
    section('Map breakdown', g.mode === 'Hardpoint' ? 'Tag every hill: who rotated first and whether it got broken' : g.mode === 'Search & Destroy' ? 'Tag every round: kills, deaths, plants and result' : 'Log key moments', await breakdownPanel(g, shared)));
  return root;
}

function gallery(media) {
  if (!media.length) return h('div', { class: 'empty-sm' }, 'No screenshots. Add them from Edit.');
  return h('div', { class: 'shots' }, media.map(m => {
    const img = h('img', { alt: 'Scoreboard screenshot', loading: 'lazy' });
    state.store.mediaUrl(m).then(u => { img.src = u; });
    return h('button', { class: 'thumb thumb-btn', onclick: () => modal('Screenshot', h('img', { class: 'lightbox', src: img.src, alt: 'Scoreboard screenshot' })) }, img);
  }));
}

// ---------- VOD ----------
export function parseVod(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return { kind: 'youtube', id: u.pathname.slice(1).split('/')[0] };
    if (host.endsWith('youtube.com')) {
      if (u.searchParams.get('v')) return { kind: 'youtube', id: u.searchParams.get('v') };
      const m = u.pathname.match(/\/(?:live|shorts|embed)\/([\w-]{6,})/);
      if (m) return { kind: 'youtube', id: m[1] };
    }
    if (host.endsWith('twitch.tv')) {
      const m = u.pathname.match(/\/videos\/(\d+)/);
      if (m) return { kind: 'twitch', id: m[1] };
    }
    if (/\.(mp4|webm|mov|m3u8)$/i.test(u.pathname)) return { kind: 'file', src: url };
  } catch { /* not a URL */ }
  return null;
}

function loadScript(src, ready) {
  return new Promise((res, rej) => {
    if (ready()) return res();
    const s = document.createElement('script');
    s.src = src; s.onerror = () => rej(new Error('Could not load video player'));
    document.head.append(s);
    const t = setInterval(() => { if (ready()) { clearInterval(t); res(); } }, 100);
    setTimeout(() => { clearInterval(t); if (!ready()) rej(new Error('Video player timed out')); }, 15000);
  });
}

// Returns { el, getTime(), seek(t) }
async function makePlayer(vod) {
  const host = h('div', { class: 'vod-frame' });
  if (vod.kind === 'youtube') {
    const target = h('div');
    host.append(target);
    await loadScript('https://www.youtube.com/iframe_api', () => window.YT?.Player);
    let player;
    await new Promise(res => { player = new YT.Player(target, { videoId: vod.id, width: '100%', height: '100%', events: { onReady: res } }); });
    return { el: host, getTime: () => player.getCurrentTime?.() ?? null, seek: t => { player.seekTo(t, true); player.playVideo(); } };
  }
  if (vod.kind === 'twitch') {
    host.id = `tw-${Math.random().toString(36).slice(2)}`;
    document.body.append(host); // Twitch needs the element in the DOM
    await loadScript('https://player.twitch.tv/js/embed/v1.js', () => window.Twitch?.Player);
    const player = new Twitch.Player(host.id, { video: vod.id, parent: [location.hostname], width: '100%', height: '100%', autoplay: false });
    host.remove();
    return { el: host, getTime: () => player.getCurrentTime(), seek: t => { player.seek(t); player.play(); } };
  }
  const v = h('video', { src: vod.src, controls: true, preload: 'metadata' });
  host.append(v);
  return { el: host, getTime: () => v.currentTime, seek: t => { v.currentTime = t; v.play(); } };
}

async function vodPanel(g, marks, shared = {}) {
  const wrap = h('div', { class: 'vod' });
  let player = null;
  const playerSlot = h('div', { class: 'vod-player' });

  const setPlayer = async vod => {
    clear(playerSlot).append(h('div', { class: 'loading' }, 'Loading video…'));
    try {
      player = await makePlayer(vod);
      shared.player = player;
      clear(playerSlot).append(player.el);
    } catch (e) { clear(playerSlot).append(h('p', { class: 'muted' }, e.message)); }
  };

  const vod = parseVod(g.vod_url);
  if (vod) setPlayer(vod);
  else clear(playerSlot).append(h('div', { class: 'empty-sm' },
    g.vod_url ? h('p', {}, 'This link can’t be embedded — ', h('a', { href: g.vod_url, target: '_blank', rel: 'noopener' }, 'open VOD'), '.')
      : h('p', {}, 'No VOD linked. Add a YouTube or Twitch link from Edit, or open a local recording below.'),
    h('label', { class: 'btn btn-sm' }, 'Open local video file',
      h('input', { type: 'file', accept: 'video/*', hidden: true, onchange: e => {
        const f = e.target.files[0]; if (f) setPlayer({ kind: 'file', src: URL.createObjectURL(f) });
      } })),
    h('p', { class: 'muted small' }, 'Local files play in your browser only and are not uploaded.')));

  const list = h('ol', { class: 'marks' });
  const renderMarks = () => {
    clear(list);
    if (!marks.length) list.append(h('li', { class: 'muted small' }, 'No notes yet.'));
    for (const m of marks) list.append(h('li', {},
      h('button', { class: 'mark-time', onclick: () => player ? player.seek(m.t_seconds) : toast('No video loaded') }, fmtTime(m.t_seconds)),
      m.tag ? h('span', { class: 'tag' }, m.tag) : null,
      h('span', { class: 'mark-note' }, m.note),
      canEdit() ? h('button', {
        class: 'icon-btn', 'aria-label': 'Delete note', onclick: async () => {
          if (!(await confirmDialog('Delete this note?'))) return;
          await state.store.deleteMark(m.id);
          marks.splice(marks.indexOf(m), 1); renderMarks();
        },
      }, '✕') : null));
  };
  renderMarks();

  const time = h('input', { class: 'in-num', placeholder: 'm:ss', 'aria-label': 'Time' });
  const tag = h('select', { 'aria-label': 'Tag' }, h('option', { value: '' }, 'Tag'), MARK_TAGS.map(t => h('option', { value: t }, t)));
  const note = h('input', { placeholder: 'What happened?', 'aria-label': 'Note' });
  const form = canEdit() ? h('form', {
    class: 'mark-form', onsubmit: async e => {
      e.preventDefault();
      let t = parseTime(time.value);
      if (t == null && player) t = Math.floor(player.getTime() || 0);
      if (t == null || !note.value.trim()) return toast('Add a time and a note', 'error');
      const mark = { t_seconds: t, tag: tag.value || null, note: note.value.trim() };
      await state.store.addMark(state.team.id, g.id, mark);
      marks.splice(0, marks.length, ...(await state.store.listMarks(g.id)));
      time.value = ''; note.value = ''; renderMarks();
    },
  },
  h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { if (player) time.value = fmtTime(player.getTime()); else toast('Load a video first'); } }, '⏱ Now'),
  time, tag, note, h('button', { class: 'btn btn-sm btn-primary', type: 'submit' }, 'Add note')) : null;

  wrap.append(playerSlot, h('div', { class: 'vod-side' }, form, list));
  return wrap;
}
