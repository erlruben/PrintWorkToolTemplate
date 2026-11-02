import { useMemo, useState } from 'react';
import { useSupportTickets } from '../lib/data';
import { MANUAL, MANUAL_UPDATED, MANUAL_VERSION, sectionText, type ManualSection } from '../lib/manual';
import { useSession } from '../lib/sessionContext';
import { transcriptText } from '../lib/support';
import { fmtDate, type Profile } from '../lib/types';
import { KEEP_DAYS, updatesByDate } from '../lib/updates';
import { Rich } from './Rich';
import SupportChat from './SupportChat';

export type HelpView = 'home' | 'manual' | 'support' | 'updates' | 'tickets';

/**
 * Help (2026-10-11), opened from the profile menu: the User Manual to read and
 * search, Chat Support, and What's new. Support and the Tech Developer also
 * get the filed support tickets (kept 30 days).
 */
export default function Help({ profiles, view, onView, onOpenChat }: {
  profiles: Profile[];
  view: HelpView;
  onView: (v: HelpView) => void;
  onOpenChat: (conversationId: string) => void;
}) {
  const { profile } = useSession();
  const staff = profile?.role === 'support' || profile?.role === 'developer';
  // The tickets are for Support and the Tech Developer; anyone else lands on the first page.
  if (view === 'tickets' && !staff) view = 'home';
  const TITLE: Record<HelpView, string> = { home: 'Help', manual: 'User Manual', support: 'Chat Support', updates: 'What’s new', tickets: 'Support tickets' };
  const SUB: Record<HelpView, string> = {
    home: 'The manual, quick answers, and what changed.',
    manual: `Version ${MANUAL_VERSION} · updated ${MANUAL_UPDATED}`,
    support: 'Quick answers about the tracker. It works even when the internet drops.',
    updates: 'The latest changes, in short.',
    tickets: 'Closed and handed-over support chats. Kept for 30 days, then deleted.',
  };

  return (
    <div className="wrap help">
      <div className="page-head">
        <div>
          {/* What's new has its own place in the profile menu, so it has no way back into Help. */}
          {view !== 'home' && view !== 'updates' && <button className="linkbtn help-back" onClick={() => onView('home')}>‹ Help</button>}
          <h1>{TITLE[view]}</h1>
          <p className="sub">{SUB[view]}</p>
        </div>
      </div>

      {view === 'home' && (
        <div className="help-cards">
          <button className="card help-card" onClick={() => onView('manual')}>
            <strong>User Manual</strong>
            <span className="muted">How everything works, step by step. You can search it.</span>
          </button>
          <button className="card help-card" onClick={() => onView('support')}>
            <strong>Chat Support</strong>
            <span className="muted">Ask a question and get the steps at once. It can add Support when you need a person.</span>
          </button>
          {staff && (
            <button className="card help-card" onClick={() => onView('tickets')}>
              <strong>Support tickets</strong>
              <span className="muted">What people asked Chat Support. Kept for 30 days.</span>
            </button>
          )}
        </div>
      )}
      {view === 'manual' && <ManualView />}
      {view === 'support' && <div className="card help-support"><SupportChat profiles={profiles} onOpenChat={onOpenChat} /></div>}
      {view === 'updates' && <UpdatesList />}
      {view === 'tickets' && staff && <Tickets profiles={profiles} onOpenChat={onOpenChat} />}
    </div>
  );
}

function ManualView() {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const texts = useMemo(() => MANUAL.map((s) => sectionText(s).toLowerCase()), []);
  const shown = needle ? MANUAL.filter((_, i) => texts[i].includes(needle)) : MANUAL;
  return (
    <div className="manual">
      <div className="manual-tools">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the manual" aria-label="Search the manual" />
        <button type="button" className="btn ghost sm manual-print" onClick={() => window.print()}>Print</button>
      </div>
      {!needle && (
        <nav className="manual-toc card" aria-label="Contents">
          {MANUAL.map((s, i) => <a key={s.id} href={`#manual-${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`manual-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{i + 1}. {s.title}</a>)}
        </nav>
      )}
      {shown.length === 0 && <p className="muted">Nothing in the manual matches &ldquo;{q}&rdquo;. Try another word, or ask Chat Support.</p>}
      {shown.map((s) => <Section key={s.id} s={s} n={MANUAL.indexOf(s) + 1} />)}
    </div>
  );
}

function Section({ s, n }: { s: ManualSection; n: number }) {
  return (
    <section className="card manual-section" id={`manual-${s.id}`}>
      <h2>{n}. {s.title}</h2>
      {s.intro && <p className="muted manual-intro"><Rich text={s.intro} /></p>}
      {s.parts.map((p, i) => (
        <div key={i} className="manual-part">
          {p.heading && <h3>{p.heading}</h3>}
          {p.rows && (
            <dl className="manual-rows">
              {p.rows.map(([a, b]) => (
                <div key={a}><dt>{a}</dt><dd><Rich text={b} /></dd></div>
              ))}
            </dl>
          )}
          {p.steps && (
            <ol className="manual-steps">
              {p.steps.map((st, k) => (
                <li key={k}>
                  <span className="manual-who">{st.who}</span>
                  <span><Rich text={st.what} /></span>
                  {st.details && <ul>{st.details.map((d, j) => <li key={j}><Rich text={d} /></li>)}</ul>}
                </li>
              ))}
            </ol>
          )}
          {p.list && <ul className="manual-list">{p.list.map((t, k) => <li key={k}><Rich text={t} /></li>)}</ul>}
          {p.note && <p className="manual-note"><Rich text={p.note} /></p>}
        </div>
      ))}
    </section>
  );
}

export function UpdatesList() {
  const days = updatesByDate();
  return (
    <div className="updates">
      {days.length === 0 && <p className="muted">No updates in the last {KEEP_DAYS} days.</p>}
      {days.map((d) => (
        <section className="updates-day" key={d.released} aria-label={d.label}>
          <h2 className="updates-day-head">{d.label}</h2>
          {d.entries.map((u) => (
            <div className="card updates-entry" key={u.id}>
              <h3>{u.title}</h3>
              <ul>{u.items.map((t, i) => <li key={i}><Rich text={t} /></li>)}</ul>
            </div>
          ))}
        </section>
      ))}
      <p className="muted" style={{ fontSize: 13 }}>Release notes stay here for {KEEP_DAYS} days. Refresh the app once after an update to get the newest version.</p>
    </div>
  );
}

function Tickets({ profiles, onOpenChat }: { profiles: Profile[]; onOpenChat: (id: string) => void }) {
  const { tickets, loading, available } = useSupportTickets(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.full_name ?? 'Unknown';
  if (!available) return <p className="notice">Support tickets are not switched on yet (a database update is pending).</p>;
  if (loading) return <p className="muted">Loading…</p>;
  if (!tickets.length) return <p className="muted">No support tickets in the last 30 days.</p>;
  return (
    <div className="tickets">
      {tickets.map((t) => {
        const asked = t.transcript.filter((m) => m.from === 'me').map((m) => m.text);
        const open = openId === t.id;
        return (
          <section className="card ticket-row" key={t.id}>
            <button className="ticket-head-btn" aria-expanded={open} onClick={() => setOpenId(open ? null : t.id)}>
              <span>
                <strong>{nameOf(t.user_id)}</strong>
                <span className={`ticket-tag ${t.status}`}>{t.status === 'closed' ? 'Closed' : 'Handed to Support'}</span>
              </span>
              <span className="muted ticket-meta">{fmtDate(t.closed_at)} · {asked[0] ?? 'No question typed'}</span>
            </button>
            {open && (
              <div className="ticket-body">
                <pre>{transcriptText(t.transcript, nameOf(t.user_id))}</pre>
                {t.conversation_id && <button className="btn ghost sm" onClick={() => onOpenChat(t.conversation_id!)}>Open the chat</button>}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
