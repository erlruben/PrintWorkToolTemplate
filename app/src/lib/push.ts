// Web push, per device. A person turns it on from the notifications panel; the
// browser subscription is stored in `push_subscriptions`, and the push-send
// Edge Function delivers a notification even when the app is closed. Everything
// here is a no-op unless a VAPID public key is set in Settings, so the app runs
// exactly as before when push isn't configured.

import { useCallback, useEffect, useState } from 'react';
import { supabase, userBearer } from './supabase';

export const pushSupported = () =>
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  typeof window !== 'undefined' &&
  'PushManager' in window &&
  'Notification' in window;

/**
 * Chrome/Edge/Safari have a real push service; the VS Code Simple Browser and many
 * in-app webviews expose the Push APIs but have nothing behind them, so subscribe()
 * fails with "push service not available". This flags the obvious embedded cases so
 * the UI can warn before the person taps and hits a confusing error.
 */
export function pushServiceLikelyMissing(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /\bElectron\b|VSCode|\bCode\/\d/i.test(ua);
}

const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)); // iPadOS reports as a Mac
const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

/**
 * Why this device can't turn push on, in words a person can act on — or null
 * when it can. iPhones only allow web push from the Home Screen app (iOS 16.4+),
 * which is the case most staff will hit, so it gets its own instructions.
 */
export function pushUnavailableReason(): string | null {
  if (pushSupported()) return null;
  if (isIOS()) {
    return isStandalone()
      ? 'Notifications need iOS 16.4 or newer. Update this iPhone in Settings → General → Software Update, then reopen the app.'
      : 'On iPhone, notifications only work from the Home Screen app: in Safari tap Share → Add to Home Screen, then open PrintFlow from its icon.';
  }
  return "This browser can't receive push notifications. Open the app in Chrome, Edge or Safari.";
}

/** Turn a subscribe() failure into something a non-technical person can act on. */
function pushErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  const msg = e instanceof Error ? e.message : '';
  if (
    name === 'NotSupportedError' || name === 'AbortError' ||
    /push service|not available|not supported/i.test(msg)
  ) {
    return "This browser can't receive push here (for example the in-editor preview). " +
      'Open the app in Chrome, Edge or Safari — or install it to the home screen — and try again.';
  }
  return msg || 'Could not turn on push notifications.';
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/**
 * Push state for the current device: whether it can be offered, whether it's
 * on, and turn it on/off. `enable` asks the browser's permission, subscribes,
 * and records the subscription; `disable` removes it.
 */
export function usePush(userId: string | undefined, vapidKey: string | null | undefined) {
  const supported = pushSupported();
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported || !userId) return;
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) { if (!cancelled) setSubscribed(false); return; }
        // push-send deletes a subscription the push service rejects (410 gone).
        // If ours is no longer on the server, this device isn't really getting
        // pushes — clear it here so "Turn on" shows again instead of a false "on".
        // Only with the person's own token: an anon answer is always empty.
        const bearer = await userBearer();
        if (!bearer) return;
        const { data, error: dbErr } = await supabase
          .from('push_subscriptions').select('endpoint').eq('endpoint', sub.endpoint)
          .setHeader('Authorization', bearer).maybeSingle();
        if (!dbErr && !data) {
          await sub.unsubscribe().catch(() => {});
          if (!cancelled) setSubscribed(false);
          return;
        }
        if (!cancelled) setSubscribed(true);
      } catch { /* service worker unavailable — leave the default */ }
    })();
    return () => { cancelled = true; };
  }, [supported, userId]);

  const enable = useCallback(async () => {
    if (!supported || !userId || !vapidKey) return;
    setBusy(true);
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setError('Notifications are blocked for this site in the browser settings.');
        setBusy(false);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey.trim()) as BufferSource,
        }));
      const json = sub.toJSON();
      const { error: dbErr } = await supabase.from('push_subscriptions').upsert(
        {
          user_id: userId,
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? '',
          auth: json.keys?.auth ?? '',
        },
        { onConflict: 'endpoint' },
      );
      if (dbErr) throw new Error(dbErr.message);
      setSubscribed(true);
    } catch (e) {
      setError(pushErrorMessage(e));
    }
    setBusy(false);
  }, [supported, userId, vapidKey]);

  const disable = useCallback(async () => {
    if (!supported) return;
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn off push notifications.');
    }
    setBusy(false);
  }, [supported]);

  return {
    supported,
    subscribed,
    busy,
    error,
    enable,
    disable,
    canOffer: supported && !!vapidKey && !!userId,
    // Only worth explaining when push is set up for the app but this device can't use it.
    unavailableReason: vapidKey && userId ? pushUnavailableReason() : null,
    serviceLikelyMissing: pushServiceLikelyMissing(),
  };
}

export type PushState = ReturnType<typeof usePush>;
