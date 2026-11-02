import { useEffect } from 'react';
import type { Notification } from '../lib/types';
import { plainBody } from '../lib/mentions';
import type { PushState } from '../lib/push';
import { IconBell } from './Icons';
import type { ReleaseNotice } from '../lib/updates';

export interface Toast { id: number; kind: Notification['kind']; title: string; body?: string; }

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-PH', { day: 'numeric', month: 'short' });
}

/** The bell button, shown beside the profile with an unread count. */
export function NotifBell({ unread, active, onClick }: { unread: number; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`notif-bell ${active ? 'active' : ''}`}
      onClick={onClick}
      aria-expanded={active}
      aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
    >
      <IconBell />
      {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
    </button>
  );
}

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  items: Notification[];
  unread: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  toasts: Toast[];
  onDismissToast: (id: number) => void;
  onOpen: (n: Notification) => void;
  push?: PushState;
  /** App updates, as rows in the bell (2026-10-11). Unread until What's new has been seen. */
  releases?: ReleaseNotice[];
  onOpenRelease?: () => void;
}

/**
 * The overlays that go with the bell: a transient toast (with a chime) as each
 * notification arrives, and the inbox panel. Clicking a row marks it read and
 * hands it to `onOpen` — the app takes an assignment to its ticket and a
 * message to that chat. State lives in the app so the bell can sit by the
 * profile while these float over everything.
 */
export default function NotifOverlay({
  open, onClose, items, unread, markRead, markAllRead, clearAll, toasts, onDismissToast, onOpen, push, releases = [], onOpenRelease,
}: OverlayProps) {
  // Escape closes the panel, like every other panel in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  function clearNotifs() {
    if (confirm('Clear all your notifications?\n\nThey are deleted for good.')) clearAll();
  }
  function openNotif(n: Notification) {
    markRead(n.id);
    onClose();
    onOpen(n);
  }

  return (
    <>
      {toasts.length > 0 && (
        <div className="toast-stack" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`} role="status" onClick={() => onDismissToast(t.id)}>
              <div className="toast-main">
                <strong>{t.title}</strong>
                {t.body && <span className="toast-body">{plainBody(t.body)}</span>}
              </div>
              <button className="toast-x" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); onDismissToast(t.id); }}>×</button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <>
          <div className="notif-backdrop" onClick={onClose} />
          <div className="notif-panel" role="dialog" aria-label="Notifications">
            <div className="notif-head">
              <strong>Notifications</strong>
              {items.length + releases.length > 0 && (
                <span className="notif-actions">
                  {unread > 0 && <button className="notif-allread" onClick={markAllRead}>Mark all read</button>}
                  <button className="notif-allread" onClick={clearNotifs}>Clear all</button>
                </span>
              )}
              <button className="notif-x" aria-label="Close" onClick={onClose}>×</button>
            </div>
            {push?.canOffer && (
              <div className="notif-push">
                {push.subscribed ? (
                  <span className="muted">
                    Push is on for this device ·{' '}
                    <button className="linkbtn" onClick={push.disable} disabled={push.busy}>turn off</button>
                  </span>
                ) : (
                  <>
                    <button className="notif-enable" onClick={push.enable} disabled={push.busy}>
                      {push.busy ? 'Turning on…' : '🔔 Turn on push notifications on this device'}
                    </button>
                    {push.serviceLikelyMissing && (
                      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                        Heads up: the in-editor preview can't receive push. Open the app in Chrome, Edge or
                        Safari to turn it on.
                      </div>
                    )}
                  </>
                )}
                {push.error && (
                  <div style={{ color: 'var(--vim-red)', fontSize: 12, marginTop: 4 }}>{push.error}</div>
                )}
              </div>
            )}
            {/* Push is set up for the app but this device can't use it — say why
                and what to do, rather than silently showing nothing. */}
            {push && !push.canOffer && push.unavailableReason && (
              <div className="notif-push">
                <span className="muted" style={{ fontSize: 12.5 }}>🔔 {push.unavailableReason}</span>
              </div>
            )}
            <div className="notif-list">
              {items.length + releases.length === 0 ? (
                <div className="notif-empty">Nothing yet. New assignments and messages show up here.</div>
              ) : (
                // Newest first, app updates in among the rest by their release date.
                [...items.map((n) => ({ at: n.created_at, n, r: null as ReleaseNotice | null })),
                 ...releases.map((r) => ({ at: r.at, n: null as Notification | null, r }))]
                  .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
                  .map(({ n, r }) => (n ? (
                    <button key={n.id} className={`notif-row ${n.read_at ? '' : 'unread'}`} onClick={() => openNotif(n)}>
                      <span className={`notif-dot ${n.kind}`} />
                      <span className="notif-row-main">
                        <span className="notif-title">{n.title}</span>
                        {n.body && <span className="notif-body">{plainBody(n.body)}</span>}
                        <span className="notif-time">{timeAgo(n.created_at)}</span>
                      </span>
                    </button>
                  ) : r && (
                    <button key={`release-${r.id}`} className={`notif-row release ${r.unread ? 'unread' : ''}`} onClick={() => { onClose(); onOpenRelease?.(); }}>
                      <span className="notif-dot release" />
                      <span className="notif-row-main">
                        <span className="notif-title">{r.title}</span>
                        <span className="notif-body">{r.body}</span>
                        <span className="notif-time">{r.label} · tap to see what&rsquo;s new</span>
                      </span>
                    </button>
                  )))
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
