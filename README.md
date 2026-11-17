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
- **Data.** Export CSV (all games or the filtered view), back up and restore with JSON.
- **Demo mode.** It works with no backend; data stays in the browser. A **Load sample team** button fills it with example data.
- **Try the demo.** Once Supabase is connected, the sign-in page has a **Try the demo** button. Visitors can explore a sample team in their own browser without an account. To hide it, add `export const SHOW_DEMO = false;` to `js/config.js`.

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

If you ran `schema.sql` before team colors were added, run this once in the SQL Editor:

```sql
alter table public.teams add column if not exists accent text check (accent ~ '^#[0-9a-fA-F]{6}$');
```

(Re-running the whole `schema.sql` also works and is safe.)

## Customizing

- **Map pool and modes**: set per team in **Team settings**. New maps you type while logging get added automatically.
- **Stat columns**: edit `STAT_FIELDS` in `js/config.js`. To add a stat, also add a column to the `stats` table in `supabase/schema.sql` (`alter table stats add column ...`).
- **Team color**: owners pick one under **Team settings** (presets or any custom color). Buttons and highlights switch to it when you're in that team. Charts keep fixed colors so they read the same for everyone.
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
js/ocr.js / ocr-parse.js   screenshot reading and scoreboard parsing
js/store/             local (demo) and Supabase data stores, same API
js/views/             dashboard, matches, editor, game/VOD, player, settings, teams, auth
supabase/schema.sql   database, security rules, storage
```
