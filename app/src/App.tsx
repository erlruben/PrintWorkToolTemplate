import { useEffect, useRef, useState, type ComponentType } from 'react';
import { isConfigured, isDemo } from './lib/supabase';
import DemoBar, { type DemoDevice } from './components/DemoBar';
import { useAwaitingJobs, useNotifications, useProfiles, useSchemaCheck, useSettings } from './lib/data';
import { usePush } from './lib/push';
import { effectiveVolume, usePrintAlarmHere } from './lib/sound';
import { isDeviceTrusted, needsStepUp } from './lib/twofactor';
import { useSession } from './lib/sessionContext';
import { awayLabel, isAdminRole, ROLE_LABEL, staffStatusOf, type Notification } from './lib/types';
import Login from './components/Login';
import ChangePassword from './components/ChangePassword';
import TwoFactorChallenge from './components/TwoFactorChallenge';
import GlanceTable from './components/GlanceTable';
import TeamChat from './components/TeamChat';
import Dashboard from './components/Dashboard';
import Accounts from './components/Accounts';
import Settings from './components/Settings';
import TrashBin from './components/TrashBin';
import Help, { type HelpView } from './components/Help';
import WhatsNewNotice from './components/WhatsNewNotice';
import UpdatePrompt from './components/UpdatePrompt';
import { clearReleaseNotices, markUpdatesSeen, useUpdates } from './lib/updates';
import QueueScreen from './components/QueueScreen';
import Inventory from './components/Inventory';
import PrintAlarm from './components/PrintAlarm';
import MadeBy from './components/MadeBy';
import UserMenu from './components/UserMenu';
import NotifOverlay, { NotifBell, type Toast } from './components/Notifications';
import { IconChart, IconInventory, IconList, IconMessage, IconMonitor, IconUsers } from './components/Icons';
import BrandMark from './components/BrandMark';
import QuickSettings from './components/QuickSettings';
import { StatusPicker } from './components/StaffStatus';
import PreviewHome from './components/PreviewHome';

type Tab = 'orders' | 'workload' | 'queue' | 'inventory' | 'accounts' | 'settings' | 'trash' | 'help';

// A short two-note chime as a notification lands (blocked until the page has
// been interacted with, which signing in covers).
function chime() {
  const vol = effectiveVolume();
  if (vol <= 0) return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1174.66].forEach((freq, i) => {
      const t = now + i * 0.13;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12 * vol, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  } catch { /* audio not allowed yet */ }
}

function Setup() {
  return (
    <div className="signin-page">
      <div className="signin-stack signin-stack--narrow"><div className="signin-card signin-card--single">
        <h1 className="signin-title">Almost there</h1>
        <p className="signin-lede">
          The tracker needs its Supabase project details before it can start.
        </p>
        <ol style={{ paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
          <li>Create a free project at supabase.com</li>
          <li>Apply the database: <code>node supabase/db.mjs push</code> (see <code>supabase/README.md</code>)</li>
          <li>
            Copy the project URL and anon key into <code>.env.local</code>
          </li>
          <li>Restart <code>npm run dev</code></li>
        </ol>
        <p className="signin-help">
          Full walkthrough in <code>SETUP.md</code>.
        </p>
      </div></div>
    </div>
  );
}

function DemoPreview() {
  const [device, setDevice] = useState<DemoDevice>('computer');
  const [frameVersion, setFrameVersion] = useState(0);
  const frameWidths: Record<DemoDevice, number> = { phone: 390, tablet: 768, computer: 1280 };

  return (
    <div className="demo-preview-shell">
      <DemoBar
        device={device}
        onDeviceChange={setDevice}
        onRoleChange={() => setFrameVersion((version) => version + 1)}
      />
      <main className="demo-preview-stage">
        <iframe
          key={frameVersion}
          className={`demo-preview-frame ${device}`}
          src={`/?devicePreview=1&device=${device}`}
          title={`${device[0].toUpperCase()}${device.slice(1)} preview`}
          style={{ width: frameWidths[device] }}
        />
      </main>
    </div>
  );
}

function AuthenticatedApp() {
  const { session, profile, loading, signOut, recovering } = useSession();
  const schema = useSchemaCheck(!!session);
  const awaitingJobs = useAwaitingJobs(!!session);
  const awaiting = awaitingJobs?.length ?? 0;
  const [alarmHere] = usePrintAlarmHere();
  // Web push (per device) — offered only when a VAPID key is set in Settings.
  const { settings } = useSettings();
  const push = usePush(profile?.id, settings.vapid_public_key);

  // Two-factor step-up: with a valid session, if the person has 2FA on and this
  // device isn't trusted, the app is gated behind their authenticator code.
  const [stepUp, setStepUp] = useState<'checking' | 'ok' | 'needed'>('checking');
  useEffect(() => {
    if (!session || !profile) { setStepUp('checking'); return; }
    let cancelled = false;
    (async () => {
      const need = await needsStepUp();
      if (cancelled) return;
      if (!need) { setStepUp('ok'); return; }
      const trusted = await isDeviceTrusted(profile.id);
      if (!cancelled) setStepUp(trusted ? 'ok' : 'needed');
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, profile?.id]);
  // Profiles for the app-wide floating chat; (re)load once the person is known.
  const { profiles, reload: reloadProfiles } = useProfiles(!!session);   // nothing is asked before sign-in
  useEffect(() => { if (profile?.id) reloadProfiles(); }, [profile?.id, reloadProfiles]);
  // Your own row from the live list, so a status set here (or by an admin)
  // shows at once; the signed-in profile is the fallback while it loads.
  const meLive = profiles.find((p) => p.id === profile?.id) ?? profile;
  const [statusOpen, setStatusOpen] = useState(false);

  // #queue deep-links straight to the print queue, so a screen at the printing
  // area can be bookmarked and reopen into it.
  const [tab, setTab] = useState<Tab>(window.location.hash === '#queue' ? 'queue' : 'workload');
  const [helpView, setHelpView] = useState<HelpView>('home');
  // App updates this person has not seen: the persistent announcement and notification bell.
  const updates = useUpdates(profile?.id);

  // The print queue is the operator's home — land them there on sign-in, once.
  // They can still browse elsewhere afterwards.
  const routedForRole = useRef(false);
  useEffect(() => {
    if (routedForRole.current || !profile) return;
    routedForRole.current = true;
    if (profile.role === 'operator' && window.location.hash !== '#queue') setTab('queue');
  }, [profile]);

  // The notifications inbox lives in the workspace header while its panel and
  // toasts float over the whole app.
  const [notifOpen, setNotifOpen] = useState(false);
  const [chatRequest, setChatRequest] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const notif = useNotifications(profile?.id, (n) => {
    const id = ++toastSeq.current;
    setToasts((l) => [...l, { id, kind: n.kind, title: n.title, body: n.body ?? undefined }]);
    // A new print job already sounds the print alarm; don't chime over it.
    if (n.kind !== 'queued') chime();
    setTimeout(() => setToasts((l) => l.filter((t) => t.id !== id)), 8000);
  });

  // Clicking a notification routes to its subject: an assignment to its ticket,
  // a message to that conversation. The work orders screen (which owns both)
  // reads this and clears it.
  const [pendingOpen, setPendingOpen] = useState<{ kind: 'ticket' | 'chat'; id: string } | null>(null);
  const [chatOpen, setChatOpen] = useState<string | null>(null);
  function openFromNotification(n: Notification) {
    if (n.kind === 'low_stock') {
      setTab('inventory');
      return;
    }

    if (n.kind === 'queued') {
      // A new file to print → the queue, with that task open (049).
      setTab('queue');
      if (n.ref_id) setPendingOpen({ kind: 'ticket', id: n.ref_id });
      return;
    }
    if (n.kind === 'printer') {
      // A printing area's printer broken / fixed → the Print Queue, where its status shows.
      setTab('queue');
      return;
    }
    if (!n.ref_id) return;
    if (n.kind === 'assign' || n.kind === 'comment' || n.kind === 'printed' || n.kind === 'finished' || n.kind === 'problem') {
      // a work order id — an assignment, an @mention in comments, a printed job,
      // or a job an artist just finished (for an admin or reception to review)
      setPendingOpen({ kind: 'ticket', id: n.ref_id });
      setTab('orders');
    } else {
      setChatOpen(n.ref_id); // a conversation id — the app-wide floating chat opens it
    }
  }

  if (!isConfigured && !isDemo) return <Setup />;
  if (loading) return <div className="signin-page" />;
  if (!session) return <Login />;
  if (profile?.must_change_password || (recovering && profile)) return <ChangePassword />;
  if (!profile) {
    return (
      <div className="signin-page">
        <div className="signin-stack signin-stack--narrow"><div className="signin-card signin-card--single">
          <h1 className="signin-title">No profile yet</h1>
          <p className="signin-lede">
            Your sign-in worked, but there is no profile attached to it. Ask the admin to set your
            account up again.
          </p>
          <button className="signin-btn" onClick={signOut}>Sign out</button>
        </div></div>
      </div>
    );
  }

  if (stepUp === 'checking') return <div className="signin-page" />;
  if (stepUp === 'needed') {
    return <TwoFactorChallenge userId={profile.id} onVerified={() => setStepUp('ok')} onSignOut={signOut} />;
  }

  const tabs: { id: Tab; label: string; icon: ComponentType }[] = [
    { id: 'workload', label: 'All Statistics', icon: IconChart },
    { id: 'orders', label: 'Work Orders', icon: IconList },
    { id: 'queue', label: 'Print Queue', icon: IconMonitor },
    { id: 'inventory', label: 'Inventory', icon: IconInventory },
    ...(isAdminRole(profile.role)
      ? [{ id: 'accounts' as Tab, label: 'Admin Tools', icon: IconUsers }]
      : []),
  ];

  const initials = profile.full_name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="shell">
      {/* Persistent navigation keeps the production areas one tap away. */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BrandMark size={34} />
          <div>
            <div className="sidebar-brand-name">PrintFlow</div>
            <div className="sidebar-brand-org">Print production</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {tabs.map((t) => (
            <button
              key={t.id}
              aria-current={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              <t.icon />
              <span>{t.label}</span>
              {t.id === 'queue' && awaiting > 0 && (
                // PRD section 4: the operator is told immediately — from any screen.
                <span className="sidebar-badge" aria-label={`${awaiting} waiting to print`}>
                  {awaiting}
                </span>
              )}
            </button>
          ))}
          <button
            type="button"
            className="sidebar-chat-action"
            aria-label="Open chats"
            onClick={() => setChatRequest((request) => request + 1)}
          >
            <IconMessage />
            <span>Chat</span>
          </button>
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-credit"><MadeBy tone="dark" /></div>
        </div>
      </aside>

      <main className="content">
        <header className="workspace-bar">
          <div className="workspace-context" aria-label="Workspace area">
            <span className="sidebar-context-mark" aria-hidden="true" />
            <span>Production floor</span>
          </div>
          <div className="workspace-actions">
            <QuickSettings
              active={tab === 'settings'}
              onOpenSettings={() => setTab('settings')}
            />
            <NotifBell
              unread={notif.unread + updates.notices.filter((r) => r.unread).length}
              active={notifOpen}
              onClick={() => setNotifOpen((o) => !o)}
            />
            <UserMenu
              name={profile.full_name}
              role={ROLE_LABEL[profile.role]}
              initials={initials}
              status={staffStatusOf(meLive)}
              away={awayLabel(meLive)}
              onSetStatus={() => setStatusOpen(true)}
              onHelp={() => { setHelpView('home'); setTab('help'); }}
              onTrash={() => setTab('trash')}
              onSignOut={signOut}
            />
          </div>
        </header>
        <div className="app-sheet">
        <div className="app-tools-row">
          <WhatsNewNotice
            userId={profile.id}
            unseen={updates.unseen}
            onSeeAll={() => { setHelpView('updates'); setTab('help'); }}
          />
        </div>
        {schema.behind && (
          <div className={`schema-banner ${schema.blocking ? '' : 'soft'}`}>
            {schema.blocking ? (
              <>
                <strong>The database is behind the app.</strong> Creating and saving work orders
                will fail until it is updated — apply the pending database migrations{' '}
                (<code>node supabase/db.mjs push</code>).
                {isAdminRole(profile.role) ? '' : ' Ask the admin.'}
              </>
            ) : (
              <>
                <strong>A database update is available.</strong> The tracker works as is; running
                it turns on newer features — apply the pending database migrations{' '}
                (<code>node supabase/db.mjs push</code>) when convenient.
                {isAdminRole(profile.role) ? '' : ' Ask the admin.'}
              </>
            )}
            <span className="muted"> Pending: {schema.missing.join('; ')}.</span>
          </div>
        )}
        {tab === 'orders' && (
          <GlanceTable pendingOpen={pendingOpen} onConsumed={() => setPendingOpen(null)} />
        )}
        {tab === 'workload' && <Dashboard onOpenQueue={() => setTab('queue')} />}
        {tab === 'queue' && <QueueScreen pendingOpen={pendingOpen} onConsumed={() => setPendingOpen(null)} />}
        {tab === 'inventory' && <Inventory />}
        {tab === 'accounts' && <Accounts />}
        {tab === 'settings' && <Settings />}
        {tab === 'trash' && <TrashBin />}
        {tab === 'help' && <Help profiles={profiles} view={helpView} onView={setHelpView} onOpenChat={setChatOpen} />}
        </div>
      </main>

      <TeamChat
        profiles={profiles}
        openConversation={chatOpen}
        onOpened={() => setChatOpen(null)}
        openRequest={chatRequest}
      />

      <NotifOverlay
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        items={notif.items}
        unread={notif.unread + updates.notices.filter((r) => r.unread).length}
        markRead={notif.markRead}
        markAllRead={() => { notif.markAllRead(); markUpdatesSeen(profile.id); }}
        clearAll={() => { notif.clearAll(); markUpdatesSeen(profile.id); clearReleaseNotices(profile.id); }}
        releases={updates.notices}
        onOpenRelease={() => { markUpdatesSeen(profile.id); setHelpView('updates'); setTab('help'); }}
        toasts={toasts}
        onDismissToast={(id) => setToasts((l) => l.filter((t) => t.id !== id))}
        onOpen={openFromNotification}
        push={push}
      />

      {statusOpen && meLive && (
        <StatusPicker person={meLive} self onClose={() => setStatusOpen(false)} onSaved={reloadProfiles} />
      )}

      {/* A newer release is out than this page runs: ask (quietly) for a refresh. */}
      <UpdatePrompt />

      {/* Operators hear new print jobs from any screen: alarm ×2, then a voice.
          Anyone else can switch it on for this device in Settings (all areas). */}
      {(profile.role === 'operator' || alarmHere) && (
        <PrintAlarm
          jobs={awaitingJobs}
          me={profile.id}
          isOperator={profile.role === 'operator'}
          site={profile.role === 'operator' ? profile.site : null}
          onOpenQueue={() => setTab('queue')}
        />
      )}
    </div>
  );
}

export default function App() {
  const previewOnly = import.meta.env.DEV && new URLSearchParams(window.location.search).get('login') !== '1' && !isDemo;
  const devicePreview = new URLSearchParams(window.location.search).has('devicePreview');
  if (isDemo && !devicePreview) return <DemoPreview />;
  return <>{previewOnly ? <PreviewHome /> : <AuthenticatedApp />}</>;
}
