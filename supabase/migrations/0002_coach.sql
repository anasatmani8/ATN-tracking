-- AI coach usage limits. No message content is stored on the server.
-- The coach Edge Function calls these as the signed-in user (auth.uid()); clients can't read or write the tables directly.

create table public.coach_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (user_id, day)
);

create table public.coach_minute (
  user_id uuid not null references auth.users (id) on delete cascade,
  minute timestamptz not null,
  requests integer not null default 0,
  primary key (user_id, minute)
);

alter table public.coach_usage enable row level security;
alter table public.coach_minute enable row level security;
alter table public.coach_usage force row level security;
alter table public.coach_minute force row level security;
revoke all on public.coach_usage, public.coach_minute from public, anon, authenticated;

-- Check and count one request. Limits come from the server function; they are clamped so a direct
-- call with huge values only counts the caller's own requests and grants nothing.
create function public.coach_consume(per_minute integer, per_day integer, tokens_per_day bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  m timestamptz := date_trunc('minute', now());
  d date := (now() at time zone 'utc')::date;
  pm integer := least(greatest(coalesce(per_minute, 1), 1), 60);
  pd integer := least(greatest(coalesce(per_day, 1), 1), 1000);
  pt bigint := least(greatest(coalesce(tokens_per_day, 1), 1), 50000000);
  mcount integer;
  dcount integer;
  dtokens bigint;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if exists (select 1 from public.erased_accounts where user_id = uid) then
    raise exception 'account_erased' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('coach:' || uid::text, 0));
  select requests into mcount from public.coach_minute where user_id = uid and minute = m;
  select requests, input_tokens + output_tokens into dcount, dtokens from public.coach_usage where user_id = uid and day = d;
  mcount := coalesce(mcount, 0);
  dcount := coalesce(dcount, 0);
  dtokens := coalesce(dtokens, 0);
  if dcount >= pd or dtokens >= pt then
    return jsonb_build_object('allowed', false, 'retry_after_sec',
      greatest(1, extract(epoch from ((d + 1)::timestamp at time zone 'utc') - now())::integer), 'remaining_today', 0);
  end if;
  if mcount >= pm then
    return jsonb_build_object('allowed', false, 'retry_after_sec', greatest(1, 60 - extract(second from now())::integer), 'remaining_today', pd - dcount);
  end if;
  insert into public.coach_minute (user_id, minute, requests) values (uid, m, 1)
    on conflict (user_id, minute) do update set requests = public.coach_minute.requests + 1;
  insert into public.coach_usage (user_id, day, requests) values (uid, d, 1)
    on conflict (user_id, day) do update set requests = public.coach_usage.requests + 1;
  delete from public.coach_minute where user_id = uid and minute < m - interval '1 hour';
  return jsonb_build_object('allowed', true, 'retry_after_sec', 0, 'remaining_today', pd - dcount - 1);
end;
$$;

create function public.coach_record_tokens(input_tokens bigint, output_tokens bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  d date := (now() at time zone 'utc')::date;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  update public.coach_usage
     set input_tokens = coach_usage.input_tokens + least(greatest(coalesce(coach_record_tokens.input_tokens, 0), 0), 2000000),
         output_tokens = coach_usage.output_tokens + least(greatest(coalesce(coach_record_tokens.output_tokens, 0), 0), 2000000)
   where user_id = uid and day = d;
end;
$$;

revoke all on function public.coach_consume(integer, integer, bigint) from public, anon;
revoke all on function public.coach_record_tokens(bigint, bigint) from public, anon;
grant execute on function public.coach_consume(integer, integer, bigint) to authenticated;
grant execute on function public.coach_record_tokens(bigint, bigint) to authenticated;

-- Account deletion (delete-account function) removes the auth user; the foreign keys above cascade.
