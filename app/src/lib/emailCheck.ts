/**
 * Is this email's domain real? (2026-10-27: "do we have validation if
 * email is real?"). Before a recovery email is saved, its domain is looked up:
 * a misspelled well-known domain ("gmial.com") gets a "did you mean", and a
 * domain that cannot receive mail at all is refused. It does NOT prove the
 * mailbox exists or belongs to the person — that needs a code sent by email,
 * which comes with the Gmail sending set-up.
 *
 * The lookup uses Google's public DNS over HTTPS (no account, no key). If it
 * cannot be reached (offline, blocked) the email is let through: this is a
 * typo guard, never a reason to stop someone saving.
 */

/** Well-known mail domains, and the misspellings people really type. */
const KNOWN: Record<string, string[]> = {
  'gmail.com': ['gmial.com', 'gmai.com', 'gmal.com', 'gamil.com', 'gnail.com', 'gmaill.com', 'gmail.co', 'gmail.con', 'gmail.cm', 'gmil.com', 'gmali.com', 'gimail.com', 'gmail.om', 'gmaik.com'],
  'yahoo.com': ['yaho.com', 'yahooo.com', 'yahoo.co', 'yahoo.con', 'yhoo.com', 'yaoo.com'],
  'hotmail.com': ['hotmial.com', 'hotmal.com', 'hotmai.com', 'hotmail.co', 'hotmail.con', 'hotmil.com'],
  'outlook.com': ['outlok.com', 'outllok.com', 'outlook.co', 'outlook.con', 'oulook.com'],
  'icloud.com': ['iclod.com', 'icloud.co', 'icoud.com', 'icloud.con'],
  'yahoo.com.ph': ['yahoo.com.hp', 'yaho.com.ph'],
};
const TYPO = new Map(Object.entries(KNOWN).flatMap(([right, wrongs]) => wrongs.map((w) => [w, right] as const)));

/** The domain of an email, lower-cased ('' when there is none). */
export const emailDomain = (email: string) => email.trim().toLowerCase().split('@')[1]?.replace(/\.+$/, '') ?? '';

/** "gmial.com" → "gmail.com"; null when the domain is not a known misspelling. */
export const likelyTypo = (domain: string): string | null => TYPO.get(domain.toLowerCase()) ?? null;

type DnsAnswer = { Status?: number; Answer?: { type: number }[] };
async function lookup(name: string, type: 'MX' | 'A', ms: number): Promise<DnsAnswer | null> {
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { signal: ctl.signal, headers: { accept: 'application/dns-json' } });
    return r.ok ? ((await r.json()) as DnsAnswer) : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(t);
  }
}

/**
 * What is wrong with this email's domain, in plain words — or null when it
 * looks fine (or could not be checked). Call it after the format check.
 */
export async function emailDomainProblem(email: string, ms = 4000): Promise<string | null> {
  const domain = emailDomain(email);
  if (!domain) return null;
  const right = likelyTypo(domain);
  if (right) return `Check the spelling: did you mean ${email.trim().split('@')[0]}@${right}?`;
  const mx = await lookup(domain, 'MX', ms);
  if (!mx) return null;                                   // could not check: let it through
  if (mx.Status === 3) return `"${domain}" does not exist, so it cannot receive email. Check the spelling.`;
  if (mx.Status === 0 && (mx.Answer ?? []).some((a) => a.type === 15)) return null;   // has a mail server
  // No mail server listed: mail may still go to the domain itself (rare).
  const a = await lookup(domain, 'A', ms);
  if (!a) return null;
  if (a.Status === 0 && (a.Answer ?? []).some((x) => x.type === 1)) return null;
  return `"${domain}" cannot receive email. Check the spelling, or use another email.`;
}
