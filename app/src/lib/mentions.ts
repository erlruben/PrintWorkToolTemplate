// @mentions — one shared format for both the per-work-order Comments and the
// Chats. A mention is stored in the message body as `@[Full Name](user-uuid)`.
// The id is what makes it unambiguous (two people can share a first name, and
// not everyone has a username), and it is what the database trigger reads to
// notify the tagged person. The UI renders the token as a highlighted @Name.

import type { Profile, Role } from './types';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
// A fresh regex per call — a shared /g/ regex carries lastIndex between calls.
const mentionRe = () => new RegExp(`@\\[([^\\]]+)\\]\\((${UUID})\\)`, 'g');

/**
 * @everyone (2026-10-12), group chats only. It is stored as one ordinary
 * mention token per member, all under the name "everyone" —
 * `@[everyone](id1)@[everyone](id2)…` — so the database notifies each of them
 * as "mentioned you" with no change to its rules. On screen that run of tokens
 * is shown as a single @everyone.
 */
export const EVERYONE = 'everyone';

/**
 * Role tags (2026-10-22): @artists, @operators, @reception, @admins. Stored the
 * same way as @everyone — one token per person in that role, all under the
 * tag's name — so the database notifies each of them with no change to its
 * rules. In a ticket's comments a tag reaches every active person in the role;
 * in a group chat, only the group's members in it.
 */
export const ROLE_TAGS: { tag: string; role: Role; noun: string }[] = [
  { tag: 'artists', role: 'artist', noun: 'artists' },
  { tag: 'operators', role: 'operator', noun: 'printer operators' },
  { tag: 'reception', role: 'receptionist', noun: 'receptionists' },
  { tag: 'admins', role: 'admin', noun: 'admins' },
];
/** Tags that stand for a group of people, shown as one @tag on screen. */
const GROUP_TAGS = new Set([EVERYONE, ...ROLE_TAGS.map((t) => t.tag)]);

/** Who a role tag reaches among the people who can be mentioned here. */
export const roleMembers = (candidates: Profile[], role: Role) =>
  candidates.filter((p) => p.role === role && p.active !== false);

/** `ids` is set on an @everyone or role-tag part: everyone it tags. */
export type BodyPart = { text: string } | { name: string; id: string; ids?: string[] };

/** Split a stored body into plain text and mention parts, for rendering. */
export function parseBody(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  let last = 0;
  for (const m of body.matchAll(mentionRe())) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push({ text: body.slice(last, idx) });
    const prev = parts[parts.length - 1];
    // A run of the same group tag ("everyone", "artists"…) with nothing between is one @tag.
    const group = GROUP_TAGS.has(m[1]);
    if (group && idx === last && prev && 'name' in prev && prev.name === m[1]) (prev.ids ??= [prev.id]).push(m[2]);
    else parts.push(group ? { name: m[1], id: m[2], ids: [m[2]] } : { name: m[1], id: m[2] });
    last = idx + m[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

/** Flatten the token back to `@Name` — for list previews, toasts, the inbox. */
export const plainBody = (body: string) =>
  body.replace(mentionRe(), (_m, name: string) => `@${name}`)
    .replace(new RegExp(`@(${[...GROUP_TAGS].join('|')})(?:@\\1)+`, 'g'), '@$1');

/** The token stored in the body when a person is picked. */
export const mentionToken = (p: Profile) => `@[${p.full_name}](${p.id})`;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Turn the readable `@Full Name` shown while typing into the stored
 * `@[Full Name](id)` token, matching against the people who can be mentioned
 * here. Longest names first so "Anna" wins over "Ann"; already-formed tokens
 * (which start with `@[`) are never re-matched. Run this once, at send time.
 */
export function expandMentions(text: string, candidates: Profile[], everyone?: Profile[], roles = false): string {
  if (!text.includes('@') || candidates.length === 0) return text;
  const sorted = [...candidates].sort((a, b) => b.full_name.length - a.full_name.length);
  let out = text;
  // @everyone → a token for each person in the group (given only in a group chat).
  if (everyone?.length) {
    const all = everyone.map((p) => `@[${EVERYONE}](${p.id})`).join('');
    out = out.replace(/(^|\s)@everyone(?=$|\s|[.,!?;:'")\]])/gi, (_m, pre: string) => `${pre}${all}`);
  }
  // @artists etc. → a token for each person in that role (comments and group chats).
  if (roles) {
    for (const t of ROLE_TAGS) {
      const who = roleMembers(candidates, t.role);
      if (!who.length) continue;
      const all = who.map((p) => `@[${t.tag}](${p.id})`).join('');
      out = out.replace(new RegExp(`(^|\\s)@${t.tag}(?=$|\\s|[.,!?;:'")\\]])`, 'gi'), (_m, pre: string) => `${pre}${all}`);
    }
  }
  for (const p of sorted) {
    const re = new RegExp(`(^|\\s)@${escapeRe(p.full_name)}(?=$|\\s|[.,!?;:'")\\]])`, 'g');
    out = out.replace(re, (_m, pre: string) => `${pre}${mentionToken(p)}`);
  }
  return out;
}

/**
 * Is the caret sitting inside an `@query` the person is typing? Returns the
 * query text and the index of the `@`, or null. It only fires at a word
 * boundary, so an email address (`a@b`) never opens the picker.
 */
export function mentionQueryAt(text: string, caret: number): { query: string; at: number } | null {
  const before = text.slice(0, caret);
  const m = before.match(/(?:^|\s)@([\p{L}\p{N}._-]*)$/u);
  if (!m) return null;
  const query = m[1];
  return { query, at: caret - query.length - 1 };
}

/** People matching the typed query (by name or username), capped for the menu. */
export function matchPeople(candidates: Profile[], query: string, limit = 6): Profile[] {
  const q = query.trim().toLowerCase();
  const pool = q
    ? candidates.filter(
        (p) =>
          p.full_name.toLowerCase().includes(q) || (p.username ?? '').toLowerCase().includes(q),
      )
    : candidates;
  return pool.slice(0, limit);
}
