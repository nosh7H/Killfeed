// Event admin: Setup (format, teams, groups, playoffs, display) and Control room (queue + setups).
import { h, clear, toast, confirmDialog, uid, download } from '../ui.js';
import { state, go } from '../state.js';
import { ev, eventPath, refreshEvent, eventSettings, teamName, watchEvent, groupsFor, teamBadge, exportEvent, DEFAULT_EVENT_SETTINGS } from '../event-state.js';
import { snakeGroups, roundRobin, buildBracket, GROUP_LABELS, roundName, queue } from '../event-logic.js';
import { eventShell } from './event.js';
import { FONT_STYLES, DEFAULT_ACCENT, applyFont } from '../theme.js';
import { statusPill } from './event-parts.js';

const lines = v => [...new Set(String(v || '').split('\n').map(s => s.trim()).filter(Boolean))];
const SCENES = [
  ['groups', 'Group standings'], ['kd:*', 'K/D leaders per mode (one screen per mode)'], ['teams', 'Team stats'],
  ['bracket', 'Bracket'], ['awards', 'Awards (MVP, Obj King, Slayer…)'], ['queue', 'Live and up next (full screen)'],
];

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
    infoPanel(), formatPanel(), teamsPanel(), stagePanel(), displayPanel(), dangerPanel())));

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
    let podNames = [...s.stations];
    const podCount = h('input', { type: 'number', min: 1, max: 32, value: podNames.length, class: 'in-num' });
    const podGrid = h('div', { class: 'pod-names' });
    const renderPods = () => {
      const n = Math.max(1, Math.min(32, +podCount.value || 1));
      while (podNames.length < n) podNames.push(`Pod ${podNames.length + 1}`);
      podNames = podNames.slice(0, n);
      clear(podGrid).append(...podNames.map((name, i) => h('input', { value: name, 'aria-label': `Pod ${i + 1} name`, oninput: e => { podNames[i] = e.target.value; } })));
    };
    podCount.oninput = renderPods;
    renderPods();
    const maps = Object.fromEntries(s.modes.map(m => [m, h('textarea', { rows: 5, placeholder: 'One map per line' }, (s.maps[m] || []).join('\n'))]));
    return panel('Format', 'Groups, bracket, series length, modes, maps and pods',
      h('div', { class: 'grid-6' },
        h('label', {}, 'Groups', groups), h('label', {}, 'To playoffs', advance), h('label', {}, 'Playoffs', bracket),
        h('label', {}, 'Group Bo', gbo), h('label', {}, 'Playoff Bo', pbo), h('label', {}, 'Grand final Bo', fbo)),
      h('div', { class: 'grid-3' },
        h('label', {}, 'Modes', modes, h('span', { class: 'hint' }, 'One per line.')),
        h('div', { class: 'field' }, h('span', {}, 'Pods'), h('label', { class: 'inline' }, 'How many', podCount), podGrid,
          h('span', { class: 'hint' }, 'Name them anything. For a 40-PC lab (8 rows of 5, 4 sections), one match per section: team A on one row, team B on the other, the 5th PC in each row as a spare or observer.')),
        h('label', {}, 'Mode order per series', order, h('span', { class: 'hint' }, 'Comma separated. Repeats for longer series.'))),
      h('div', { class: 'grid-3' }, s.modes.map(m => h('label', {}, `${m} maps`, maps[m]))),
      h('div', {}, h('button', {
        class: 'btn btn-primary', onclick: async () => {
          const ms = lines(modes.value);
          await saveSettings({
            groups: groups.value === 'auto' ? 'auto' : +groups.value, advance: advance.value === 'all' ? 'all' : +advance.value, bracket: bracket.value,
            group_bo: +gbo.value || 5, playoff_bo: +pbo.value || 5, final_bo: +fbo.value || 5,
            modes: ms, stations: podNames.map((n, i) => n.trim() || `Pod ${i + 1}`),
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
                await state.store.evUpsert('event_matches', tmpl.map((m, i) => ({
                  ...m, event_id: ev.event.id, best_of: m.stage === 'grand' || (s.bracket === 'single' && m === tmpl[tmpl.length - 1]) ? s.final_bo : s.playoff_bo,
                  status: 'scheduled', queue_pos: last + i + 1, team_a: null, team_b: null,
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
    const move = async (i, d) => {
      const list = [...seeds]; const j = i + d;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      await saveSettings({ seed_override: list }); paint();
    };
    return h('div', { class: 'step' }, h('div', { class: 'step-n' }, '↕'),
      h('div', { class: 'step-body' },
        h('strong', {}, 'Playoff seeding'),
        h('p', { class: 'small muted' }, manual ? 'Manual order. Teams that qualify later are added at the bottom.' : 'Automatic from group results: group winners first, then runners-up, and so on (A1, B1, C1, C2, B2, A2 …). Use the arrows to change it.'),
        h('ol', { class: 'seed-list' }, seeds.map((id, i) => h('li', {},
          h('span', { class: 'seed-n' }, i + 1), h('span', { class: 'spacer' }, teamName(id)),
          h('button', { class: 'icon-btn', 'aria-label': 'Move up', onclick: () => move(i, -1) }, '↑'),
          h('button', { class: 'icon-btn', 'aria-label': 'Move down', onclick: () => move(i, 1) }, '↓'))))),
      manual ? h('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { await saveSettings({ seed_override: null }); paint(); } }, 'Back to automatic') : h('span'));
  }

  // ---- display ----
  function displayPanel() {
    const d = ev.settings.display;
    const secs = h('input', { type: 'range', min: 10, max: 60, step: 5, value: d.seconds });
    const secsOut = h('strong', {}, `${d.seconds}s`);
    secs.oninput = () => { secsOut.textContent = `${secs.value}s`; };
    const minG = h('input', { type: 'number', min: 1, max: 20, value: d.min_games, class: 'in-num' });
    const ticker = h('input', { type: 'checkbox', checked: d.ticker !== false });
    const dfont = h('select', {}, FONT_STYLES.map(([k, l]) => h('option', { value: k, selected: (d.font || 'mix') === k }, l)));
    const enabled = new Set(d.scenes.map(x => (x.startsWith('kd:') ? 'kd:*' : x)));
    const order = SCENES.map(([k]) => k).sort((a, b) => {
      const ia = d.scenes.findIndex(x => (x.startsWith('kd:') ? 'kd:*' : x) === a), ib = d.scenes.findIndex(x => (x.startsWith('kd:') ? 'kd:*' : x) === b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const list = h('ol', { class: 'scene-list' });
    const renderList = () => {
      clear(list).append(...order.map((k, i) => h('li', {},
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: enabled.has(k), onchange: e => { e.target.checked ? enabled.add(k) : enabled.delete(k); } }), SCENES.find(s => s[0] === k)[1]),
        h('span', { class: 'row' },
          i ? h('button', { class: 'icon-btn', 'aria-label': 'Move up', onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; renderList(); } }, '↑') : null,
          i < order.length - 1 ? h('button', { class: 'icon-btn', 'aria-label': 'Move down', onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; renderList(); } }, '↓') : null))));
    };
    renderList();
    const url = `${location.origin}${location.pathname}#/display/${ev.event.id}`;
    return panel('Display screen', 'The rotating screen for the venue TV and the stream',
      h('div', { class: 'grid-2 gap-lg' },
        h('div', { class: 'stack-sm' },
          h('label', {}, h('span', {}, 'Time per screen: ', secsOut), secs),
          h('label', {}, 'Minimum maps to appear on K/D boards', minG),
          h('label', {}, 'Font style (screen)', dfont),
          h('label', { class: 'check' }, ticker, 'Show the “Live / Up next” bar on every screen'),
          h('p', { class: 'small' }, 'Link for OBS (Browser Source, 1920×1080) or the TV:'),
          h('div', { class: 'row' }, h('code', { class: 'url' }, url),
            h('button', { class: 'btn btn-sm', onclick: () => { navigator.clipboard.writeText(url); toast('Copied'); } }, 'Copy'))),
        h('div', {}, h('div', { class: 'small muted' }, 'Screens, in order'), list)),
      h('div', {}, h('button', {
        class: 'btn btn-primary', onclick: async () => {
          const scenes = order.filter(k => enabled.has(k)).flatMap(k => (k === 'kd:*' ? ev.settings.modes.map(m => `kd:${m}`) : [k]));
          await saveSettings({ display: { ...ev.settings.display, seconds: +secs.value, min_games: +minG.value || 1, ticker: ticker.checked, scenes, font: dfont.value } });
          toast('Display updated — open screens switch over automatically', 'success'); paint();
        },
      }, 'Save display')));
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

function panel(title, sub, ...body) {
  return h('section', { class: 'block' }, h('div', { class: 'block-head' }, h('h2', {}, title), sub ? h('span', { class: 'muted small' }, sub) : null), ...body);
}
function step(n, title, text, action) {
  return h('div', { class: 'step' }, h('div', { class: 'step-n' }, n), h('div', { class: 'step-body' }, h('strong', {}, title), h('p', { class: 'small muted' }, text)), h('div', {}, action));
}

// =====================================================================
// CONTROL ROOM
// =====================================================================
export function eventControl() {
  if (!ev.isAdmin) return notAdmin('control');
  const root = h('div');
  let showFinal = false;

  const setMatch = async (m, patch) => {
    await state.store.evUpsert('event_matches', { ...m, ...patch, updated_at: new Date().toISOString() });
    await refreshEvent(); paint();
  };

  const paint = () => {
    const bm = ev.data.matches.filter(m => m.stage !== 'group');
    const q = queue(ev.data.matches, ev.resolved);
    const stations = ev.settings.stations;
    const busy = new Map(ev.data.matches.filter(m => m.status === 'live' && m.station).map(m => [m.station, m]));
    const finals = ev.data.matches.filter(m => m.status === 'final' || ev.resolved.get(m.id)?.result?.done);

    const row = (m, i) => {
      const r = ev.resolved.get(m.id);
      return h('tr', { class: `q-${m.status}` },
        h('td', { class: 'num muted' }, i + 1),
        h('td', {}, h('a', { href: eventPath(`match/${m.id}`) }, teamName(r.A), h('span', { class: 'vs' }, ' vs '), teamName(r.B)),
          h('div', { class: 'small muted' }, roundName(m, bm), ` · Bo${m.best_of}`)),
        h('td', {}, h('select', { 'aria-label': 'Station', onchange: e => setMatch(m, { station: e.target.value || null }) },
          h('option', { value: '' }, '— pod —'),
          stations.map(st => h('option', { value: st, selected: m.station === st }, st + (busy.has(st) && busy.get(st).id !== m.id ? ' (busy)' : ''))))),
        h('td', {}, h('div', { class: 'seg seg-sm' }, ['scheduled', 'ondeck', 'live', 'final'].map(st => h('button', {
          class: m.status === st ? 'on' : '',
          onclick: async () => {
            if (st === 'live' && !m.station) return toast('Pick a pod first', 'error');
            if (st === 'final' && !r.result?.done && !(await confirmDialog('No winner from the entered maps yet. Mark final anyway? The team with more maps wins.', 'Mark final'))) return;
            setMatch(m, { status: st });
          },
        }, { scheduled: 'Sched', ondeck: 'On deck', live: 'Live', final: 'Final' }[st])))),
        h('td', {}, h('div', { class: 'row' },
          h('button', { class: 'icon-btn', 'aria-label': 'Move up', onclick: () => reorder(q, i, -1) }, '↑'),
          h('button', { class: 'icon-btn', 'aria-label': 'Move down', onclick: () => reorder(q, i, 1) }, '↓'),
          h('a', { class: 'btn btn-sm', href: eventPath(`match/${m.id}`) }, 'Scores'))));
    };

    const d = ev.settings.display;
    const sceneOpts = d.scenes.map(k => [k, k.startsWith('kd:') ? `K/D · ${k.slice(3)}` : { groups: 'Group standings', teams: 'Team stats', bracket: 'Bracket', queue: 'Live and up next', awards: 'Awards' }[k] || k]);
    clear(root).append(eventShell('control', h('div', { class: 'stack' },
      h('div', { class: 'toolbar' },
        h('label', { class: 'inline' }, 'Display screen',
          h('select', {
            onchange: async e => { await saveSettings({ display: { ...d, pin: e.target.value || null, pin_veto: null } }); toast(e.target.value ? 'Display pinned' : 'Display rotating'); paint(); },
          }, h('option', { value: '' }, 'Rotate all screens'), sceneOpts.map(([k, l]) => h('option', { value: k, selected: d.pin === k }, `Pin: ${l}`)),
            h('option', { value: 'veto', selected: d.pin === 'veto' }, 'Pin: Map veto (latest)'))),
        h('a', { class: 'btn btn-ghost btn-sm', href: `#/display/${ev.event.id}`, target: '_blank', rel: 'noopener' }, 'Open display ↗')),
      h('div', { class: 'station-grid' }, stations.map(st => {
        const m = busy.get(st);
        const r = m && ev.resolved.get(m.id);
        return h('div', { class: `station ${m ? 'busy' : ''}` },
          h('div', { class: 'eyebrow' }, st),
          m ? h('a', { href: eventPath(`match/${m.id}`) }, h('strong', {}, `${teamName(r.A)} vs ${teamName(r.B)}`),
            h('div', { class: 'small muted' }, r.result ? `Maps ${r.result.a}–${r.result.b}` : 'Starting')) : h('div', { class: 'muted small' }, 'Open'));
      })),
      panel('Queue', 'Live first, then on deck, then scheduled. Use ↑↓ to change the order teams are called.',
        q.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data queue-table' },
          h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Match'), h('th', {}, 'Pod'), h('th', {}, 'Status'), h('th', {}))),
          h('tbody', {}, q.map(row)))) : h('div', { class: 'empty-sm' }, 'Nothing waiting. Generate group matches in Setup.')),
      panel(`Completed (${finals.length})`, null,
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { showFinal = !showFinal; paint(); } }, showFinal ? 'Hide' : 'Show'),
        showFinal ? h('div', { class: 'list' }, finals.map(m => {
          const r = ev.resolved.get(m.id);
          return h('a', { class: 'list-row', href: eventPath(`match/${m.id}`) },
            h('span', {}, `${teamName(r.A)} ${r.result?.a ?? ''}–${r.result?.b ?? ''} ${teamName(r.B)}`),
            h('span', { class: 'muted small' }, roundName(m, bm)));
        })) : null))));
  };

  async function reorder(q, i, dir) {
    const j = i + dir;
    if (j < 0 || j >= q.length) return;
    const list = [...q];
    [list[i], list[j]] = [list[j], list[i]];
    await state.store.evUpsert('event_matches', list.map((m, k) => ({ ...m, queue_pos: k + 1 })));
    await refreshEvent(); paint();
  }

  paint();
  watchEvent(() => { if (root.isConnected) paint(); });
  return root;
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
