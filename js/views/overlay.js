// OBS Browser Source page: #/overlay/<eventId>/<stationId>  (set the source to 1920×1080)
// Transparent background, updates live as matches, scores and the station's settings change.
import { h } from '../ui.js';
import { ev, loadEvent, watchEvent } from '../event-state.js';
import { applyAccent, applyFont } from '../theme.js';
import { overlayStage, overlaySettings } from '../overlay.js';

export async function overlayView(eventId, stationId) {
  document.body.classList.add('display-mode', 'display-transparent', 'overlay-mode');
  document.documentElement.style.background = 'transparent'; // OBS shows the game through anything that isn't drawn
  const event = await loadEvent(eventId, { force: true });
  if (!event) return h('div', { class: 'ov-missing' }, 'Event not found or not public.');
  applyAccent(event.accent);
  applyFont(ev.settings.display?.font || 'mix');
  const station = () => overlaySettings().stations.find(s => s.id === stationId) || overlaySettings().stations[0];
  let st = station();
  const stage = overlayStage(st);
  const viewport = h('div', { class: 'ov-viewport' }, stage.el);
  const fit = () => { stage.el.style.transform = `scale(${Math.min(innerWidth / 1920, innerHeight / 1080)})`; };
  addEventListener('resize', fit);
  requestAnimationFrame(fit);
  watchEvent(() => {
    applyAccent(ev.event.accent);
    const next = station();
    if (JSON.stringify(next) !== JSON.stringify(st)) { st = next; Object.assign(stage, overlayStage(st)); viewport.replaceChildren(stage.el); fit(); return; }
    stage.update();
  });
  return viewport;
}
