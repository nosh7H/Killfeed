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
  admin_code  text not null unique default upper(substr(md5(random()::text), 1, 8))
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
  role       text not null default 'admin' check (role in ('owner','admin')),
  display_name text,
  primary key (event_id, user_id)
);

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

create or replace function public.is_event_admin(e uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from event_admins where event_id = e and user_id = auth.uid());
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
declare ev public.events;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select e.* into ev from events e join event_secrets s on s.event_id = e.id where s.admin_code = upper(trim(p_code));
  if ev.id is null then raise exception 'Invalid admin code'; end if;
  insert into event_admins(event_id, user_id, role, display_name) values (ev.id, auth.uid(), 'admin', p_display)
  on conflict (event_id, user_id) do nothing;
  return ev;
end $$;

alter table public.events        enable row level security;
alter table public.event_admins  enable row level security;
alter table public.event_secrets enable row level security;
drop policy if exists ev_secrets_admin on public.event_secrets;
create policy ev_secrets_admin on public.event_secrets for select using (is_event_admin(event_id));

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
create policy ev_admins_delete on public.event_admins for delete using (is_event_admin(event_id));

do $$
declare tbl text;
begin
  foreach tbl in array array['event_teams','event_players','event_matches','event_games','event_stats','event_media'] loop
    execute format('alter table public.%1$s enable row level security', tbl);
    execute format('drop policy if exists %1$s_read on public.%1$s', tbl);
    execute format('drop policy if exists %1$s_write on public.%1$s', tbl);
    execute format('create policy %1$s_read on public.%1$s for select using (event_visible(event_id))', tbl);
    execute format('create policy %1$s_write on public.%1$s for all using (is_event_admin(event_id)) with check (is_event_admin(event_id))', tbl);
  end loop;
end $$;

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
create or replace function public.veto_whoami(p_veto uuid, p_key text)
returns text language sql security definer stable set search_path = public as $$
  select case when p_key = key_a then 'a' when p_key = key_b then 'b' end
  from event_veto_keys where veto_id = p_veto;
$$;

-- One captain action. Mirrors applyVeto() in js/veto.js.
create or replace function public.veto_act(p_veto uuid, p_key text, p_choice text)
returns public.event_vetoes language plpgsql security definer set search_path = public as $$
declare
  v event_vetoes; k event_veto_keys; side text; idx int; st jsonb; used text[]; remaining text[]; a jsonb; g int;
begin
  select * into v from event_vetoes where id = p_veto for update;
  if v.id is null then raise exception 'Veto not found'; end if;
  select * into k from event_veto_keys where veto_id = p_veto;
  if p_key = k.key_a then side := 'a'; elsif p_key = k.key_b then side := 'b';
  else raise exception 'This captain link is not valid'; end if;

  idx := jsonb_array_length(v.actions);
  st := v.steps -> idx;
  if st is null then raise exception 'The veto is already finished.'; end if;
  if st->>'team' is distinct from side then raise exception 'It is not your turn.'; end if;

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
