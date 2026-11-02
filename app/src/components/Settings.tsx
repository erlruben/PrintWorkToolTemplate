import { useEffect, useState, type FormEvent } from 'react';
import { saveSetting, useSettings } from '../lib/data';
import { useSession } from '../lib/sessionContext';
import { isAdminRole } from '../lib/types';
import { parseLink } from '../lib/links';
import { connectDriveAccount } from '../lib/drive';
import { useTheme } from '../lib/theme';
import { PRINT_ANNOUNCEMENT, playTestSound, useAlarmBeep, usePrintAlarmHere, useSound } from '../lib/sound';
import TwoFactorSetup from './TwoFactorSetup';
import { RecoveryEmailCard } from './RecoveryEmail';

/**
 * Admin-only. The shared Google Drive folder lives here rather than in the
 * build, so moving from a personal Google account to the company one is an
 * edit on this screen — no redeploy, and every ticket picks it up at once.
 */
export default function Settings() {
  const { profile } = useSession();
  const { settings, loading } = useSettings();
  const { theme, choice, setChoice } = useTheme();
  const { on: soundOn, volume, toggle: toggleSound, setVolume } = useSound();
  const [alarmHere, setAlarmHere] = usePrintAlarmHere();
  const [beepOn, setBeepOn] = useAlarmBeep();
  const isAdmin = isAdminRole(profile?.role);

  const [twoFactor, setTwoFactor] = useState(false);
  const [folder, setFolder] = useState('');
  const [account, setAccount] = useState('');
  const [connectBusy, setConnectBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The API keys (Google client ID / API key / VAPID) are NOT edited here — they
  // are set in the database (or dashboard) so they never live in the app UI. The
  // app still reads them from `settings`; this screen only reports whether each
  // is configured. Only the Drive folder link (not a credential) stays editable.
  useEffect(() => {
    if (loading) return;
    setFolder(settings.drive_folder_url ?? '');
    setAccount(settings.drive_account_email ?? '');
  }, [loading, settings]);

  async function connectAccount() {
    const cid = (settings.google_client_id ?? '').trim();
    if (!cid) { setError('Set the Google client ID in the database first.'); return; }
    setError(null);
    setConnectBusy(true);
    try {
      const email = await connectDriveAccount(cid);
      const { error: saveErr } = await saveSetting('drive_account_email', email);
      if (saveErr) throw new Error(saveErr.message);
      setAccount(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect the Google account.');
    }
    setConnectBusy(false);
  }

  async function disconnectAccount() {
    setError(null);
    setConnectBusy(true);
    const { error: saveErr } = await saveSetting('drive_account_email', null);
    if (saveErr) setError(saveErr.message);
    else setAccount('');
    setConnectBusy(false);
  }

  const parsed = parseLink(folder);
  const looksWrong = folder.trim() !== '' && parsed?.kind !== 'drive-folder';

  async function saveFolder(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const { error: err } = await saveSetting('drive_folder_url', folder.trim() || null);
    if (err) setError(err.message);
    else setSaved(true);
    setBusy(false);
  }

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="sub">Your appearance, notifications and sign-in security{isAdmin ? ', plus the shared Drive setup' : ''}.</p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card" style={{ padding: 18, maxWidth: 720 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Appearance</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Choose a light or dark look, or follow this device's own setting. This is remembered on
          this device. You can also change it from the Settings gear beside the update notice.
        </p>
        <div className="seg" role="radiogroup" aria-label="Appearance">
          {(['light', 'dark', 'system'] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={choice === c}
              className={choice === c ? 'on' : ''}
              onClick={() => setChoice(c)}
            >
              {c === 'light' ? 'Light' : c === 'dark' ? 'Dark' : 'System'}
            </button>
          ))}
        </div>
        {choice === 'system' && (
          <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
            Following this device — {theme} right now.
          </p>
        )}
      </div>

      <div className="card" style={{ padding: 18, marginTop: 16, maxWidth: 720 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Two-factor authentication</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Add a one-time code from an authenticator app on top of your password, so a stolen
          password alone can't sign in. You'll set it up once and trust this device for 30 days.
        </p>
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => setTwoFactor(true)}>
            Set up two-factor
          </button>
        </div>
      </div>

      {/* Admins manage everyone's (themselves included); others just see their own. */}
      {/* Everyone sets their own. Other people's are managed in Accounts, by Support and the Tech Developer. */}
      <RecoveryEmailCard />

      <div className="card" style={{ padding: 18, marginTop: 16, maxWidth: 720 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Notifications</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          The bell chime, the print-queue arrival tone and the chat ping. Mute them to work in
          silence — remembered on this device.
        </p>
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <button type="button" className="btn ghost" onClick={toggleSound}>
            {soundOn ? 'Mute notification sounds' : 'Unmute notification sounds'}
          </button>
          <span className="muted" style={{ fontSize: 13 }}>
            Sounds are {soundOn ? 'on' : 'muted'}.
          </span>
        </div>

        <div className="row" style={{ alignItems: 'center', gap: 12, marginTop: 12 }}>
          <span className="muted" style={{ fontSize: 13, minWidth: 52 }}>Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(volume * 100)}
            onChange={(e) => setVolume(Number(e.target.value) / 100)}
            onMouseUp={playTestSound}
            onTouchEnd={playTestSound}
            disabled={!soundOn}
            style={{ flex: 1, maxWidth: 240 }}
            aria-label="Notification volume"
          />
          <span className="muted" style={{ fontSize: 13, minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(volume * 100)}%
          </span>
          <button type="button" className="btn ghost sm" onClick={playTestSound} disabled={!soundOn}>
            Test
          </button>
        </div>

        {(profile?.role === 'operator' || isAdmin || alarmHere) && (
          <div className="row" style={{ alignItems: 'center', gap: 10, marginTop: 12 }}>
            <button type="button" className="btn ghost sm" onClick={() => setBeepOn(!beepOn)}>
              {beepOn ? 'Turn off the alarm beeps' : 'Turn the alarm beeps back on'}
            </button>
            <span className="muted" style={{ fontSize: 13 }}>
              When a file arrives: {beepOn ? 'the alarm twice, then' : 'voice only —'} “{PRINT_ANNOUNCEMENT}”,
              repeating every 20 seconds until someone taps the screen.
            </span>
          </div>
        )}

        {profile && profile.role !== 'operator' && (
          <div className="row" style={{ alignItems: 'center', gap: 10, marginTop: 12 }}>
            <button type="button" className="btn ghost sm" onClick={() => setAlarmHere(!alarmHere)}>
              {alarmHere ? 'Turn off the print alarm here' : 'Ring the print alarm on this device'}
            </button>
            <span className="muted" style={{ fontSize: 13 }}>
              {alarmHere
                ? 'On — this device rings whenever a file is sent to print (any printing area).'
                : 'Operators always hear it. Turn it on for a PC at the printing area, or to try it out.'}
            </span>
          </div>
        )}

        {isAdmin && (
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 14 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>Push notifications</h3>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              When configured, everyone can turn push on from the bell — assignments, @mentions and queue
              arrivals reach them even when the app is closed.
            </p>
            <div className="cfg-row">
              <span className={`cfg-dot ${settings.vapid_public_key ? 'on' : ''}`} />
              {settings.vapid_public_key ? 'Configured' : <span className="muted">Not set up</span>}
            </div>
          </div>
        )}
      </div>

      {isAdmin && (
      <>
      <div className="card" style={{ padding: 18, marginTop: 16, maxWidth: 720 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Shared Google Drive folder</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Where print-ready files go. Every ticket links straight to it, so nobody has to hunt
          for the right folder.
        </p>

        <form onSubmit={saveFolder}>
          <label className="field">
            <span>Folder link</span>
            <input
              type="url"
              value={folder}
              onChange={(e) => { setFolder(e.target.value); setSaved(false); }}
              placeholder="https://drive.google.com/drive/folders/…"
            />
          </label>

          {looksWrong && (
            <div className="notice" style={{ marginTop: -4 }}>
              That does not look like a Drive <strong>folder</strong> link. Open the folder in
              Drive and copy the address bar — a file link will not work here.
            </div>
          )}

          <div className="row">
            <button className="btn" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="muted" style={{ fontSize: 13 }}>Saved.</span>}
            {folder.trim() && (
              <a className="btn ghost sm" href={folder} target="_blank" rel="noreferrer">
                Open it →
              </a>
            )}
          </div>
        </form>
      </div>

      <div className="card" style={{ padding: 18, marginTop: 16, maxWidth: 720 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Upload to Drive</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          With a Google client ID configured, tickets file uploads into each job's own Drive folder.
          Add a Google API key too and the ticket gets an <strong>Attach from Drive</strong> button.
          Both come from the same Google Cloud project; without them, everyone just pastes a link.
        </p>
        <div className="cfg-row">
          <span className={`cfg-dot ${settings.google_client_id ? 'on' : ''}`} />
          Google client ID {settings.google_client_id ? 'connected' : <span className="muted">not set</span>}
        </div>
        <div className="cfg-row">
          <span className={`cfg-dot ${settings.google_api_key ? 'on' : ''}`} />
          Google API key {settings.google_api_key ? 'connected' : <span className="muted">not set</span>}
        </div>

        <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 14 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>Company Google account</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            One-time: sign in once with the company Google account and the app remembers it for
            <strong> everyone</strong> — every device then goes straight to that account, no picker.
          </p>
          <div className="row" style={{ alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="btn ghost"
              onClick={connectAccount}
              disabled={connectBusy || !settings.google_client_id}
            >
              {connectBusy ? 'Connecting…' : account ? 'Reconnect' : 'Connect Google account'}
            </button>
            {account && (
              <button
                type="button"
                className="btn ghost"
                onClick={disconnectAccount}
                disabled={connectBusy}
              >
                Disconnect
              </button>
            )}
            {account ? (
              <span className="muted" style={{ fontSize: 13 }}>
                Connected as <strong>{account}</strong>.
              </span>
            ) : (
              <span className="muted" style={{ fontSize: 13 }}>Not connected yet.</span>
            )}
          </div>
        </div>
      </div>
      </>
      )}

      <div className="settings-legal">
        <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>
        <span aria-hidden>·</span>
        <a href="/terms.html" target="_blank" rel="noreferrer">Terms of Service</a>
      </div>

      {twoFactor && <TwoFactorSetup onClose={() => setTwoFactor(false)} />}
    </div>
  );
}
