-- Shareable lobby codes for website join-by-code (no npm on the friend PC).
alter table public.game_servers
  add column if not exists join_code text;

create unique index if not exists game_servers_join_code_uidx
  on public.game_servers (join_code)
  where join_code is not null;

create or replace function public.find_lobby(p_code text)
returns setof public.game_servers
language sql
security definer
set search_path = public
stable
as $$
  select *
  from public.game_servers
  where join_code = upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'))
    and heartbeat_at > now() - interval '45 seconds'
  limit 1;
$$;

grant execute on function public.find_lobby(text) to anon, authenticated;
