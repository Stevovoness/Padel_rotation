-- Padel Rotation: shared scoring.
--
-- Run once in the Supabase SQL editor. Safe to run again.
--
-- The tables are locked: the website (the anon / publishable key) cannot read
-- or list them directly. It can only call the functions at the bottom, and
-- every one of those needs a session's code - so a session's link is its
-- password, and nobody can browse other people's sessions.

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------

create table if not exists public.sessions (
  id          text primary key check (id ~ '^[a-z0-9]{10}$'),
  fingerprint text unique check (char_length(fingerprint) <= 64),
  schedule    jsonb not null check (pg_column_size(schedule) < 200000),
  created_at  timestamptz not null default now(),
  touched_at  timestamptz not null default now()
);

create table if not exists public.scores (
  session_id text not null references public.sessions (id) on delete cascade,
  round      int  not null check (round between 1 and 40),
  court      int  not null check (court between 1 and 8),
  a          int  check (a between 0 and 999),
  b          int  check (b between 0 and 999),
  updated_at timestamptz not null,
  primary key (session_id, round, court)
);

create table if not exists public.people (
  session_id text not null references public.sessions (id) on delete cascade,
  slot       int  not null check (slot between 0 and 31),
  segments   jsonb not null check (pg_column_size(segments) < 10000),
  updated_at timestamptz not null,
  primary key (session_id, slot)
);

-- row level security on, and no policies: direct table access is refused
alter table public.sessions enable row level security;
alter table public.scores   enable row level security;
alter table public.people   enable row level security;
revoke all on public.sessions, public.scores, public.people from anon, authenticated;

-- ---------------------------------------------------------------------------
-- functions the website calls
-- ---------------------------------------------------------------------------

-- Create a session, or return the one already made from the same schedule
-- (two phones importing the same PDF end up on the same scoreboard).
create or replace function public.create_session(p_id text, p_fingerprint text, p_schedule jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  found text;
begin
  select id into found from sessions where fingerprint = p_fingerprint;
  if found is not null then
    return found;
  end if;
  insert into sessions (id, fingerprint, schedule)
  values (p_id, p_fingerprint, p_schedule)
  on conflict do nothing;
  -- if another phone won a race on the same schedule, use theirs
  select id into found from sessions where fingerprint = p_fingerprint;
  return coalesce(found, p_id);
end;
$$;

-- Everything a phone needs to show the session.
create or replace function public.get_session(p_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', s.id,
    'schedule', s.schedule,
    'scores', coalesce((
      select jsonb_agg(jsonb_build_object('round', round, 'court', court, 'a', a, 'b', b, 'at', updated_at))
      from scores where session_id = s.id), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('slot', slot, 'segments', segments, 'at', updated_at))
      from people where session_id = s.id), '[]'::jsonb)
  )
  from sessions s
  where s.id = p_id;
$$;

-- One match's score. The edit made last wins, even if it arrives late
-- (a phone that was offline); a clock can't claim to be in the future.
create or replace function public.set_score(p_id text, p_round int, p_court int, p_a int, p_b int, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  stamp timestamptz := least(p_at, now() + interval '1 minute');
begin
  insert into scores (session_id, round, court, a, b, updated_at)
  values (p_id, p_round, p_court, p_a, p_b, stamp)
  on conflict (session_id, round, court) do update
    set a = excluded.a, b = excluded.b, updated_at = excluded.updated_at
    where scores.updated_at <= excluded.updated_at;
  update sessions set touched_at = now() where id = p_id;
end;
$$;

-- Who holds a roster slot (name fixes and substitutions).
create or replace function public.set_people(p_id text, p_slot int, p_segments jsonb, p_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  stamp timestamptz := least(p_at, now() + interval '1 minute');
begin
  insert into people (session_id, slot, segments, updated_at)
  values (p_id, p_slot, p_segments, stamp)
  on conflict (session_id, slot) do update
    set segments = excluded.segments, updated_at = excluded.updated_at
    where people.updated_at <= excluded.updated_at;
  update sessions set touched_at = now() where id = p_id;
end;
$$;

revoke all on function public.create_session(text, text, jsonb) from public;
revoke all on function public.get_session(text) from public;
revoke all on function public.set_score(text, int, int, int, int, timestamptz) from public;
revoke all on function public.set_people(text, int, jsonb, timestamptz) from public;
grant execute on function public.create_session(text, text, jsonb) to anon, authenticated;
grant execute on function public.get_session(text) to anon, authenticated;
grant execute on function public.set_score(text, int, int, int, int, timestamptz) to anon, authenticated;
grant execute on function public.set_people(text, int, jsonb, timestamptz) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- tidy up: sessions nobody has touched for 30 days are deleted nightly
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;

select cron.schedule(
  'padel-delete-old-sessions',
  '17 3 * * *',
  $$delete from public.sessions where touched_at < now() - interval '30 days'$$
);
