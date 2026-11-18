// Map veto page for captains (link with ?k=<key>) and spectators (no key).
import { h, clear, toast } from '../ui.js';
import { state } from '../state.js';
import { ev, loadEvent, watchEvent, teamName, teamTag, eventPath } from '../event-state.js';
import { vetoNext, vetoSeries, mapStates, stepLabel, sideOptions } from '../veto.js';
import { applyAccent, applyFont } from '../theme.js';

const modesOf = v => [...new Set(v.steps.map(s => s.mode))];
const sideTeam = (v, side) => (side === 'a' ? v.team_a : side === 'b' ? v.team_b : null);

/** Map 1…5 list for a veto: mode, map, who picked it, starting side. */
export function vetoSeriesList(v, { large = false } = {}) {
  return h('div', { class: `veto-series ${large ? 'large' : ''}` }, vetoSeries(v).map(s => h('div', { class: `vs-row ${s.map ? 'set' : ''}` },
    h('span', { class: 'vs-slot' }, `Map ${s.slot}`),
    h('span', { class: 'vs-mode' }, s.mode),
    h('span', { class: 'vs-map' }, s.map || '—'),
    h('span', { class: 'vs-by' }, s.by === 'decider' ? 'Decider' : s.by ? `${teamTag(sideTeam(v, s.by))} pick` : s.map && v.source === 'in_person' ? 'In person' : ''),
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
          side && ev.myTeam ? h('a', { class: 'btn btn-sm btn-ghost', href: `#/e/${ev.event.id}/me` }, '← My team') : null,
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
      h('span', { class: 'muted' }, ` · ${a.mode === 'Search & Destroy' ? 'SnD' : a.mode}`),
      a.staff ? h('span', { class: 'chip chip-xs' }, 'staff') : null)));
  }

  paint();
  watchEvent(() => { if (root.isConnected) paint(); });
  return root;
}

// ---------- admin panel on the match page ----------
// Three ways to set a match's maps:
//   1. Captain links (online)      – each captain vetoes from their phone
//   2. Staff runs it at the desk   – same veto, staff clicks for whichever team is up
//   3. In person                   – teams veto on paper / out loud, staff types in the maps
// Staff can switch any time: act for a team, undo a step, or overwrite with in-person maps.
export function vetoAdminPanel(m, r) {
  const wrap = h('section', { class: 'block veto-admin' });
  let manual = false;

  const save = async v => {
    v.updated_at = new Date().toISOString();
    await state.store.evUpsert('event_vetoes', v);
    const i = ev.data.vetoes.findIndex(x => x.id === v.id);
    if (i >= 0) ev.data.vetoes[i] = v; else ev.data.vetoes.push(v);
    if (v.status === 'done') await writeMaps(v);
  };
  // fill the match's maps (keeps scores already entered)
  const writeMaps = async v => {
    const { vetoMaps } = await import('../veto.js');
    const games = ev.data.games.filter(g => g.match_id === m.id);
    const rows = vetoMaps(v).map(x => {
      const g = games.find(y => y.game_no === x.slot);
      return { ...(g || { id: crypto.randomUUID(), event_id: ev.event.id, match_id: m.id, game_no: x.slot, a_score: null, b_score: null }), map: x.map, mode: x.mode };
    });
    if (rows.length) await state.store.evUpsert('event_games', rows);
    const { refreshEvent } = await import('../event-state.js');
    await refreshEvent();
  };
  const create = async source => {
    const { buildVetoSteps, autoAdvance, randomKey } = await import('../veto.js');
    const steps = buildVetoSteps(ev.settings, m.best_of);
    const pools = Object.fromEntries([...new Set(steps.map(s => s.mode))].map(md => [md, ev.settings.maps[md] || []]));
    const a = firstSel?.value || r.A, b = a === r.A ? r.B : r.A;
    const row = autoAdvance({ id: crypto.randomUUID(), event_id: ev.event.id, match_id: m.id, team_a: a, team_b: b, steps, pools, actions: [], source });
    await save(row);
    await state.store.evUpsert('event_veto_keys', { veto_id: row.id, event_id: ev.event.id, key_a: randomKey(), key_b: randomKey() });
    return row;
  };
  let firstSel = null;

  const draw = async () => {
    const v = ev.data.vetoes.find(x => x.match_id === m.id);
    const statusTxt = !v ? null : v.status === 'done' ? (v.source === 'in_person' ? 'Set in person' : 'Complete') : v.status === 'active' ? 'In progress' : 'Not started';
    clear(wrap).append(h('div', { class: 'block-head' }, h('h2', {}, 'Map veto'),
      v ? h('span', { class: `status status-${v.status === 'done' ? 'final' : v.status === 'active' ? 'live' : 'scheduled'}` }, statusTxt) : null,
      v && v.source === 'staff' ? h('span', { class: 'chip' }, 'Run at the desk') : v && v.actions.some(a => a.staff) && v.source !== 'in_person' ? h('span', { class: 'chip' }, 'Staff override used') : null));

    if (!ev.isAdmin) {
      wrap.append(v ? h('div', { class: 'stack-sm' }, vetoBanner(v), vetoSeriesList(v)) : h('div', { class: 'empty-sm' }, 'No veto yet.'));
      return;
    }
    if (manual) { wrap.append(manualForm(v)); return; }

    if (!v) {
      const seedOf = id => ev.teamById.get(id)?.seed ?? 99;
      const higher = seedOf(r.A) <= seedOf(r.B) ? r.A : r.B;
      firstSel = h('select', {}, [r.A, r.B].map(id => h('option', { value: id, selected: id === higher }, teamName(id))));
      const inPerson = ev.settings.veto_method === 'in_person';
      const btn = (label, cls, fn, tip) => h('button', { class: `btn ${cls}`, 'data-tip': tip, onclick: async () => { try { await fn(); draw(); } catch (e) { toast(e.message, 'error'); } } }, label);
      wrap.append(
        h('div', { class: 'row wrap' },
          h('label', { class: 'inline' }, 'Team A (starts the veto)', firstSel)),
        h('div', { class: 'veto-choices' },
          btn('Create captain links', inPerson ? '' : 'btn-primary', () => create('online'), 'Each captain gets a link and vetoes from their phone'),
          btn('Run the veto at the desk', '', () => create('staff'), 'Same veto, but staff clicks for whichever team is up'),
          btn('Enter maps (veto done in person)', inPerson ? 'btn-primary' : '', async () => { manual = true; }, 'Teams decided out loud or on paper. Type in the maps and sides.')),
        h('p', { class: 'hint' }, `Uses the ${ev.settings.mode_order.slice(0, m.best_of).join(' → ')} order and each mode's map pool from Setup. The higher seed is Team A by default.`));
      return;
    }

    wrap.append(vetoBanner(v));
    if (v.status !== 'done') wrap.append(staffBox(v));

    if (v.source !== 'in_person') {
      const keys = await state.store.vetoKeys(v.id);
      const base = `${location.origin}${location.pathname}#/veto/${v.id}`;
      const linkRow = (label, url) => h('div', { class: 'link-row' }, h('span', { class: 'lr-label' }, label), h('code', { class: 'url' }, url),
        h('button', { class: 'btn btn-sm', onclick: () => { navigator.clipboard.writeText(url); toast('Link copied'); } }, 'Copy'));
      const links = h('div', { class: 'stack-sm' },
        keys ? linkRow(`Captain · ${teamName(v.team_a)}`, `${base}?k=${keys.key_a}`) : null,
        keys ? linkRow(`Captain · ${teamName(v.team_b)}`, `${base}?k=${keys.key_b}`) : null,
        linkRow('Spectators', base),
        h('p', { class: 'hint' }, 'Send each captain only their own link. When the veto finishes, the maps fill into this match automatically.'));
      wrap.append(v.source === 'staff' || v.status === 'done' ? h('details', {}, h('summary', {}, 'Captain and spectator links'), links) : links);
    }
    wrap.append(vetoSeriesList(v),
      h('div', { class: 'row wrap' },
        h('a', { class: 'btn btn-sm', href: `#/veto/${v.id}`, target: '_blank', rel: 'noopener' }, 'Watch ↗'),
        h('button', {
          class: 'btn btn-sm btn-ghost', onclick: async () => {
            const { eventSettings } = await import('../event-state.js');
            const d = eventSettings(ev.event).display;
            await state.store.updateEvent(ev.event.id, { settings: { ...ev.event.settings, display: { ...d, pin: 'veto', pin_veto: v.id } } });
            toast('Display now shows this veto. Unpin from the Control panel.');
          },
        }, 'Show on display'),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { manual = true; draw(); } }, v.status === 'done' ? 'Edit maps' : 'Override: enter maps from in person'),
        h('button', {
          class: 'btn btn-sm btn-ghost btn-danger-text', onclick: async () => {
            const { confirmDialog } = await import('../ui.js');
            if (!(await confirmDialog('Delete this veto and its links? Maps already filled into the match stay.', 'Reset veto'))) return;
            await state.store.evDelete('event_vetoes', v.id);
            ev.data.vetoes = ev.data.vetoes.filter(x => x.id !== v.id);
            draw();
          },
        }, 'Reset veto')));
  };

  // staff makes the next choice for whichever team is up
  function staffBox(v) {
    const st = vetoNext(v);
    if (!st) return null;
    const who = teamName(sideTeam(v, st.team));
    const act = async choice => {
      try {
        const { staffAct } = await import('../veto.js');
        await save(staffAct(v, choice));
        toast(`${who}: ${choice}`, 'success'); draw();
      } catch (e) { toast(e.message, 'error'); }
    };
    const undo = async () => {
      const { undoVeto } = await import('../veto.js');
      await save(undoVeto(v)); toast('Last choice undone'); draw();
    };
    const choices = st.kind === 'side' ? st.options : mapStates(v, st.mode).filter(x => x.state === 'open').map(x => x.map);
    return h('div', { class: `staff-box ${v.source === 'staff' ? 'open' : ''}` },
      h('div', { class: 'row' }, h('span', { class: 'eyebrow' }, v.source === 'staff' ? 'Staff veto' : 'Override'),
        h('span', { class: 'small' }, `Choose for `, h('strong', {}, who), ` — ${stepLabel(st)}`),
        h('span', { class: 'spacer' }),
        v.actions.length ? h('button', { class: 'btn btn-sm btn-ghost', onclick: undo }, '↶ Undo last') : null),
      h('div', { class: 'staff-maps' }, choices.map(c => h('button', {
        class: `btn btn-sm ${st.kind === 'ban' ? 'is-ban' : ''}`, 'data-submit': '', onclick: () => act(c),
      }, st.kind === 'ban' ? `Ban ${c}` : st.kind === 'side' ? c : `Pick ${c}`))),
      v.source !== 'staff' ? h('p', { class: 'hint' }, 'Use this if a captain can’t open their link or the teams call it out loud. Each staff choice is marked in the log.') : null);
  }

  // type in the maps the teams agreed in person
  function manualForm(v) {
    const s = ev.settings;
    const games = ev.data.games.filter(g => g.match_id === m.id);
    const series = v ? vetoSeries(v) : [];
    const A = v?.team_a || r.A, B = v?.team_b || r.B;
    const rows = Array.from({ length: m.best_of }, (_, i) => {
      const slot = i + 1;
      const fromVeto = series.find(x => x.slot === slot);
      const g = games.find(x => x.game_no === slot);
      return {
        slot, mode: fromVeto?.mode || g?.mode || s.mode_order[i % s.mode_order.length] || s.modes[0],
        map: fromVeto?.map || g?.map || '', sideTeam: fromVeto?.side?.team || '', side: fromVeto?.side?.choice || '',
      };
    });
    const lists = s.modes.map(mode => h('datalist', { id: `vm-${mode.replace(/\W/g, '')}` }, (s.maps[mode] || []).map(x => h('option', { value: x }))));
    const table = h('table', { class: 'data tight manual-veto' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Map'), h('th', {}, 'Mode'), h('th', {}, 'Map name'), h('th', {}, 'Side chosen by'), h('th', {}, 'Starting side'))),
      h('tbody', {}, rows.map(x => {
        const sideSel = h('select', { onchange: e => { x.side = e.target.value; } });
        const fillSides = () => {
          const opts = sideOptionsFor(x.mode);
          clear(sideSel).append(h('option', { value: '' }, '—'), ...opts.map(o => h('option', { value: o, selected: x.side === o }, o)));
        };
        fillSides();
        const mapIn = h('input', { list: `vm-${x.mode.replace(/\W/g, '')}`, value: x.map, placeholder: 'Map', oninput: e => { x.map = e.target.value.trim(); } });
        return h('tr', {},
          h('td', { class: 'num' }, x.slot),
          h('td', {}, h('select', { onchange: e => { x.mode = e.target.value; mapIn.setAttribute('list', `vm-${x.mode.replace(/\W/g, '')}`); fillSides(); } }, s.modes.map(md => h('option', { value: md, selected: x.mode === md }, md)))),
          h('td', {}, mapIn),
          h('td', {}, h('select', { onchange: e => { x.sideTeam = e.target.value; } }, h('option', { value: '' }, '—'),
            h('option', { value: 'a', selected: x.sideTeam === 'a' }, teamName(A)), h('option', { value: 'b', selected: x.sideTeam === 'b' }, teamName(B)))),
          h('td', {}, sideSel));
      })));
    return h('div', { class: 'stack-sm' }, ...lists,
      h('p', { class: 'small muted' }, 'Type the maps the teams agreed on. Leave a map blank if it isn’t decided yet. Saving fills them into this match and replaces any online veto.'),
      h('div', { class: 'table-wrap' }, table),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-ghost', onclick: () => { manual = false; draw(); } }, 'Cancel'),
        h('button', {
          class: 'btn btn-primary', onclick: async () => {
            if (!rows.some(x => x.map)) return toast('Enter at least one map', 'error');
            const { manualVeto } = await import('../veto.js');
            const base = v ? { ...v } : { id: crypto.randomUUID(), event_id: ev.event.id, match_id: m.id, team_a: A, team_b: B, pools: {} };
            await save(manualVeto(base, rows.map(x => ({ ...x, sideTeam: x.sideTeam || null, side: x.side || null })), s));
            manual = false; toast('Maps saved to the match', 'success'); draw();
          },
        }, 'Save maps')));
  }
  const sideOptionsFor = mode => sideOptions(ev.settings, mode);

  // live updates refresh the panel, but never while staff is typing maps in
  wrap.refresh = () => { if (!manual) draw(); };
  draw();
  return wrap;
}

export { eventPath };
