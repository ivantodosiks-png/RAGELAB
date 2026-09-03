-- Admin staff + moderation RPCs (ban / unban / user list).
-- Privileges are enforced inside security-definer functions, not by the client.

create table if not exists public.staff (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  role       text not null default 'admin' check (role = 'admin'),
  created_at timestamptz not null default now()
);

alter table public.staff enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.staff s
    where s.profile_id = auth.uid()
  );
$$;

-- First signed-in player becomes admin if nobody has the role yet.
create or replace function public.admin_bootstrap()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  insert into public.staff (profile_id)
  select auth.uid()
  where not exists (select 1 from public.staff)
  on conflict (profile_id) do nothing;
  return public.is_admin();
end;
$$;

create or replace function public.my_active_ban()
returns table (
  reason text,
  created_at timestamptz,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select b.reason, b.created_at, b.expires_at
  from public.bans b
  where b.profile_id = auth.uid()
    and (b.expires_at is null or b.expires_at > now())
  order by b.created_at desc
  limit 1;
$$;

create or replace function public.admin_list_users()
returns table (
  profile_id uuid,
  username text,
  email text,
  created_at timestamptz,
  level integer,
  kills integer,
  deaths integer,
  banned boolean,
  ban_reason text,
  is_admin boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.username,
    u.email::text,
    p.created_at,
    coalesce(s.level, 1),
    coalesce(s.kills, 0),
    coalesce(s.deaths, 0),
    exists (
      select 1 from public.bans b
      where b.profile_id = p.id
        and (b.expires_at is null or b.expires_at > now())
    ),
    (
      select b.reason from public.bans b
      where b.profile_id = p.id
        and (b.expires_at is null or b.expires_at > now())
      order by b.created_at desc
      limit 1
    ),
    exists (select 1 from public.staff st where st.profile_id = p.id)
  from public.profiles p
  left join public.player_stats s on s.profile_id = p.id
  left join auth.users u on u.id = p.id
  order by p.created_at desc;
end;
$$;

create or replace function public.admin_ban(p_profile_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_profile_id is null then
    raise exception 'missing player';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'You cannot ban yourself';
  end if;
  if exists (select 1 from public.staff st where st.profile_id = p_profile_id) then
    raise exception 'You cannot ban an admin';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile_id) then
    raise exception 'Player not found';
  end if;

  cleaned := trim(coalesce(p_reason, ''));
  if char_length(cleaned) < 3 or char_length(cleaned) > 280 then
    raise exception 'Reason must be between 3 and 280 characters';
  end if;

  update public.bans b
  set expires_at = now()
  where b.profile_id = p_profile_id
    and (b.expires_at is null or b.expires_at > now());

  insert into public.bans (profile_id, reason, expires_at, created_by)
  values (p_profile_id, cleaned, null, auth.uid()::text);
end;
$$;

create or replace function public.admin_unban(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_profile_id is null then
    raise exception 'missing player';
  end if;

  update public.bans b
  set expires_at = now()
  where b.profile_id = p_profile_id
    and (b.expires_at is null or b.expires_at > now());
end;
$$;

-- If this is a one-player project, that account is the founder admin.
insert into public.staff (profile_id)
select p.id
from public.profiles p
where (select count(*) from public.profiles) = 1
  and not exists (select 1 from public.staff)
on conflict (profile_id) do nothing;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.admin_bootstrap() from public, anon;
revoke all on function public.my_active_ban() from public, anon;
revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_ban(uuid, text) from public, anon;
revoke all on function public.admin_unban(uuid) from public, anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_bootstrap() to authenticated;
grant execute on function public.my_active_ban() to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_ban(uuid, text) to authenticated;
grant execute on function public.admin_unban(uuid) to authenticated;
