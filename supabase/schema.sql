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
  modes       text[] not null default array['Hardpoint','Search & Destroy','Control'],
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
  foreach tbl in array array['players','matches','games','stats','media','vod_marks'] loop
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
