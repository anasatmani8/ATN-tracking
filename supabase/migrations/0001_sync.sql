-- Kinset account sync. Applied with `supabase db push` (or psql against any Postgres that
-- provides Supabase's auth schema: auth.users, auth.uid(), auth.jwt(), roles anon/authenticated).
--
-- Design
--   * One row per client record: (user_id, tbl, id) → jsonb document, server revision, tombstone.
--   * Clients never write tables directly. RLS allows only SELECT of the caller's own records;
--     every write goes through SECURITY DEFINER functions that take the user from auth.uid().
--   * rev comes from one sequence. Pushes for a user are serialised by an advisory lock, so a
--     user's revisions commit in order and `rev > cursor` pulls never skip a change.
--   * Deletes are tombstones and always win. A stale edit can never resurrect a record.
--   * Every operation carries a client op_id; replays return the stored result.

create table public.records (
  user_id uuid not null references auth.users (id) on delete cascade,
  tbl text not null,
  id text not null,
  data jsonb,
  rev bigint not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, tbl, id)
);
create index records_pull_idx on public.records (user_id, rev);

create table public.applied_ops (
  user_id uuid not null references auth.users (id) on delete cascade,
  op_id text not null,
  result jsonb not null,
  applied_at timestamptz not null default now(),
  primary key (user_id, op_id)
);

-- Survives deletion of the auth user so a device holding an unexpired token cannot upload again.
create table public.erased_accounts (
  user_id uuid primary key,
  erased_at timestamptz not null default now()
);

create sequence public.record_rev;

alter table public.records enable row level security;
alter table public.applied_ops enable row level security;
alter table public.erased_accounts enable row level security;
alter table public.records force row level security;
alter table public.applied_ops force row level security;
alter table public.erased_accounts force row level security;

revoke all on public.records, public.applied_ops, public.erased_accounts from public, anon, authenticated;
revoke all on sequence public.record_rev from public, anon, authenticated;
grant select on public.records to authenticated;

-- Deny by default: the only policy is read-your-own. No insert/update/delete policy exists.
create policy records_select_own on public.records for select to authenticated using (user_id = (select auth.uid()));

create function public.sync_tables() returns text[] language sql immutable as $$
  select array['prefs','exercises','programs','scheduled_workouts','sessions','session_exercises','session_sets','foods','recipes',
               'saved_meals','food_logs','planned_meals','water_logs','sleep_logs','measurements','checkins','reminders','progression_decisions'];
$$;

-- Internal: apply one row change. Returns {status, rev, data?}.
create function public.sync_apply_row(p_uid uuid, p_tbl text, p_id text, p_kind text, p_base_rev bigint, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cur public.records%rowtype;
  new_rev bigint;
  doc jsonb;
begin
  if p_tbl is null or not (p_tbl = any (public.sync_tables())) then
    return jsonb_build_object('status', 'invalid', 'error', 'unknown_table');
  end if;
  if p_id is null or length(p_id) = 0 or length(p_id) > 120 then
    return jsonb_build_object('status', 'invalid', 'error', 'bad_id');
  end if;
  if p_kind = 'upsert' then
    if p_data is null or jsonb_typeof(p_data) <> 'object' or p_data ->> 'id' is distinct from p_id then
      return jsonb_build_object('status', 'invalid', 'error', 'bad_data');
    end if;
    if pg_column_size(p_data) > 262144 then
      return jsonb_build_object('status', 'invalid', 'error', 'too_large');
    end if;
    doc := p_data - 'rev' - 'deleted_at';
  elsif p_kind <> 'delete' then
    return jsonb_build_object('status', 'invalid', 'error', 'bad_kind');
  end if;

  select * into cur from public.records where user_id = p_uid and tbl = p_tbl and id = p_id for update;

  if not found then
    new_rev := nextval('public.record_rev');
    insert into public.records (user_id, tbl, id, data, rev, deleted)
    values (p_uid, p_tbl, p_id, case when p_kind = 'delete' then null else doc end, new_rev, p_kind = 'delete');
    return jsonb_build_object('status', 'ok', 'rev', new_rev);
  end if;

  if cur.deleted then
    if p_kind = 'delete' then
      return jsonb_build_object('status', 'ok', 'rev', cur.rev);
    end if;
    return jsonb_build_object('status', 'rejected_deleted', 'rev', cur.rev);
  end if;

  if p_kind = 'delete' then
    new_rev := nextval('public.record_rev');
    update public.records set deleted = true, data = null, rev = new_rev, updated_at = now()
    where user_id = p_uid and tbl = p_tbl and id = p_id;
    return jsonb_build_object('status', 'ok', 'rev', new_rev);
  end if;

  if cur.rev <> coalesce(p_base_rev, 0) then
    return jsonb_build_object('status', 'conflict', 'rev', cur.rev, 'data', cur.data);
  end if;

  new_rev := nextval('public.record_rev');
  update public.records set data = doc, rev = new_rev, updated_at = now()
  where user_id = p_uid and tbl = p_tbl and id = p_id;
  return jsonb_build_object('status', 'ok', 'rev', new_rev);
end;
$$;

-- Internal: apply one client operation idempotently.
create function public.sync_apply_op(p_uid uuid, p_op jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_op_id text := p_op ->> 'op_id';
  v_kind text := p_op ->> 'kind';
  prior jsonb;
  res jsonb;
  revs jsonb := '{}'::jsonb;
  t text;
  r jsonb;
  one jsonb;
begin
  if v_op_id is null or length(v_op_id) = 0 or length(v_op_id) > 120 then
    return jsonb_build_object('op_id', v_op_id, 'status', 'invalid', 'error', 'bad_op_id');
  end if;
  select result into prior from public.applied_ops where user_id = p_uid and op_id = v_op_id;
  if found then
    return prior;
  end if;

  if v_kind = 'session_complete' then
    -- Finishing a workout: the session, its exercises and its sets land together or not at all.
    -- Rows that already exist are left as they are, so a replay under a new op_id is harmless.
    if jsonb_typeof(p_op -> 'data') is distinct from 'object' then
      res := jsonb_build_object('status', 'invalid', 'error', 'bad_data');
    else
      foreach t in array array['sessions', 'session_exercises', 'session_sets'] loop
        if jsonb_typeof(p_op -> 'data' -> t) = 'array' then
          for r in select * from jsonb_array_elements(p_op -> 'data' -> t) loop
            one := public.sync_apply_row(p_uid, t, r ->> 'id', 'upsert', 0, r);
            if one ->> 'status' = 'invalid' then
              raise exception 'invalid_session_row: %', one ->> 'error' using errcode = '22023';
            end if;
            revs := revs || jsonb_build_object(t || '/' || (r ->> 'id'), one -> 'rev');
          end loop;
        end if;
      end loop;
      res := jsonb_build_object('status', 'ok', 'revs', revs);
    end if;
  else
    res := public.sync_apply_row(p_uid, p_op ->> 'tbl', p_op ->> 'id', v_kind, (p_op ->> 'base_rev')::bigint, p_op -> 'data');
  end if;

  res := res || jsonb_build_object('op_id', v_op_id);
  insert into public.applied_ops (user_id, op_id, result) values (p_uid, v_op_id, res);
  return res;
end;
$$;

create function public.sync_guard() returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if exists (select 1 from public.erased_accounts where user_id = uid) then
    raise exception 'account_erased' using errcode = 'P0001';
  end if;
  return uid;
end;
$$;

-- Push a batch of operations. Returns one result per op, in order.
create function public.sync_push(ops jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := public.sync_guard();
  op jsonb;
  results jsonb := '[]'::jsonb;
begin
  if ops is null or jsonb_typeof(ops) <> 'array' or jsonb_array_length(ops) > 200 then
    raise exception 'invalid_ops' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  for op in select * from jsonb_array_elements(ops) loop
    results := results || jsonb_build_array(public.sync_apply_op(uid, op));
  end loop;
  return results;
end;
$$;

-- Pull changes after a cursor, oldest first.
create function public.sync_pull(since bigint, lim integer default 200)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := public.sync_guard();
  n integer := least(greatest(coalesce(lim, 200), 1), 500);
  recs jsonb;
  last_rev bigint;
  cnt integer;
begin
  select coalesce(jsonb_agg(jsonb_build_object('tbl', q.tbl, 'id', q.id, 'data', q.data, 'rev', q.rev, 'deleted', q.deleted) order by q.rev), '[]'::jsonb),
         max(q.rev), count(*)
    into recs, last_rev, cnt
  from (select * from public.records where user_id = uid and rev > coalesce(since, 0) order by rev limit n) q;
  return jsonb_build_object('records', recs, 'cursor', coalesce(last_rev, coalesce(since, 0)), 'more', cnt = n);
end;
$$;

-- Erase everything the caller owns and block further uploads. Requires a recent sign-in.
-- The delete-account Edge Function calls this, then removes the auth user with the service role.
create function public.delete_my_data()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  recent bigint;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select max((m ->> 'timestamp')::bigint) into recent from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) m;
  if recent is null or recent < extract(epoch from now()) - 600 then
    raise exception 'reauth_required' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  delete from public.records where user_id = uid;
  delete from public.applied_ops where user_id = uid;
  insert into public.erased_accounts (user_id) values (uid) on conflict do nothing;
end;
$$;

revoke all on function public.sync_apply_row(uuid, text, text, text, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.sync_apply_op(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.sync_guard() from public, anon, authenticated;
revoke all on function public.sync_push(jsonb) from public, anon;
revoke all on function public.sync_pull(bigint, integer) from public, anon;
revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.sync_pull(bigint, integer) to authenticated;
grant execute on function public.delete_my_data() to authenticated;
