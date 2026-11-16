# Backend (optional): Supabase Auth + Postgres sync

The app is fully usable without this. Configure it only to enable accounts, backup and multi-device sync.

## What runs on the server

- `public.records`: one row per synced client record `(user_id, tbl, id)` with a JSON document, a server revision and a tombstone flag.
- Row-level security is on and forced. The only policy lets a signed-in user **select their own rows**. There are no insert/update/delete policies; all writes go through `SECURITY DEFINER` functions that take the user from `auth.uid()`.
- RPCs callable by `authenticated` only:
  - `sync_push(ops jsonb)` — idempotent by `op_id`, revision-checked, deletes win, `session_complete` applies a finished workout atomically
  - `sync_pull(since bigint, lim int)` — changes after a cursor
  - `delete_my_data()` — requires a sign-in within the last 10 minutes; erases the user's rows and records the erasure so stale devices cannot upload again
- `functions/delete-account`: Edge Function that calls `delete_my_data()` as the user, then deletes the auth user with the service role key, which exists only in the function environment.

## Set up a project

1. Create a Supabase project (the publisher's account). Note the project URL and anon key.
2. Auth → Providers: enable Email. Decide on email confirmation (recommended on).
3. Apply the migration:
   ```bash
   supabase link --project-ref <ref>
   supabase db push                     # applies supabase/migrations/0001_sync.sql
   ```
   or paste `migrations/0001_sync.sql` into the SQL editor.
4. Deploy the deletion function:
   ```bash
   supabase functions deploy delete-account
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions by the platform.
5. In the app's `.env.local` (or EAS environment variables):
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   ```
6. Publish a web page for account deletion requests (needed by Google Play) and set `ACCOUNT_DELETION_URL`.

Never put the service role key in the app or in any `EXPO_PUBLIC_*` variable.

## Local or staging path

- `npm run test:server` starts a disposable Postgres, applies `tests/local_auth_stub.sql` (a minimal stand-in for `auth.users`, `auth.uid()` and `auth.jwt()`) and the real migration, and runs authorization and two-device sync tests through the same RPCs the app calls.
- For a full local stack with real Auth, use `supabase start` (needs Docker), then `supabase db reset` to apply migrations and point the app at the printed local URL and anon key.
- A separate Supabase project works as staging; use a `preview` EAS build with that project's URL and key.

## Retention and backups

- Rows are deleted when the user deletes their account (cascade from `auth.users`, plus `delete_my_data()`).
- Tombstones keep only `(user_id, tbl, id, rev)` without content so stale devices cannot resurrect deleted entries.
- `applied_ops` keeps operation ids and results for idempotent retries; it is removed with the account. A scheduled clean-up of entries older than 90 days is recommended before launch.
- Platform backups follow the Supabase plan's retention. State the retention window in the privacy policy.
