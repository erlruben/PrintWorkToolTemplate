// "Forgot password" — public (no sign-in). Takes the username or email a person
// signs in with, finds their private recovery email (table account_recovery,
// or the sign-in email itself for accounts that use a real one), and emails a
// one-time reset link (valid about an hour) from the shop's Gmail over SMTP.
//
// It always answers the same way, and at once (the email goes out in the
// background), whether or not the account exists or has a recovery email — so
// neither the answer nor its timing tells anyone who has an account. At most 3
// emails an hour per account and 30 an hour in all (Gmail allows ~500 a day).
//
// Deploy: Supabase → Edge Functions → new function "password-reset", paste
// this file, turn OFF "Enforce JWT verification" (people use it signed out).
// Secrets (Edge Functions → Secrets):
//   GMAIL_USER          the Gmail address that sends the emails
//   GMAIL_APP_PASSWORD  a 16-letter Google "app password" for that account
//                       (Google Account → Security → 2-Step Verification on →
//                       App passwords). Never the account's real password.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GMAIL_USER = Deno.env.get('GMAIL_USER') ?? '';
const GMAIL_APP_PASSWORD = (Deno.env.get('GMAIL_APP_PASSWORD') ?? '').replace(/\s+/g, '');

const INTERNAL = '@printflow.local'; // staff usernames are stored as username@printflow.local
const MAX_PER_HOUR = 3;
const MAX_ALL_PER_HOUR = 30;

// Supabase keeps the function alive for work handed to waitUntil after replying.
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// The one answer for every request that is not a setup problem.
const SENT = { ok: true };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { ping?: unknown; login?: unknown; redirectTo?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Malformed request' }, 400);
  }
  const ready = !!GMAIL_USER && !!GMAIL_APP_PASSWORD;
  // The sign-in screen asks first, and only offers "Forgot your password?" once
  // the sending Gmail is set up.
  if (body?.ping === true) return json({ ready });
  if (!ready) {
    return json({ error: 'Password reset by email is not set up yet. Ask an admin to reset your password.' }, 503);
  }

  const login = String(body?.login ?? '').trim().toLowerCase();
  // Only ever back to the app itself; Supabase also checks it against the
  // allowed Redirect URLs.
  const redirectTo = typeof body?.redirectTo === 'string' && /^https:\/\/[^/]+\/?$/.test(body.redirectTo)
    ? body.redirectTo : undefined;
  if (!login || login.length > 254 || /\s/.test(login)) return json(SENT);
  const authEmail = login.includes('@') ? login : `${login}${INTERNAL}`;

  const work = sendResetEmail(authEmail, redirectTo);
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work);
  else await work;
  return json(SENT);
});

async function sendResetEmail(authEmail: string, redirectTo: string | undefined) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  try {
    const { data: userId } = await admin.rpc('user_id_for_login_email', { p_email: authEmail });
    if (!userId) return;

    const { data: prof } = await admin.from('profiles').select('full_name, active').eq('id', userId).maybeSingle();
    if (!prof?.active) return;

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin.from('password_reset_requests')
      .select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('requested_at', since);
    if ((count ?? 0) >= MAX_PER_HOUR) return;
    const { count: all } = await admin.from('password_reset_requests')
      .select('id', { count: 'exact', head: true }).gte('requested_at', since);
    if ((all ?? 0) >= MAX_ALL_PER_HOUR) { console.error('password-reset: hourly limit reached'); return; }

    const { data: rec } = await admin.from('account_recovery').select('email').eq('user_id', userId).maybeSingle();
    const to = rec?.email ?? (authEmail.endsWith(INTERNAL) ? null : authEmail);
    if (!to) return;

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'recovery', email: authEmail, options: redirectTo ? { redirectTo } : undefined,
    });
    const url = link?.properties?.action_link;
    if (linkErr || !url) { console.error('generateLink', linkErr?.message); return; }

    await admin.from('password_reset_requests').insert({ user_id: userId });

    const first = String(prof.full_name ?? '').split(/\s+/)[0] || 'there';
    const shown = authEmail.endsWith(INTERNAL) ? authEmail.slice(0, -INTERNAL.length) : authEmail;
    const smtp = new SMTPClient({
      connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD } },
    });
    try {
      await smtp.send({
        from: `PrintFlow Work Order Tracker <${GMAIL_USER}>`,
        to,
        subject: 'Reset your Work Order Tracker password',
        content: `Hi ${first},\n\nSomeone asked to reset the password for "${shown}" on the PrintFlow Work Order Tracker.\n\nChoose a new password here (the link works once and expires in about an hour):\n${url}\n\nIf this wasn't you, ignore this email — your password stays the same.\n\nYour organization`,
        html: `<div style="font:15px/1.5 Arial,sans-serif;color:#111;max-width:480px">
<p>Hi ${esc(first)},</p>
<p>Someone asked to reset the password for <strong>${esc(shown)}</strong> on the PrintFlow Work Order Tracker.</p>
<p><a href="${esc(url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:bold">Choose a new password</a></p>
<p style="color:#555;font-size:13px">The link works once and expires in about an hour. If this wasn't you, ignore this email — your password stays the same.</p>
<p style="color:#555;font-size:13px">Your organization</p>
</div>`,
      });
    } finally {
      await smtp.close().catch(() => {});
    }
  } catch (e) {
    // The caller already has its answer; log what went wrong instead.
    console.error('password-reset', e instanceof Error ? e.message : String(e));
  }
}
