// Staff usually have no email, so they sign in with a username. A username maps
// to a hidden internal email (username@printflow.local) that Supabase Auth stores;
// the owners keep their real emails. Everything below is a pure string mapping,
// so sign-in needs no lookup — the login field takes either form.

export const INTERNAL_EMAIL_DOMAIN = 'printflow.local';

/** A bare username (no "@") becomes its internal email; a real email passes through. */
export function toLoginEmail(identifier: string): string {
  const v = identifier.trim().toLowerCase();
  if (!v || v.includes('@')) return v;
  return `${v}@${INTERNAL_EMAIL_DOMAIN}`;
}

/** Keep a typed username safe as an email local-part. */
export function cleanUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

export function isInternalEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${INTERNAL_EMAIL_DOMAIN}`);
}

/** What to show a person as their login: the username for staff, the email otherwise. */
export function loginNameOf(email: string): string {
  return isInternalEmail(email) ? email.split('@')[0] : email;
}
