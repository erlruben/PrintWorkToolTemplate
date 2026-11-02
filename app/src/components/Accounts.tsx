import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useProfiles, useRecoveryEmails } from '../lib/data';
import { useSession } from '../lib/sessionContext';
import { startPan } from '../lib/pan';
import { loginNameOf, toLoginEmail } from '../lib/identity';
import { isAdminRole, ROLE_LABEL, SITE_LABEL, staffStatusOf, statusUntilLabel, type Profile, type Role, type Site } from '../lib/types';
import { StatusPicker, StatusTag } from './StaffStatus';
import { RecoveryEmailDialog } from './RecoveryEmail';
import { IconEye } from './Icons';

const ROLES: Role[] = ['admin', 'moderator', 'receptionist', 'operator', 'artist', 'developer', 'support'];

/** A readable temporary password the admin can say out loud. */
function tempPassword() {
  const words = ['tarp', 'vinyl', 'matte', 'gloss', 'print', 'panel', 'frame', 'inkjet'];
  const w = words[Math.floor(Math.random() * words.length)];
  return `${w}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/** How long until a deactivated account is removed (3 days after switch-off). */
function removalNote(deactivatedAt: string | null): string {
  if (!deactivatedAt) return '';
  const left = new Date(deactivatedAt).getTime() + 3 * 86_400_000 - Date.now();
  if (left <= 0) return 'removing soon';
  const days = Math.ceil(left / 86_400_000);
  return `removes in ${days} day${days === 1 ? '' : 's'}`;
}

/**
 * Admin-only. Self-signup is deliberately off: the tracker is on a public URL,
 * so accounts are handed out rather than claimed.
 */
export default function Accounts() {
  const { profile: me } = useSession();
  const { profiles, reload } = useProfiles();

  const [login, setLogin] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>('artist');
  const [password, setPassword] = useState(tempPassword());
  // Hidden by default so it can't be read over the admin's shoulder.
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; login: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Whose staff status is being set (admins can set anyone's).
  const [statusFor, setStatusFor] = useState<Profile | null>(null);
  // Other people's password-recovery emails: Support and the Tech Developer only, for now
  // (2026-10-11) — everyone sets their own in Settings. Whose is being edited.
  const manageRecovery = me?.role === 'support' || me?.role === 'developer';
  const recovery = useRecoveryEmails(manageRecovery);
  const [recoveryFor, setRecoveryFor] = useState<Profile | null>(null);

  async function copyPassword() {
    if (!created) return;
    const text = created.password;
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    try {
      await navigator.clipboard.writeText(text);
      done();
      return;
    } catch {
      // Fall back for older phones / insecure contexts where the async API is blocked.
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch {
      // Clipboard fully blocked — the password is still on screen to read.
    }
  }

  async function callAdmin(payload: Record<string, string>) {
    const { data, error } = await supabase.functions.invoke('admin-users', { body: payload });

    // A non-2xx reply leaves data null, so the useful message is on the
    // error's response body rather than error.message.
    if (error) {
      let detail = error.message;
      let status: number | undefined;

      const ctx = (error as { context?: Response }).context;
      if (ctx) {
        status = ctx.status;
        if (typeof ctx.json === 'function') {
          try {
            const body = await ctx.json();
            if (body?.error) detail = body.error;
          } catch {
            // Non-JSON body — fall back to the generic message.
          }
        }
      }

      // The Edge Function is an optional deploy step, so a missing one is the
      // most likely failure here. Say what to do about it rather than leaving
      // a bare "Failed to send a request" on screen.
      if (status === 404 || /not found|failed to send|fetch/i.test(detail)) {
        throw new Error(
          'The admin-users function is not deployed yet, so accounts cannot be created ' +
          'from here. Either deploy it (see SETUP.md step 5), or add people in the ' +
          'Supabase dashboard under Authentication -> Users and set their role in the ' +
          'table below.',
        );
      }

      throw new Error(detail);
    }

    if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    return data;
  }

  async function addPerson(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);

    try {
      // A username becomes a hidden internal email; a real email passes through.
      const loginEmail = toLoginEmail(login);
      await callAdmin({
        action: 'create',
        email: loginEmail,
        full_name: fullName.trim(),
        role,
        password,
      });

      setCreated({ name: fullName.trim(), login: loginNameOf(loginEmail), password });
      setCopied(false);
      setLogin('');
      setFullName('');
      setPassword(tempPassword());
      setShowPw(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  }

  async function changeRole(id: string, next: Role) {
    setError(null);
    // Only operators belong to a printing area; clear it if they move off the role.
    const patch: { role: Role; site?: null } = { role: next };
    if (next !== 'operator') patch.site = null;
    const { error } = await supabase.from('profiles').update(patch).eq('id', id);
    if (error) setError(error.message);
    else await reload();
  }

  /** Operators are assigned to a printing area when the shop uses more than one. */
  async function changeSite(id: string, next: Site | '') {
    setError(null);
    const { error } = await supabase
      .from('profiles').update({ site: next || null }).eq('id', id);
    if (error) setError(error.message);
    else await reload();
  }

  async function resetPassword(id: string, name: string) {
    const pw = tempPassword();
    setError(null);
    try {
      await callAdmin({ action: 'reset_password', user_id: id, password: pw });
      setCreated({ name, login: '', password: pw });
      setCopied(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function setActive(id: string, name: string, active: boolean) {
    const msg = active
      ? `Let ${name} sign in again?`
      : `Deactivate ${name}? They can no longer sign in. Their name stays on past work orders, ` +
        'but if left deactivated for 3 days the account is removed automatically. Reactivate ' +
        'before then to keep it.';
    if (!confirm(msg)) return;

    setError(null);
    try {
      await callAdmin({ action: 'set_active', user_id: id, active: String(active) });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!isAdminRole(me?.role)) {
    return (
      <div className="wrap">
        <div className="card empty">Only the admin can manage accounts.</div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Admin Tools</h1>
          <p className="sub">Who can sign in, and what each person is allowed to do.</p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card" style={{ padding: 18, marginBottom: 18 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Add someone</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          People cannot sign themselves up. You create the account and hand over the temporary
          password. Staff without an email sign in with a simple <strong>username</strong>; owners
          can use an email.
        </p>

        <form onSubmit={addPerson}>
          <div className="grid2">
            <label className="field">
              <span>Full name</span>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Jamie Chen"
                required
              />
            </label>

            <label className="field">
              <span>Username or email</span>
              <input
                type="text"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="e.g. jamie  ·  or an email"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            </label>
          </div>

          <div className="grid2">
            <label className="field">
              <span>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Temporary password</span>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <div className="pw-wrap">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    spellCheck={false}
                    required
                  />
                  <button
                    type="button"
                    className="pw-eye"
                    onClick={() => setShowPw((s) => !s)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    aria-pressed={showPw}
                    title={showPw ? 'Hide password' : 'Show password'}
                  >
                    <IconEye off={showPw} />
                  </button>
                </div>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => setPassword(tempPassword())}
                >
                  New
                </button>
              </div>
            </label>
          </div>

          <button className="btn" disabled={busy}>{busy ? 'Adding…' : 'Add account'}</button>
        </form>
      </div>

      {created && (
        <div className="notice">
          <strong>{created.name}</strong> can now sign in{created.login ? (
            <>
              {' '}with the {created.login.includes('@') ? 'email' : 'username'}{' '}
              <strong style={{ fontFamily: 'monospace' }}>{created.login}</strong> and the
            </>
          ) : ' with the'} temporary password{' '}
          <strong style={{ fontFamily: 'monospace' }}>{created.password}</strong>. Pass it on
          directly — they will be asked to choose their own password on first sign-in.
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={copyPassword}>{copied ? 'Copied ✓' : 'Copy password'}</button>
            <button className="btn ghost sm" onClick={() => setCreated(null)}>Got it</button>
          </div>
        </div>
      )}

      <div className="card table-scroll" onMouseDown={startPan}>
        <table className="glance">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Printing area</th>
              <th>Status</th>
              <th>Account</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} style={{ cursor: 'default' }}>
                <td>
                  <strong>{p.full_name}</strong>
                  {p.id === me.id && <span className="muted"> (you)</span>}
                  {p.username && <div className="muted" style={{ fontSize: 12 }}>@{p.username}</div>}
                  {manageRecovery && recovery.available && p.active && (
                    <div className="acct-recovery">
                      {recovery.byId[p.id]
                        ? <span className="muted" title="Password recovery email">{recovery.byId[p.id]}</span>
                        : p.username   // a username account has no inbox of its own
                          ? <span className="acct-recovery-missing">No recovery email</span>
                          : <span className="muted">Resets go to sign-in email</span>}
                      <button className="linkbtn" onClick={() => setRecoveryFor(p)}>
                        {recovery.byId[p.id] ? 'Edit' : 'Add'}
                      </button>
                    </div>
                  )}
                </td>
                <td>
                  <select
                    className="select-plain"
                    value={p.role}
                    disabled={p.id === me.id}
                    onChange={(e) => changeRole(p.id, e.target.value as Role)}
                    style={{ width: 'auto' }}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                </td>
                <td>
                  {p.role === 'operator' ? (
                    <select
                      className="select-plain"
                      value={p.site ?? ''}
                      onChange={(e) => changeSite(p.id, e.target.value as Site | '')}
                      style={{ width: 'auto' }}
                    >
                      <option value="">Not set</option>
                      <option value="office">{SITE_LABEL.office}</option>
                      <option value="production">{SITE_LABEL.production}</option>
                    </select>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {p.active ? (
                    <span className="acct-status">
                      {staffStatusOf(p) === 'working'
                        ? <span className="muted">Working</span>
                        : <><StatusTag profile={p} />{statusUntilLabel(p.status_until) && <span className="muted" style={{ fontSize: 12 }}>{statusUntilLabel(p.status_until)}</span>}</>}
                      <button className="linkbtn" onClick={() => setStatusFor(p)}>Change</button>
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {!p.active ? (
                    <span className="muted">
                      Deactivated{removalNote(p.deactivated_at) ? ` · ${removalNote(p.deactivated_at)}` : ''}
                    </span>
                  ) : p.must_change_password ? (
                    <span className="muted">Temporary password</span>
                  ) : (
                    <span className="muted">Active</span>
                  )}
                </td>
                <td>
                  <div className="acct-actions">
                    <button className="linkbtn" onClick={() => resetPassword(p.id, p.full_name)}>
                      Reset password
                    </button>
                    {p.id !== me.id && (
                      <button
                        className={`linkbtn ${p.active ? 'danger' : ''}`}
                        onClick={() => setActive(p.id, p.full_name, !p.active)}
                      >
                        {p.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {recoveryFor && (
        <RecoveryEmailDialog person={recoveryFor} current={recovery.byId[recoveryFor.id] ?? null}
          onClose={() => setRecoveryFor(null)} onSaved={recovery.reload} />
      )}
      {statusFor && (
        <StatusPicker person={statusFor} self={statusFor.id === me.id} onClose={() => setStatusFor(null)} onSaved={reload} />
      )}

      <p className="muted" style={{ fontSize: 12 }}>
        Roles decide what each person can do: printer operators (and reception) run the print queue and tick a job as printed;
        the receptionist and admin can open a work order for anyone, and an artist can open one for
        themselves. Deactivating someone blocks
        their sign-in and keeps their name on past work orders — but an account left deactivated
        for 3 days is removed automatically. Reactivate before then to keep it.
      </p>
    </div>
  );
}
