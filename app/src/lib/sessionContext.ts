import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isAdminRole, isReceptionRole, type Profile, type Status, type WorkOrder } from './types';

export interface SessionValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Signed in from a "forgot password" email link: choose a new password first. */
  recovering?: boolean;
  endRecovery?: () => void;
}

export const SessionContext = createContext<SessionValue>({
  session: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
  signOut: async () => {},
});

export const useSession = () => useContext(SessionContext);

/** Who runs the print queue: operators, reception (since 2026-10-09) and admins. */
export const canMarkPrinted = (p: Profile | null) =>
  p?.role === 'operator' || isReceptionRole(p?.role) || isAdminRole(p?.role);

// Reception/admin open jobs for anyone; an artist can also open their own task
// (it starts in To Do and they move it through To Do / In progress themselves).
export const canCreateOrders = (p: Profile | null) =>
  isReceptionRole(p?.role) || isAdminRole(p?.role) || p?.role === 'artist';

/** Admin, Moderator, or reception — the reviewers. */
export const isReviewerRole = (p: Profile | null) => isReceptionRole(p?.role) || isAdminRole(p?.role);

/** A job at or past "Finished" is the client's finalized record. */
export const isFinalized = (status: Status) =>
  status === 'finished' || status === 'awaiting_print' || status === 'printed';

/** An operator has taken the job, set it going, or printed it. */
export const printingStarted = (o: Pick<WorkOrder, 'operator_id' | 'print_state' | 'printed_at'>) =>
  !!o.operator_id || !!o.print_state || !!o.printed_at;

/**
 * Content and stage edits: an admin any time; a receptionist while the job is
 * still To Do / In progress; the assigned artist until printing has started
 * (an operator has taken it) — migration 046.
 */
export const canEditOrder = (
  p: Profile | null,
  order: Pick<WorkOrder, 'artist_id' | 'status' | 'operator_id' | 'print_state' | 'printed_at'> | null,
) =>
  !!p && !!order &&
  (isAdminRole(p.role) ||
    (isReceptionRole(p.role) && !isFinalized(order.status)) ||
    (p.id === order.artist_id && !printingStarted(order)));
