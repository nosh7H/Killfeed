-- ============================================================
-- CoD Team Stats — Supabase schema
-- Run this once in Supabase: SQL Editor → New query → paste → Run
-- Every table is scoped to a team, and Row Level Security makes
-- sure users only ever see data for teams they belong to.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Tables ----------

create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  tag         text check (char_length(tag) <= 6),
  invite_code text not null unique default upper(substr(md5(random()::text), 1, 8)),
  maps        text[] not null default '{}',
  modes       text[] not null default array['Hardpoint','Search & Destroy','Hijack'],
  accent      text check (accent ~ '^#[0-9a-fA-F]{6}$'),
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id      uuid not null references public.teams(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'player' check (role in ('owner','coach','player','viewer')),
  display_name text,
  joined_at    timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.players (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  gamertag   text not null,
  role       text,             -- e.g. AR, SMG, Flex
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- A "match" is a series (scrim block, Bo5, tournament series …)
create table if not exists public.matches (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  type       text not null default 'scrim' check (type in ('scrim','match','tournament','pug')),
  opponent   text,
  played_on  date not null default current_date,
  event      text,
  notes      text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- A "game" is one map within a match
create table if not exists public.games (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  match_id   uuid not null references public.matches(id) on delete cascade,
  game_no    int  not null default 1,
  map        text,
  mode       text,
  team_score int,
  opp_score  int,
  vod_url    text,
  notes      text,
  created_at timestamptz not null default now()
);

create table if not exists public.stats (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  game_id     uuid not null references public.games(id) on delete cascade,
  player_id   uuid references public.players(id) on delete set null,
  player_name text not null,
  kills       int not null default 0,
  deaths      int not null default 0,
  assists     int,
  damage      int,
  obj_time    int,   -- seconds (hill time in Hardpoint)
  plants      int,
  defuses     int,
  captures    int,   -- Control zone captures / ticks
  first_bloods int
);

create table if not exists public.media (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  game_id    uuid not null references public.games(id) on delete cascade,
  kind       text not null default 'screenshot' check (kind in ('screenshot','vod')),
  path       text not null,           -- storage path inside the "media" bucket
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- Timestamped VOD review notes
create table if not exists public.vod_marks (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  game_id    uuid not null references public.games(id) on delete cascade,
  t_seconds  int not null,
  tag        text,                    -- e.g. rotate, trade, util, comms
  note       text not null,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- for projects created before team colors existed (safe to re-run)
alter table public.teams add column if not exists accent text check (accent ~ '^#[0-9a-fA-F]{6}$');

-- Shared team notepad
create table if not exists public.team_notes (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  title      text not null default '',
  body       text not null default '',
  map        text,
  mode       text,
  opponent   text,
  pinned     boolean not null default false,
  updated_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- VOD breakdowns: hill-by-hill / round-by-round tags for one map
create table if not exists public.game_breakdowns (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  game_id    uuid not null unique references public.games(id) on delete cascade,
  source     text not null default 'pov' check (source in ('pov','caster')),
  mode       text,
  data       jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) default auth.uid(),
  updated_at timestamptz not null default now()
);

-- Schedule: upcoming scrims / matches, and player time off
alter table public.teams add column if not exists schedule_cfg jsonb not null default '{}'::jsonb;  -- leagues + colors
alter table public.teams add column if not exists home_cfg jsonb not null default '{}'::jsonb;      -- team home layout (widgets)

create table if not exists public.schedule_events (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  kind       text not null default 'scrim' check (kind in ('scrim','match','tournament','practice')),
  league_id  text,
  title      text,
  opponent   text,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  status     text not null default 'scheduled' check (status in ('scheduled','confirmed','cancelled','done')),
  notes      text,
  match_id   uuid references public.matches(id) on delete set null,
  history    jsonb not null default '[]'::jsonb,       -- reschedules: [{ from, to, at, by }]
  created_by uuid references auth.users(id) default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.player_timeoff (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  repeat     text not null default 'none' check (repeat in ('none','weekly')),
  until      date,
  reason     text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists sched_team_idx on public.schedule_events(team_id, starts_at);
create index if not exists timeoff_team_idx on public.player_timeoff(team_id);

create index if not exists games_team_idx  on public.games(team_id);
create index if not exists stats_team_idx  on public.stats(team_id);
create index if not exists stats_game_idx  on public.stats(game_id);
create index if not exists media_game_idx  on public.media(game_id);
create index if not exists marks_game_idx  on public.vod_marks(game_id);

-- ---------- Helper functions ----------

create or replace function public.is_member(t uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from team_members where team_id = t and user_id = auth.uid());
$$;

create or replace function public.can_edit(t uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from team_members
                 where team_id = t and user_id = auth.uid()
                   and role in ('owner','coach','player'));
$$;

create or replace function public.is_owner(t uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from team_members where team_id = t and user_id = auth.uid() and role = 'owner');
$$;

-- Create a team and make the caller its owner
create or replace function public.create_team(p_name text, p_tag text, p_display text)
returns public.teams language plpgsql security definer set search_path = public as $$
declare t public.teams;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into teams(name, tag, created_by) values (p_name, nullif(p_tag,''), auth.uid()) returning * into t;
  insert into team_members(team_id, user_id, role, display_name) values (t.id, auth.uid(), 'owner', p_display);
  return t;
end $$;

-- Join a team with its invite code
create or replace function public.join_team(p_code text, p_display text)
returns public.teams language plpgsql security definer set search_path = public as $$
declare t public.teams;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into t from teams where invite_code = upper(trim(p_code));
  if t.id is null then raise exception 'Invalid invite code'; end if;
  insert into team_members(team_id, user_id, role, display_name)
  values (t.id, auth.uid(), 'player', p_display)
  on conflict (team_id, user_id) do nothing;
  return t;
end $$;

-- Owners can rotate the invite code
create or replace function public.rotate_invite(p_team uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not is_owner(p_team) then raise exception 'Only owners can do that'; end if;
  c := upper(substr(md5(random()::text), 1, 8));
  update teams set invite_code = c where id = p_team;
  return c;
end $$;

-- ---------- Row Level Security ----------

alter table public.teams        enable row level security;
alter table public.team_members enable row level security;
alter table public.players      enable row level security;
alter table public.matches      enable row level security;
alter table public.games        enable row level security;
alter table public.stats        enable row level security;
alter table public.media        enable row level security;
alter table public.vod_marks    enable row level security;
alter table public.team_notes   enable row level security;
alter table public.game_breakdowns enable row level security;
alter table public.schedule_events enable row level security;
alter table public.player_timeoff enable row level security;

drop policy if exists teams_read   on public.teams;
drop policy if exists teams_update on public.teams;
drop policy if exists teams_delete on public.teams;
create policy teams_read   on public.teams for select using (is_member(id));
create policy teams_update on public.teams for update using (is_owner(id)) with check (is_owner(id));
create policy teams_delete on public.teams for delete using (is_owner(id));

drop policy if exists members_read   on public.team_members;
drop policy if exists members_update on public.team_members;
drop policy if exists members_delete on public.team_members;
create policy members_read   on public.team_members for select using (is_member(team_id));
create policy members_update on public.team_members for update using (is_owner(team_id));
-- owners can remove anyone; anyone can leave
create policy members_delete on public.team_members for delete using (is_owner(team_id) or user_id = auth.uid());

-- Same pattern for every data table: members read, editors write
do $$
declare tbl text;
begin
  foreach tbl in array array['players','matches','games','stats','media','vod_marks','team_notes','game_breakdowns','schedule_events','player_timeoff'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', tbl);
    execute format('drop policy if exists %1$s_write on public.%1$s', tbl);
    execute format('create policy %1$s_read on public.%1$s for select using (is_member(team_id))', tbl);
    execute format('create policy %1$s_write on public.%1$s for all using (can_edit(team_id)) with check (can_edit(team_id))', tbl);
  end loop;
end $$;

-- ---------- Storage (screenshots / VOD files) ----------
-- Private bucket; files are stored under  <team_id>/<game_id>/<file>

insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

drop policy if exists media_read   on storage.objects;
drop policy if exists media_insert on storage.objects;
drop policy if exists media_delete on storage.objects;
create policy media_read on storage.objects for select
  using (bucket_id = 'media' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy media_insert on storage.objects for insert
  with check (bucket_id = 'media' and public.can_edit(((storage.foldername(name))[1])::uuid));
create policy media_delete on storage.objects for delete
  using (bucket_id = 'media' and public.can_edit(((storage.foldername(name))[1])::uuid));

-- ============================================================
-- LAN EVENTS
-- Public events can be READ by anyone (no login) so the stats
-- page, bracket and venue/stream display work for spectators.
-- Only event admins can write.
-- ============================================================

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  starts_on   date,
  venue       text,
  is_public   boolean not null default true,
  accent      text check (accent ~ '^#[0-9a-fA-F]{6}$'),
  settings    jsonb not null default '{}'::jsonb,   -- modes, maps, stations, groups, bracket, display
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

-- The admin code is secret, so it lives in its own admin-only table (never on the public events row)
create table if not exists public.event_secrets (
  event_id    uuid primary key references public.events(id) on delete cascade,
  admin_code  text not null unique default upper(substr(md5(random()::text), 1, 8)),
  staff_code  text unique default upper(substr(md5(random()::text), 1, 8))
);
-- migrate installs from before this change: move the code off the public row
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'events' and column_name = 'admin_code') then
    insert into public.event_secrets(event_id, admin_code) select id, admin_code from public.events on conflict (event_id) do nothing;
    alter table public.events drop column admin_code;
  end if;
end $$;

create table if not exists public.event_admins (
  event_id   uuid not null references public.events(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'admin' check (role in ('owner','admin','staff')),
  display_name text,
  primary key (event_id, user_id)
);

-- older databases: allow the staff role
alter table public.event_admins drop constraint if exists event_admins_role_check;
alter table public.event_admins add constraint event_admins_role_check check (role in ('owner','admin','staff'));

create table if not exists public.event_teams (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  name        text not null,
  tag         text,
  seed        int,
  group_label text,
  created_at  timestamptz not null default now()
);

-- team logo + color (added later; safe to re-run)
alter table public.event_teams add column if not exists logo_path text;
alter table public.event_teams add column if not exists color text;
alter table public.event_teams add column if not exists row_no int;  -- group-stage row the team stays at

create table if not exists public.event_players (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references public.events(id) on delete cascade,
  team_id   uuid not null references public.event_teams(id) on delete cascade,
  gamertag  text not null
);

create table if not exists public.event_matches (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  stage       text not null check (stage in ('group','upper','lower','grand')),
  group_label text,
  round       int not null default 1,
  slot        int not null default 1,
  code        text,                 -- bracket code, e.g. U1-2, L3-1, GF
  team_a      uuid references public.event_teams(id) on delete set null,
  team_b      uuid references public.event_teams(id) on delete set null,
  src_a       text,                 -- bracket source, e.g. S:1, W:U1-2, L:U2-1
  src_b       text,
  best_of     int not null default 5,
  status      text not null default 'scheduled' check (status in ('scheduled','ondeck','live','final')),
  station     text,
  queue_pos   int,
  updated_at  timestamptz not null default now()
);
alter table public.event_matches add column if not exists live jsonb;  -- running score of the map in play: { game_no, a, b }
alter table public.event_matches add column if not exists casted boolean not null default false;  -- caster POV → advanced stats
alter table public.event_matches add column if not exists row_a int;     -- bracket: row team A reports to
alter table public.event_matches add column if not exists row_b int;     -- bracket: row team B reports to
alter table public.event_matches add column if not exists match_no int;  -- permanent match number for records
alter table public.event_matches add column if not exists started_at timestamptz;  -- went live (for estimated start times)
alter table public.event_matches add column if not exists ended_at timestamptz;    -- went final

create table if not exists public.event_games (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references public.events(id) on delete cascade,
  match_id  uuid not null references public.event_matches(id) on delete cascade,
  game_no   int not null default 1,
  map       text,
  mode      text,
  a_score   int,
  b_score   int
);

-- the map's winner when staff only record who won (final score added later, or never)
alter table public.event_games add column if not exists winner text check (winner in ('a', 'b'));

create table if not exists public.event_stats (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  game_id      uuid not null references public.event_games(id) on delete cascade,
  team_id      uuid references public.event_teams(id) on delete set null,
  player_id    uuid references public.event_players(id) on delete set null,
  player_name  text not null,
  kills int not null default 0, deaths int not null default 0,
  assists int, damage int, obj_time int, plants int, defuses int, first_bloods int, captures int
);
-- caster-only stats (entered for casted matches)
alter table public.event_stats add column if not exists non_traded_kills int;
alter table public.event_stats add column if not exists highest_streak int;
alter table public.event_stats add column if not exists avg_hill_time int;   -- seconds
alter table public.event_stats add column if not exists obj_kills int;
alter table public.event_stats add column if not exists contested_time int;  -- seconds

create table if not exists public.event_media (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  game_id    uuid not null references public.event_games(id) on delete cascade,
  path       text not null,
  created_at timestamptz not null default now()
);

create index if not exists ev_matches_idx on public.event_matches(event_id);
create index if not exists ev_games_idx   on public.event_games(event_id);
create index if not exists ev_stats_idx   on public.event_stats(event_id);

alter table public.event_secrets add column if not exists staff_code text unique default upper(substr(md5(random()::text), 1, 8));
update public.event_secrets set staff_code = upper(substr(md5(random()::text || event_id::text), 1, 8)) where staff_code is null;

create or replace function public.is_event_admin(e uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from event_admins where event_id = e and user_id = auth.uid());
$$;
-- owner or admin (not staff): setup, teams, groups, seeding, captain links, members
create or replace function public.is_event_manager(e uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from event_admins where event_id = e and user_id = auth.uid() and role in ('owner', 'admin'));
$$;
create or replace function public.is_event_staff(e uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from event_admins where event_id = e and user_id = auth.uid() and role = 'staff');
$$;

create or replace function public.event_visible(e uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from events where id = e and is_public) or is_event_admin(e);
$$;

create or replace function public.create_event(p_name text, p_display text)
returns public.events language plpgsql security definer set search_path = public as $$
declare ev public.events;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into events(name, created_by) values (p_name, auth.uid()) returning * into ev;
  insert into event_secrets(event_id) values (ev.id);
  insert into event_admins(event_id, user_id, role, display_name) values (ev.id, auth.uid(), 'owner', p_display);
  return ev;
end $$;

create or replace function public.join_event_admin(p_code text, p_display text)
returns public.events language plpgsql security definer set search_path = public as $$
declare ev public.events; new_role text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  -- the admin code makes an admin, the staff code a staff member (an admin code later upgrades staff)
  select case when s.admin_code = upper(trim(p_code)) then 'admin' else 'staff' end into new_role
    from event_secrets s where s.admin_code = upper(trim(p_code)) or s.staff_code = upper(trim(p_code));
  select e.* into ev from events e join event_secrets s on s.event_id = e.id
    where s.admin_code = upper(trim(p_code)) or s.staff_code = upper(trim(p_code));
  if ev.id is null then raise exception 'Invalid code'; end if;
  insert into event_admins(event_id, user_id, role, display_name) values (ev.id, auth.uid(), new_role, p_display)
  on conflict (event_id, user_id) do update set role = 'admin' where event_admins.role = 'staff' and excluded.role = 'admin';
  return ev;
end $$;

alter table public.events        enable row level security;
alter table public.event_admins  enable row level security;
alter table public.event_secrets enable row level security;
drop policy if exists ev_secrets_admin on public.event_secrets;
create policy ev_secrets_admin on public.event_secrets for select using (is_event_manager(event_id));  -- staff never see the codes

drop policy if exists events_read   on public.events;
drop policy if exists events_write  on public.events;
drop policy if exists events_delete on public.events;
create policy events_read   on public.events for select using (is_public or is_event_admin(id));
create policy events_write  on public.events for update using (is_event_admin(id)) with check (is_event_admin(id));
create policy events_delete on public.events for delete
  using (exists (select 1 from event_admins where event_id = id and user_id = auth.uid() and role = 'owner'));

drop policy if exists ev_admins_read on public.event_admins;
drop policy if exists ev_admins_delete on public.event_admins;
create policy ev_admins_read   on public.event_admins for select using (is_event_admin(event_id));
create policy ev_admins_delete on public.event_admins for delete using ((is_event_manager(event_id) and role <> 'owner') or user_id = auth.uid());
drop policy if exists ev_admins_update on public.event_admins;
-- admins switch members between admin and staff; the owner stays the owner
create policy ev_admins_update on public.event_admins for update using (is_event_manager(event_id) and role <> 'owner') with check (role in ('admin', 'staff'));

do $$
declare tbl text;
begin
  foreach tbl in array array['event_teams','event_players','event_matches','event_games','event_stats','event_media'] loop
    execute format('alter table public.%1$s enable row level security', tbl);
    execute format('drop policy if exists %1$s_read on public.%1$s', tbl);
    execute format('drop policy if exists %1$s_write on public.%1$s', tbl);
    execute format('create policy %1$s_read on public.%1$s for select using (event_visible(event_id))', tbl);
    execute format('drop policy if exists %1$s_ins on public.%1$s', tbl);
    execute format('drop policy if exists %1$s_upd on public.%1$s', tbl);
    execute format('drop policy if exists %1$s_del on public.%1$s', tbl);
    if tbl in ('event_teams', 'event_matches') then
      -- staff can update (guarded by the triggers below); only admins add or remove teams and matches
      execute format('create policy %1$s_ins on public.%1$s for insert with check (is_event_manager(event_id))', tbl);
      execute format('create policy %1$s_upd on public.%1$s for update using (is_event_admin(event_id)) with check (is_event_admin(event_id))', tbl);
      execute format('create policy %1$s_del on public.%1$s for delete using (is_event_manager(event_id))', tbl);
    else
      execute format('create policy %1$s_write on public.%1$s for all using (is_event_admin(event_id)) with check (is_event_admin(event_id))', tbl);
    end if;
  end loop;
end $$;

-- ---------- what staff (not admins) may change ----------
-- events: only the display remote, coin flips and which group session is playing now
create or replace function public._staff_guard_event() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if is_event_staff(new.id) and not is_event_manager(new.id) then
    if (to_jsonb(new) - 'settings') is distinct from (to_jsonb(old) - 'settings')
       or ((coalesce(new.settings, '{}') #- '{seating,current}') - 'display' - 'coin_flips' - 'overlays')
          is distinct from ((coalesce(old.settings, '{}') #- '{seating,current}') - 'display' - 'coin_flips' - 'overlays') then
      raise exception 'Only event admins can change this. Staff can run matches, the display, stream overlays and coin flips.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists staff_guard_event on public.events;
create trigger staff_guard_event before update on public.events for each row execute function public._staff_guard_event();

-- teams: staff can pin rows and clear staff calls, nothing else
create or replace function public._staff_guard_team() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if is_event_staff(new.event_id) and not is_event_manager(new.event_id)
     and (to_jsonb(new) - 'row_no' - 'help') is distinct from (to_jsonb(old) - 'row_no' - 'help') then
    raise exception 'Only event admins can change teams. Staff can pin rows and handle staff calls.';
  end if;
  return new;
end $$;
drop trigger if exists staff_guard_team on public.event_teams;
create trigger staff_guard_team before update on public.event_teams for each row execute function public._staff_guard_team();

-- matches: staff run them (status, rows, queue, live map, check-ins, reports, casted), but not the structure
create or replace function public._staff_guard_match() returns trigger language plpgsql security definer set search_path = public as $$
declare keep text[] := array['stage','round','slot','code','src_a','src_b','group_label','team_a','team_b','best_of','match_no','event_id'];
        k text;
begin
  if is_event_staff(new.event_id) and not is_event_manager(new.event_id) then
    foreach k in array keep loop
      if (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
        raise exception 'Only event admins can change the schedule or bracket (%).', k;
      end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists staff_guard_match on public.event_matches;
create trigger staff_guard_match before update on public.event_matches for each row execute function public._staff_guard_match();

-- Event screenshots live in the same private bucket under <event_id>/<game_id>/<file>
drop policy if exists ev_media_read   on storage.objects;
drop policy if exists ev_media_insert on storage.objects;
drop policy if exists ev_media_delete on storage.objects;
create policy ev_media_read on storage.objects for select
  using (bucket_id = 'media' and public.event_visible(((storage.foldername(name))[1])::uuid));
create policy ev_media_insert on storage.objects for insert
  with check (bucket_id = 'media' and public.is_event_admin(((storage.foldername(name))[1])::uuid));
create policy ev_media_delete on storage.objects for delete
  using (bucket_id = 'media' and public.is_event_admin(((storage.foldername(name))[1])::uuid));

-- Live updates: stream changes to the display screen and every open page
do $$
declare tbl text;
begin
  foreach tbl in array array['events','event_teams','event_players','event_matches','event_games','event_stats'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end $$;

-- ============================================================
-- MAP VETO
-- event_vetoes is public (spectators + display can watch).
-- The captain keys live in a separate admin-only table, and the
-- only way to act is veto_act(), which checks the key and turn.
-- ============================================================

create table if not exists public.event_vetoes (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  match_id    uuid not null references public.event_matches(id) on delete cascade,
  team_a      uuid references public.event_teams(id) on delete set null,
  team_b      uuid references public.event_teams(id) on delete set null,
  steps       jsonb not null,
  pools       jsonb not null,
  actions     jsonb not null default '[]'::jsonb,
  status      text not null default 'pending' check (status in ('pending','active','done')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- online = captain links · in_person = staff typed in the maps (staff overrides on an online veto are flagged per action)
alter table public.event_vetoes add column if not exists source text not null default 'online';

create table if not exists public.event_veto_keys (
  veto_id   uuid primary key references public.event_vetoes(id) on delete cascade,
  event_id  uuid not null references public.events(id) on delete cascade,
  key_a     text not null,
  key_b     text not null
);

alter table public.event_vetoes    enable row level security;
alter table public.event_veto_keys enable row level security;
drop policy if exists event_vetoes_read  on public.event_vetoes;
drop policy if exists event_vetoes_write on public.event_vetoes;
drop policy if exists event_veto_keys_all on public.event_veto_keys;
create policy event_vetoes_read  on public.event_vetoes for select using (event_visible(event_id));
create policy event_vetoes_write on public.event_vetoes for all using (is_event_admin(event_id)) with check (is_event_admin(event_id));
create policy event_veto_keys_all on public.event_veto_keys for all using (is_event_admin(event_id)) with check (is_event_admin(event_id));

-- Which team does this captain link belong to? ('a', 'b' or null)
-- ============================================================
-- ROLES: viewer (public link) · player (picks their team, no login)
--        captain (private link per team) · admin/staff (event_admins)
-- Captains act only through the functions below, which check their key.
-- ============================================================
create table if not exists public.event_team_keys (
  team_id     uuid primary key references public.event_teams(id) on delete cascade,
  event_id    uuid not null references public.events(id) on delete cascade,
  captain_key text not null unique
);
alter table public.event_team_keys enable row level security;
drop policy if exists event_team_keys_all on public.event_team_keys;
drop policy if exists event_team_keys_read on public.event_team_keys;
drop policy if exists event_team_keys_write on public.event_team_keys;
create policy event_team_keys_read  on public.event_team_keys for select using (is_event_admin(event_id));
create policy event_team_keys_write on public.event_team_keys for all using (is_event_manager(event_id)) with check (is_event_manager(event_id));

alter table public.event_matches add column if not exists checkin jsonb not null default '{}'::jsonb;  -- { <team_id>: timestamp }
alter table public.event_matches add column if not exists reports jsonb not null default '{}'::jsonb;  -- { <team_id>: { games: [{game_no, us, them}], at } }
alter table public.event_teams   add column if not exists help jsonb;                                   -- staff call: { at, note }

-- which team a captain link belongs to (null = not a captain link for this event)
-- ---------- activity log: who changed what (staff and captains), with the data before/after for revert ----------
create table if not exists public.event_log (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references public.events(id) on delete cascade,
  at        timestamptz not null default now(),
  actor     text,                 -- staff name, or 'Captain · NOWL'
  group_id  text,                 -- writes from one action share a group (reverted together)
  kind      text,                 -- 'staff' | 'captain' | 'revert'
  summary   text,
  match_id  uuid,                 -- no foreign key: the log outlives deleted matches
  before    jsonb,                -- { table: [rows] } as they were (null = new rows)
  after     jsonb,                -- { table: [rows] } as written
  reverts   text                  -- group_id this entry undid
);
create index if not exists ev_log_idx on public.event_log(event_id, at desc);
alter table public.event_log enable row level security;
drop policy if exists ev_log_read on public.event_log;
drop policy if exists ev_log_write on public.event_log;
create policy ev_log_read  on public.event_log for select using (is_event_admin(event_id));
create policy ev_log_write on public.event_log for insert with check (is_event_admin(event_id));
-- no update / delete policy: entries can't be edited or removed (they go when the event is deleted)

create or replace function public._log(p_event uuid, p_match uuid, p_team uuid, p_summary text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into event_log(event_id, match_id, actor, kind, summary, group_id)
  values (p_event, p_match, 'Captain · ' || coalesce((select coalesce(nullif(tag, ''), name) from event_teams where id = p_team), '?'), 'captain', p_summary, gen_random_uuid()::text);
end $$;
revoke execute on function public._log(uuid, uuid, uuid, text) from public, anon, authenticated;

create or replace function public.captain_team(p_event uuid, p_key text)
returns uuid language sql security definer stable set search_path = public as $$
  select team_id from event_team_keys where event_id = p_event and captain_key = p_key;
$$;

create or replace function public._captain(p_key text)
returns event_team_keys language plpgsql security definer stable set search_path = public as $$
declare k event_team_keys;
begin
  select * into k from event_team_keys where captain_key = p_key;
  if k.team_id is null then raise exception 'This captain link is not valid'; end if;
  return k;
end $$;

-- the match must be in this event, not final, and (for group matches) include the team
create or replace function public._captain_match(k event_team_keys, p_match uuid)
returns event_matches language plpgsql security definer stable set search_path = public as $$
declare m event_matches;
begin
  select * into m from event_matches where id = p_match and event_id = k.event_id;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.status = 'final' then raise exception 'This match is already final.'; end if;
  if k.team_id::text not in (coalesce(_match_team(m.id, 'a'), '-'), coalesce(_match_team(m.id, 'b'), '-')) then raise exception 'Your team is not in this match.'; end if;
  return m;
end $$;

create or replace function public.captain_checkin(p_key text, p_match uuid, p_ready boolean)
returns void language plpgsql security definer set search_path = public as $$
declare k event_team_keys; m event_matches;
begin
  k := _captain(p_key); m := _captain_match(k, p_match);
  update event_matches set checkin = case when p_ready then checkin || jsonb_build_object(k.team_id::text, now()) else checkin - k.team_id::text end,
    updated_at = now() where id = m.id;
  perform _log(k.event_id, m.id, k.team_id, case when p_ready then 'Checked in' else 'Undid check-in' end || coalesce(' for match ' || m.match_no, ''));
end $$;

-- p_games: [{ "game_no": 1, "us": 250, "them": 201 }, ...] (from the captain's side)
create or replace function public.captain_report(p_key text, p_match uuid, p_games jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare k event_team_keys; m event_matches; t text;
begin
  k := _captain(p_key); m := _captain_match(k, p_match); t := k.team_id::text;
  if jsonb_typeof(p_games) <> 'array' or jsonb_array_length(p_games) > 9 then raise exception 'Bad report'; end if;
  update event_matches set reports = reports || jsonb_build_object(t, coalesce(reports -> t, '{}'::jsonb) || jsonb_build_object('games', p_games, 'at', now())),
    updated_at = now() where id = m.id;
  perform _log(k.event_id, m.id, k.team_id, 'Reported a score' || coalesce(' for match ' || m.match_no, '') || ': ' ||
    coalesce((select string_agg('map ' || (g->>'game_no') || ' ' || coalesce(g->>'us', '?') || '–' || coalesce(g->>'them', '?'), ', ') from jsonb_array_elements(p_games) g), 'no maps'));
end $$;

-- Scoreboard photos from captains. Captains don't sign in, so they can't write to Storage;
-- a small JPEG goes through this checked function instead. Staff read them, then they move into
-- the match's screenshots (Storage) when the result is approved.
create table if not exists public.event_report_shots (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  match_id   uuid not null references public.event_matches(id) on delete cascade,
  team_id    uuid not null references public.event_teams(id) on delete cascade,
  game_no    int not null,
  image      text not null,            -- data:image/jpeg;base64,…
  created_at timestamptz not null default now()
);
create index if not exists ev_report_shots_idx on public.event_report_shots(match_id);
alter table public.event_report_shots enable row level security;
drop policy if exists event_report_shots_all on public.event_report_shots;
create policy event_report_shots_all on public.event_report_shots for all using (is_event_admin(event_id)) with check (is_event_admin(event_id));

create or replace function public.captain_shot(p_key text, p_match uuid, p_game int, p_image text)
returns uuid language plpgsql security definer set search_path = public as $$
declare k event_team_keys; m event_matches; t text; new_id uuid;
begin
  k := _captain(p_key); t := k.team_id::text;
  -- photos are welcome after the match is over too (the last map's tap closes it)
  select * into m from event_matches where id = p_match and event_id = k.event_id;
  if m.id is null then raise exception 'Match not found'; end if;
  if t not in (coalesce(_match_team(m.id, 'a'), '-'), coalesce(_match_team(m.id, 'b'), '-')) then raise exception 'Your team is not in this match.'; end if;
  if m.status = 'final' and m.ended_at < now() - interval '3 hours' then raise exception 'This match ended a while ago — ask staff.'; end if;
  if p_game is null or p_game < 1 or p_game > 9 then raise exception 'Pick a map'; end if;
  if p_image not like 'data:image/jpeg;base64,%' then raise exception 'Send a photo'; end if;
  if length(p_image) > 1200000 then raise exception 'That photo is too large'; end if;
  if (select count(*) from event_report_shots where match_id = m.id and team_id = k.team_id) >= 12 then
    raise exception 'Photo limit reached for this match — ask staff'; end if;
  insert into event_report_shots(event_id, match_id, team_id, game_no, image) values (k.event_id, m.id, k.team_id, p_game, p_image) returning id into new_id;
  update event_matches set reports = reports || jsonb_build_object(t, coalesce(reports -> t, '{}'::jsonb)
      || jsonb_build_object('shots', coalesce(reports -> t -> 'shots', '[]'::jsonb) || to_jsonb(p_game), 'at', now())),
    updated_at = now() where id = m.id;
  perform _log(k.event_id, m.id, k.team_id, 'Sent a scoreboard photo of map ' || p_game || coalesce(' (match ' || m.match_no || ')', ''));
  return new_id;
end $$;
grant execute on function public.captain_shot(text, uuid, int, text) to anon, authenticated;

create or replace function public.captain_help(p_key text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare k event_team_keys;
begin
  k := _captain(p_key);
  update event_teams set help = case when p_note is null then null else jsonb_build_object('at', now(), 'note', left(p_note, 140)) end
  where id = k.team_id;
  perform _log(k.event_id, null, k.team_id, case when p_note is null then 'Cancelled the staff call' else 'Called staff: ' || left(p_note, 140) end);
end $$;

-- captains fix their gamertags (same number of rows or more; extra rows are removed)
create or replace function public.captain_roster(p_key text, p_names text[])
returns void language plpgsql security definer set search_path = public as $$
declare k event_team_keys; ids uuid[]; i int; n text;
begin
  k := _captain(p_key);
  if coalesce(array_length(p_names, 1), 0) > 8 then raise exception 'At most 8 players'; end if;
  ids := array(select id from event_players where team_id = k.team_id order by gamertag);
  for i in 1..coalesce(array_length(p_names, 1), 0) loop
    n := left(trim(p_names[i]), 32);
    continue when n = '';
    if i <= coalesce(array_length(ids, 1), 0) then update event_players set gamertag = n where id = ids[i];
    else insert into event_players(event_id, team_id, gamertag) values (k.event_id, k.team_id, n); end if;
  end loop;
  delete from event_players where team_id = k.team_id and id = any(ids[coalesce(array_length(p_names, 1), 0) + 1:]);
  perform _log(k.event_id, null, k.team_id, 'Updated the roster: ' || array_to_string(p_names, ', '));
end $$;

-- ---------- map winners from captains: one tap per map, counts right away ----------
alter table public.event_games add column if not exists win_by uuid;     -- team whose captain tapped the winner
alter table public.event_games add column if not exists win_check text check (win_check in ('ok', 'disputed'));  -- the other captain's answer
alter table public.event_games add column if not exists win_at timestamptz;

-- a map's winner: the score when both are entered, else the tapped winner (same as gameWinner() in js/event-logic.js)
create or replace function public._game_winner(g public.event_games) returns text language sql immutable as $$
  select case when g.a_score is not null and g.b_score is not null and g.a_score <> g.b_score
              then case when g.a_score > g.b_score then 'a' else 'b' end else g.winner end $$;

-- maps won per side and the series winner (same as seriesResult())
create or replace function public._series(p_match uuid, out a int, out b int, out winner text)
language plpgsql stable security definer set search_path = public as $$
declare m event_matches; need int;
begin
  select * into m from event_matches where id = p_match;
  select count(*) filter (where _game_winner(g) = 'a'), count(*) filter (where _game_winner(g) = 'b') into a, b
  from event_games g where g.match_id = p_match;
  need := coalesce(m.best_of, 5) / 2 + 1;
  winner := case when a >= need then 'a' when b >= need then 'b'
                 when m.status = 'final' and a <> b then case when a > b then 'a' else 'b' end end;
end $$;

-- the team in one slot of a match ('a' / 'b'): set directly for groups; for the bracket, from the seeds
-- or the winner / loser of the match it comes from (same as resolveMatches()). Returns a team id, 'BYE' or null.
create or replace function public._match_team(p_match uuid, p_side text, p_depth int default 0)
returns text language plpgsql stable security definer set search_path = public as $$
declare m event_matches; f event_matches; src text; kind text; ref text; fa text; fb text; sr record; w text; l text; seeds jsonb;
begin
  if p_depth > 24 then return null; end if;
  select * into m from event_matches where id = p_match;
  if m.id is null then return null; end if;
  if p_side = 'a' and m.team_a is not null then return m.team_a::text; end if;
  if p_side = 'b' and m.team_b is not null then return m.team_b::text; end if;
  src := case p_side when 'a' then m.src_a else m.src_b end;
  if src is null then return null; end if;
  kind := split_part(src, ':', 1); ref := split_part(src, ':', 2);
  if kind = 'S' then
    select settings -> 'seeds' into seeds from events where id = m.event_id;
    if seeds is null or jsonb_typeof(seeds) <> 'array' then return null; end if;
    if ref::int > jsonb_array_length(seeds) then return 'BYE'; end if;
    return seeds ->> (ref::int - 1);
  end if;
  select * into f from event_matches where event_id = m.event_id and code = ref;
  if f.id is null then return null; end if;
  fa := _match_team(f.id, 'a', p_depth + 1); fb := _match_team(f.id, 'b', p_depth + 1);
  if fa = 'BYE' and fb = 'BYE' then w := 'BYE'; l := 'BYE';
  elsif fa = 'BYE' and fb is not null then w := fb; l := 'BYE';
  elsif fb = 'BYE' and fa is not null then w := fa; l := 'BYE';
  elsif fa is not null and fb is not null then
    sr := _series(f.id);
    if sr.winner = 'a' then w := fa; l := fb; elsif sr.winner = 'b' then w := fb; l := fa; end if;
  end if;
  return case kind when 'W' then w when 'L' then l end;
end $$;

-- "We won map 2" / "They won map 2". Only the next map can be reported; the series, groups and bracket update at once.
create or replace function public.captain_map_won(p_key text, p_match uuid, p_game int, p_we_won boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k event_team_keys; m event_matches; side text; w text; decided int; gid uuid; need int; s record; wtag text;
begin
  k := _captain(p_key);
  select * into m from event_matches where id = p_match and event_id = k.event_id for update;
  if m.id is null then raise exception 'Match not found'; end if;
  if m.status = 'final' then raise exception 'This match is already over.'; end if;
  side := case k.team_id::text when _match_team(m.id, 'a') then 'a' when _match_team(m.id, 'b') then 'b' end;
  if side is null then raise exception 'Your team is not in this match.'; end if;
  need := coalesce(m.best_of, 5) / 2 + 1;
  s := _series(m.id);
  if s.a >= need or s.b >= need then raise exception 'The series is already decided.'; end if;
  select count(*) into decided from event_games g where g.match_id = m.id and _game_winner(g) is not null;
  if p_game <= decided then raise exception 'Map % was already reported. Refresh the page.', p_game; end if;
  if p_game > decided + 1 then raise exception 'Report map % first.', decided + 1; end if;
  w := case when p_we_won then side when side = 'a' then 'b' else 'a' end;
  update event_games set winner = w, win_by = k.team_id, win_check = null, win_at = now()
    where match_id = m.id and game_no = p_game returning id into gid;
  if gid is null then
    insert into event_games(event_id, match_id, game_no, winner, win_by, win_at) values (m.event_id, m.id, p_game, w, k.team_id, now());
  end if;
  s := _series(m.id);
  if s.a >= need or s.b >= need then
    update event_matches set status = 'final', live = null, started_at = coalesce(started_at, now()), ended_at = now(), updated_at = now() where id = m.id;
  else
    update event_matches set status = 'live', live = jsonb_build_object('game_no', p_game + 1), started_at = coalesce(started_at, now()), updated_at = now() where id = m.id;
  end if;
  select coalesce(nullif(tag, ''), name) into wtag from event_teams where id::text = _match_team(m.id, w);
  perform _log(k.event_id, m.id, k.team_id, 'Map ' || p_game || ' won by ' || coalesce(wtag, '?') || ' · series ' || s.a || '–' || s.b
    || case when s.a >= need or s.b >= need then ' (final)' else '' end);
  return jsonb_build_object('a', s.a, 'b', s.b, 'done', s.a >= need or s.b >= need);
end $$;

-- the other captain confirms or disputes a tapped map winner (disputes go to staff; nothing changes until they decide)
create or replace function public.captain_map_check(p_key text, p_match uuid, p_game int, p_ok boolean)
returns void language plpgsql security definer set search_path = public as $$
declare k event_team_keys; m event_matches; g event_games;
begin
  k := _captain(p_key);
  select * into m from event_matches where id = p_match and event_id = k.event_id;
  if m.id is null then raise exception 'Match not found'; end if;
  if k.team_id::text not in (coalesce(_match_team(m.id, 'a'), '-'), coalesce(_match_team(m.id, 'b'), '-')) then raise exception 'Your team is not in this match.'; end if;
  select * into g from event_games where match_id = m.id and game_no = p_game;
  if g.id is null or g.win_by is null then raise exception 'Nothing to check for that map.'; end if;
  if g.win_by = k.team_id then raise exception 'The other team checks this one.'; end if;
  if g.win_check is not null then raise exception 'Already answered.'; end if;
  update event_games set win_check = case when p_ok then 'ok' else 'disputed' end where id = g.id;
  perform _log(k.event_id, m.id, k.team_id, case when p_ok then 'Confirmed' else 'Disputed' end || ' the map ' || p_game || ' result');
end $$;

grant execute on function public.captain_map_won(text, uuid, int, boolean) to anon, authenticated;
grant execute on function public.captain_map_check(text, uuid, int, boolean) to anon, authenticated;
revoke execute on function public._match_team(uuid, text, int) from public, anon, authenticated;
revoke execute on function public._series(uuid) from public, anon, authenticated;

grant execute on function public.captain_team(uuid, text) to anon, authenticated;
grant execute on function public.captain_checkin(text, uuid, boolean) to anon, authenticated;
grant execute on function public.captain_report(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.captain_help(text, text) to anon, authenticated;
grant execute on function public.captain_roster(text, text[]) to anon, authenticated;
revoke execute on function public._captain(text) from public, anon, authenticated;
revoke execute on function public._captain_match(event_team_keys, uuid) from public, anon, authenticated;

create or replace function public.veto_whoami(p_veto uuid, p_key text)
returns text language sql security definer stable set search_path = public as $$
  select case when p_key = k.key_a or exists (select 1 from event_team_keys t where t.team_id = v.team_a and t.captain_key = p_key) then 'a'
              when p_key = k.key_b or exists (select 1 from event_team_keys t where t.team_id = v.team_b and t.captain_key = p_key) then 'b' end
  from event_vetoes v left join event_veto_keys k on k.veto_id = v.id where v.id = p_veto;
$$;

-- One captain action. Mirrors applyVeto() in js/veto.js.
create or replace function public.veto_act(p_veto uuid, p_key text, p_choice text)
returns public.event_vetoes language plpgsql security definer set search_path = public as $$
declare
  v event_vetoes; k event_veto_keys; side text; idx int; st jsonb; used text[]; remaining text[]; a jsonb; g int; st_kind text; st_mode text;
begin
  select * into v from event_vetoes where id = p_veto for update;
  if v.id is null then raise exception 'Veto not found'; end if;
  select * into k from event_veto_keys where veto_id = p_veto;
  -- a veto link, or the team's captain link
  if p_key = k.key_a or exists (select 1 from event_team_keys t where t.team_id = v.team_a and t.captain_key = p_key) then side := 'a';
  elsif p_key = k.key_b or exists (select 1 from event_team_keys t where t.team_id = v.team_b and t.captain_key = p_key) then side := 'b';
  else raise exception 'This captain link is not valid'; end if;

  idx := jsonb_array_length(v.actions);
  st := v.steps -> idx;
  if st is null then raise exception 'The veto is already finished.'; end if;
  if st->>'team' is distinct from side then raise exception 'It is not your turn.'; end if;
  st_kind := st->>'kind'; st_mode := st->>'mode';

  if st->>'kind' = 'side' then
    if not (st->'options') ? p_choice then raise exception 'Pick one of the listed sides.'; end if;
  else
    used := array(select x->>'choice' from jsonb_array_elements(v.actions) x where x->>'mode' = st->>'mode' and x->>'kind' <> 'side');
    if not (v.pools -> (st->>'mode')) ? p_choice or p_choice = any(used) then
      raise exception 'That map is no longer available.';
    end if;
  end if;

  v.actions := v.actions || jsonb_build_array(jsonb_build_object(
    'i', idx, 'kind', st->>'kind', 'mode', st->>'mode', 'team', side, 'choice', p_choice, 'slot', st->'slot', 'at', now()));

  -- forced deciders (only one map left)
  loop
    idx := jsonb_array_length(v.actions);
    st := v.steps -> idx;
    exit when st is null or st->>'kind' <> 'decider';
    used := array(select x->>'choice' from jsonb_array_elements(v.actions) x where x->>'mode' = st->>'mode' and x->>'kind' <> 'side');
    remaining := array(select m from jsonb_array_elements_text(v.pools -> (st->>'mode')) m where not (m = any(used)));
    exit when coalesce(array_length(remaining, 1), 0) <> 1;
    v.actions := v.actions || jsonb_build_array(jsonb_build_object(
      'i', idx, 'kind', 'decider', 'mode', st->>'mode', 'team', null, 'choice', remaining[1], 'slot', st->'slot', 'at', now()));
  end loop;

  if jsonb_array_length(v.actions) >= jsonb_array_length(v.steps) then
    v.status := 'done';
    -- write the vetoed maps into the match
    for a in select * from jsonb_array_elements(v.actions) loop
      if a->>'kind' in ('pick', 'decider') then
        g := (a->>'slot')::int;
        update event_games set map = a->>'choice', mode = a->>'mode' where match_id = v.match_id and game_no = g;
        if not found then
          insert into event_games(event_id, match_id, game_no, map, mode) values (v.event_id, v.match_id, g, a->>'choice', a->>'mode');
        end if;
      end if;
    end loop;
  else
    v.status := 'active';
  end if;

  update event_vetoes set actions = v.actions, status = v.status, updated_at = now() where id = v.id returning * into v;
  perform _log(v.event_id, v.match_id, case side when 'a' then v.team_a else v.team_b end,
    'Veto: ' || case when st_kind = 'side' then 'picked side ' else st_kind || ' ' end || p_choice || ' (' || st_mode || ')');
  return v;
end $$;

grant execute on function public.veto_act(uuid, text, text) to anon, authenticated;
grant execute on function public.veto_whoami(uuid, text) to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_vetoes') then
    alter publication supabase_realtime add table public.event_vetoes;
  end if;
end $$;
