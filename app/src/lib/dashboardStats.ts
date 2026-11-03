/**
 * Numbers for the role dashboards and the statistics assistant.
 * Pure functions over the same rows the screens load, so they are unit-tested
 * and every screen counts the same way.
 */

import { afterPrint, waitingForClient, type WorkOrder } from "./types";
import { addDays, countInto, dayBuckets, monthBuckets, type Bucket } from "./chartMath";
import { phDay } from "./credits";
import { isLowStock, type InventoryItem, type InventoryMovement, type InventoryStock } from "./inventory";

export const OPEN = ["todo", "in_progress"] as const;
export const isOpen = (o: Pick<WorkOrder, "status">) =>
  (OPEN as readonly string[]).includes(o.status);

export function daysUntil(due: string, today: string): number {
  const [yd, md, dd] = due.split("-").map(Number);
  const [yt, mt, dt] = today.split("-").map(Number);
  const msDue = Date.UTC(yd, md - 1, dd);
  const msToday = Date.UTC(yt, mt - 1, dt);
  return Math.round((msDue - msToday) / (24 * 60 * 60 * 1000));
}

export const isOverdue = (
  o: WorkOrder,
  today: string
): boolean => isOpen(o) && !!o.date_due && o.date_due < today && !waitingForClient(o);

export const byDue = (a: WorkOrder, b: WorkOrder): number => {
  const aHasDue = a.date_due != null;
  const bHasDue = b.date_due != null;

  if (aHasDue && bHasDue) {
    const dateDiff = a.date_due!.localeCompare(b.date_due!);
    if (dateDiff !== 0) return dateDiff;
    return a.wo_number.localeCompare(b.wo_number);
  }

  if (aHasDue) return -1;
  if (bHasDue) return 1;

  return a.wo_number.localeCompare(b.wo_number);
};

export interface ArtistStats {
  points: number;
  todo: number;
  inProgress: number;
  dueSoon: number;
  overdue: number;
  jobs: WorkOrder[];
}

export function artistStats(
  orders: WorkOrder[],
  me: string,
  today: string,
  points: number
): ArtistStats {
  const mine = orders.filter((o) => o.artist_id === me);
  const todo = mine.filter((o) => o.status === "todo").length;
  const inProgress = mine.filter((o) => o.status === "in_progress").length;
  const dueSoon = mine.filter((o) =>
    isOpen(o) && o.date_due && daysUntil(o.date_due, today) <= 3 && daysUntil(o.date_due, today) >= 0 && !isOverdue(o, today)
  ).length;
  const overdue = mine.filter((o) => isOverdue(o, today)).length;
  const jobs = [...mine.filter(isOpen)].sort(byDue);
  return { points, todo, inProgress, dueSoon, overdue, jobs };
}

export interface OperatorStats {
  points: number;
  waiting: number;
  printing: number;
  queue: WorkOrder[];
}

export function operatorStats(
  orders: WorkOrder[],
  me: string,
  points: number
): OperatorStats {
  const claimed = orders.filter(
    (o) => o.operator_id === me && o.status === "awaiting_print"
  );
  const printing = claimed.filter((o) => o.print_state === "printing");
  const waiting = claimed.length - printing.length;
  const queue = [...claimed].sort((a, b) => {
    if (a.print_state === "printing" && b.print_state !== "printing") return -1;
    if (a.print_state !== "printing" && b.print_state === "printing") return 1;
    return byDue(a, b);
  });
  return { points, waiting, printing: printing.length, queue };
}

export interface ReceptionStats {
  openedToday: number;
  waitingOnClient: number;
  readyForRelease: number;
  overdue: number;
  ready: WorkOrder[];
  clientWait: WorkOrder[];
}

export function receptionStats(
  orders: WorkOrder[],
  today: string
): ReceptionStats {
  const openedToday = orders.filter((o) => o.date_given === today).length;
  const clientWait = orders.filter((o) => isOpen(o) && waitingForClient(o));
  const ready = orders
    .filter((o) => afterPrint(o) === "ready")
    .sort((a, b) => (a.ready_for_pickup_at ?? "").localeCompare(b.ready_for_pickup_at ?? ""));
  const overdue = orders.filter((o) => isOverdue(o, today)).length;
  const readyForRelease = ready.length;
  const waitingOnClient = clientWait.length;

  return { openedToday, waitingOnClient, readyForRelease, overdue, ready, clientWait };
}

export interface LowStockLine {
  item: InventoryItem;
  site: InventoryStock["site"];
  quantity: number;
}

export interface SupplyStats {
  items: number;
  low: LowStockLine[];
  lowItems: number;
  receipts: number;
  usages: number;
  recent: InventoryMovement[];
}

/**
 * The stockroom in the period. Received and Used count movements (deliveries
 * and usage entries), because quantities of different items cannot be added.
 */
export function supplyStats(
  items: InventoryItem[],
  stock: InventoryStock[],
  movements: InventoryMovement[],
  sinceIso: string
): SupplyStats {
  const activeItems = new Map(items.filter(i => i.active).map(i => [i.id, i]));
  const itemCount = activeItems.size;

  const lowStockLines: LowStockLine[] = stock
    .filter(s => {
      const item = activeItems.get(s.item_id);
      return item !== undefined && isLowStock(s.quantity, item.low_stock_threshold);
    })
    .map(s => ({
      item: activeItems.get(s.item_id)!,
      site: s.site,
      quantity: s.quantity
    }))
    .sort((a, b) => a.quantity - b.quantity || a.item.name.localeCompare(b.item.name));

  const sinceTimestamp = Date.parse(sinceIso);
  let receipts = 0;
  let usages = 0;
  for (const m of movements) {
    if (Date.parse(m.created_at) < sinceTimestamp) continue;
    if (m.movement_type === 'receipt') {
      receipts += 1;
    } else if (m.movement_type === 'usage') {
      usages += 1;
    }
  }

  const recent = movements
    .slice()
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 8);

  const lowItems = new Set(lowStockLines.map(l => l.item.id)).size;

  return {
    items: itemCount,
    low: lowStockLines,
    lowItems,
    receipts,
    usages,
    recent
  };
}

// Periods for the role dashboards: last 30 or 90 days, or all time.
export type Period = "30" | "90" | "all";
export const PERIODS: { id: Period; label: string }[] = [
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
  { id: "all", label: "All time" },
];

export const TODAY = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Manila",
});

export function periodStart(p: Period): string {
  return windowStartIso(p, phDay(new Date().toISOString()) ?? "");
}

/** Return the first date included in the window for a given period.
 *  For the "all" period, return `null`. Otherwise the window is exactly N calendar days ending `today`, so compute the start date by subtracting `N - 1` days from `today`. */
export function windowFirstDay(p: Period, today: string): string | null {
  if (p === "all") return null;
  const daysToSubtract = Number(p) - 1;
  return addDays(today, -daysToSubtract);
}

/** Return the ISO string for the start of the window for a given period.
 *  For the "all" period, return `1970-01-01T00:00:00+08:00`. Otherwise combine `windowFirstDay` with a midnight UTC+8 timestamp. */
export function windowStartIso(p: Period, today: string): string {
  if (p === "all") {
    return "1970-01-01T00:00:00+08:00";
  }
  const firstDay = windowFirstDay(p, today);
  return `${firstDay}T00:00:00+08:00`;
}

/** Categorise orders into buckets based on the completion window for a given period.
 *  The window is constructed using `windowFirstDay`.
 *  If the period is '30' use 3-day buckets, if '90' use 10-day buckets; otherwise use monthly buckets starting from the earliest finished date that is not after `today`. */
export function finishedTrend(
  orders: Pick<WorkOrder, "first_finished_on" | "date_finished">[],
  p: Period,
  today: string,
): Bucket[] {
  const days = orders.map(o => o.first_finished_on ?? o.date_finished);
  let buckets: Bucket[];
  if (p === "30") {
    buckets = dayBuckets(windowFirstDay(p, today)!, today, 3);
  } else if (p === "90") {
    buckets = dayBuckets(windowFirstDay(p, today)!, today, 10);
  } else {
    const first = [...days]
      .filter(d => d && d <= today)
      .sort()[0] ?? today;
    buckets = monthBuckets(first, today);
  }
  return countInto(buckets, days);
}
