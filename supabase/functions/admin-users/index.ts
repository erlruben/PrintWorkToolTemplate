// Admin-only account management.
// The service_role key can never live in the browser, so account creation
// runs here instead. Deploy: Supabase → Edge Functions → new function
// named "admin-users", paste this file, deploy.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // --- Confirm the caller is a signed-in admin -------------------
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not signed in' }, 401);

  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !user) return json({ error: 'Not signed in' }, 401);

  const { data: profile } = await asCaller
    .from('profiles').select('role').eq('id', user.id).single();

  // Admin, Tech Developer and Support all manage accounts (migration 049).
  if (!['admin', 'developer', 'support'].includes(profile?.role ?? '')) {
    return json({ error: 'Only an admin can manage accounts' }, 403);
  }

  // --- Act with full privileges ----------------------------------
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let payload: Record<string, string>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Malformed request' }, 400);
  }

  const { action } = payload;

  if (action === 'create') {
    const { email, full_name, role, password } = payload;

    if (!email || !full_name || !role || !password) {
      return json({ error: 'Email, name, role and temporary password are all required' }, 400);
    }
    if (password.length < 8) {
      return json({ error: 'Temporary password must be at least 8 characters' }, 400);
    }
    if (!['admin', 'moderator', 'receptionist', 'artist', 'operator', 'developer', 'support'].includes(role)) {
      return json({ error: `Unknown role: ${role}` }, 400);
    }

    // email_confirm skips the confirmation mail — this shop has no SMTP set
    // up, and the admin hands over the temporary password in person.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role, must_change_password: true },
    });

    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, user_id: data.user?.id });
  }

  if (action === 'reset_password') {
    const { user_id, password } = payload;
    if (!user_id || !password) return json({ error: 'Missing user or password' }, 400);
    if (password.length < 8) {
      return json({ error: 'Temporary password must be at least 8 characters' }, 400);
    }

    const { error } = await admin.auth.admin.updateUserById(user_id, { password });
    if (error) return json({ error: error.message }, 400);

    await admin.from('profiles')
      .update({ must_change_password: true }).eq('id', user_id);

    return json({ ok: true });
  }

  // Deactivating rather than deleting: a deleted account takes its name off
  // every work order it ever touched, and those records are the performance
  // history the tracker exists to keep.
  if (action === 'set_active') {
    const { user_id, active } = payload;
    if (!user_id) return json({ error: 'Missing user' }, 400);
    if (user_id === user.id) return json({ error: 'You cannot deactivate your own account' }, 400);

    const turningOn = String(active) === 'true';

    const { error: banErr } = await admin.auth.admin.updateUserById(user_id, {
      ban_duration: turningOn ? 'none' : '876000h', // 100 years
    });
    if (banErr) return json({ error: banErr.message }, 400);

    const { error: profErr } = await admin
      .from('profiles').update({ active: turningOn }).eq('id', user_id);
    if (profErr) return json({ error: profErr.message }, 400);

    return json({ ok: true });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
