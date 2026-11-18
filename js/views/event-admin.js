// Event admin: Setup (format, teams, groups, playoffs, display). Control panel + rows live in event-control.js.
import { h, clear, toast, confirmDialog, uid, download } from '../ui.js';
import { state, go } from '../state.js';
import { ev, eventPath, refreshEvent, eventSettings, teamName, groupsFor, teamBadge, exportEvent, DEFAULT_EVENT_SETTINGS, finalDayName } from '../event-state.js';
import { snakeGroups, roundRobin, buildBracket, GROUP_LABELS, TIEBREAKERS, pace, EST_DEFAULTS, roundKey, roundName } from '../event-logic.js';
import { eventShell } from './event.js';
import { FONT_STYLES, DEFAULT_ACCENT, applyFont } from '../theme.js';
import { MAP_POOL } from '../config.js';

const lines = v => [...new Set(String(v || '').split('\n').map(s => s.trim()).filter(Boolean))];

function notAdmin(sub) { return eventShell(sub, h('div', { class: 'empty' }, h('p', {}, 'Only event admins can see this page.'))); }

async function saveSettings(patch) {
  const s = { ...eventSettings(ev.event), ...patch };
  await state.store.updateEvent(ev.event.id, { settings: s });
  await refreshEvent();
}

// =====================================================================
// SETUP
// =====================================================================
export function eventSetup() {
  if (!ev.isAdmin) return notAdmin('setup');
  const root = h('div');
  const paint = () => clear(root).append(eventShell('setup', h('div', { class: 'stack' },
    infoPanel(), formatPanel(), teamsPanel(), accessPanel(), stagePanel(), tiebreakPanel(), timesPanel(), displayNote(), dangerPanel())));

  // ---- event info ----
  function infoPanel() {
    const e = ev.event;
    const name = h('input', { value: e.name, maxlength: 80 });
    const date = h('input', { type: 'date', value: e.starts_on || '' });
    const venue = h('input', { value: e.venue || '', placeholder: 'Venue / city' });
    const pub = h('input', { type: 'checkbox', checked: e.is_public !== false });
    const color = h('input', { type: 'color', value: e.accent || DEFAULT_ACCENT });
    const font = h('select', { onchange: ev2 => applyFont(ev2.target.value) }, FONT_STYLES.map(([k, l]) => h('option', { value: k, selected: (e.settings?.font || 'mix') === k }, l)));
    return panel('Event', null,
      h('div', { class: 'grid-4' }, h('label', {}, 'Name', name), h('label', {}, 'Date', date), h('label', {}, 'Venue', venue), h('label', {}, 'Accent color', color)),
      h('label', {}, 'Font style (website)', font),
      h('label', { class: 'check' }, pub, 'Public — anyone with the link can see stats, bracket and the display (no login)'),
      state.store.mode === 'cloud' ? h('p', { class: 'small' }, 'Admin code for helpers: ', (() => { const c = h('code', { class: 'invite' }, '········'); state.store.eventAdminCode(e.id).then(v => { c.textContent = v || '—'; }); return c; })(),
        h('span', { class: 'muted' }, ' — they sign in, open Events and choose “Help run an event”.')) : null,
      h('div', {}, h('button', {
        class: 'btn btn-primary', onclick: async () => {
          await state.store.updateEvent(e.id, { name: name.value.trim() || e.name, starts_on: date.value || null, venue: venue.value.trim() || null, is_public: pub.checked, accent: color.value, settings: { ...eventSettings(ev.event), font: font.value } });
          await refreshEvent(); toast('Saved', 'success'); paint();
        },
      }, 'Save')));
  }

  // ---- format, modes, maps, stations ----
  function formatPanel() {
    const s = ev.settings;
    const num = (v, min, max) => h('input', { type: 'number', min, max, value: v, class: 'in-num' });
    const groups = h('select', {}, h('option', { value: 'auto', selected: s.groups === 'auto' }, `Auto (${groupsFor()} for ${ev.data.teams.length} teams)`),
      [1, 2, 3, 4, 5, 6, 7, 8].map(n => h('option', { value: n, selected: String(s.groups) === String(n) }, n)));
    const advance = h('select', {}, h('option', { value: 'all', selected: s.advance === 'all' }, 'All teams'),
      [1, 2, 3, 4, 5, 6].map(n => h('option', { value: n, selected: String(s.advance) === String(n) }, `Top ${n} per group`)));
    const gbo = num(s.group_bo, 1, 9), pbo = num(s.playoff_bo, 1, 9), fbo = num(s.final_bo, 1, 9);
    const bracket = h('select', {}, h('option', { value: 'double', selected: s.bracket === 'double' }, 'Double elimination'), h('option', { value: 'single', selected: s.bracket === 'single' }, 'Single elimination'));
    const modes = h('textarea', { rows: 4 }, s.modes.join('\n'));
    const order = h('input', { value: s.mode_order.join(', ') });
    const caster = h('select', {},
      h('option', { value: 'none', selected: s.caster === 'none' }, 'No caster — player POV stats only'),
      h('option', { value: 'some', selected: (s.caster || 'some') === 'some' }, 'Some matches — tick “Casted” per match'),
      h('option', { value: 'all', selected: s.caster === 'all' }, 'Every match is casted'));
    const vetoM = h('select', {}, h('option', { value: 'online', selected: s.veto_method !== 'in_person' }, 'Captain links (online)'), h('option', { value: 'in_person', selected: s.veto_method === 'in_person' }, 'In person (staff enters the maps)'));
    const maps = Object.fromEntries(s.modes.map(m => [m, h('textarea', { rows: 5, placeholder: 'One map per line' }, (s.maps[m] || []).join('\n'))]));
    return panel('Format', 'Groups, bracket, series length, modes and maps',
      h('div', { class: 'grid-6' },
        h('label', {}, 'Groups', groups), h('label', {}, 'To playoffs', advance), h('label', {}, 'Playoffs', bracket),
        h('label', {}, 'Group Bo', gbo), h('label', {}, 'Playoff Bo', pbo), h('label', {}, 'Grand final Bo', fbo)),
      h('div', { class: 'grid-3' },
        h('label', {}, 'Modes', modes, h('span', { class: 'hint' }, 'One per line.')),
        h('div', { class: 'field' }, h('span', {}, 'Rows'), h('p', { class: 'hint' }, 'Pin teams to their group-stage rows and set bracket rows on ', h('a', { href: eventPath('seating') }, 'Rows'), '.'),
          h('label', {}, 'Default veto', vetoM, h('span', { class: 'hint' }, 'Staff can always override or switch a single match on its page.')),
          h('label', {}, 'Caster stats', caster, h('span', { class: 'hint' }, 'Player POV scoreboards show kills, deaths, hill time, plants and defuses. Damage, assists, non-traded kills, streaks, hill details and first bloods need a caster POV.'))),
        h('label', {}, 'Mode order per series', order, h('span', { class: 'hint' }, 'Comma separated. Repeats for longer series.'))),
      h('div', { class: 'grid-3' }, s.modes.map(m => h('label', {}, `${m} maps`, maps[m]))),
      h('div', {}, h('button', {
        class: 'btn btn-sm btn-ghost', 'data-tip': 'Fill each mode with the current competitive pool (then Save format)',
        onclick: () => { for (const m of s.modes) if (MAP_POOL[m] && maps[m]) maps[m].value = MAP_POOL[m].join('\n'); toast('Current map pool filled in — click Save format'); },
      }, 'Use current map pool')),
      h('div', {}, h('button', {
        class: 'btn btn-primary', onclick: async () => {
          const ms = lines(modes.value);
          await saveSettings({
            groups: groups.value === 'auto' ? 'auto' : +groups.value, advance: advance.value === 'all' ? 'all' : +advance.value, bracket: bracket.value,
            group_bo: +gbo.value || 5, playoff_bo: +pbo.value || 5, final_bo: +fbo.value || 5,
            modes: ms, veto_method: vetoM.value, caster: caster.value,
            mode_order: order.value.split(',').map(x => x.trim()).filter(Boolean),
            maps: Object.fromEntries(ms.map(m => [m, maps[m] ? lines(maps[m].value) : (ev.settings.maps[m] || [])])),
          });
          toast('Format saved', 'success'); paint();
        },
      }, 'Save format')));
  }

  // ---- teams ----
  function teamsPanel() {
    const teams = ev.data.teams.slice().sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999) || a.name.localeCompare(b.name));
    const paste = h('textarea', { rows: 6, placeholder: 'Night Owls | NOWL | Kairo, Vexo, Trillo, Mendez\nVanta | VNTA | Player1, Player2, Player3, Player4' });
    const groupOpts = GROUP_LABELS.slice(0, groupsFor());
    return panel('Teams', `${teams.length} teams · seed order = list order`,
      teams.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data tight' },
        h('thead', {}, h('tr', {}, h('th', { class: 'num' }, 'Seed'), h('th', {}, 'Logo'), h('th', {}, 'Team'), h('th', {}, 'Tag'), h('th', {}, 'Color'), h('th', {}, 'Group'), h('th', {}, 'Roster (comma separated)'), h('th', {}))),
        h('tbody', {}, teams.map((t, i) => {
          const roster = ev.data.players.filter(p => p.team_id === t.id);
          const save = async patch => { await state.store.evUpsert('event_teams', { ...t, ...patch }); await refreshEvent(); };
          return h('tr', {},
            h('td', { class: 'num' }, h('input', { class: 'in-num', type: 'number', min: 1, value: t.seed ?? i + 1, onchange: e => save({ seed: +e.target.value || null }).then(paint) })),
            h('td', {}, h('label', { class: 'logo-pick', 'data-tip': 'Upload a logo (PNG with transparency works best)' }, teamBadge(t.id, 'md'),
              h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async e => {
                const f = e.target.files[0]; if (!f) return;
                try {
                  const blob = await squareLogo(f);
                  const path = await state.store.evUploadLogo(ev.event.id, t.id, blob);
                  await save({ logo_path: path }); toast('Logo saved', 'success'); paint();
                } catch (err) { toast(`Logo upload failed: ${err.message}`, 'error'); }
              } }))),
            h('td', {}, h('input', { value: t.name, onchange: e => save({ name: e.target.value.trim() || t.name }) })),
            h('td', {}, h('input', { value: t.tag || '', class: 'in-tag', maxlength: 6, onchange: e => save({ tag: e.target.value.trim().toUpperCase() || null }) })),
            h('td', {}, h('input', { type: 'color', class: 'in-color', value: t.color || '#3f3f46', onchange: e => save({ color: e.target.value }).then(paint) })),
            h('td', {}, h('select', { onchange: e => save({ group_label: e.target.value || null }).then(paint) },
              h('option', { value: '' }, '—'), groupOpts.map(g => h('option', { value: g, selected: t.group_label === g }, g)))),
            h('td', {}, h('input', {
              value: roster.map(p => p.gamertag).join(', '), class: 'in-wide',
              onchange: async e => {
                const want = e.target.value.split(',').map(x => x.trim()).filter(Boolean);
                const keep = roster.filter(p => want.some(w => w.toLowerCase() === p.gamertag.toLowerCase()));
                const add = want.filter(w => !roster.some(p => p.gamertag.toLowerCase() === w.toLowerCase()));
                const drop = roster.filter(p => !keep.includes(p)).map(p => p.id);
                if (drop.length) await state.store.evDelete('event_players', drop);
                if (add.length) await state.store.evUpsert('event_players', add.map(g => ({ event_id: ev.event.id, team_id: t.id, gamertag: g })));
                await refreshEvent(); toast('Roster saved');
              },
            })),
            h('td', {}, h('button', {
              class: 'icon-btn', 'aria-label': `Delete ${t.name}`, onclick: async () => {
                if (!(await confirmDialog(`Delete ${t.name} and its roster?`))) return;
                await state.store.evDelete('event_teams', t.id); await refreshEvent(); paint();
              },
            }, '✕')));
        })))) : null,
      h('details', { open: !teams.length },
        h('summary', {}, 'Add teams in bulk'),
        h('p', { class: 'hint' }, 'One team per line: Name | TAG | gamertags separated by commas. Tag and roster are optional.'),
        paste,
        h('button', {
          class: 'btn', onclick: async () => {
            const rows = lines(paste.value).map(l => l.split('|').map(x => x.trim()));
            if (!rows.length) return toast('Paste at least one team', 'error');
            let seed = teams.length;
            for (const [name, tag, roster] of rows) {
              if (!name) continue;
              const id = uid();
              await state.store.evUpsert('event_teams', { id, event_id: ev.event.id, name, tag: (tag || '').toUpperCase() || null, seed: ++seed, group_label: null });
              const tags = (roster || '').split(',').map(x => x.trim()).filter(Boolean);
              if (tags.length) await state.store.evUpsert('event_players', tags.map(g => ({ event_id: ev.event.id, team_id: id, gamertag: g })));
            }
            await refreshEvent(); toast(`Added ${rows.length} team${rows.length === 1 ? '' : 's'}`, 'success'); paint();
          },
        }, 'Add teams')));
  }

  // ---- group stage + playoffs ----
  function stagePanel() {
    const s = ev.settings;
    const groupMatches = ev.data.matches.filter(m => m.stage === 'group');
    const playoffMatches = ev.data.matches.filter(m => m.stage !== 'group');
    const played = ids => ev.data.games.some(g => ids.has(g.match_id));
    return panel('Stages', null,
      h('div', { class: 'steps' },
        step('1', 'Assign groups', `Snake by seed into ${groupsFor()} group${groupsFor() === 1 ? '' : 's'}${s.groups === 'auto' ? ' (auto: 2 up to 8 teams, 3 up to 12, 4 up to 16)' : ''}. You can still change groups per team above.`,
          h('button', {
            class: 'btn', onclick: async () => {
              const map = snakeGroups(ev.data.teams, groupsFor());
              await state.store.evUpsert('event_teams', ev.data.teams.map(t => ({ ...t, group_label: map[t.id] })));
              await refreshEvent(); toast('Groups assigned', 'success'); paint();
            },
          }, 'Auto-assign groups')),
        step('2', 'Generate group matches', groupMatches.length ? `${groupMatches.length} group matches exist. Regenerating replaces them.` : 'Round robin inside each group.',
          h('button', {
            class: 'btn', onclick: async () => {
              if (groupMatches.length) {
                const warn = played(new Set(groupMatches.map(m => m.id))) ? ' Results already entered will be deleted.' : '';
                if (!(await confirmDialog(`Replace all ${groupMatches.length} group matches?${warn}`, 'Replace'))) return;
                await state.store.evDelete('event_matches', groupMatches.map(m => m.id));
              }
              const rows = [];
              const byGroup = {};
              for (const t of ev.data.teams) if (t.group_label) (byGroup[t.group_label] ||= []).push(t);
              let q = 0;
              const maxRounds = Math.max(0, ...Object.values(byGroup).map(ts => roundRobin(ts.map(t => t.id)).length));
              const rr = Object.fromEntries(Object.entries(byGroup).map(([g, ts]) => [g, roundRobin(ts.sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99)).map(t => t.id))]));
              for (let r = 0; r < maxRounds; r++) {
                for (const g of Object.keys(rr).sort()) {
                  (rr[g][r] || []).forEach(([a, b], i) => rows.push({
                    event_id: ev.event.id, stage: 'group', group_label: g, round: r + 1, slot: i + 1, code: `G${g}${r + 1}-${i + 1}`,
                    team_a: a, team_b: b, best_of: s.group_bo, status: 'scheduled', queue_pos: ++q,
                  }));
                }
              }
              if (!rows.length) return toast('Assign teams to groups first', 'error');
              // match numbers: groups are 1, 2, 3 … in play order
              rows.forEach((m, i) => { m.match_no = i + 1; });
              await state.store.evUpsert('event_matches', rows);
              await refreshEvent(); toast(`${rows.length} group matches created`, 'success'); paint();
            },
          }, groupMatches.length ? 'Regenerate' : 'Generate')),
        playoffMatches.length ? null : seedEditor(),
        step('3', 'Generate playoffs', playoffMatches.length
          ? `Playoffs are set with ${s.seeds?.length || 0} teams (seeds locked).`
          : `Locks ${s.advance === 'all' ? 'every team' : `the top ${s.advance} per group`} as seeds from the group results, then builds the ${s.bracket}-elimination bracket. Until then, the bracket shows a live projection.`,
          h('div', { class: 'row' },
            h('button', {
              class: 'btn btn-primary', onclick: async () => {
                const seeds = currentSeeds();
                if (seeds.length < 2) return toast('Need at least 2 qualified teams', 'error');
                const left = groupMatches.filter(m => !ev.resolved.get(m.id)?.result?.done).length;
                if (left && !(await confirmDialog(`${left} group match${left === 1 ? ' is' : 'es are'} not finished. Seeds will be locked from the current standings. Generate anyway?`, 'Generate'))) return;
                if (playoffMatches.length) {
                  if (!(await confirmDialog('Rebuild the bracket from current standings? Playoff results will be deleted.', 'Rebuild'))) return;
                  await state.store.evDelete('event_matches', playoffMatches.map(m => m.id));
                }
                const tmpl = buildBracket(seeds.length, s.bracket);
                const last = Math.max(...ev.data.matches.map(m => m.queue_pos || 0), 0);
                // bracket match numbers continue after the group stage
                const firstNo = Math.max(0, ...groupMatches.map(m => Number(m.match_no) || 0), groupMatches.length);
                await state.store.evUpsert('event_matches', tmpl.map((m, i) => ({
                  ...m, event_id: ev.event.id, best_of: m.stage === 'grand' || (s.bracket === 'single' && m === tmpl[tmpl.length - 1]) ? s.final_bo : s.playoff_bo,
                  status: 'scheduled', queue_pos: last + i + 1, team_a: null, team_b: null, match_no: firstNo + i + 1,
                })));
                await saveSettings({ seeds, seed_override: null });
                toast('Playoffs generated', 'success'); paint();
              },
            }, playoffMatches.length ? 'Rebuild playoffs' : 'Generate playoffs'),
            playoffMatches.length ? h('button', {
              class: 'btn btn-ghost btn-danger-text', onclick: async () => {
                if (!(await confirmDialog('Remove the playoff bracket and its results?'))) return;
                await state.store.evDelete('event_matches', playoffMatches.map(m => m.id));
                await saveSettings({ seeds: null }); paint();
              },
            }, 'Remove playoffs') : null))));
  }

  // ---- playoff seeding (auto from standings, or drag into your own order) ----
  function currentSeeds() {
    const auto = ev.seeds;
    const o = ev.settings.seed_override;
    if (!o?.length) return auto;
    // keep the manual order, drop teams no longer qualified, append newly qualified
    return [...o.filter(id => auto.includes(id)), ...auto.filter(id => !o.includes(id))];
  }
  function seedEditor() {
    const seeds = currentSeeds();
    if (seeds.length < 2) return null;
    const manual = !!ev.settings.seed_override?.length;
    const info = new Map(ev.seedTable.map(x => [x.id, x]));
    const move = async (i, d) => {
      const list = [...seeds]; const j = i + d;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      await saveSettings({ seed_override: list }); paint();
    };
    const how = (ev.settings.seed_method || 'rank') === 'snake'
      ? 'group winners first, then runners-up (A1, B1, C1, C2, B2, A2 …)'
      : 'group winners first, ranked against each other with the tiebreakers, then runners-up the same way';
    return h('div', { class: 'step' }, h('div', { class: 'step-n' }, '↕'),
      h('div', { class: 'step-body' },
        h('strong', {}, 'Playoff seeding'),
        h('p', { class: 'small muted' }, manual ? 'Manual order. Teams that qualify later are added at the bottom.' : `Automatic from group results: ${how}. Use the arrows to rearrange.`),
        h('ol', { class: 'seed-list' }, seeds.map((id, i) => {
          const x = info.get(id);
          return h('li', {},
            h('span', { class: 'seed-n' }, i + 1), h('span', { class: 'spacer' }, teamName(id),
              x ? h('span', { class: 'muted small' }, ` · ${x.group}${x.place}`) : null,
              !manual && x?.tb ? tbChip(x.tb, i < seeds.length - 1 ? seeds[i + 1] : null) : null),
            h('button', { class: 'icon-btn', 'aria-label': 'Move up', onclick: () => move(i, -1) }, '↑'),
            h('button', { class: 'icon-btn', 'aria-label': 'Move down', onclick: () => move(i, 1) }, '↓'));
        }))),
      manual ? h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { await saveSettings({ seed_override: null }); paint(); } }, 'Back to automatic') : h('span'));
  }

  // ---- estimated start times ----
  function timesPanel() {
    const e = { ...EST_DEFAULTS, ...(ev.settings.est || {}) };
    const p = pace(ev.data.matches, ev.data.games, ev.settings);
    const sessions = ev.settings.seating?.sessions || [];
    // a stored "HH:MM" (older events) becomes a full date + time on the event's date
    const asLocal = v => (!v ? '' : /T/.test(v) ? v.slice(0, 16) : ev.event.starts_on ? `${ev.event.starts_on}T${v.padStart(5, '0')}` : '');
    const when = v => h('input', { type: 'datetime-local', value: asLocal(v) });
    const perMap = h('input', { type: 'number', min: 3, max: 40, step: 1, value: e.map_minutes, class: 'in-num' });
    const slot = h('input', { type: 'number', min: 0, max: 180, step: 5, value: e.slot_minutes ?? 60, class: 'in-num' });
    const brk = h('input', { type: 'number', min: 15, max: 30, step: 1, value: Math.min(30, Math.max(15, e.break_minutes)), class: 'in-num' });
    const top = h('input', { type: 'number', min: 0, max: 32, step: 1, value: ev.settings.final_top ?? 6, class: 'in-num' });
    const pub = h('input', { type: 'checkbox', checked: e.public !== false });
    const ses = sessions.map(x => [x.id, when(e.session_starts?.[x.id] || (x.id === sessions[0]?.id ? e.day_start : ''))]);
    const bracketAt = when(e.bracket_start), sundayAt = when(e.sunday_start);
    const fd = ev.finalDay;
    return panel('Schedule & match timing', 'Set when each part of the event starts; estimated start times count from there. Each map takes about 15 minutes. After a match, a team gets a break (also its time to log in and set up), and its next match starts at least an hour after the last one started: a 3–0 is 3 × 15 + 15 = 1 hour, and every extra map adds 15 minutes. If both teams ready up early, they can start right away. Teams only waiting on other matches start as soon as those finish.',
      h('div', { class: 'sched-grid' },
        ses.map(([id, inp], i) => h('label', {}, `${sessions[i].name} groups start`, inp)),
        h('label', {}, 'Bracket play starts', bracketAt),
        h('label', {}, 'Final day starts', sundayAt)),
      h('div', { class: 'grid-4' },
        h('label', {}, 'Minutes per map', perMap),
        h('label', {}, 'Break between matches (15–30)', brk),
        h('label', {}, 'Minimum, start to next start', slot),
        h('label', {}, 'Teams that make the final day', top)),
      h('p', { class: 'small muted' }, fd
        ? `Top ${fd.top} play ${finalDayName()}: the 2 teams in the winners final and the teams left in the losers bracket. ${fd.qualifies.size} matches send their winner there (they glow purple: “Winner → ${finalDayName()}”). In the upper semis both teams are already through (“Both → ${finalDayName()}”). Teams that are through see “Qualified for ${finalDayName()}”. Set 0 for no cut.`
        : 'Top teams that play the final day: their qualifying matches glow purple once the bracket exists. Set 0 for no cut.'),
      finalRoundsPicker(),
      h('label', { class: 'inline' }, pub, 'Show estimated start times to players and on the display'),
      h('p', { class: 'small muted' }, p.samples
        ? `Learned so far: ${p.learned.toFixed(1)} min per map from ${p.samples} finished match${p.samples === 1 ? '' : 'es'}. Estimates use ${p.mapMin.toFixed(1)} min (your setting counts less as more matches finish).`
        : 'Nothing finished yet, so estimates use your minutes per map. Once matches finish, the real pace takes over.'),
      h('div', {}, h('button', {
        class: 'btn btn-primary', 'data-submit': '', onclick: async () => {
          await saveSettings({
            final_top: Math.max(0, Math.round(+top.value || 0)),
            est: { ...e, day_start: '', map_minutes: Math.max(3, +perMap.value || 15), setup_minutes: 0, slot_minutes: Math.max(0, +slot.value || 0),
              break_minutes: Math.min(30, Math.max(15, +brk.value || 15)), public: pub.checked,
              session_starts: Object.fromEntries(ses.map(([id, inp]) => [id, inp.value || ''])),
              bracket_start: bracketAt.value || '', sunday_start: sundayAt.value || '' },
          });
          toast('Schedule saved', 'success'); paint();
        },
      }, 'Save')));
  }

  // which bracket rounds are played on the final day (the rest is Saturday): automatic, or ticked by staff
  function finalRoundsPicker() {
    const real = ev.data.matches.filter(m => m.stage !== 'group');
    const bm = real.length ? real : ev.bracketPreview || [];
    if (!bm.length || !(Number(ev.settings.final_top ?? 6) > 0)) return null;
    const order = { upper: 0, lower: 1, grand: 2 };
    const rounds = [];
    for (const m of [...bm].sort((a, b) => order[a.stage] - order[b.stage] || a.round - b.round)) {
      const k = roundKey(m);
      if (!rounds.some(x => x.key === k)) rounds.push({ key: k, label: roundName(m, bm), stage: m.stage, n: bm.filter(x => roundKey(x) === k).length });
    }
    const picked = ev.settings.final_rounds?.length ? new Set(ev.settings.final_rounds) : null;
    const isSun = k => (picked ? picked.has(k) : bm.some(m => roundKey(m) === k && ev.finalDay?.sunday.has(m.id)));
    const save = async keys => { await saveSettings({ final_rounds: keys }); toast(keys ? 'Final-day rounds saved' : 'Back to automatic', 'success'); paint(); };
    const box = (x) => h('label', { class: `fr-round ${isSun(x.key) ? 'on' : ''}` },
      h('input', {
        type: 'checkbox', checked: isSun(x.key),
        onchange: () => {
          const cur = new Set(rounds.filter(y => isSun(y.key)).map(y => y.key));
          cur.has(x.key) ? cur.delete(x.key) : cur.add(x.key);
          save([...cur]);
        },
      }),
      h('span', {}, x.label), h('span', { class: 'muted small' }, `${x.n} match${x.n === 1 ? '' : 'es'}`));
    const col = stage => rounds.filter(x => x.stage === stage);
    return h('details', { class: 'block-inner fr-pick', open: !!picked },
      h('summary', {}, h('strong', {}, `Rounds played on ${finalDayName()}`),
        h('span', { class: 'muted small' }, picked ? ' · picked by you' : ' · automatic')),
      h('p', { class: 'small muted' }, `Tick the rounds played on ${finalDayName()}. Everything else is Saturday. Matches that send their winner into a ticked round glow purple (“Winner → ${finalDayName()}”), and teams in a ticked round show as qualified.`),
      h('div', { class: 'fr-cols' },
        ['upper', 'lower', 'grand'].map(st => col(st).length ? h('div', { class: 'fr-col' },
          h('div', { class: 'eyebrow' }, { upper: 'Upper bracket', lower: 'Lower bracket', grand: 'Final' }[st]), col(st).map(box)) : null)),
      picked ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => save(null) }, 'Back to automatic') : null);
  }

  // ---- tiebreakers: rules, coin flips, and rearranging a group by hand ----
  function tiebreakPanel() {
    const s = ev.settings;
    const labels = Object.keys(ev.standings);
    const coins = ev.coinsNeeded;
    const method = h('select', {
      onchange: async e => { await saveSettings({ seed_method: e.target.value }); toast('Seeding updated', 'success'); paint(); },
    }, h('option', { value: 'rank', selected: (s.seed_method || 'rank') === 'rank' }, 'Rank each place with the tiebreakers (A1/B1/C1… best record first)'),
    h('option', { value: 'snake', selected: s.seed_method === 'snake' }, 'Fixed group order (A1, B1, C1, C2, B2, A2 …)'));

    const flipCard = c => {
      const picked = [];
      const box = h('div', { class: 'coin-card' });
      const save = async order => {
        await saveSettings({ coin_flips: { ...(ev.settings.coin_flips || {}), [c.key]: order } });
        toast(`${teamName(order[0])} won the coin flip`, 'success'); paint();
      };
      const draw = () => {
        const left = c.ids.filter(id => !picked.includes(id));
        clear(box).append(
          h('div', {}, h('strong', {}, c.where), h('span', { class: 'muted small' }, ` · ${c.ids.map(teamName).join(', ')} are tied on record, head to head and map win %`)),
          c.ids.length === 2
            ? h('div', { class: 'row wrap' }, h('span', { class: 'small' }, 'Who won the flip?'),
              c.ids.map(id => h('button', { class: 'btn btn-sm', 'data-submit': '', onclick: () => save([id, ...c.ids.filter(x => x !== id)]) }, teamName(id))))
            : h('div', { class: 'row wrap' }, h('span', { class: 'small' }, picked.length ? `Order so far: ${picked.map(teamName).join(' → ')}. Next:` : 'Click teams in the order they finished the flips:'),
              left.map(id => h('button', {
                class: 'btn btn-sm', onclick: () => { picked.push(id); if (picked.length >= c.ids.length - 1) save([...picked, ...c.ids.filter(x => !picked.includes(x))]); else draw(); },
              }, teamName(id)))),
          h('button', {
            class: 'btn btn-sm btn-ghost', 'data-tip': 'Picks a random order and saves it',
            onclick: () => { const o = [...c.ids]; for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } save(o); },
          }, '🪙 Flip for me'));
      };
      draw();
      return box;
    };

    const doneFlips = Object.entries(s.coin_flips || {});
    const groupOrder = l => {
      const rows = ev.standings[l];
      const manual = !!s.group_override?.[l]?.length;
      const move = async (i, d) => {
        const ids = rows.map(r => r.team.id); const j = i + d;
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        await saveSettings({ group_override: { ...(s.group_override || {}), [l]: ids } }); paint();
      };
      return h('div', { class: 'tb-group' },
        h('div', { class: 'row' }, h('strong', {}, `Group ${l}`), manual ? h('span', { class: 'chip chip-warn' }, 'Set by staff') : null, h('span', { class: 'spacer' }),
          manual ? h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { const o = { ...(s.group_override || {}) }; delete o[l]; await saveSettings({ group_override: o }); paint(); } }, 'Back to automatic') : null),
        h('ol', { class: 'seed-list' }, rows.map((r, i) => h('li', {},
          h('span', { class: 'seed-n' }, i + 1),
          h('span', { class: 'spacer' }, r.team.name, h('span', { class: 'muted small' }, ` · ${r.sw}–${r.sl} · maps ${Math.round((r.mpct || 0) * 100)}%`),
            !manual && r.tb ? tbChip(r.tb, rows[i + 1]?.team.id) : null),
          h('button', { class: 'icon-btn', 'aria-label': 'Move up', onclick: () => move(i, -1) }, '↑'),
          h('button', { class: 'icon-btn', 'aria-label': 'Move down', onclick: () => move(i, 1) }, '↓')))));
    };

    return panel('Tiebreakers', 'How tied teams are ordered in the groups and for playoff seeding. You can rearrange anything by hand.',
      h('ol', { class: 'tb-rules' }, TIEBREAKERS.map(([, nm], i) => h('li', {}, h('b', {}, `${'abcd'[i]}.`), ' ', nm))),
      h('p', { class: 'small muted' }, 'Head to head counts series between the tied teams only. When three or more are tied and a rule separates some of them, the rules start again from head to head for the teams still level.'),
      h('label', {}, 'Playoff seeding across groups', method),
      coins.length
        ? h('div', { class: 'stack-sm' }, h('div', { class: 'eyebrow warn-text' }, `Coin flip${coins.length > 1 ? 's' : ''} needed`), coins.map(flipCard))
        : null,
      doneFlips.length
        ? h('div', { class: 'small muted' }, 'Coin flips done: ', doneFlips.map(([k, order], i) => h('span', {},
          i ? ' · ' : '', `${order.map(teamName).join(' > ')} `,
          h('button', { class: 'link-btn', onclick: async () => { const o = { ...(s.coin_flips || {}) }; delete o[k]; await saveSettings({ coin_flips: o }); paint(); } }, 'undo'))))
        : null,
      labels.length
        ? h('details', { class: 'block-inner', open: tbOpen, ontoggle: e => { tbOpen = e.currentTarget.open; } }, h('summary', {}, h('strong', {}, 'Rearrange group standings'), h('span', { class: 'muted small' }, ' · for rulings or forfeits')),
          h('div', { class: 'tb-groups' }, labels.map(groupOrder)))
        : h('div', { class: 'empty-sm' }, 'Standings appear once teams are in groups.'));
  }

  // ---- roles + captain links ----
  function accessPanel() {
    const body = h('div', { class: 'stack-sm' }, h('div', { class: 'muted small' }, 'Loading…'));
    const roles = h('div', { class: 'roles-grid' }, [
      ['Viewer', 'r-viewer', 'Anyone with the event link. Bracket, stats, teams, display. Read only.'],
      ['Player', 'r-player', 'Picks their team on the event page (no login). Sees where they sit, when they play, live scores and their team’s stats.'],
      ['Captain', 'r-captain', 'Opens their team’s private link. Everything a player sees, plus: check in, map veto, report scores for you to approve, call staff, fix the roster.'],
      ['Admin / staff', 'r-admin', 'Signed in with the admin code. Control panel, seating, display, setup, approving scores.'],
    ].map(([t, c, d]) => h('div', { class: 'role-card' }, h('span', { class: `role-dot ${c}` }), h('div', {}, h('strong', {}, t), h('p', { class: 'small muted' }, d)))));
    const draw = async () => {
      const { randomKey } = await import('../veto.js');
      const { captainLink } = await import('../event-state.js');
      const keys = await state.store.teamKeys(ev.event.id).catch(() => []);
      const byTeam = new Map(keys.map(x => [x.team_id, x.captain_key]));
      const teams = ev.data.teams.slice().sort((a, b) => a.name.localeCompare(b.name));
      const missing = teams.filter(t => !byTeam.has(t.id));
      const make = async list => {
        await state.store.evUpsert('event_team_keys', list.map(t => ({ team_id: t.id, event_id: ev.event.id, captain_key: randomKey() + randomKey() })));
        draw();
      };
      const allText = () => teams.filter(t => byTeam.has(t.id)).map(t => `${t.name}: ${captainLink(byTeam.get(t.id))}`).join('\n');
      clear(body).append(...[
        teams.length ? null : h('div', { class: 'empty-sm' }, 'Add teams first.'),
        missing.length ? h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', onclick: () => make(missing) }, `Create captain links (${missing.length})`),
          h('span', { class: 'small muted' }, 'One private link per team. Send it only to that team’s captain.')) : null,
        keys.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data tight' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Team'), h('th', {}, 'Captain link'), h('th', {}))),
          h('tbody', {}, teams.filter(t => byTeam.has(t.id)).map(t => {
            const url = captainLink(byTeam.get(t.id));
            return h('tr', {},
              h('td', {}, teamBadge(t.id, 'xs'), t.name),
              h('td', {}, h('code', { class: 'url small' }, url.replace(/cap=(.{4}).*/, 'cap=$1••••••'))),
              h('td', {}, h('div', { class: 'row' },
                h('button', { class: 'btn btn-sm', onclick: () => { navigator.clipboard.writeText(url); toast(`${t.name} captain link copied`); } }, 'Copy'),
                h('button', {
                  class: 'btn btn-sm btn-ghost', 'data-tip': 'Makes the old link stop working (lost or shared by mistake)',
                  onclick: async () => { if (await confirmDialog(`Make a new captain link for ${t.name}? The old one stops working.`, 'New link')) make([t]); },
                }, 'New link'))));
          })))) : null,
        keys.length ? h('div', { class: 'row' },
          h('button', { class: 'btn btn-sm', onclick: () => { navigator.clipboard.writeText(allText()); toast('All captain links copied'); } }, 'Copy all'),
          h('button', { class: 'btn btn-sm btn-ghost', onclick: () => printSheet(teams.filter(t => byTeam.has(t.id)).map(t => [t, captainLink(byTeam.get(t.id))])) }, 'Print slips')) : null,
      ].filter(Boolean));
    };
    draw();
    return panel('Roles & captain links', 'Who can do what. Use “Preview as” at the top right to see each role.', roles, body);
  }

  function printSheet(rows) {
    const w = window.open('', '_blank');
    if (!w) return toast('Allow pop-ups to print', 'error');
    const esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    w.document.write(`<!doctype html><title>Captain links</title><style>body{font:14px system-ui;margin:24px}div{border:1px dashed #999;padding:14px;margin:0 0 12px;page-break-inside:avoid}h2{margin:0 0 4px;font-size:18px}code{word-break:break-all;font-size:12px}p{margin:6px 0 0;color:#555;font-size:12px}</style>${rows.map(([t, url]) => `<div><h2>${esc(t.name)} · captain</h2><code>${esc(url)}</code><p>Open on your phone. Check in, do the map veto, report scores and call staff from here. Don’t share it.</p></div>`).join('')}<script>print()<\/script>`);
    w.document.close();
  }

  // ---- display moved to its own admin tab ----
  function displayNote() {
    return panel('Display screen', null, h('p', { class: 'small' }, 'Screens, presets, timing and the OBS link are on the ', h('a', { href: eventPath('screens') }, 'Display'), ' tab.'));
  }

  function dangerPanel() {
    const csvs = ['player_maps.csv', 'player_totals.csv', 'teams.csv', 'group_standings.csv', 'matches.csv', 'maps.csv', 'vetoes.csv'];
    return panel('Data', 'Everything from the event: one row per player per map, totals, teams, standings, series, maps and vetoes',
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary', onclick: () => exportEvent() }, 'Download all stats (.zip)'),
        h('select', { 'aria-label': 'Download one file', onchange: e => { if (e.target.value) exportEvent(e.target.value); e.target.value = ''; } },
          h('option', { value: '' }, 'Or one CSV…'), csvs.map(f => h('option', { value: f }, f)))),
      h('p', { class: 'hint' }, 'CSV files open in Excel, Google Sheets, or pandas. The ZIP also includes a full JSON backup.'),
      h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => download(`${ev.event.name}-backup.json`, JSON.stringify({ event: (({ admin_code, ...e }) => e)(ev.event), ...ev.data }, null, 2), 'application/json') }, 'Backup (JSON)'),
      h('button', {
        class: 'btn btn-ghost btn-danger-text', onclick: async () => {
          if (!(await confirmDialog(`Delete ${ev.event.name} and everything in it?`))) return;
          await state.store.deleteEvent(ev.event.id); go('#/events');
        },
      }, 'Delete event')));
  }

  paint();
  return root;
}

let tbOpen = false; // keep "Rearrange group standings" open between repaints
const TB_SHORT = { record: null, h2h: 'H2H', maps: 'Map %', coin: 'Coin flip', 'coin?': 'Coin flip needed' };
const TB_LONG = { h2h: 'head to head', maps: 'map win %', coin: 'coin flip', 'coin?': 'nothing yet: a coin flip is needed' };
function tbChip(tb, below) {
  if (!TB_SHORT[tb]) return null;
  return h('span', { class: `chip tb-chip ${tb === 'coin?' ? 'chip-warn' : ''}`, 'data-tip': tb === 'coin?' ? `Tied with ${below ? teamName(below) : 'the next team'} on every rule: a coin flip is needed` : `Ahead of ${below ? teamName(below) : 'the next team'} on ${TB_LONG[tb]}` }, TB_SHORT[tb]);
}

function panel(title, sub, ...body) {
  return h('section', { class: 'block' }, h('div', { class: 'block-head' }, h('h2', {}, title), sub ? h('span', { class: 'muted small' }, sub) : null), ...body);
}
function step(n, title, text, action) {
  return h('div', { class: 'step' }, h('div', { class: 'step-n' }, n), h('div', { class: 'step-body' }, h('strong', {}, title), h('p', { class: 'small muted' }, text)), h('div', {}, action));
}

export { DEFAULT_EVENT_SETTINGS };

/** Fit a logo into a 256×256 transparent PNG. */
async function squareLogo(file) {
  const img = await createImageBitmap(file);
  const size = 256, c = document.createElement('canvas');
  c.width = c.height = size;
  const k = Math.min(size / img.width, size / img.height);
  const w = img.width * k, hgt = img.height * k;
  c.getContext('2d').drawImage(img, (size - w) / 2, (size - hgt) / 2, w, hgt);
  return await new Promise(res => c.toBlob(res, 'image/png'));
}
