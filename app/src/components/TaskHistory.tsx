import { useOrderHistory } from '../lib/data';
import { fromRecords, historyLine } from '../lib/credits';

const when = (iso: string, dayOnly: boolean) =>
  new Date(iso).toLocaleString('en-PH', dayOnly
    ? { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }
    : { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * A task's history (2026-10-14): one line each time something happened to it —
 * who made it, who did the art, who printed it, every send back and reprint —
 * oldest first. The database writes the lines itself; nobody can edit them.
 * `stamp` changes whenever the task is saved, so new lines show at once.
 */
export default function TaskHistory({ orderId, stamp }: { orderId: string; stamp: string }) {
  const { events, available } = useOrderHistory(orderId, stamp);
  if (!available || !events.length) return null;
  return (
    <details className="links-list task-history">
      <summary>History ({events.length})</summary>
      <ol>
        {events.map((e) => (
          <li key={e.id} className={`history-${e.kind}`}>
            <span className="history-when">{when(e.at, fromRecords(e) && e.kind !== 'printed' && e.kind !== 'released')}</span>
            <span className="history-what">{historyLine(e)}</span>
          </li>
        ))}
      </ol>
      {events.some(fromRecords) && (
        <p className="history-foot">Lines before October 14, 2026 were rebuilt from the task's records.</p>
      )}
    </details>
  );
}
