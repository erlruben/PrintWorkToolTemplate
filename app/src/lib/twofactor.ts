// Two-factor auth: Supabase's built-in TOTP MFA (an authenticator app), plus a
// "trust this device for 30 days" layer so the code isn't asked for every login
// on a known device. Everything here is free and server-backed — no SMS.

import { supabase, userBearer } from './supabase';

// ---- Trusted device (30 days) -------------------------------------------------
const DEVICE_KEY = 'deviceToken';

/** A stable random token for this browser, made once and kept in localStorage. */
function deviceToken(): string {
  try {
    let t = localStorage.getItem(DEVICE_KEY);
    if (!t) {
      t = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
      localStorage.setItem(DEVICE_KEY, t);
    }
    return t;
  } catch {
    return '';
  }
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Is this device still within its 30-day trust for the signed-in person? */
export async function isDeviceTrusted(userId: string): Promise<boolean> {
  const t = deviceToken();
  if (!t) return false;
  const bearer = await userBearer();
  if (!bearer) return false;
  const { data } = await supabase
    .from('trusted_devices')
    .select('user_id')
    .eq('user_id', userId)
    .eq('token_hash', await sha256(t))
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .setHeader('Authorization', bearer);
  return !!data && data.length > 0;
}

/** Trust this device for 30 days (after a successful code). */
export async function trustThisDevice(userId: string): Promise<void> {
  const t = deviceToken();
  if (!t) return;
  const now = Date.now();
  await supabase.from('trusted_devices').upsert(
    {
      user_id: userId,
      token_hash: await sha256(t),
      label: navigator.userAgent.slice(0, 80),
      last_used_at: new Date(now).toISOString(),
      expires_at: new Date(now + 30 * 86_400_000).toISOString(),
    },
    { onConflict: 'user_id,token_hash' },
  );
}

/** Drop this device's trust (used when turning 2FA off). */
export async function untrustThisDevice(userId: string): Promise<void> {
  const t = deviceToken();
  if (!t) return;
  await supabase.from('trusted_devices').delete()
    .eq('user_id', userId).eq('token_hash', await sha256(t));
}

// ---- Supabase TOTP MFA --------------------------------------------------------
export interface TotpFactor { id: string; status: string; friendly_name?: string | null; }

export async function listTotpFactors(): Promise<TotpFactor[]> {
  const { data } = await supabase.auth.mfa.listFactors();
  return (data?.totp ?? []) as TotpFactor[];
}

/** A verified factor exists and this session hasn't cleared it yet. */
export async function needsStepUp(): Promise<boolean> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel === 'aal1' && data?.nextLevel === 'aal2';
}

export async function enrollTotp() {
  // A unique friendly name — Supabase rejects a second factor with a name that
  // already exists (including the empty default), which StrictMode's double
  // effect would otherwise trip.
  return supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `authenticator-${Date.now()}` });
}

/** Verify a 6-digit code against a factor (used for both enrol and step-up). */
export async function verifyTotp(factorId: string, code: string) {
  const ch = await supabase.auth.mfa.challenge({ factorId });
  if (ch.error) return { data: null, error: ch.error };
  return supabase.auth.mfa.verify({ factorId, challengeId: ch.data.id, code: code.trim() });
}

export async function unenrollTotp(factorId: string) {
  return supabase.auth.mfa.unenroll({ factorId });
}
