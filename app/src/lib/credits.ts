/**
 * Who gets the credit for a job (2026-10-14). Three people work on a task and
 * each is counted for their own part, on the day they did it:
 *   - the person who MADE the task, on the day it was given;
 *   - the ARTIST who did the art, on the day it was first finished or first
 *     marked "Waiting for client approval" — a later Send back does not take
 *     it away, and neither does giving the task to someone else afterwards;
 *   - the OPERATOR who printed it, on the day it was printed. That is the
 *     operator who took the job: reception or an admin pressing Finish for
 *     them does not take the credit. A job nobody took is credited to whoever
 *     pressed Finish.
 * The Workload screen and the Monthly Report both count from here, so their
 * numbers agree.
 *
 * The counts come from each task's history (work_order_events), which keeps
 * every step with the person's name — so a reprint does not erase the first
 * printer, and a person who has left the shop keeps their past work. Until
 * that history exists in the database the same rules are applied to what the
 * task itself still remembers.
 */
import { artistDoneOn, type WorkOrder } from './types';

const PH_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * The Philippine calendar day of a date or a moment, as YYYY-MM-DD. A plain
 * date is already a shop day; a moment (printed at 2 AM on the 1st, say) is
 * placed on the day it was in the shop.
 */
export function phDay(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : PH_DAY.format(d);
}
/** This month in the shop, as YYYY-MM. */
export const phMonthNow = () => PH_DAY.format(new Date()).slice(0, 7);

/** One line of a task's history. */
export interface OrderEvent {
  id: number;
  work_order_id: string;
  at: string;
  kind: 'made' | 'assigned' | 'art_done' | 'sent_back' | 'client_wait' | 'client_ok' | 'to_print' | 'claimed' | 'printed'
    | 'reprint' | 'problem' | 'for_release' | 'released' | 'trashed' | 'restored';
  actor_id: string | null;
  actor_name: string | null;
  person_id: string | null;
  person_name: string | null;
  note: string | null;
}
/** The lines that carry credit. */
export const CREDIT_KINDS: OrderEvent['kind'][] = ['made', 'art_done', 'client_wait', 'printed'];

type Job = Pick<WorkOrder, 'id' | 'created_by' | 'artist_id' | 'operator_id' | 'printed_by' | 'printed_at' | 'date_given' | 'date_finished' | 'first_finished_on' | 'client_wait_first_on'>;

/** Who printed a job: the operator who took it, else whoever ticked it off. */
export const printerOf = (o: Pick<WorkOrder, 'operator_id' | 'printed_by' | 'printed_at'>) =>
  (o.printed_at ? o.operator_id ?? o.printed_by ?? null : null);

export interface CreditRow {
  /** The person's id — or their name, for someone whose account is gone. */
  id: string;
  name: string;
  count: number;
}
/**
 * "Art done" is no longer counted here — it's a straight count of
 * file_credit_events for the period (see useFileCreditEventsSince), credited
 * the moment an artist adds a file and taken back if it's removed. This row
 * just says who was given work in the period; join it to the file-credit
 * counts by `id` for the "Art done" number.
 */
export interface ArtistCredit {
  id: string;
  name: string;
  /** Tasks given to this artist in the period. */
  given: number;
}
export interface Credits {
  makers: CreditRow[];
  artists: ArtistCredit[];
  printers: CreditRow[];
  /** Tasks given and tasks printed in the period. */
  totals: { made: number; printed: number };
  /** Per task: who is credited for each part (for the line-by-line report). */
  byTask: Map<string, { maker: string | null; artist: string | null; printers: string[] }>;
}

interface Credit { task: string; id: string | null; name: string | null; day: string | null }

/**
 * Everyone's credit for the days that pass `inPeriod` (a month, or the last 30
 * days). `orders` are the tasks that count (not the ones in the Trash),
 * `events` their history (null = not available: use the tasks themselves),
 * and `nameOf` turns an id into a name.
 */
export function credits(
  orders: Job[],
  inPeriod: (day: string | null) => boolean,
  nameOf: (id: string | null) => string,
  events: OrderEvent[] | null = null,
): Credits {
  const live = new Map(orders.map((o) => [o.id, o]));
  const made: Credit[] = [];
  const art: Credit[] = [];
  const printed: Credit[] = [];

  // Tasks with history are counted from it; the others from what they remember.
  const told = new Set<string>();
  if (events) {
    const firstArt = new Map<string, OrderEvent>();
    const prints = new Map<string, OrderEvent>();          // one per task and person: the first
    for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)) {
      const o = live.get(e.work_order_id);
      if (!o) continue;                                     // in the Trash, or gone
      if (e.kind === 'made') {
        told.add(o.id);
        made.push({ task: o.id, id: e.person_id, name: e.person_name, day: phDay(o.date_given) });
      } else if (e.kind === 'art_done' || e.kind === 'client_wait') {
        if (!firstArt.has(o.id)) firstArt.set(o.id, e);
      } else if (e.kind === 'printed') {
        const key = `${o.id}|${e.person_id ?? e.person_name ?? ''}`;
        if (!prints.has(key)) prints.set(key, e);
      }
    }
    for (const [task, e] of firstArt) if (told.has(task)) art.push({ task, id: e.person_id, name: e.person_name, day: phDay(e.at) });
    for (const e of prints.values()) if (told.has(e.work_order_id)) printed.push({ task: e.work_order_id, id: e.person_id, name: e.person_name, day: phDay(e.at) });
  }
  for (const o of orders) {
    if (told.has(o.id)) continue;
    made.push({ task: o.id, id: o.created_by, name: null, day: phDay(o.date_given) });
    if (o.artist_id) art.push({ task: o.id, id: o.artist_id, name: null, day: artistDoneOn(o) });
    if (o.printed_at) printed.push({ task: o.id, id: printerOf(o), name: null, day: phDay(o.printed_at) });
  }

  const makers = new Map<string, CreditRow>();
  const artists = new Map<string, ArtistCredit>();
  const printers = new Map<string, CreditRow>();
  const byTask: Credits['byTask'] = new Map();
  const task = (id: string) => {
    let t = byTask.get(id);
    if (!t) { t = { maker: null, artist: null, printers: [] }; byTask.set(id, t); }
    return t;
  };
  // A person still on the staff list reads by their current name; one who has
  // left, by the name written in the history.
  const label = (c: Credit) => {
    const known = c.id ? nameOf(c.id) : null;
    return known && known !== 'Unknown' ? known : c.name ?? (c.id ? 'Unknown' : 'Not recorded');
  };
  const row = <T extends { id: string; name: string }>(map: Map<string, T>, c: Credit, blank: Omit<T, 'id' | 'name'>): T => {
    const key = c.id ?? (c.name ? `name:${c.name}` : 'none');
    let r = map.get(key);
    if (!r) { r = { id: key, name: label(c), ...blank } as T; map.set(key, r); }
    return r;
  };
  const totals = { made: 0, printed: 0 };
  const printedTasks = new Set<string>();
  for (const c of made) {
    task(c.task).maker = label(c);
    if (inPeriod(c.day)) { row(makers, c, { count: 0 }).count += 1; totals.made += 1; }
  }
  for (const o of orders) {
    if (o.artist_id && inPeriod(phDay(o.date_given))) row(artists, { task: o.id, id: o.artist_id, name: null, day: null }, { given: 0 }).given += 1;
  }
  // Still used for the per-task "artist of record" label on the line-by-line
  // report (byTask.artist) — just no longer a credit count.
  for (const c of art) {
    if (!c.day) continue;
    task(c.task).artist = label(c);
  }
  for (const c of printed) {
    const t = task(c.task);
    if (!t.printers.includes(label(c))) t.printers.push(label(c));
    if (inPeriod(c.day)) { row(printers, c, { count: 0 }).count += 1; printedTasks.add(c.task); }
  }
  totals.printed = printedTasks.size;

  const byCount = <T extends CreditRow>(m: Map<string, T>) => [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    makers: byCount(makers),
    artists: [...artists.values()].sort((a, b) => b.given - a.given || a.name.localeCompare(b.name)),
    printers: byCount(printers),
    totals,
    byTask,
  };
}

/** A history line in plain words. */
export function historyLine(e: OrderEvent): string {
  const who = e.actor_name ?? 'Someone';
  const person = e.person_name ?? 'someone';
  const by = e.actor_name && e.actor_name !== e.person_name ? ` by ${e.actor_name}` : '';
  switch (e.kind) {
    case 'made': return `Task made by ${person}`;
    case 'assigned': return `Given to ${person}${by}`;
    case 'art_done': return `File attached — art done by ${person}`;
    case 'sent_back': return `Sent back for changes by ${who}`;
    case 'client_wait': return e.actor_name ? `Marked waiting for client approval by ${who}` : `Waiting for client approval — ${person}'s art was with the client`;
    case 'client_ok': return `Client approved — noted by ${who}`;
    case 'to_print': return `Sent to print by ${who}`;
    case 'claimed': return e.actor_name && e.actor_name !== e.person_name ? `Print job given to ${person} by ${e.actor_name}` : `${person} took the print job`;
    case 'printed': return `Printed by ${person}${e.actor_name && e.actor_name !== e.person_name ? ` (marked done by ${e.actor_name})` : ''}`;
    case 'reprint': return `Returned for a reprint by ${who}${e.note ? `: ${e.note}` : ''}`;
    case 'problem': return `Problem at the press reported by ${who}${e.note ? `: ${e.note.replace(/_/g, ' ')}` : ''}`;
    case 'for_release': return `Marked For Release by ${who}`;
    case 'released': return `Released to the client by ${person}`;
    case 'trashed': return `Moved to the Trash by ${who}`;
    case 'restored': return `Brought back from the Trash by ${who}`;
    default: return e.kind;
  }
}
/** Rebuilt from what the task still remembered, not seen as it happened. */
export const fromRecords = (e: OrderEvent) => e.note === 'from the records';
