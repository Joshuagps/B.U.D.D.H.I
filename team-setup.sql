-- B.U.D.D.H.I. Teams: run this once in Supabase (SQL Editor → New query → paste → Run).
-- It adds team group chats. Only members of a team can read or write its messages.

create table if not exists public.buddhi_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  code text not null unique,
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.buddhi_room_members (
  room_id uuid not null references public.buddhi_rooms on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  display_name text not null default 'Member' check (char_length(display_name) between 1 and 60),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.buddhi_room_messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.buddhi_rooms on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  author text not null check (char_length(author) between 1 and 80),
  channel text not null check (channel in ('team', 'ai')),
  role text not null default 'user' check (role in ('user', 'ai')),
  body text not null check (char_length(body) between 1 and 8000),
  created_at timestamptz not null default now()
);
create index if not exists buddhi_room_messages_room_id on public.buddhi_room_messages (room_id, id);

alter table public.buddhi_rooms enable row level security;
alter table public.buddhi_room_members enable row level security;
alter table public.buddhi_room_messages enable row level security;

-- is the signed-in person a member of this team?
create or replace function public.buddhi_is_member(r uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.buddhi_room_members where room_id = r and user_id = auth.uid());
$$;

drop policy if exists "members read rooms" on public.buddhi_rooms;
create policy "members read rooms" on public.buddhi_rooms for select to authenticated using (public.buddhi_is_member(id));

drop policy if exists "members see members" on public.buddhi_room_members;
create policy "members see members" on public.buddhi_room_members for select to authenticated using (public.buddhi_is_member(room_id));
drop policy if exists "leave a team" on public.buddhi_room_members;
create policy "leave a team" on public.buddhi_room_members for delete to authenticated using (user_id = auth.uid());

drop policy if exists "members read messages" on public.buddhi_room_messages;
create policy "members read messages" on public.buddhi_room_messages for select to authenticated using (public.buddhi_is_member(room_id));
drop policy if exists "members write messages" on public.buddhi_room_messages;
create policy "members write messages" on public.buddhi_room_messages for insert to authenticated with check (user_id = auth.uid() and public.buddhi_is_member(room_id));
drop policy if exists "delete own messages" on public.buddhi_room_messages;
create policy "delete own messages" on public.buddhi_room_messages for delete to authenticated using (user_id = auth.uid());

-- make a team (with a random 6-character code) and join it
create or replace function public.create_room(p_name text, p_display text) returns json
language plpgsql security definer set search_path = public as $$
declare r public.buddhi_rooms; c text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  loop
    c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.buddhi_rooms where code = c);
  end loop;
  insert into public.buddhi_rooms (name, code, created_by) values (left(trim(p_name), 60), c, auth.uid()) returning * into r;
  insert into public.buddhi_room_members (room_id, user_id, display_name) values (r.id, auth.uid(), coalesce(nullif(left(trim(p_display), 60), ''), 'Member'));
  return json_build_object('id', r.id, 'name', r.name, 'code', r.code, 'members', 1);
end; $$;

-- join a team with its code
create or replace function public.join_room(p_code text, p_display text) returns json
language plpgsql security definer set search_path = public as $$
declare r public.buddhi_rooms;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into r from public.buddhi_rooms where code = upper(trim(p_code));
  if r.id is null then raise exception 'No team has that code'; end if;
  insert into public.buddhi_room_members (room_id, user_id, display_name) values (r.id, auth.uid(), coalesce(nullif(left(trim(p_display), 60), ''), 'Member'))
    on conflict (room_id, user_id) do update set display_name = excluded.display_name;
  return json_build_object('id', r.id, 'name', r.name, 'code', r.code, 'members', (select count(*) from public.buddhi_room_members m where m.room_id = r.id));
end; $$;

-- the teams I am in
create or replace function public.my_rooms() returns setof json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', r.id, 'name', r.name, 'code', r.code, 'members', (select count(*) from public.buddhi_room_members m2 where m2.room_id = r.id))
  from public.buddhi_rooms r join public.buddhi_room_members m on m.room_id = r.id and m.user_id = auth.uid()
  order by r.created_at desc;
$$;

revoke all on function public.create_room(text, text), public.join_room(text, text), public.my_rooms(), public.buddhi_is_member(uuid) from public, anon;
grant execute on function public.create_room(text, text), public.join_room(text, text), public.my_rooms(), public.buddhi_is_member(uuid) to authenticated;
