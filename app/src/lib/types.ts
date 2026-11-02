export type Role = 'admin' | 'moderator' | 'receptionist' | 'artist' | 'operator' | 'developer' | 'support' | 'supply_clerk';
/** Admin, Tech Developer and Support — full access. */
export const isAdminRole = (role: Role | null | undefined) =>
  role === 'admin' || role === 'developer' || role === 'support';
/** Moderators have the combined day-to-day workflow access of reception, operators and artists. */
export const isModeratorRole = (role: Role | null | undefined) => role === 'moderator';
export const isReceptionRole = (role: Role | null | undefined) =>
  role === 'receptionist' || isModeratorRole(role);
export type Status = 'todo' | 'in_progress' | 'finished' | 'awaiting_print' | 'printed';

/** The operator's live progress on a job waiting to print. Null = just waiting. */
export type PrintState = 'preparing' | 'printing' | 'paused';
/** What went wrong at the press (migration 048). */
export type PrintProblem = 'wrong_item' | 'broken_print' | 'printer_down' | 'other';
export const PROBLEM_LABEL: Record<PrintProblem, string> = {
  wrong_item: 'Wrong item to print',
  broken_print: 'Broken print',
  printer_down: 'Broken printer',
  other: 'Other problem',
};
export const PRINT_STATE_LABEL: Record<PrintState, string> = {
  preparing: 'Preparing',
  printing: 'Printing',
  paused: 'On pause',
};
/** The two stages the team sets by hand; the rest of the status is computed. */
export type Stage = 'todo' | 'in_progress';
export type Urgency = 'low' | 'mid' | 'high' | 'urgent';

export const URGENCY_LABEL: Record<Urgency, string> = {
  low: 'Low', mid: 'Mid', high: 'High', urgent: 'Urgent',
};
/** Urgent first, so a descending sort surfaces the most pressing. */
export const URGENCY_RANK: Record<Urgency, number> = {
  urgent: 3, high: 2, mid: 1, low: 0,
};
export const URGENCY_OPTIONS: Urgency[] = ['low', 'mid', 'high', 'urgent'];
/** PRD section 8: operators are split across two printing areas. */
export type Site = 'office' | 'production';

/** A printing area's printer (2026-10-27): Working, Cooling down until a time, or Broken. */
export type PrinterState = 'working' | 'cooldown' | 'broken';
export interface PrinterStatus {
  site: Site;
  state: PrinterState;
  note: string | null;
  /** When a cool-down ends. */
  until: string | null;
  changed_at: string;
  changed_by: string | null;
  changed_by_name: string | null;
}
/** The state right now: a cool-down whose time is up is Working again. */
export const printerStateAt = (p: Pick<PrinterStatus, 'state' | 'until'> | null | undefined, now: number): PrinterState =>
  !p ? 'working' : p.state === 'cooldown' && (!p.until || new Date(p.until).getTime() <= now) ? 'working' : p.state;
/** Who may change a printer's status (the database checks the same). */
export const canSetPrinter = (role: Role | null | undefined) =>
  role === 'operator' || isReceptionRole(role) || isAdminRole(role);

export const SITE_LABEL: Record<Site, string> = {
  office: 'Office',
  production: 'Production',
};

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  active: boolean;
  must_change_password: boolean;
  site: Site | null;
  created_at: string;
  deactivated_at: string | null;   // when set, the account is purged 3 days later
  username: string | null;         // staff sign-in name; null for email accounts
  // Staff status (20261008120000_staff_status); absent until that migration runs.
  status?: StaffStatus;
  status_note?: string | null;
  status_until?: string | null;    // the status clears itself after this time
}

/** Slack-style staff status. Working is the default ("no status"). */
export type StaffStatus = 'working' | 'out_of_office' | 'sick';
export const STAFF_STATUS_LABEL: Record<StaffStatus, string> = {
  working: 'Working',
  out_of_office: 'Out of office',
  sick: 'Sick',
};
export const STAFF_STATUSES: StaffStatus[] = ['working', 'out_of_office', 'sick'];

/** Someone's status right now: a status whose time has passed counts as Working. */
export function staffStatusOf(
  p: Pick<Profile, 'status' | 'status_until'> | null | undefined,
  now = Date.now(),
): StaffStatus {
  const s = p?.status ?? 'working';
  if (s === 'working') return s;
  return p?.status_until && Date.parse(p.status_until) <= now ? 'working' : s;
}

/** When a status ends, for a label: "until today", "until Mon, Oct 12". */
export function statusUntilLabel(until: string | null | undefined, now = new Date()): string | null {
  if (!until) return null;
  const d = new Date(until);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, now)) return 'until today';
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (sameDay(d, tomorrow)) return 'until tomorrow';
  return `until ${d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}`;
}

/** A name for a pick list, including an away status when one is set. */
/** The operators who can be picked to print at a printing area: all of them
 *  for Either, otherwise that area's (an operator with no area fits both). */
export const operatorsForSite = (operators: Profile[], site: Site | '' | null) =>
  operators.filter((p) => !site || !p.site || p.site === site);

export function nameWithStatus(p: Pick<Profile, 'full_name' | 'status' | 'status_until'>): string {
  const s = staffStatusOf(p);
  return s === 'working' ? p.full_name : `${p.full_name} (${STAFF_STATUS_LABEL[s]})`;
}

/**
 * The away line for someone who is not Working — "Sick · until tomorrow ·
 * Fever" — or null when they are working (nothing to show).
 */
export function awayLabel(p: Pick<Profile, 'status' | 'status_note' | 'status_until'> | null | undefined): string | null {
  const s = staffStatusOf(p);
  if (s === 'working') return null;
  return [STAFF_STATUS_LABEL[s], statusUntilLabel(p?.status_until), p?.status_note?.trim() || null]
    .filter(Boolean).join(' · ');
}

/** One file attached to a job — a web link (usually Drive) and its file name. */
export interface Attachment {
  url: string;
  name?: string | null;
  /** The folder it was uploaded in ("400 x 304 with sintra") — 2026-10-14. Unset = a loose file. */
  folder?: string | null;
}

/** One line of a job: what it is and how many (migration 046). */
export interface Item {
  name: string;
  qty: number | null;
  install?: boolean | null;   // with installation (049); unset = without
  /** Values for the task's own extra columns, by column key (2026-10-10). */
  extra?: Record<string, string> | null;
  /** How many of it fit on one printed sheet (2026-10-27: "1 page has 12 icons").
   *  Unset or 1 = one per sheet. The Print Queue counts sheets: see sheetsOf. */
  per_sheet?: number | null;
}

/** An extra column on a task's Items table — added and named by the team. */
export interface ItemColumn {
  key: string;
  label: string;
}

export interface WorkOrder {
  id: string;
  wo_number: string;
  job_order_number: string | null;   // official number in the customer records; null = not yet recorded
  client_name?: string | null;       // the customer the job is for — migration 038
  client_phone?: string | null;      // customer contact for pickup — migration 038
  artist_id: string | null;
  description: string;
  material: string | null;
  laminating: string | null;
  urgency: Urgency | null;
  qty: number | null;                 // pieces ordered
  printed_qty: number;                // pieces printed so far (for batch printing)
  priority: boolean;                  // bumped to the top of the print queue
  notes: string | null;
  date_given: string;
  date_due: string | null;
  date_finished: string | null;
  first_finished_on?: string | null; // set once, the day she FIRST finished — Send back doesn't clear it (first_finished_credit)
  sent_back_count?: number;          // revisions tally — ticks up each time a finished job goes back unfinished
  /** "Waiting for client approval" (2026-10-13): since when. Null/absent = not waiting. */
  client_wait_since?: string | null;
  /** The day it was FIRST marked waiting for the client — the artist's work was done by then. Set once. */
  client_wait_first_on?: string | null;
  preview_path: string | null;
  file_link: string | null;
  attachments?: Attachment[] | null; // every file on the job, file_link included — migration 042
  items?: Item[] | null;             // what the job is, line by line — migration 046
  item_columns?: ItemColumn[] | null; // this task's extra Items columns — 2026-10-10
  target_site: Site | null;
  queued_at: string | null;    // when an admin sent it to the print queue
  operator_id: string | null;  // the operator who claimed the print
  planned_operator_id?: string | null; // picked ahead with the printing area; becomes operator_id on Send to print — 2026-10-20
  print_eta: string | null;    // the printer's expected finish time (countdown)
  print_pause_left: number | null; // seconds left on the timer, frozen while On pause
  ready_at: string | null;
  printed_at: string | null;
  printed_by: string | null;
  printed_site: Site | null;
  printed_file_link: string | null;
  reprint_count: number;               // times flagged for a redo and re-queued
  ready_for_pickup_at: string | null;  // finishing done; ready for the customer
  released_at?: string | null;         // reception checked & released the print — migration 036
  released_by?: string | null;         // who released it (the receptionist/admin) — migration 036
  archived_at: string | null;
  deleted_at?: string | null;          // in the Trash Bin (soft-deleted) — migration 035
  stage: Stage;
  print_state: PrintState | null;   // operator's live progress in the queue
  printed_items?: number[] | null;  // pages printed per item, same order as items — migration 048
  print_problem?: PrintProblem | null;     // a problem the operator reported at the press — 048
  print_problem_note?: string | null;
  print_problem_at?: string | null;
  print_problem_by?: string | null;
  return_note?: string | null;      // why reception returned the print — 048
  operator_note?: string | null;    // a note from reception / admin for the operator — 049
  created_by: string | null;
  created_at: string;
  updated_at: string;
  status: Status;
  days_to_finish: number | null;
}

export interface Message {
  id: string;
  work_order_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  // Work-order events point at a work order; low-stock events point at an item.
  // Messages and mentions point at a conversation.
  kind: 'assign' | 'message' | 'mention' | 'comment' | 'printed' | 'finished' | 'queued' | 'problem' | 'printer' | 'low_stock';
  title: string;
  body: string | null;
  ref_id: string | null;   // work order id (assign, comment) or conversation id (message, mention)
  actor_id: string | null;
  created_at: string;
  read_at: string | null;
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  moderator: 'Moderator',
  receptionist: 'Receptionist',
  artist: 'Artist',
  operator: 'Printer operator',
  supply_clerk: 'Supply Clerk',
  developer: 'Tech Developer',
  support: 'Support',
};

export const STATUS_LABEL: Record<Status, string> = {
  todo: 'To Do',
  in_progress: 'In progress',
  finished: 'File Attached for Review',
  awaiting_print: 'Waiting to Print',
  printed: 'Done Printing',
};

/** After printing: Done Printing → For Release (reception checked it) → Released to Client. */
export const AFTER_PRINT_LABEL = {
  done: 'Done Printing',
  ready: 'For Release',
  released: 'Released to Client',
} as const;
export const afterPrint = (o: Pick<WorkOrder, 'printed_at' | 'ready_for_pickup_at' | 'released_at'>) =>
  !o.printed_at ? null : o.released_at ? 'released' as const : o.ready_for_pickup_at ? 'ready' as const : 'done' as const;

/**
 * Archived = filed away after its release. A job that was taken back into the
 * flow afterwards (Undo release, Return for reprint, released again) is not:
 * it shows on the board again, wherever it now is.
 */
export const isArchived = (o: Pick<WorkOrder, 'archived_at' | 'released_at'>) =>
  !!o.archived_at && !!o.released_at && Date.parse(o.archived_at) >= Date.parse(o.released_at);

export const fmtDate = (d: string | null) =>
  d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-PH', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : '—';

/** Working days a job has been open, for the overdue nudge in the table. */
export const daysOpen = (o: WorkOrder) => {
  const end = o.date_finished ? new Date(o.date_finished + 'T00:00:00') : new Date();
  const start = new Date(o.date_given + 'T00:00:00');
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
};

/**
 * Is this job waiting for the client's approval? (2026-10-13) The artist's part
 * is done and the hold-up is the client's, so it is not counted as late.
 */
export const waitingForClient = (o: Pick<WorkOrder, 'client_wait_since'>) => !!o.client_wait_since;
/**
 * The day the artist's work on a job was done, for the Monthly Report: the
 * first time it was finished or marked waiting for the client, whichever came
 * first. A later Send back or a pending approval does not take it away.
 */
export function artistDoneOn(o: Pick<WorkOrder, 'date_finished' | 'first_finished_on' | 'client_wait_first_on'>): string | null {
  const days = [o.first_finished_on ?? o.date_finished, o.client_wait_first_on].filter((d): d is string => !!d).sort();
  return days[0] ?? null;
}
