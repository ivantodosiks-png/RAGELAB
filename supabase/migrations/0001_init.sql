-- ═════════════════════════════════════════════════════════════════════════════
-- RAGELAB core schema
--
-- Persistent, account-related data only. High frequency game state (positions,
-- shots, physics) never touches Postgres - it lives in the authoritative game
-- server.
-- ═════════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── helpers ─────────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── profiles ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null check (char_length(username) between 3 and 20
                                   and username ~ '^[A-Za-z0-9_][A-Za-z0-9_ -]*[A-Za-z0-9_]$'),
  avatar_url  text,
  bio         text check (bio is null or char_length(bio) <= 280),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ── player_stats ────────────────────────────────────────────────────────────
create table if not exists public.player_stats (
  profile_id       uuid primary key references public.profiles (id) on delete cascade,
  kills            integer not null default 0 check (kills >= 0),
  deaths           integer not null default 0 check (deaths >= 0),
  assists          integer not null default 0 check (assists >= 0),
  headshots        integer not null default 0 check (headshots >= 0),
  shots_fired      bigint  not null default 0 check (shots_fired >= 0),
  shots_hit        bigint  not null default 0 check (shots_hit >= 0),
  damage_dealt     bigint  not null default 0 check (damage_dealt >= 0),
  matches_played   integer not null default 0 check (matches_played >= 0),
  wins             integer not null default 0 check (wins >= 0),
  playtime_seconds integer not null default 0 check (playtime_seconds >= 0),
  xp               integer not null default 0 check (xp >= 0),
  level            integer not null default 1 check (level >= 1),
  longest_killstreak integer not null default 0 check (longest_killstreak >= 0),
  updated_at       timestamptz not null default now()
);

drop trigger if exists player_stats_touch_updated_at on public.player_stats;
create trigger player_stats_touch_updated_at
  before update on public.player_stats
  for each row execute function public.touch_updated_at();

-- Per-weapon breakdown, kept separate so adding weapons never needs a migration.
create table if not exists public.player_weapon_stats (
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  weapon_id    text not null,
  kills        integer not null default 0 check (kills >= 0),
  shots_fired  bigint  not null default 0 check (shots_fired >= 0),
  shots_hit    bigint  not null default 0 check (shots_hit >= 0),
  headshots    integer not null default 0 check (headshots >= 0),
  damage_dealt bigint  not null default 0 check (damage_dealt >= 0),
  updated_at   timestamptz not null default now(),
  primary key (profile_id, weapon_id)
);

-- ── player_settings ─────────────────────────────────────────────────────────
create table if not exists public.player_settings (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists player_settings_touch_updated_at on public.player_settings;
create trigger player_settings_touch_updated_at
  before update on public.player_settings
  for each row execute function public.touch_updated_at();

-- ── cosmetics & inventory ───────────────────────────────────────────────────
create table if not exists public.cosmetic_items (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  name       text not null,
  item_type  text not null,
  rarity     text not null default 'common'
             check (rarity in ('common', 'rare', 'epic', 'legendary')),
  data       jsonb not null default '{}'::jsonb,
  -- Level required to unlock; 0 = available to everyone.
  unlock_level integer not null default 0 check (unlock_level >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.player_inventory (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  item_id     uuid not null references public.cosmetic_items (id) on delete cascade,
  equipped    boolean not null default false,
  acquired_at timestamptz not null default now(),
  primary key (profile_id, item_id)
);

create index if not exists player_inventory_profile_idx
  on public.player_inventory (profile_id);

-- Only one equipped item per cosmetic type per player. Index expressions cannot
-- contain subqueries, so this is enforced with a trigger instead.
create or replace function public.enforce_single_equipped()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_type text;
begin
  if new.equipped is not true then
    return new;
  end if;

  select item_type into new_type from public.cosmetic_items where id = new.item_id;

  update public.player_inventory pi
  set equipped = false
  where pi.profile_id = new.profile_id
    and pi.item_id <> new.item_id
    and pi.equipped
    and exists (
      select 1 from public.cosmetic_items c
      where c.id = pi.item_id and c.item_type = new_type
    );

  return new;
end;
$$;

drop trigger if exists player_inventory_single_equipped on public.player_inventory;
create trigger player_inventory_single_equipped
  after insert or update of equipped on public.player_inventory
  for each row when (new.equipped) execute function public.enforce_single_equipped();

-- ── server browser ──────────────────────────────────────────────────────────
create table if not exists public.game_servers (
  id             text primary key,
  name           text not null,
  region         text not null default 'local',
  map_id         text not null,
  mode           text not null default 'sandbox',
  player_count   integer not null default 0 check (player_count >= 0),
  max_players    integer not null default 16 check (max_players > 0),
  has_password   boolean not null default false,
  tick_ms        real not null default 0,
  ws_url         text,
  created_at     timestamptz not null default now(),
  heartbeat_at   timestamptz not null default now()
);

create index if not exists game_servers_heartbeat_idx
  on public.game_servers (heartbeat_at desc);

-- ── matches ─────────────────────────────────────────────────────────────────
create table if not exists public.matches (
  id         uuid primary key default gen_random_uuid(),
  room_id    text not null,
  map_id     text not null,
  mode       text not null default 'sandbox',
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  winner_id  uuid references public.profiles (id) on delete set null
);

create index if not exists matches_started_idx on public.matches (started_at desc);

create table if not exists public.match_participants (
  match_id   uuid not null references public.matches (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kills      integer not null default 0,
  deaths     integer not null default 0,
  score      integer not null default 0,
  headshots  integer not null default 0,
  damage_dealt integer not null default 0,
  playtime_seconds integer not null default 0,
  primary key (match_id, profile_id)
);

create index if not exists match_participants_profile_idx
  on public.match_participants (profile_id);

-- ── moderation ──────────────────────────────────────────────────────────────
create table if not exists public.bans (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  reason     text not null,
  -- null = permanent
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text not null default 'system'
);

create index if not exists bans_profile_active_idx
  on public.bans (profile_id, expires_at);

create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_id   uuid not null references public.profiles (id) on delete cascade,
  reason      text not null check (char_length(reason) between 3 and 500),
  match_id    uuid references public.matches (id) on delete set null,
  status      text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at  timestamptz not null default now(),
  constraint reports_no_self check (reporter_id <> target_id)
);

create index if not exists reports_target_idx on public.reports (target_id, created_at desc);

-- ═════════════════════════════════════════════════════════════════════════════
-- Row level security
--
-- Rule of thumb: clients may read public data and write only their own
-- preferences. Everything that affects progression is written exclusively by
-- the game server using the service role key (which bypasses RLS).
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.profiles            enable row level security;
alter table public.player_stats        enable row level security;
alter table public.player_weapon_stats enable row level security;
alter table public.player_settings     enable row level security;
alter table public.cosmetic_items      enable row level security;
alter table public.player_inventory    enable row level security;
alter table public.game_servers        enable row level security;
alter table public.matches             enable row level security;
alter table public.match_participants  enable row level security;
alter table public.bans                enable row level security;
alter table public.reports             enable row level security;

-- profiles: world readable, self writable
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- stats: world readable (leaderboards), never client writable
drop policy if exists player_stats_select on public.player_stats;
create policy player_stats_select on public.player_stats for select using (true);

drop policy if exists player_weapon_stats_select on public.player_weapon_stats;
create policy player_weapon_stats_select on public.player_weapon_stats for select using (true);

-- settings: private to the owner
drop policy if exists player_settings_all_self on public.player_settings;
create policy player_settings_all_self on public.player_settings
  for all to authenticated using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- cosmetics catalogue: world readable
drop policy if exists cosmetic_items_select on public.cosmetic_items;
create policy cosmetic_items_select on public.cosmetic_items for select using (true);

-- inventory: readable by anyone (to show loadouts), equip toggled by the owner
drop policy if exists player_inventory_select on public.player_inventory;
create policy player_inventory_select on public.player_inventory for select using (true);

drop policy if exists player_inventory_update_self on public.player_inventory;
create policy player_inventory_update_self on public.player_inventory
  for update to authenticated using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- server browser: world readable, written by the game server only
drop policy if exists game_servers_select on public.game_servers;
create policy game_servers_select on public.game_servers for select using (true);

-- match history: world readable
drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches for select using (true);

drop policy if exists match_participants_select on public.match_participants;
create policy match_participants_select on public.match_participants for select using (true);

-- bans: a player may see their own ban, nothing else
drop policy if exists bans_select_self on public.bans;
create policy bans_select_self on public.bans
  for select to authenticated using (auth.uid() = profile_id);

-- reports: create your own, read your own
drop policy if exists reports_insert_self on public.reports;
create policy reports_insert_self on public.reports
  for insert to authenticated with check (auth.uid() = reporter_id);

drop policy if exists reports_select_self on public.reports;
create policy reports_select_self on public.reports
  for select to authenticated using (auth.uid() = reporter_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- Automatic profile bootstrap on signup
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_name text;
  final_name text;
  suffix integer := 0;
begin
  base_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'player'
  );

  -- Sanitise to the profiles username constraint.
  base_name := regexp_replace(base_name, '[^A-Za-z0-9_ -]', '', 'g');
  base_name := trim(base_name);
  if char_length(base_name) < 3 then
    base_name := 'player';
  end if;
  base_name := left(base_name, 16);

  final_name := base_name;
  while exists (select 1 from public.profiles p where lower(p.username) = lower(final_name)) loop
    suffix := suffix + 1;
    final_name := left(base_name, 16) || suffix::text;
  end loop;

  insert into public.profiles (id, username, avatar_url)
  values (new.id, final_name, new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do nothing;

  insert into public.player_stats (profile_id) values (new.id) on conflict do nothing;
  insert into public.player_settings (profile_id) values (new.id) on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ═════════════════════════════════════════════════════════════════════════════
-- Server-side RPCs
-- ═════════════════════════════════════════════════════════════════════════════

-- Atomic stat accumulation. Called by the game server (service role) at the end
-- of a match or when a player disconnects.
create or replace function public.apply_player_stats(
  p_profile_id uuid,
  p_kills integer default 0,
  p_deaths integer default 0,
  p_headshots integer default 0,
  p_shots_fired bigint default 0,
  p_shots_hit bigint default 0,
  p_damage_dealt bigint default 0,
  p_playtime_seconds integer default 0,
  p_matches_played integer default 0,
  p_wins integer default 0,
  p_killstreak integer default 0
)
returns public.player_stats
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.player_stats;
  gained_xp integer;
begin
  gained_xp := greatest(0, p_kills * 100 + p_headshots * 50 + p_wins * 500
                          + (p_playtime_seconds / 60) * 10 + (p_damage_dealt / 100)::integer);

  insert into public.player_stats (profile_id)
  values (p_profile_id)
  on conflict (profile_id) do nothing;

  update public.player_stats s
  set kills = s.kills + greatest(p_kills, 0),
      deaths = s.deaths + greatest(p_deaths, 0),
      headshots = s.headshots + greatest(p_headshots, 0),
      shots_fired = s.shots_fired + greatest(p_shots_fired, 0),
      shots_hit = s.shots_hit + greatest(p_shots_hit, 0),
      damage_dealt = s.damage_dealt + greatest(p_damage_dealt, 0),
      playtime_seconds = s.playtime_seconds + greatest(p_playtime_seconds, 0),
      matches_played = s.matches_played + greatest(p_matches_played, 0),
      wins = s.wins + greatest(p_wins, 0),
      longest_killstreak = greatest(s.longest_killstreak, greatest(p_killstreak, 0)),
      xp = s.xp + gained_xp,
      -- 1000 xp per level with a gentle curve.
      level = greatest(1, floor(sqrt((s.xp + gained_xp)::numeric / 500))::integer + 1)
  where s.profile_id = p_profile_id
  returning s.* into result;

  return result;
end;
$$;

create or replace function public.apply_weapon_stats(
  p_profile_id uuid,
  p_weapon_id text,
  p_kills integer default 0,
  p_shots_fired bigint default 0,
  p_shots_hit bigint default 0,
  p_headshots integer default 0,
  p_damage_dealt bigint default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.player_weapon_stats as w
    (profile_id, weapon_id, kills, shots_fired, shots_hit, headshots, damage_dealt)
  values (p_profile_id, p_weapon_id, greatest(p_kills, 0), greatest(p_shots_fired, 0),
          greatest(p_shots_hit, 0), greatest(p_headshots, 0), greatest(p_damage_dealt, 0))
  on conflict (profile_id, weapon_id) do update
  set kills = w.kills + greatest(p_kills, 0),
      shots_fired = w.shots_fired + greatest(p_shots_fired, 0),
      shots_hit = w.shots_hit + greatest(p_shots_hit, 0),
      headshots = w.headshots + greatest(p_headshots, 0),
      damage_dealt = w.damage_dealt + greatest(p_damage_dealt, 0),
      updated_at = now();
end;
$$;

-- Is a profile currently banned?
create or replace function public.is_banned(p_profile_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.bans b
    where b.profile_id = p_profile_id
      and (b.expires_at is null or b.expires_at > now())
  );
$$;

-- Public leaderboard (kills desc), safe for anonymous callers.
create or replace function public.leaderboard(p_limit integer default 50)
returns table (
  profile_id uuid,
  username text,
  avatar_url text,
  kills integer,
  deaths integer,
  level integer,
  kd numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.username, p.avatar_url, s.kills, s.deaths, s.level,
         round(s.kills::numeric / greatest(s.deaths, 1), 2) as kd
  from public.player_stats s
  join public.profiles p on p.id = s.profile_id
  order by s.kills desc, s.level desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- Rooms that have sent a heartbeat recently.
create or replace function public.active_servers(p_stale_seconds integer default 30)
returns setof public.game_servers
language sql
security definer
set search_path = public
stable
as $$
  select * from public.game_servers
  where heartbeat_at > now() - make_interval(secs => greatest(coalesce(p_stale_seconds, 30), 5))
  order by player_count desc, name asc;
$$;

grant execute on function public.leaderboard(integer) to anon, authenticated;
grant execute on function public.active_servers(integer) to anon, authenticated;
grant execute on function public.is_banned(uuid) to authenticated;
