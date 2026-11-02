// push-send — delivers a web push for a notification row, so people are told
// even when the app is closed. Triggered by a Supabase Database Webhook on
// INSERT into public.notifications (Database → Webhooks in the dashboard), which
// POSTs { record: <the new notification> } here.
//
// Deploy like the admin-users function (Edge Functions → Deploy). It needs three
// secrets set on the function (Edge Functions → push-send → Secrets):
//   VAPID_PUBLIC_KEY   — the public VAPID key (same one pasted into Settings)
//   VAPID_PRIVATE_KEY  — the private VAPID key (keep secret; never in the app)
//   VAPID_SUBJECT      — a contact, e.g. mailto:admin@example.com
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically. Calls
// without the service_role key (the webhook's) are refused with 403.
//
// Generate a VAPID key pair once with:  npx web-push generate-vapid-keys
//
// The VAPID setup runs inside the handler, not at load time: a bad secret (a
// stray space, a subject without "mailto:") used to throw at boot and crash the
// worker with an unexplained WORKER_ERROR. Now the reply says what is wrong.

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Pasted secrets often carry quotes or whitespace; strip both.
const env = (k: string) => (Deno.env.get(k) ?? '').trim().replace(/^["']|["']$/g, '');

const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

let vapidReady = false;
function setupVapid(): string | null {
  if (vapidReady) return null;
  const pub = env('VAPID_PUBLIC_KEY');
  const priv = env('VAPID_PRIVATE_KEY');
  let subject = env('VAPID_SUBJECT') || 'mailto:admin@example.com';
  if (!pub || !priv) return 'VAPID keys not configured';
  if (!/^(mailto:|https:)/.test(subject)) subject = `mailto:${subject}`;
  try {
    webpush.setVapidDetails(subject, pub, priv);
    vapidReady = true;
    return null;
  } catch (e) {
    return `VAPID setup failed: ${e instanceof Error ? e.message : e}`;
  }
}

interface Notification {
  user_id: string;
  title?: string;
  body?: string;
  kind?: string;
  ref_id?: string;
}

/**
 * Only the database webhook may send pushes. The platform's own JWT check lets
 * the public anon key through (it is a valid JWT and sits in the app bundle),
 * so without this anyone could push any text to anyone. The webhook sends the
 * service_role key; accept that exact key, or failing an exact match (the
 * project's keys rotated), any key the Auth admin API accepts.
 */
async function fromWebhook(req: Request): Promise<boolean> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (key && token.length === key.length) {
    let diff = 0;
    for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ token.charCodeAt(i);
    if (diff === 0) return true;
  }
  const probe = createClient(env('SUPABASE_URL'), token, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
  return !error;
}

Deno.serve(async (req) => {
  try {
    if (!(await fromWebhook(req))) return new Response('Forbidden', { status: 403 });
    const vapidErr = setupVapid();
    if (vapidErr) {
      console.error(vapidErr);
      return new Response(vapidErr, { status: 500 });
    }
    const payload = await req.json().catch(() => ({}));
    const rec: Notification = payload.record ?? payload;
    if (!rec?.user_id) return new Response('no user', { status: 200 });

    const { data: subs, error: subErr } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', rec.user_id);
    if (subErr) {
      console.error('subscriptions read failed:', subErr.message);
      return new Response(`subscriptions read failed: ${subErr.message}`, { status: 500 });
    }
    if (!subs || subs.length === 0) return new Response('no subscriptions', { status: 200 });

    const message = JSON.stringify({
      title: rec.title ?? 'Work Order Tracker',
      body: rec.body ?? '',
      url: '/',
      tag: rec.kind ? `${rec.kind}-${rec.ref_id ?? ''}` : undefined,
    });

    let sent = 0;
    const failures: string[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            message,
          );
          sent++;
        } catch (err) {
          // 404/410 mean the subscription is dead — drop it so it isn't retried.
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
          }
          const why = `${code ?? ''} ${err instanceof Error ? err.message : err}`.trim();
          console.error('push failed:', why);
          failures.push(why);
        }
      }),
    );

    return new Response(
      `ok sent=${sent} failed=${failures.length}${failures.length ? ` (${failures[0]})` : ''}`,
      { status: 200 },
    );
  } catch (e) {
    console.error(e);
    return new Response(`error: ${e instanceof Error ? e.message : e}`, { status: 500 });
  }
});
