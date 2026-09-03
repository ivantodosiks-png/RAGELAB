-- ═════════════════════════════════════════════════════════════════════════════
-- Cosmetic catalogue seed.
--
-- The client renders cosmetics purely from `data`, so new items are a single
-- INSERT away - no client release required.
-- ═════════════════════════════════════════════════════════════════════════════

insert into public.cosmetic_items (key, name, item_type, rarity, unlock_level, data) values
  -- player suit colours
  ('suit_default',   'Standard Issue',  'suit',   'common',    0,  '{"color": 4478779, "accent": 16744751}'),
  ('suit_ash',       'Ash Grey',        'suit',   'common',    0,  '{"color": 5723991, "accent": 11184810}'),
  ('suit_toxic',     'Toxic',           'suit',   'rare',      5,  '{"color": 3382583, "accent": 10485600}'),
  ('suit_crimson',   'Crimson Unit',    'suit',   'rare',      8,  '{"color": 9184024, "accent": 16729156}'),
  ('suit_arctic',    'Arctic Recon',    'suit',   'epic',      14, '{"color": 14019823, "accent": 5077247}'),
  ('suit_void',      'Void Operator',   'suit',   'legendary', 25, '{"color": 1315860, "accent": 12517631}'),

  -- tracer colours
  ('tracer_amber',   'Amber Tracer',    'tracer', 'common',    0,  '{"color": 16766602}'),
  ('tracer_verdant', 'Verdant Tracer',  'tracer', 'rare',      4,  '{"color": 5963642}'),
  ('tracer_azure',   'Azure Tracer',    'tracer', 'rare',      7,  '{"color": 4890623}'),
  ('tracer_violet',  'Violet Tracer',   'tracer', 'epic',      12, '{"color": 13395711}'),
  ('tracer_white',   'Phosphor Tracer', 'tracer', 'legendary', 22, '{"color": 16777215, "glow": 2.4}'),

  -- weapon charms (small object dangling from the view model)
  ('charm_bolt',     'Lucky Bolt',      'charm',  'common',    0,  '{"shape": "bolt", "color": 12303291}'),
  ('charm_skull',    'Grin',            'charm',  'rare',      6,  '{"shape": "skull", "color": 15658734}'),
  ('charm_cube',     'Rage Cube',       'charm',  'epic',      16, '{"shape": "cube", "color": 16744751}'),

  -- titles shown next to the name in the kill feed
  ('title_rookie',   'Rookie',          'title',  'common',    0,  '{"text": "Rookie"}'),
  ('title_breaker',  'Yard Breaker',    'title',  'rare',      10, '{"text": "Yard Breaker"}'),
  ('title_menace',   'Certified Menace','title',  'epic',      18, '{"text": "Certified Menace"}'),
  ('title_rage',     'RAGELAB',         'title',  'legendary', 30, '{"text": "RAGELAB"}')
on conflict (key) do update
  set name = excluded.name,
      item_type = excluded.item_type,
      rarity = excluded.rarity,
      unlock_level = excluded.unlock_level,
      data = excluded.data;

-- Grant every existing and future player the level-0 items.
create or replace function public.grant_default_cosmetics(p_profile_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.player_inventory (profile_id, item_id, equipped)
  select p_profile_id, c.id, c.key in ('suit_default', 'tracer_amber')
  from public.cosmetic_items c
  where c.unlock_level = 0
  on conflict (profile_id, item_id) do nothing;
$$;

-- Unlock everything the player's level entitles them to. Called by the game
-- server after a match so progression rewards land without a client roundtrip.
create or replace function public.sync_cosmetic_unlocks(p_profile_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  player_level integer;
  granted integer;
begin
  select level into player_level from public.player_stats where profile_id = p_profile_id;
  if player_level is null then
    return 0;
  end if;

  with inserted as (
    insert into public.player_inventory (profile_id, item_id)
    select p_profile_id, c.id
    from public.cosmetic_items c
    where c.unlock_level <= player_level
    on conflict (profile_id, item_id) do nothing
    returning 1
  )
  select count(*)::integer into granted from inserted;

  return granted;
end;
$$;

grant execute on function public.grant_default_cosmetics(uuid) to authenticated;

-- Backfill anyone who signed up before this migration.
do $$
declare
  r record;
begin
  for r in select id from public.profiles loop
    perform public.grant_default_cosmetics(r.id);
  end loop;
end;
$$;

-- Extend the signup trigger so new accounts get their starter cosmetics.
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
  perform public.grant_default_cosmetics(new.id);

  return new;
end;
$$;
