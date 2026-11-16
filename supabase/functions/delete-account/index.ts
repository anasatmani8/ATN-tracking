// Supabase Edge Function (Deno). Deletes the calling user's data and auth account.
// Deploy: supabase functions deploy delete-account
// The service role key exists only in the function's environment, never in the app.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: cors });
  const auth = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: user, error: userErr } = await asUser.auth.getUser();
  if (userErr || !user?.user) return json({ error: 'not_authenticated' }, 401);

  // Runs as the user: checks the recent-sign-in claim, erases rows, records the erasure.
  const { error: eraseErr } = await asUser.rpc('delete_my_data');
  if (eraseErr) return json({ error: eraseErr.message }, eraseErr.message.includes('reauth_required') ? 403 : 500);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { error: delErr } = await admin.auth.admin.deleteUser(user.user.id);
  if (delErr) return json({ error: 'data_erased_account_removal_failed' }, 500);
  return json({ ok: true }, 200);
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
