import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { markThreadRead, useMessages } from '../lib/data';
import { useSession } from '../lib/sessionContext';
import { ROLE_LABEL, type Profile } from '../lib/types';
import MentionInput from './MentionInput';
import MentionText from './MentionText';
import { expandMentions } from '../lib/mentions';

interface Props {
  workOrderId: string;
  profiles: Profile[];
}

/**
 * Replaces the phone call in PRD section 2 — the operator waiting for the
 * artist to ring, and the wrong file getting printed because nobody could
 * ask. The thread hangs off the work order, so it doubles as the record of
 * what was agreed.
 */
export default function Chat({ workOrderId, profiles }: Props) {
  const { profile } = useSession();
  const { messages, loading } = useMessages(workOrderId);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const author = useMemo(() => {
    const m = new Map(profiles.map((p) => [p.id, p]));
    return (id: string) => m.get(id);
  }, [profiles]);

  // Is this browser tab in front? Comments are only "read" when it is.
  const [tabVisible, setTabVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const onVis = () => setTabVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    if (profile && messages.length && tabVisible) markThreadRead(profile.id, workOrderId);
  }, [messages, profile, workOrderId, tabVisible]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const raw = body.trim();
    if (!raw || !profile) return;
    const text = expandMentions(raw, mentionable, undefined, true);

    setSending(true);
    setError(null);

    const { error } = await supabase
      .from('messages')
      .insert({ work_order_id: workOrderId, author_id: profile.id, body: text });

    if (error) setError(error.message);
    else setBody('');
    setSending(false);
  }

  // Anyone can be pulled into a job's thread with an @mention.
  const mentionable = profiles.filter((p) => p.id !== profile?.id);

  return (
    <div className="chat">
      <div className="chat-log" ref={logRef}>
        {loading && <p className="muted">Loading…</p>}

        {!loading && messages.length === 0 && (
          <p className="muted" style={{ margin: 'auto', textAlign: 'center' }}>
            No comments yet. Ask here instead of calling — the answer stays with the job.
          </p>
        )}

        {messages.map((m) => {
          const who = author(m.author_id);
          const mine = m.author_id === profile?.id;
          return (
            <div key={m.id} className={`msg ${mine ? 'mine' : ''}`}>
              <div className="meta">
                {mine ? 'You' : who?.full_name ?? 'Unknown'}
                {who && !mine ? ` · ${ROLE_LABEL[who.role]}` : ''}
                {' · '}
                {new Date(m.created_at).toLocaleString('en-PH', {
                  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                })}
              </div>
              <div className="bubble"><MentionText body={m.body} meId={profile?.id} /></div>
            </div>
          );
        })}
      </div>

      {error && <div className="error" style={{ margin: 10 }}>{error}</div>}

      <form className="chat-compose" onSubmit={send}>
        <MentionInput
          value={body}
          onChange={setBody}
          onEnter={() => send()}
          candidates={mentionable}
          roles
          placeholder="Comment on this work order…  (@ to mention)"
        />
        <button className="btn sm" disabled={sending || !body.trim()}>Send</button>
      </form>
    </div>
  );
}
