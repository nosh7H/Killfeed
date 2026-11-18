// Map veto (pick/ban) logic — pure, shared by the demo store and mirrored by the
// veto_act() function in supabase/schema.sql.
//
// A veto has:
//   steps   [{ kind: 'ban'|'pick'|'decider'|'side', team: 'a'|'b'|null, mode, slot?, options? }]
//   pools   { [mode]: [map, …] }            (snapshot of the event map pool)
//   actions [{ i, kind, mode, team, choice, slot, at }]
//   team_a / team_b  — event team ids. Team A is usually the higher seed.

export const DEFAULT_SIDES = { 'Search & Destroy': ['Attack', 'Defense'], '*': ['Side A', 'Side B'] };

export function sideOptions(settings, mode) {
  const s = { ...DEFAULT_SIDES, ...(settings.veto_sides || {}) };
  return s[mode] || s['*'];
}

const other = t => (t === 'a' ? 'b' : 'a');

/**
 * CDL-style veto for a series:
 *  - Modes are vetoed in order of first appearance (HP, then S&D, then the third mode).
 *  - Team A starts the first mode, Team B the second, Team A the third, …
 *  - Modes played twice: each team bans one, then the starter picks the first map of that
 *    mode (other team picks side) and the other team picks the second (starter picks side).
 *  - Modes played once: teams alternate bans until one map is left (the decider);
 *    the team that did not make the last ban picks side.
 */
export function buildVetoSteps(settings, bestOf) {
  const order = Array.from({ length: bestOf }, (_, i) => settings.mode_order[i % settings.mode_order.length]);
  const modes = [...new Set(order)];
  const steps = [];
  modes.forEach((mode, mi) => {
    const slots = order.map((m, i) => (m === mode ? i + 1 : null)).filter(Boolean);
    const pool = settings.maps?.[mode] || [];
    if (pool.length < slots.length) throw new Error(`${mode} needs at least ${slots.length} map${slots.length === 1 ? '' : 's'} in its map pool (Setup → Format).`);
    const starter = mi % 2 ? 'b' : 'a';
    const sides = sideOptions(settings, mode);
    if (slots.length === 1) {
      let left = pool.length, t = starter;
      while (left > 1) { steps.push({ kind: 'ban', team: t, mode }); t = other(t); left--; }
      steps.push({ kind: 'decider', team: null, mode, slot: slots[0] });
      steps.push({ kind: 'side', team: t, mode, slot: slots[0], options: sides });
    } else {
      const bans = Math.max(0, Math.min(2, pool.length - slots.length));
      let t = starter;
      for (let i = 0; i < bans; i++) { steps.push({ kind: 'ban', team: t, mode }); t = other(t); }
      let pt = starter;
      slots.forEach((slot, i) => {
        const left = pool.length - bans - i;
        if (i === slots.length - 1 && left === 1) steps.push({ kind: 'decider', team: null, mode, slot });
        else steps.push({ kind: 'pick', team: pt, mode, slot });
        steps.push({ kind: 'side', team: other(pt), mode, slot, options: sides });
        pt = other(pt);
      });
    }
  });
  return steps;
}

export const vetoNext = v => v.steps[v.actions.length] || null;
export const usedMaps = (v, mode) => v.actions.filter(a => a.mode === mode && a.kind !== 'side').map(a => a.choice);
export const available = (v, mode) => (v.pools[mode] || []).filter(m => !usedMaps(v, mode).includes(m));

/** Fill in decider maps that are forced (only one left), and set status. Mutates v. */
export function autoAdvance(v) {
  let st;
  while ((st = vetoNext(v)) && st.kind === 'decider') {
    const left = available(v, st.mode);
    if (left.length !== 1) break;
    v.actions.push({ i: v.actions.length, kind: 'decider', mode: st.mode, team: null, choice: left[0], slot: st.slot, at: new Date().toISOString() });
  }
  v.status = v.actions.length >= v.steps.length ? 'done' : v.actions.length ? 'active' : 'pending';
  return v;
}

/** Validate and apply one captain action. Returns a new veto object. */
export function applyVeto(veto, side, choice) {
  const v = { ...veto, actions: [...veto.actions] };
  const st = vetoNext(v);
  if (!st) throw new Error('The veto is already finished.');
  if (st.team !== side) throw new Error('It is not your turn.');
  if (st.kind === 'side') {
    if (!st.options.includes(choice)) throw new Error('Pick one of the listed sides.');
  } else if (!available(v, st.mode).includes(choice)) {
    throw new Error('That map is no longer available.');
  }
  v.actions.push({ i: v.actions.length, kind: st.kind, mode: st.mode, team: side, choice, slot: st.slot ?? null, at: new Date().toISOString() });
  return autoAdvance(v);
}

/** Series map list: [{ slot, mode, map, by, side: { team, choice } }] */
export function vetoSeries(v) {
  const slots = [...new Set(v.steps.filter(s => s.slot).map(s => s.slot))].sort((a, b) => a - b);
  return slots.map(slot => {
    const step = v.steps.find(s => s.slot === slot && s.kind !== 'side');
    const pick = v.actions.find(a => a.slot === slot && a.kind !== 'side');
    const side = v.actions.find(a => a.slot === slot && a.kind === 'side');
    return { slot, mode: step.mode, map: pick?.choice || null, by: pick ? (pick.kind === 'decider' ? 'decider' : pick.team) : null, side: side ? { team: side.team, choice: side.choice } : null };
  });
}

/** Status of each map in a mode's pool: { map, state: 'open'|'banned'|'picked', team, slot } */
export function mapStates(v, mode) {
  return (v.pools[mode] || []).map(map => {
    const a = v.actions.find(x => x.mode === mode && x.kind !== 'side' && x.choice === map);
    if (!a) return { map, state: 'open' };
    return { map, state: a.kind === 'ban' ? 'banned' : 'picked', team: a.team, slot: a.slot, decider: a.kind === 'decider' };
  });
}

export function stepLabel(st) {
  if (!st) return 'Veto complete';
  if (st.kind === 'ban') return `ban a ${st.mode} map`;
  if (st.kind === 'pick') return `pick the ${st.mode} map for Map ${st.slot}`;
  if (st.kind === 'side') return `choose a starting side for Map ${st.slot}`;
  return `Map ${st.slot} decider`;
}

export function randomKey() {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
}

// ---------- staff overrides (veto done in person / at the admin desk) ----------

/** Staff makes the next choice for whichever team is up. Marks the action as staff-entered. */
export function staffAct(veto, choice) {
  const st = vetoNext(veto);
  if (!st) throw new Error('The veto is already finished.');
  const i = veto.actions.length;
  const v = applyVeto(veto, st.team, choice);
  v.actions[i] = { ...v.actions[i], staff: true };
  return v;
}

/** Take back the last choice (and any decider that was filled in automatically after it). */
export function undoVeto(veto) {
  const actions = [...veto.actions];
  while (actions.length && actions[actions.length - 1].kind === 'decider') actions.pop();
  actions.pop();
  return { ...veto, actions, status: actions.length ? 'active' : 'pending' };
}

/**
 * A veto the teams did in person: staff types in each map (and optional starting side).
 * entries: [{ slot, mode, map, sideTeam: 'a'|'b'|null, side: string|null }]
 */
export function manualVeto(base, entries, settings = {}) {
  const steps = [], actions = [], at = new Date().toISOString();
  const sorted = [...entries].filter(e => e.map).sort((x, y) => x.slot - y.slot);
  for (const e of sorted) {
    steps.push({ kind: 'pick', team: null, mode: e.mode, slot: e.slot });
    actions.push({ i: actions.length, kind: 'pick', mode: e.mode, team: null, choice: e.map, slot: e.slot, at, staff: true });
    if (e.side && e.sideTeam) {
      steps.push({ kind: 'side', team: e.sideTeam, mode: e.mode, slot: e.slot, options: sideOptions(settings, e.mode) });
      actions.push({ i: actions.length, kind: 'side', mode: e.mode, team: e.sideTeam, choice: e.side, slot: e.slot, at, staff: true });
    }
  }
  const modes = [...new Set(sorted.map(e => e.mode))];
  const pools = { ...(base.pools || {}) };
  for (const m of modes) pools[m] = [...new Set([...(pools[m] || settings.maps?.[m] || []), ...sorted.filter(e => e.mode === m).map(e => e.map)])];
  return { ...base, steps, actions, pools, status: 'done', source: 'in_person' };
}

/** Maps decided by a veto, ready to write into the match: [{ slot, mode, map }]. */
export function vetoMaps(v) {
  return v.actions.filter(a => a.kind === 'pick' || a.kind === 'decider').map(a => ({ slot: a.slot, mode: a.mode, map: a.choice }));
}
