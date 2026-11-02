// "Confirm your recovery email" (2026-10-27). Signed in only. Emails a 6-digit
// code to the caller's OWN recovery email (table account_recovery), from the
// shop's Gmail over SMTP — the same sender as password-reset. The person types
// the code back in Settings; the database checks it (confirm_recovery_email)
// and marks the email confirmed. The code is stored only as a hash, lasts 15
// minutes, and a new one can be asked for once a minute.
//
//   { ping: true }  → { ready }      ready = the Gmail secrets are set
//   { send: true }  → { ok } | { error, wait? }
//
// Deploy: Supabase → Edge Functions → new function "recovery-verify", paste this
// file, KEEP "Enforce JWT verification" ON (only signed-in staff use it). Or:
//   npx supabase functions deploy recovery-verify --project-ref <ref>
// Secrets: the same GMAIL_USER and GMAIL_APP_PASSWORD as password-reset.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GMAIL_USER = Deno.env.get('GMAIL_USER') ?? '';
const GMAIL_APP_PASSWORD = (Deno.env.get('GMAIL_APP_PASSWORD') ?? '').replace(/\s+/g, '');

const CODE_MINUTES = 15;
const RESEND_SECONDS = 60;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** A uniformly random 6-digit code (000000–999999). */
function newCode(): string {
  const a = new Uint32Array(1);
  let n: number;
  do { crypto.getRandomValues(a); n = a[0]; } while (n >= 4_294_000_000);   // no bias
  return String(n % 1_000_000).padStart(6, '0');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let body: { ping?: unknown; send?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'Malformed request' }, 400); }

  const ready = !!GMAIL_USER && !!GMAIL_APP_PASSWORD;
  if (body?.ping === true) return json({ ready });
  if (body?.send !== true) return json({ error: 'Unknown request' }, 400);
  if (!ready) return json({ error: 'Email is not set up yet. Ask Support.' }, 503);

  // Who is asking: the signed-in person's own token.
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  const userId = who?.user?.id;
  if (whoErr || !userId) return json({ error: 'Sign in again, then try once more.' }, 401);

  const { data: prof } = await admin.from('profiles').select('full_name, active').eq('id', userId).maybeSingle();
  if (!prof?.active) return json({ error: 'Sign in again, then try once more.' }, 401);
  const { data: rec } = await admin.from('account_recovery').select('email, verified_at').eq('user_id', userId).maybeSingle();
  if (!rec?.email) return json({ error: 'Add a recovery email first.' }, 400);
  if (rec.verified_at) return json({ ok: true, already: true });

  const { data: last } = await admin.from('recovery_email_codes').select('sent_at').eq('user_id', userId).maybeSingle();
  if (last?.sent_at) {
    const wait = Math.ceil(RESEND_SECONDS - (Date.now() - new Date(last.sent_at).getTime()) / 1000);
    if (wait > 0) return json({ error: `A code was just sent. You can ask for a new one in ${wait} seconds.`, wait }, 429);
  }

  const code = newCode();
  const { error: saveErr } = await admin.from('recovery_email_codes').upsert({
    user_id: userId,
    email: rec.email,
    code_hash: await sha256Hex(code + userId),
    sent_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + CODE_MINUTES * 60_000).toISOString(),
    attempts: 0,
  }, { onConflict: 'user_id' });
  if (saveErr) { console.error('recovery-verify save', saveErr.message); return json({ error: 'Could not send a code. Try again.' }, 500); }

  const first = String(prof.full_name ?? '').split(/\s+/)[0] || 'there';
  const smtp = new SMTPClient({
    connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD } },
  });
  try {
    await smtp.send({
      from: `PrintFlow Work Order Tracker <${GMAIL_USER}>`,
      to: rec.email,
      subject: `${code} is your Work Order Tracker code`,
      content: `Hi ${first},\n\nYour code to confirm this recovery email is: ${code}\n\nType it in the Work Order Tracker under Settings → Password recovery email. It works for ${CODE_MINUTES} minutes.\n\nIf you did not ask for this, ignore this email.\n\nYour organization`,
      html: `<div style="font:15px/1.5 Arial,sans-serif;color:#111;max-width:480px">
<p>Hi ${esc(first)},</p>
<p>Your code to confirm this recovery email is:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px;margin:8px 0 14px">${code}</p>
<p>Type it in the Work Order Tracker under <strong>Settings → Password recovery email</strong>. It works for ${CODE_MINUTES} minutes.</p>
<p style="color:#555;font-size:13px">If you did not ask for this, ignore this email.</p>
<p style="color:#555;font-size:13px">Your organization</p>
</div>`,
    });
  } catch (e) {
    console.error('recovery-verify send', e instanceof Error ? e.message : String(e));
    await admin.from('recovery_email_codes').delete().eq('user_id', userId);
    return json({ error: 'The email could not be sent. Check the address, or try again later.' }, 502);
  } finally {
    await smtp.close().catch(() => {});
  }
  return json({ ok: true });
});
