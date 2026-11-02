import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createGroup, saveSupportTicket, sendChatMessage, type SupportTicket } from '../lib/data';
import { useSession } from '../lib/sessionContext';
import { closestTopics, rank, readMessage, suggestionsFor, topicById, transcriptText, type SupportMsg, type SupportTopic } from '../lib/support';
import type { Profile } from '../lib/types';
import { Rich } from './Rich';

/**
 * Help → Chat Support (2026-10-11). A scripted helper answers from what it
 * knows of the tracker (lib/support.ts) — all in the browser, so it keeps
 * working when the internet drops, for as long as this page stays open. The
 * conversation lives in memory only: a refresh starts a new one.
 *
 *  • It asks whether the answer solved it. "All good" brings up Close ticket.
 *  • Asked for a person, or stuck twice in a row: it offers to add Support to
 *    a group chat with you, with the conversation so far.
 *  • A closed or handed-over ticket is filed as a report (kept 30 days). With
 *    no internet it is filed as soon as the connection is back.
 */
interface Session {
  msgs: SupportMsg[];
  awaitingDone: boolean;
  misses: number;
  offer: 'human' | null;
  ended: null | 'closed' | 'handed';
  startedAt: string;
  /** Questions to offer next (topic ids): other likely answers, or "did you mean" when it was not sure. */
  next: string[];
}
// Kept for this page load only (so leaving Help and coming back keeps the chat).
let memory: Session | null = null;
let memoryFor: string | null = null;
type Pending = Pick<SupportTicket, 'status' | 'transcript' | 'conversation_id' | 'started_at'>;
const unsent: Pending[] = [];
async function flushUnsent(): Promise<boolean> {
  while (unsent.length) {
    if (await saveSupportTicket(unsent[0])) return false;   // still no connection: try again later
    unsent.shift();
  }
  return true;
}
const stamp = () => new Date().toISOString();
const bot = (text: string, extra: Partial<SupportMsg> = {}): SupportMsg => ({ from: 'bot', text, at: stamp(), ...extra });

export default function SupportChat({ profiles, onOpenChat }: {
  profiles: Profile[];
  /** Opens the team chat on a conversation (after Support was added). */
  onOpenChat: (conversationId: string) => void;
}) {
  const { profile } = useSession();
  const first = profile?.full_name.split(' ')[0] ?? 'there';
  const fresh = (): Session => ({
    msgs: [bot(`Hi ${first}. I am the PrintFlow helper. Ask me how to do something in the tracker, or tap a question below.`)],
    awaitingDone: false, misses: 0, offer: null, ended: null, startedAt: stamp(), next: [],
  });
  const [s, setS] = useState<Session>(() => {
    if (memory && memoryFor === profile?.id) return memory;
    // Someone else signed in on this page: nothing of the last person's carries over.
    if (memoryFor && memoryFor !== profile?.id) unsent.length = 0;
    return fresh();
  });
  const [input, setInput] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [waiting, setWaiting] = useState(unsent.length);   // reports not filed yet (no internet)
  const endRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { memory = s; memoryFor = profile?.id ?? null; }, [s, profile?.id]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
    // On a short screen (a phone held sideways) keep the whole chat, typing box included, in view.
    if (window.innerHeight < 560) rootRef.current?.scrollIntoView({ block: 'end' });
  }, [s.msgs.length, s.offer, s.ended]);
  useEffect(() => {
    const on = () => { setOnline(true); void flushUnsent().then(() => setWaiting(unsent.length)); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    if (unsent.length) void flushUnsent().then(() => setWaiting(unsent.length));
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  // Escape closes the Close-ticket prompt.
  useEffect(() => {
    if (!closeOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setCloseOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [closeOpen]);

  // Who a person is handed to: Support first, the Tech Developer when there is no one else.
  const team = (() => {
    const others = profiles.filter((p) => p.active && p.id !== profile?.id);
    const support = others.filter((p) => p.role === 'support');
    return support.length ? support : others.filter((p) => p.role === 'developer');
  })();
  const teamNames = team.map((p) => p.full_name.split(' ')[0]).join(' and ') || 'Support';

  const offerHuman = (why: string): SupportMsg[] => [bot(team.length
    ? `${why} I can add ${teamNames} (Support) to a chat with you, with this conversation so they can see what you asked. Add them?`
    : `${why} There is no one from Support to add right now. Please tell an admin.`)];

  function answer(topic: SupportTopic): SupportMsg[] {
    return [bot(topic.title, { steps: topic.answer, topic: topic.id }), bot('Did that solve it?')];
  }

  function say(text: string) {
    const typed = text.trim();
    if (!typed || s.ended) return;
    const mine: SupportMsg = { from: 'me', text: typed, at: stamp() };
    // Right after an answer, or after a first "no", a short reply is about that — not a new question.
    const intent = readMessage(typed, s.awaitingDone || s.misses > 0);
    let next: Session = { ...s, msgs: [...s.msgs, mine], offer: null, next: [] };
    switch (intent.kind) {
      case 'answer': {
        // In case it picked the wrong one: the next most likely answers, then the related ones.
        const others = [...rank(typed).map((r) => r.topic.id), ...(intent.topic.related ?? [])].filter((id, i, all) => id !== intent.topic.id && all.indexOf(id) === i).slice(0, 2);
        next = { ...next, msgs: [...next.msgs, ...answer(intent.topic)], awaitingDone: true, misses: 0, next: others };
        break;
      }
      case 'done':
        next = { ...next, msgs: [...next.msgs, bot('Glad that helped. If everything is good, press **Close ticket** to finish.')], awaitingDone: false, misses: 0 };
        setCloseOpen(true);
        break;
      case 'human':
        next = { ...next, msgs: [...next.msgs, ...offerHuman('Sure.')], offer: team.length ? 'human' : null, awaitingDone: false };
        break;
      case 'hello':
        next = { ...next, msgs: [...next.msgs, bot('Hello. What do you need help with? You can type it, or tap one of these.')], awaitingDone: false };
        break;
      default: {
        // "No" after an answer, or something it does not know: twice in a row brings in a person.
        const misses = s.misses + 1;
        if (misses >= 2) {
          next = { ...next, msgs: [...next.msgs, ...offerHuman('I could not solve this one.')], offer: team.length ? 'human' : null, misses: 0, awaitingDone: false };
        } else {
          // Not sure: offer the closest questions instead of guessing.
          const guesses = intent.kind === 'not_done' ? [] : closestTopics(typed, 3).map((t) => t.id);
          next = { ...next, misses, awaitingDone: false, next: guesses, msgs: [...next.msgs, bot(intent.kind === 'not_done'
            ? 'Sorry about that. Tell me in other words what you are trying to do, or tap a question below.'
            : guesses.length
              ? 'I am not sure I understood. Is it one of these? Tap it, or say it in other words.'
              : 'I am not sure I understood. Try a few key words, like "upload file" or "release", or tap a question below.')] };
        }
      }
    }
    setS(next);
    setInput('');
    inputRef.current?.focus();
  }
  function submit(e: FormEvent) { e.preventDefault(); say(input); }

  async function file(t: Pending) {
    unsent.push(t);
    const done = await flushUnsent();
    setWaiting(unsent.length);
    return done;
  }

  async function closeTicket() {
    setBusy(true);
    const msgs = [...s.msgs, bot('Ticket closed. Thank you.')];
    const saved = await file({ status: 'closed', transcript: msgs, conversation_id: null, started_at: s.startedAt });
    setBusy(false);
    setCloseOpen(false);
    setS({ ...s, msgs: saved ? msgs : [...msgs, bot('There is no internet right now. Your report is kept and will be filed when the connection is back, as long as this page stays open.')], ended: 'closed', awaitingDone: false, offer: null });
  }

  async function addSupport() {
    if (!profile || !team.length) return;
    if (!navigator.onLine) { setS({ ...s, msgs: [...s.msgs, bot('There is no internet right now, so I cannot reach Support. Try again when you are back online.')] }); return; }
    setBusy(true);
    const conv = await createGroup(`Support: ${profile.full_name}`, team.map((p) => p.id));
    if (!conv) {
      setBusy(false);
      setS({ ...s, msgs: [...s.msgs, bot('I could not reach the server. Check your internet and try again.')] });
      return;
    }
    const text = transcriptText(s.msgs, profile.full_name);
    await sendChatMessage(conv, profile.id, `Support request. What was asked so far:\n\n${text.length > 3000 ? `…${text.slice(-3000)}` : text}`);
    const msgs = [...s.msgs, bot(`${teamNames} was added. Your chat with them is open now. They will answer there.`)];
    await file({ status: 'handed_over', transcript: msgs, conversation_id: conv, started_at: s.startedAt });
    setBusy(false);
    setS({ ...s, msgs, ended: 'handed', offer: null, awaitingDone: false });
    onOpenChat(conv);
  }

  function restart() { setS(fresh()); setInput(''); }

  const last = s.msgs[s.msgs.length - 1];
  // What to offer under the conversation.
  const offered = (s.next ?? []).map(topicById).filter((t): t is SupportTopic => !!t).map((t) => ({ label: t.title, send: t.title }));
  const chips: { label: string; send: string }[] = s.ended || s.offer ? [] : s.awaitingDone
    ? [{ label: 'Yes, all good', send: 'Yes, all good' }, { label: 'No, still stuck', send: 'No, still stuck' }, ...offered]
    : offered.length ? offered : suggestionsFor(profile?.role).map((t) => ({ label: t.title, send: t.title }));

  return (
    <div className="support-chat" aria-label="Chat Support" ref={rootRef}>
      {!online && (
        <div className="support-offline" role="status">
          No internet. The helper still answers here. Adding Support to the chat needs a connection.
        </div>
      )}
      <div className="support-log" role="log" aria-live="polite">
        {s.msgs.map((m, i) => (
          <div key={i} className={`support-msg ${m.from}`}>
            <div className="support-bubble">
              {m.steps ? <strong><Rich text={m.text} /></strong> : <Rich text={m.text} />}
              {m.steps && (
                <ol>{m.steps.map((st, k) => <li key={k}><Rich text={st} /></li>)}</ol>
              )}
            </div>
          </div>
        ))}
        {s.offer === 'human' && (
          <div className="support-actions">
            <button className="btn sm" disabled={busy} onClick={addSupport}>{busy ? 'Adding…' : `Add ${teamNames} to the chat`}</button>
            <button className="btn ghost sm" disabled={busy} onClick={() => setS({ ...s, offer: null, msgs: [...s.msgs, bot('Okay. Ask me anything else, or tap a question below.')] })}>Not now</button>
          </div>
        )}
        {s.ended && (
          <div className="support-actions">
            {waiting > 0 && <span className="muted" role="status" style={{ fontSize: 12.5 }}>Report waiting for the internet…</span>}
            <button className="btn ghost sm" onClick={restart}>Ask something else</button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {chips.length > 0 && (
        <div className="support-chips" aria-label="Suggestions">
          {chips.map((c) => <button key={c.label} type="button" className="support-chip" onClick={() => say(c.send)}>{c.label}</button>)}
          {team.length > 0 && last?.from === 'bot' && s.msgs.length > 1 && (
            <button type="button" className="support-chip person" onClick={() => say('Talk to a person')}>Talk to a person</button>
          )}
        </div>
      )}

      <form className="support-form" onSubmit={submit}>
        <input
          ref={inputRef}
          value={input}
          disabled={!!s.ended}
          maxLength={500}
          placeholder={s.ended ? 'This ticket is closed' : 'Type your question…'}
          aria-label="Your question"
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="btn" disabled={!!s.ended || !input.trim()}>Send</button>
        {!s.ended && s.msgs.length > 1 && (
          <button type="button" className="btn ghost" onClick={() => setCloseOpen(true)} title="Finish this conversation">Close ticket</button>
        )}
      </form>

      {closeOpen && (
        <div className="overlay" onClick={() => !busy && setCloseOpen(false)}>
          <div className="sheet support-close" role="dialog" aria-modal="true" aria-label="Close ticket" onClick={(e) => e.stopPropagation()}>
            <h2>All good?</h2>
            <p className="muted">Closing the ticket ends this conversation and files it as a report for Support. Reports are kept for 30 days.</p>
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn ghost" disabled={busy} onClick={() => setCloseOpen(false)}>Not yet</button>
              <button className="btn" autoFocus disabled={busy} onClick={closeTicket}>{busy ? 'Closing…' : 'Close ticket'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
