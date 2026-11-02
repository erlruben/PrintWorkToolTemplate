import { useEffect, useRef, useState } from 'react';
import { purgeOrder, restoreOrder, useSettings, useWorkOrders } from '../lib/data';
import { useSession } from '../lib/sessionContext';
import { startPan } from '../lib/pan';
import { deleteJobFolder, driveFolderId } from '../lib/drive';
import { fmtDate, isAdminRole, type WorkOrder } from '../lib/types';
import { jobTitle } from '../lib/items';

const TRASH_DAYS = 30;
const DAY = 86400000;

/**
 * The Trash Bin (opened from the profile menu; everyone since migration 046 —
 * deleting for good stays admin-only). Deleting a work order
 * moves it here rather than erasing it; from here it can be restored, or deleted
 * for good — which also sends its Drive folder to the Trash. Anything left past
 * 30 days is purged automatically when an admin opens this screen (the folder can
 * only be cleared from a signed-in browser, so it can't be a server cron).
 */
export default function TrashBin() {
  const { profile } = useSession();
  const { trashed } = useWorkOrders();
  const { settings } = useSettings();
  const purging = useRef(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function restore(o: WorkOrder) {
    setBusyId(o.id);
    setError(null);
    // The row still holds its (unique) wo_number, so clearing deleted_at can't
    // clash — restore always succeeds unless the network itself fails.
    const { error: err } = await restoreOrder(o.id);
    if (err) setError(`Could not restore ${o.wo_number}: ${err.message}`);
    setBusyId(null);
  }

  async function purge(o: WorkOrder) {
    // Best-effort: clear the Drive folder first, then remove the row. A Drive
    // hiccup must not block the purge — the folder can be tidied by hand.
    const clientId = settings.google_client_id?.trim();
    const rootFolderId = driveFolderId(settings.drive_folder_url);
    if (clientId && rootFolderId) {
      try {
        await deleteJobFolder({ clientId, rootFolderId, woNumber: o.wo_number, month: o.date_given.slice(0, 7) });
      } catch { /* leave the folder for manual cleanup */ }
    }
    const { error: err } = await purgeOrder(o.id);
    if (err) setError(`Could not delete ${o.wo_number}: ${err.message}`);
  }

  const isAdmin = isAdminRole(profile?.role);
  // Auto-remove anything older than 30 days — folder and row together (admin).
  useEffect(() => {
    if (!isAdmin || purging.current) return;
    const stale = trashed.filter(
      (o) => o.deleted_at && Date.now() - new Date(o.deleted_at).getTime() > TRASH_DAYS * DAY,
    );
    if (stale.length === 0) return;
    purging.current = true;
    (async () => {
      for (const o of stale) await purge(o);
      purging.current = false;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trashed]);

  const daysLeft = (o: WorkOrder) =>
    Math.max(0, TRASH_DAYS - Math.floor((Date.now() - new Date(o.deleted_at!).getTime()) / DAY));

  async function askPurge(o: WorkOrder) {
    if (
      !confirm(
        `Permanently delete ${o.wo_number}?\n\n` +
        'This removes all of its info — chat, printing record — and its Drive folder. This cannot be undone.',
      )
    ) return;
    setBusyId(o.id);
    setError(null);
    await purge(o);
    setBusyId(null);
  }

  return (
    <div className="wrap">
      <div className="page-head head-center">
        <h1>Trash Bin</h1>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        Deleted work orders stay here for {TRASH_DAYS} days, then delete automatically — including their
        Drive folder. Restore one to put it back{isAdmin ? ', or delete it for good now' : ''}.
      </p>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      {trashed.length === 0 ? (
        <div className="card empty">The Trash is empty.</div>
      ) : (
        <div className="card table-scroll" onMouseDown={startPan}>
          <table className="glance">
            <thead>
              <tr>
                <th>WO #</th>
                <th>Job</th>
                <th>Deleted</th>
                <th>Auto-deletes</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {trashed.map((o) => (
                <tr key={o.id} style={{ cursor: 'default' }}>
                  <td><strong>{o.wo_number}</strong></td>
                  <td className="desc" title={jobTitle(o)}>{jobTitle(o) || '—'}</td>
                  <td>{fmtDate(o.deleted_at!)}</td>
                  <td style={{ color: daysLeft(o) <= 3 ? 'var(--vim-red)' : undefined }}>
                    in {daysLeft(o)} day{daysLeft(o) === 1 ? '' : 's'}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn ghost sm" onClick={() => restore(o)} disabled={busyId === o.id}>
                      {busyId === o.id ? 'Working…' : 'Restore'}
                    </button>
                    {isAdmin && (
                      <button
                        className="btn danger sm"
                        style={{ marginLeft: 8 }}
                        onClick={() => askPurge(o)}
                        disabled={busyId === o.id}
                      >
                        Delete permanently
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
