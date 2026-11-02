import { useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { ROLE_LABEL, type Profile } from '../lib/types';
import { EVERYONE, matchPeople, mentionQueryAt, ROLE_TAGS, roleMembers } from '../lib/mentions';

/**
 * A compose textarea with `@` autocomplete. Type `@` and a menu of people
 * appears; picking one drops an `@[Name](id)` token into the text. Enter sends
 * (the parent's onEnter) unless the menu is open, when it accepts the highlight
 * instead. Used by both the Comments thread and the Chats panel.
 */
interface Props {
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  candidates: Profile[];
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  /** A group chat: offer "@everyone" first, to tag the whole group at once. */
  everyone?: boolean;
  /** Offer the role tags (@artists, @operators, @reception, @admins). */
  roles?: boolean;
}
// "@everyone" in the menu, as a stand-in person.
const ALL = { id: EVERYONE, full_name: EVERYONE } as unknown as Profile;
// Role tags in the menu, the same way; the id marks them apart from people.
const ROLE_ID = 'role:';
const roleItem = (tag: string) => ({ id: ROLE_ID + tag, full_name: tag }) as unknown as Profile;

export default function MentionInput({
  value, onChange, onEnter, candidates, placeholder, disabled, rows = 1, everyone = false, roles = false,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<{ at: number; items: Profile[]; index: number } | null>(null);
  // Where to put the caret after we rewrite the value to insert a token.
  const caretTo = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (caretTo.current != null && ref.current) {
      ref.current.selectionStart = ref.current.selectionEnd = caretTo.current;
      ref.current.focus();
      caretTo.current = null;
    }
  });

  function refresh(text: string, caret: number) {
    const q = mentionQueryAt(text, caret);
    if (!q) { setMenu(null); return; }
    const people = matchPeople(candidates, q.query);
    // "@", "@e", "@every…" (and "@all") bring up @everyone, above the names.
    const typed = q.query.toLowerCase();
    const offerAll = everyone && candidates.length > 0 && (EVERYONE.startsWith(typed) || 'all'.startsWith(typed));
    // A role tag once its first letter is typed ("@a" → @artists, @admins), so a bare "@" stays short.
    const tags = roles && typed
      ? ROLE_TAGS.filter((t) => t.tag.startsWith(typed) && roleMembers(candidates, t.role).length).map((t) => roleItem(t.tag))
      : [];
    const items = [...(offerAll ? [ALL] : []), ...tags, ...people].slice(0, 6);
    setMenu(items.length ? { at: q.at, items, index: 0 } : null);
  }

  function change(e: ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    onChange(text);
    refresh(text, e.target.selectionStart ?? text.length);
  }

  function accept(p: Profile) {
    if (!menu) return;
    const caret = ref.current?.selectionStart ?? value.length;
    const before = value.slice(0, menu.at);
    // Show a clean "@Full Name" while typing; it's expanded to the stored
    // @[Name](id) token at send time (see expandMentions).
    const token = `@${p.full_name} `;
    onChange(before + token + value.slice(caret));
    caretTo.current = (before + token).length;
    setMenu(null);
  }

  function key(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (menu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMenu((m) => (m ? { ...m, index: Math.min(m.index + 1, m.items.length - 1) } : m));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMenu((m) => (m ? { ...m, index: Math.max(m.index - 1, 0) } : m));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(menu.items[menu.index]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMenu(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onEnter(); }
  }

  function optionNote(p: Profile) {
    if (p.id === EVERYONE) return `Notify all ${candidates.length} in this group`;
    const t = p.id.startsWith(ROLE_ID) && ROLE_TAGS.find((x) => ROLE_ID + x.tag === p.id);
    if (t) {
      const n = roleMembers(candidates, t.role).length;
      return `Notify ${n === 1 ? 'the 1' : `all ${n}`} ${n === 1 ? t.noun.replace(/s$/, '') : t.noun}`;
    }
    return ROLE_LABEL[p.role];
  }

  return (
    <div className="mention-wrap">
      <textarea
        ref={ref}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        rows={rows}
        onChange={change}
        onKeyDown={key}
        // A blur closes the menu, but after the option's mousedown has fired.
        onBlur={() => setTimeout(() => setMenu(null), 120)}
      />
      {menu && (
        <div className="mention-menu" role="listbox">
          {menu.items.map((p, i) => (
            <button
              type="button"
              key={p.id}
              className={`mention-opt${i === menu.index ? ' on' : ''}`}
              role="option"
              aria-selected={i === menu.index}
              onMouseDown={(e) => { e.preventDefault(); accept(p); }}
            >
              <span className="mention-opt-name">{p.id === EVERYONE || p.id.startsWith(ROLE_ID) ? `@${p.full_name}` : p.full_name}</span>
              <span className="mention-opt-role">{optionNote(p)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
