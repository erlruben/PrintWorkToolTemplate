/**
 * Drag a task onto another status group on the board (049) — admin and
 * reception. What each drop changes, using the same fields as the buttons, so
 * the database rules still decide. A move that is not allowed returns null and
 * that group is not offered as a drop target.
 */
import { afterPrint, isAdminRole, isReceptionRole, type Profile, type WorkOrder } from './types';

export type GroupKey = 'todo' | 'in_progress' | 'finished' | 'awaiting_print' | 'to_review' | 'for_release' | 'released';

export interface Move {
  patch: Record<string, unknown>;
  /** Ask before doing it (a reprint, or taking a job off the press). */
  confirm?: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();

/** The group a task sits in now. */
export function groupOf(o: WorkOrder): GroupKey {
  const a = afterPrint(o);
  if (a === 'done') return 'to_review';
  if (a === 'ready') return 'for_release';
  if (a === 'released') return 'released';
  return o.status as GroupKey;
}

export function moveTo(o: WorkOrder, target: GroupKey, me: Profile | null): Move | null {
  if (!me || o.archived_at || o.deleted_at) return null;
  const admin = isAdminRole(me.role);
  if (!admin && !isReceptionRole(me.role)) return null;
  const from = groupOf(o);
  if (from === target) return null;
  const onPress = !!(o.operator_id || o.print_state);
  const offPress = onPress ? `${o.wo_number} is on the press. Take it out of the print queue?` : undefined;

  // Before printing: To Do · In progress · File Attached for Review · Waiting to Print.
  if (from === 'todo' || from === 'in_progress' || from === 'finished' || from === 'awaiting_print') {
    switch (target) {
      case 'todo': return { patch: { stage: 'todo', date_finished: null }, confirm: offPress };
      case 'in_progress': return { patch: { stage: 'in_progress', date_finished: null }, confirm: offPress };
      case 'finished':
        return from === 'awaiting_print'
          ? { patch: { queued_at: null }, confirm: offPress }
          : { patch: { stage: 'in_progress', date_finished: o.date_finished ?? (o.date_given > today() ? o.date_given : today()) } };
      case 'awaiting_print':
        return { patch: { stage: 'in_progress', date_finished: o.date_finished ?? (o.date_given > today() ? o.date_given : today()), queued_at: now() } };
      case 'to_review':
        // Reception and admins run the print queue too, so they may mark it printed.
        return from === 'awaiting_print' ? { patch: { printed_at: now(), print_state: null, print_eta: null } } : null;
      default: return null;
    }
  }

  // After printing: Done Printing · For Release · Released to Client.
  const ret: Move = {
    patch: {
      printed_at: null, printed_qty: 0, print_state: null, print_eta: null,
      ready_for_pickup_at: null, released_at: null, reprint_count: (o.reprint_count ?? 0) + 1,
    },
    confirm: `Return ${o.wo_number} to the print queue for a reprint?`,
  };
  switch (target) {
    case 'awaiting_print': return ret;
    case 'to_review': return { patch: { ready_for_pickup_at: null, released_at: null, released_by: null } };
    case 'for_release': return { patch: { ready_for_pickup_at: o.ready_for_pickup_at ?? now(), released_at: null, released_by: null } };
    case 'released': return { patch: { ready_for_pickup_at: o.ready_for_pickup_at ?? now(), released_at: now(), released_by: me.id } };
    default: return null;
  }
}
