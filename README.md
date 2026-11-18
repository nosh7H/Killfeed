# Killfeed: CoD team stats

A static website for Call of Duty teams to log scrims and matches, upload scoreboard screenshots, and analyze **kills, deaths, K/D, obj time, plants, defuses and captures**, filtered by **map, mode, match type, opponent, player, result and date**. It runs on GitHub Pages and has no build step.

## Features

- **Separate teams.** Each team has its own private space. Members join with an invite code and get a role (owner, coach, player or viewer). One account can belong to several teams and switch between them.
- **Screenshot → stats.** Drop, browse for or paste (Ctrl+V) a scoreboard screenshot, then click **Read stats**. In-browser OCR reads the rows and matches them to your roster, even with noise such as `Kair0` → `Kairo` or clan tags. You tell it once which number column is which stat. It remembers that per mode.
- **Mode-aware stats.** Obj time appears for Hardpoint, plants, defuses and first bloods for S&D, and captures for Control. Damage and assists are optional.
- **Dashboard.** Shows the record, win rate and team K/D. It also has a sortable player leaderboard, a map × mode win-rate grid (click a cell to filter), an opponent head-to-head table and recent games.
- **Player pages.** Each has a K/D trend chart, splits by map, by mode and by map + mode, and a full game log.
- **Matches as series.** A match holds up to five maps (or any number). There's a **Bo5 template** (HP, S&D, Control, HP, S&D).
- **VOD review.** Embed a YouTube or Twitch VOD per map, or open a local recording. Add timestamped notes with tags. Click a note to jump to that moment.
- **Green submit buttons.** Every button that saves or submits (Save, Create, Log, End map, Start match…) turns green on hover, so it's clear what commits a change.
- **Data.** Export CSV (all games or the filtered view), back up and restore with JSON.
- **Demo mode.** It works with no backend; data stays in the browser. A **Load sample team** button fills it with example data.
- **Try the demo.** Once Supabase is connected, the sign-in page has a **Try the demo** button. Visitors can explore a sample team in their own browser without an account. To hide it, add `export const SHOW_DEMO = false;` to `js/config.js`.

## Team home

**Home** is the first page of each team. It's a dashboard of widgets you arrange yourself:
- **Widgets:** key numbers, a single stat tile (pick the stat and mode), recent form, team K/D trend, win rate by mode, map win rates for one mode, top players for any stat, a player comparison chart, the next events from the schedule, recent matches, pinned notes, S&D round stats and hill-by-hill stats from tagged VODs, and a free-text team message.
- **Filters:** match type (scrims, matches…) and period (all time, 30, 14 or 7 days) apply to every widget.
- **Customize:** add widgets, drag them to reorder, set each one to Small, Medium or Wide, and open ⚙ to choose its stat or mode.
- **Saving:** the owner can **Save for the team** (everyone sees it). Anyone can **Save just for me** (kept in that browser), and go back to the team layout later.

## Team insights and notes

- **Insights** (team nav):
  - **Pick/ban assistant.** Each map's win rate per mode with an 80% range. Small samples are pulled toward 50%, so a 2–0 map doesn't outrank a proven 14–3 one. Each map gets a label (Strong / Leaning / Even / Weak / Low sample), and each mode gets a suggested pick and ban. Maps in your pool that you've never played are listed separately.
  - **What wins us maps.** For each mode, the team stats that differ most between won and lost maps (team K/D, deaths, lowest player K/D, hill time, first bloods, plants + defuses, damage per kill…). Each one shows its effect size and a rule of thumb, e.g. "Team K/D ≥ 1.06: won 11 of 11". It flags an early read under 8 maps.
  - **Player impact.** The team's win rate when each player goes positive vs negative.
  - Filters: match type and a start date.
- **Notes** (team nav): a shared notepad tagged by map, mode and opponent, with pinning, search, autosave and a "Map plan" template. Maps with notes link to them from the pick/ban assistant.

## Map breakdown tagging (VOD)

Open any map → **Map breakdown**. Pick the source:
- **Player POV**: tag as you watch. Deathcams hide the score, so you tag events (kills, deaths, plants), not the scoreboard.
- **CODCaster**: always-on scores, no deathcam. Same hotkeys, more reliable.

Each tag stamps the current VOD time. Hotkeys can be switched off.
- Hardpoint: `N` new hill, `1` we got first, `2` they got first, `B` we broke, `U` lost (they broke us), `Z` undo.
- S&D: set "We start on" Attack/Defense, then `R` new round, `K` our kill, `D` our death, `P` plant, `E` defuse, `W`/`L` round won/lost, `U`/`Z` undo.
- `←` / `→` seek the video by 5 seconds.

Tags autosave, and the stats update on their own in **Insights**:
- Hill by hill: hold rate, break rate, and the results for each hill.
- S&D rounds: first-blood rate and conversion, post-plant win %, retakes, 3v2 / 2v3 and the full 4×4 man-advantage matrix, and Attack vs Defense.
- A breakdown log.
- These features also feed **What wins us maps**.

Hijack only has free event tags for now.

## Schedule and time off

**Schedule** (team nav):
- Views: week, month and list.
- Rescheduling: drag a match to a new slot (15-minute snap) and use the **Undo** toast to reverse it. Each move is kept in the event's history.
- Colors: each league has its own color, and scrims (teal) and practice (grey) have separate colors. The owner sets these in **Leagues and colors**.
- **Time off:** each player blocks times they can't play, either once or as a weekly repeat with an end date. The calendar shades these times, and an event shows "N out" if it clashes with someone's time off.
- **Find a time:** pick a length and a range of days to get a ranked list of slots where everyone (or most people) is free. Schedule straight from a slot.
- **Log result:** turns a finished event into a new match with the opponent and date filled in, then links the two.

Times are stored in UTC and shown in each person's local time.

## LAN events

**Events** (top nav) is a separate section for running a LAN.

- **Setup** — paste teams (`Name | TAG | gamer1, gamer2, gamer3, gamer4`, one per line). Groups are automatic (2 groups up to 8 teams, 3 up to 12, 4 up to 16) or a number you choose. Choose who reaches playoffs (default: **all teams**), single or double elimination, and series length per stage (default: **Bo3 groups, Bo5 playoffs**). Set the mode order (default **HP → S&D → Hijack → HP → S&D**), the map pool per mode, and the default veto method (captain links or in person).
- **Stages** — auto-assign groups (snake by seed), generate the round-robin group matches, then generate playoffs. Seeds come from the group results: group winners first, then runners-up. You can reorder seeds by hand before locking them in. Until playoffs are generated, the bracket shows a live projection.
- **Admin view.** Admins see a **Public view | Admin** switch on every event page. The admin side has its own tabs (**Control panel**, **Rows & pods**, **Setup**) and is never shown to the public.
- **Control panel** (staff):
  - **Live now:** a card for each live match with its row, the map being played and a live score. Use −/+ (Hardpoint steps by 10, with a +1 button) or type the score. It shows on the display within a second. **End map** saves the map result and moves the series on; the match goes final when someone wins.
  - **On deck:** **Start match** takes the team's pinned rows in groups, or the first free bracket row. It warns if a row or a team is already live.
  - **Queue:** shows where each match is played, its veto status and its status (Scheduled → On deck → Live → Final). Use ↑↓ to change who is called next.
  - **Display remote:** pin a screen or rotate, **Next screen**, **Pause / Resume**, and an **announcement** banner across the top of the TV (e.g. "Lunch break — back at 1:00").
- **Rows & pods**:
  - **Group stage:** each team is pinned to one row (default 8 rows of 5 PCs) and keeps it for every group match. **Auto-pin by group and seed**, or drag a team chip onto another row (or use its row menu). With more teams than rows, rows are shared and marked.
  - **Bracket stage:** each match is set to one of the bracket rows (default Row 1–4, renamable). **Fill rows in queue order** does them all at once.
- **Scores** — when a team reports, open the match and type the map scores. Stats and screenshots are optional and can be added later. Screenshot reading works for both teams at once. A series is marked final automatically when someone wins, and the bracket moves the winner on.
- **Public pages** — overview, bracket, stats (K/D per mode, obj time, plants, defuses, first bloods) and team pages. Anyone with the link can see them; no login needed.
- **Team logos and colors**: upload a logo (it's fitted to a square PNG) and pick a color for each team in Setup → Teams. They appear in standings, the bracket, the queue, match pages and on the TV.
- **Awards**: Event MVP, Slayer, Obj King, Bomb Specialist, First Blood, Damage Dealer and Mr. Consistent, calculated automatically. They appear on the Overview, and as an optional TV screen (Setup → Display → Awards).
- **Export**: Setup → Data → **Download all stats (.zip)**, or **Export stats** on the public Stats page. The ZIP contains `player_maps.csv` (one row per player per map: ideal for pivots, Sheets or pandas), `player_totals.csv`, `teams.csv`, `group_standings.csv`, `matches.csv`, `maps.csv`, `vetoes.csv` and a JSON backup.
- **Display** (`#/display/<event-id>`) — full-screen scenes for the venue TV and OBS: **Live** → Groups → K/D Hardpoint → K/D Hijack → K/D S&D → Team stats → Bracket. The **Live** screen shows every live match with its series score, current map and live map score, then who's on deck and which row to report to. The bottom bar shows live scores and up next, then scrolls the **category leaders** (overall and per-mode K/D, HP obj time, S&D first bloods and plants + defuses, most kills, damage per map). Switch it off in Setup → Display. Brackets with more than 8 teams get a separate upper and lower screen. Each screen shows for 15–30 s (set in Setup), and a Live / Up next bar runs along the bottom. **It updates by itself** when scores are entered on any other laptop. No refresh needed.
  - OBS: add a Browser Source at 1920×1080 with the display link. Add `?bg=transparent` for a transparent background.
  - Link options: `?t=20` sets seconds per screen, `?scene=bracket` shows only that screen.
  - Arrow keys or a click advance to the next screen (handy for testing).

### Map veto (pick/ban)

1. Open a match (click it in the Control panel) and click **Create captain links**. The higher seed is Team A by default, and you can change it.
2. Send each captain **their own link**. Captains open it on their phone with no account needed. Their buttons only work on their turn, and every ban or pick needs a confirm tap. Share the **spectator link** with anyone else.
3. The order follows the event's mode order (default HP → S&D → Hijack → HP → S&D) and each mode's map pool:
   - **Modes played twice (HP, S&D):** each team bans one map. Then the team that started that mode picks the first map and the other team picks its side. The other team picks the second map and the first team picks the side. If only one map is left, it's taken automatically.
   - **Modes played once (Hijack in a Bo5, every mode in a Bo3):** teams alternate bans until one map is left. That's the decider. The team that didn't make the last ban picks the side.
   - Team A starts Hardpoint, Team B starts S&D, Team A starts the third mode.
4. When the veto ends, **the maps and modes fill into the match automatically**. Staff only enter scores.
5. **Show on display**, or **Pin: Map veto** in the Control panel, puts the live veto on the venue TV and stream.

**Overriding the veto (in person).** Staff can take over at any point:
- **Run the veto at the desk:** the same veto, but staff clicks the ban, pick or side for whichever team is up. This works on a captain-link veto too, for example when a captain's phone dies. **Undo last** takes back a choice.
- **Enter maps (veto done in person):** if teams veto out loud or on paper, type in each map, its mode and the starting side. On a veto already in progress, use **Override: enter maps from in person**. This replaces the online veto and fills the maps into the match.
- Staff choices are marked "staff" in the veto log, and the series shows "In person".

Side names default to Attack / Defense for S&D and Side A / Side B for other modes. Security: captain keys are checked by the database itself (`veto_act`). Nobody can act for the other team, act out of turn, or reuse a banned map, even by calling the API directly.

## 1. Put it on GitHub Pages (5 min)

1. Create a new GitHub repo (for example `killfeed`) and upload everything in this folder, keeping the folder structure. The `.nojekyll` file must be included.
2. Go to **Settings → Pages → Build and deployment → Source: Deploy from a branch**. Pick `main` and `/ (root)`, then click **Save**.
3. After about a minute the site is live at `https://<your-username>.github.io/killfeed/`.

At this point it runs in **Demo mode**: everything works, but data stays in each person's browser.

## 2. Turn on accounts and shared team data (Supabase, free tier)

GitHub Pages can only host files. Supabase provides the database, logins and screenshot storage.

1. Create a free project at https://supabase.com.
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql` and click **Run**. This creates the tables, the team-separation security rules and a private `media` storage bucket.
3. Open **Project Settings → API**. Copy the **Project URL** and the **anon public** key into `js/config.js`:
   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...';
   ```
   The anon key is meant to be public. Row Level Security makes sure people only see data for teams they belong to.
4. Open **Authentication → URL Configuration**. Set **Site URL** to your Pages URL and add it under **Redirect URLs**. Email confirmation and sign-in links need this.
5. Commit the change. Visitors now sign up, create a team (they become its owner) and share the invite code from **Team → Members & invites**.

## How the data fits together

```
team ─┬─ members (role)
      ├─ players (roster gamertags)
      └─ matches (scrim / match / tournament, opponent, date)
            └─ games (map, mode, score, VOD link)
                  ├─ stats (one row per player: K, D, A, DMG, OBJ, PL, DEF, FB, CAP)
                  ├─ media (screenshots in storage)
                  └─ vod_marks (timestamped notes)
```

## Updating an existing Supabase project

**After this update, run the whole `supabase/schema.sql` again** (SQL Editor → paste → Run). It's safe to re-run: it only adds what's missing. It creates the event tables, makes public events readable without a login, and turns on live updates for the display. Recent versions added the `game_breakdowns`, `schedule_events` and `player_timeoff` tables and the `teams.schedule_cfg` column. This version adds `teams.home_cfg` (Home layout), `event_teams.row_no` (pinned rows), `event_matches.live` (live map score) and `event_vetoes.source` (online or in person).

### Older note

If you ran `schema.sql` before team colors were added, run this once in the SQL Editor:

```sql
alter table public.teams add column if not exists accent text check (accent ~ '^#[0-9a-fA-F]{6}$');
```

(Re-running the whole `schema.sql` also works and is safe.)

## Customizing

- **Map pool and modes**: set per team in **Team settings**. New maps you type while logging get added automatically.
- **Stat columns**: edit `STAT_FIELDS` in `js/config.js`. To add a stat, also add a column to the `stats` table in `supabase/schema.sql` (`alter table stats add column ...`).
- **Team color**: owners pick one under **Team settings** (presets or any custom color). Buttons and highlights switch to it when you're in that team. Charts keep fixed colors so they read the same for everyone.
- **Fonts**: four styles: **Mix** (default: Chakra Petch headings, IBM Plex Sans text, JetBrains Mono numbers, Big Shoulders Display on the TV), **Tactical HUD**, **Analyst** and **Stadium**. Events choose one for the website and one for the TV screen (Setup → Event / Display screen). The team section saves its choice per device (Team → Font style).
- **Colors**: the default accent is light purple. Winning scores are white and losing scores grey, and the top value in each stat column gets a gold ★.
- **Site name**: `SITE_NAME` in `js/config.js`. Default colors are at the top of `css/styles.css`.

## OCR tips

- Use full-resolution screenshots of the scoreboard: PC captures, or capture-card or console share exports. Phone photos of a TV work much worse.
- Add your roster first so rows match to players.
- The first time you read a mode's scoreboard, set the column dropdowns (for example Kills, Deaths, ignore, Obj time). They're saved per mode in your browser.
- Always glance at the filled numbers before saving. OCR is a big time-saver, not a guarantee.

## Uploading VODs (next step)

VODs are currently **links** (YouTube or Twitch, auto-embedded) or **local files** played in the browser. Unlisted YouTube is the cheapest way to host full matches. To upload video files directly later, the `media` table and storage bucket already support `kind = 'vod'`. Watch Supabase's per-file size limit: 50 MB on the free plan, configurable on paid plans.

## Run locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
(Opening `index.html` directly from disk doesn't work, because ES modules need a web server.)

## Files

```
index.html            app shell
css/styles.css        styles
js/config.js          Supabase keys, stat fields, defaults
js/app.js             router and nav
js/state.js           current team and data cache
js/stats.js           filtering and aggregation (pure functions)
js/home.js            team Home widgets: catalog, layout, numbers
js/event-logic.js     groups, bracket, standings, seating rows, live map, leaders
js/veto.js            map veto rules + staff overrides (act, undo, in-person maps)
js/ocr.js / ocr-parse.js   screenshot reading and scoreboard parsing
js/store/             local (demo) and Supabase data stores, same API
js/views/             home, dashboard, matches, editor, game/VOD, player, settings, teams, auth,
                      events (event, event-control = control panel + rows & pods, event-admin = setup,
                      event-match, display, veto)
supabase/schema.sql   database, security rules, storage
```
