// Map veto page for captains (link with ?k=<key>) and spectators (no key).
import { h, clear, toast } from '../ui.js';
import { state } from '../state.js';
import { ev, loadEvent, watchEvent, teamName, teamTag, eventPath } from '../event-state.js';
import { vetoNext, vetoSeries, mapStates, stepLabel } from '../veto.js';
import { applyAccent, applyFont } from '../theme.js';

const modesOf = v => [...new Set(v.steps.map(s => s.mode))];
const sideTeam = (v, side) => (side === 'a' ? v.team_a : side === 'b' ? v.team_b : null);

/** Map 1…5 list for a veto: mode, map, who picked it, starting side. */
export function vetoSeriesList(v, { large = false } = {}) {
  return h('div', { class: `veto-series ${large ? 'large' : ''}` }, vetoSeries(v).map(s => h('div', { class: `vs-row ${s.map ? 'set' : ''}` },
    h('span', { class: 'vs-slot' }, `Map ${s.slot}`),
    h('span', { class: 'vs-mode' }, s.mode),
    h('span', { class: 'vs-map' }, s.map || '—'),
    h('span', { class: 'vs-by' }, s.by === 'decider' ? 'Decider' : s.by ? `${teamTag(sideTeam(v, s.by))} pick` : ''),
    h('span', { class: 'vs-side' }, s.side ? `${teamTag(sideTeam(v, s.side.team))} · ${s.side.choice}` : ''))));
}

export function vetoBanner(v, mySide = null) {
  const st = vetoNext(v);
  if (!st) return h('div', { class: 'veto-banner done' }, h('strong', {}, 'Veto complete'), h('span', {}, 'Maps and modes are set for this series.'));
  const who = teamName(sideTeam(v, st.team));
  if (mySide && st.team === mySide) return h('div', { class: 'veto-banner mine' }, h('span', { class: 'eyebrow' }, 'Your turn'), h('strong', {}, cap(stepLabel(st))));
  return h('div', { class: 'veto-banner' }, h('span', { class: 'eyebrow' }, 'Waiting'), h('strong', {}, `${who} to ${stepLabel(st)}`));
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export async function vetoView(vetoId) {
  const key = new URLSearchParams(location.hash.split('?')[1] || '').get('k');
  const first = await state.store.getVeto(vetoId);
  if (!first) return h('div', { class: 'empty' }, h('h2', {}, 'Veto not found'), h('p', {}, 'Check the link with your tournament staff.'));
  await loadEvent(first.event_id, { force: true });
  applyAccent(ev.event.accent);
  applyFont(ev.event.settings?.font || 'mix');
  const side = await state.store.vetoWhoami(vetoId, key);
  if (key && !side) toast('This captain link is not valid — you are watching as a spectator.', 'error');

  const root = h('div', { class: 'page veto-page' });
  let selected = null, busy = false, lastIdx = -1;

  const act = async choice => {
    if (busy) return;
    busy = true;
    try {
      await state.store.vetoAct(vetoId, key, choice);
      selected = null;
      // the live update repaints; repaint now too in case it's slow
      const v = await state.store.getVeto(vetoId);
      const i = ev.data.vetoes.findIndex(x => x.id === vetoId);
      if (i >= 0) ev.data.vetoes[i] = v; else ev.data.vetoes.push(v);
      paint();
    } catch (e) { toast(e.message.replace(/^.*?:\s*/, ''), 'error'); }
    busy = false;
  };

  function paint() {
    const v = ev.data.vetoes.find(x => x.id === vetoId) || first;
    const st = vetoNext(v);
    const mine = side && st && st.team === side;
    const myTeam = sideTeam(v, side);
    clear(root).append(...[
      h('div', { class: 'veto-head' },
        h('div', { class: 'eyebrow' }, `${ev.event.name} · Map veto`),
        h('h1', {}, teamName(v.team_a), h('span', { class: 'vs' }, 'vs'), teamName(v.team_b)),
        h('div', { class: 'row' },
          h('span', { class: 'pill' }, side ? `Captain · ${teamName(myTeam)}` : 'Spectating'),
          h('span', { class: 'muted small' }, `${teamName(v.team_a)} starts the veto`))),
      vetoBanner(v, side),
      mine && st.kind === 'side' ? sidePicker(v, st) : null,
      h('div', { class: 'veto-layout' },
        h('div', { class: 'stack-sm' }, modesOf(v).map(mode => modeBlock(v, mode, mine && st.mode === mode && st.kind !== 'side' ? st : null))),
        h('aside', { class: 'stack-sm' },
          h('div', { class: 'eyebrow' }, 'Series'), vetoSeriesList(v),
          h('div', { class: 'eyebrow', style: { marginTop: '1rem' } }, 'Log'), log(v))),
      selected && mine ? confirmBar(st) : null].filter(Boolean));
    // bring the captain to the right section when their turn starts
    const idx = v.actions.length;
    if (mine && idx !== lastIdx) root.querySelector('.veto-mode.active, .side-picker')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    lastIdx = idx;
  }

  function modeBlock(v, mode, activeStep) {
    return h('section', { class: `veto-mode ${activeStep ? 'active' : ''}` },
      h('div', { class: 'block-head' }, h('h2', {}, mode), activeStep ? h('span', { class: 'pill pill-demo' }, activeStep.kind === 'ban' ? 'Ban one' : `Pick Map ${activeStep.slot}`) : null),
      h('div', { class: 'veto-maps' }, mapStates(v, mode).map(ms => {
        const clickable = activeStep && ms.state === 'open';
        return h(clickable ? 'button' : 'div', {
          class: `veto-map ${ms.state} ${selected === ms.map && activeStep ? 'selected' : ''} ${clickable ? 'can' : ''}`,
          onclick: clickable ? () => { selected = ms.map; paint(); } : null,
        },
        h('span', { class: 'vm-name' }, ms.map),
        h('span', { class: 'vm-state' }, ms.state === 'banned' ? `Banned · ${teamTag(sideTeam(v, ms.team))}`
          : ms.state === 'picked' ? (ms.decider ? `Map ${ms.slot} · decider` : `Map ${ms.slot} · ${teamTag(sideTeam(v, ms.team))} pick`) : clickable ? 'Tap to select' : 'Available'));
      })));
  }

  function sidePicker(v, st) {
    const map = vetoSeries(v).find(s => s.slot === st.slot);
    return h('section', { class: 'side-picker' },
      h('div', { class: 'small muted' }, `Map ${st.slot} · ${map?.mode} · ${map?.map}`),
      h('div', { class: 'side-buttons' }, st.options.map(o => h('button', { class: 'btn btn-lg', onclick: () => act(o) }, o))));
  }

  function confirmBar(st) {
    const verb = st.kind === 'ban' ? `Ban ${selected}` : `Pick ${selected} for Map ${st.slot}`;
    return h('div', { class: 'confirm-bar' },
      h('button', { class: 'btn btn-ghost', onclick: () => { selected = null; paint(); } }, 'Cancel'),
      h('button', { class: `btn btn-lg ${st.kind === 'ban' ? 'btn-danger' : 'btn-primary'}`, onclick: () => act(selected) }, verb));
  }

  function log(v) {
    if (!v.actions.length) return h('div', { class: 'muted small' }, 'Nothing yet.');
    return h('ol', { class: 'veto-log' }, [...v.actions].reverse().map(a => h('li', {},
      h('b', {}, a.team ? teamTag(sideTeam(v, a.team)) : 'Auto'),
      a.kind === 'ban' ? ` banned ${a.choice}` : a.kind === 'side' ? ` chose ${a.choice} on Map ${a.slot}` : a.kind === 'decider' ? ` — ${a.choice} is the decider (Map ${a.slot})` : ` picked ${a.choice} for Map ${a.slot}`,
      h('span', { class: 'muted' }, ` · ${a.mode === 'Search & Destroy' ? 'SnD' : a.mode}`))));
  }

  paint();
  watchEvent(() => { if (root.isConnected) paint(); });
  return root;
}

// ---------- admin panel on the match page ----------
export function vetoAdminPanel(m, r) {
  const wrap = h('section', { class: 'block' });
  const draw = async () => {
    const v = ev.data.vetoes.find(x => x.match_id === m.id);
    clear(wrap).append(h('div', { class: 'block-head' }, h('h2', {}, 'Map veto'), v ? h('span', { class: `status status-${v.status === 'done' ? 'final' : v.status === 'active' ? 'live' : 'scheduled'}` }, v.status === 'done' ? 'Complete' : v.status === 'active' ? 'In progress' : 'Not started') : null));
    if (!v) {
      if (!ev.isAdmin) { wrap.append(h('div', { class: 'empty-sm' }, 'No veto yet.')); return; }
      const seedOf = id => ev.teamById.get(id)?.seed ?? 99;
      const higher = seedOf(r.A) <= seedOf(r.B) ? r.A : r.B;
      const first = h('select', {}, [r.A, r.B].map(id => h('option', { value: id, selected: id === higher }, teamName(id))));
      wrap.append(h('div', { class: 'row' },
        h('label', { class: 'inline' }, 'Team A (starts the veto)', first),
        h('button', {
          class: 'btn btn-primary', onclick: async () => {
            try {
              const { buildVetoSteps, autoAdvance, randomKey } = await import('../veto.js');
              const steps = buildVetoSteps(ev.settings, m.best_of);
              const pools = Object.fromEntries([...new Set(steps.map(s => s.mode))].map(md => [md, ev.settings.maps[md] || []]));
              const a = first.value, b = a === r.A ? r.B : r.A;
              const row = autoAdvance({ id: crypto.randomUUID(), event_id: ev.event.id, match_id: m.id, team_a: a, team_b: b, steps, pools, actions: [] });
              row.updated_at = new Date().toISOString();
              await state.store.evUpsert('event_vetoes', row);
              await state.store.evUpsert('event_veto_keys', { veto_id: row.id, event_id: ev.event.id, key_a: randomKey(), key_b: randomKey() });
              ev.data.vetoes.push(row);
              draw();
            } catch (e) { toast(e.message, 'error'); }
          },
        }, 'Create veto links')),
      h('p', { class: 'hint' }, `Uses the ${ev.settings.mode_order.slice(0, m.best_of).join(' → ')} order and each mode's map pool from Setup. The higher seed is Team A by default.`));
      return;
    }
    wrap.append(vetoBanner(v));
    if (ev.isAdmin) {
      const keys = await state.store.vetoKeys(v.id);
      const base = `${location.origin}${location.pathname}#/veto/${v.id}`;
      const linkRow = (label, url) => h('div', { class: 'link-row' }, h('span', { class: 'lr-label' }, label), h('code', { class: 'url' }, url),
        h('button', { class: 'btn btn-sm', onclick: () => { navigator.clipboard.writeText(url); toast('Link copied'); } }, 'Copy'));
      wrap.append(h('div', { class: 'stack-sm' },
        keys ? linkRow(`Captain · ${teamName(v.team_a)}`, `${base}?k=${keys.key_a}`) : null,
        keys ? linkRow(`Captain · ${teamName(v.team_b)}`, `${base}?k=${keys.key_b}`) : null,
        linkRow('Spectators', base),
        h('p', { class: 'hint' }, 'Send each captain only their own link. When the veto finishes, the maps fill into this match automatically.'),
        h('div', { class: 'row' },
          h('a', { class: 'btn btn-sm', href: `#/veto/${v.id}`, target: '_blank', rel: 'noopener' }, 'Watch ↗'),
          h('button', {
            class: 'btn btn-sm btn-ghost', onclick: async () => {
              const { eventSettings } = await import('../event-state.js');
              const d = eventSettings(ev.event).display;
              await state.store.updateEvent(ev.event.id, { settings: { ...ev.event.settings, display: { ...d, pin: 'veto', pin_veto: v.id } } });
              toast('Display now shows this veto. Unpin from the Control room.');
            },
          }, 'Show on display'),
          h('button', {
            class: 'btn btn-sm btn-ghost btn-danger-text', onclick: async () => {
              const { confirmDialog } = await import('../ui.js');
              if (!(await confirmDialog('Delete this veto and its links? Maps already filled into the match stay.', 'Reset veto'))) return;
              await state.store.evDelete('event_vetoes', v.id);
              ev.data.vetoes = ev.data.vetoes.filter(x => x.id !== v.id);
              draw();
            },
          }, 'Reset veto'))));
    }
    wrap.append(vetoSeriesList(v));
  };
  draw();
  return wrap;
}

export { eventPath };
