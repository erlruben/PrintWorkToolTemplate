import { describe, expect, it } from "vitest";
import { artistStats, daysUntil, operatorStats, receptionStats, supplyStats } from "../../src/lib/dashboardStats";
import type { WorkOrder } from "../../src/lib/types";
import type { InventoryItem, InventoryMovement, InventoryStock } from "../../src/lib/inventory";

const wo = (over: Partial<WorkOrder>): WorkOrder => ({
  id: over.wo_number ?? "x",
  wo_number: "WO-1",
  status: "todo",
  artist_id: null,
  operator_id: null,
  date_due: null,
  date_given: "2026-10-01",
  client_wait_since: null,
  print_state: null,
  printed_at: null,
  ready_for_pickup_at: null,
  released_at: null,
  ...over,
}) as WorkOrder;

const today = "2026-10-29";

describe("Dashboard stats", () => {
  it("daysUntil correctly calculates day differences", () => {
    expect(daysUntil("2026-11-01", today)).toBe(3);
    expect(daysUntil("2026-10-27", today)).toBe(-2);
  });

  it("artistStats returns correct points and job ordering", () => {
    const orders = [
      wo({ wo_number: "WO-1", artist_id: "me", status: "todo", date_due: "2026-10-30" }),
      wo({ wo_number: "WO-2", artist_id: "me", status: "in_progress", date_due: "2026-10-20" }),
      wo({ wo_number: "WO-3", artist_id: "me", status: "printed", date_due: "2026-10-30" }),
      wo({ wo_number: "WO-4", artist_id: "other", status: "todo" }),
    ];
    const stats = artistStats(orders, "me", today, 7);
    expect(stats.points).toBe(7);
    expect(stats.todo).toBe(1);
    expect(stats.inProgress).toBe(1);
    expect(stats.dueSoon).toBe(1);
    expect(stats.overdue).toBe(1);
   expect(stats.jobs.map((o) => o.wo_number)).toEqual(["WO-2", "WO-1"]);
  });

  it("operatorStats returns correct queue and counts", () => {
    const orders = [
      wo({ wo_number: "WO-5", operator_id: "op", status: "awaiting_print", date_due: "2026-11-02" }),
      wo({ wo_number: "WO-6", operator_id: "op", status: "awaiting_print", print_state: "printing" }),
      wo({ wo_number: "WO-7", operator_id: "op", status: "awaiting_print", date_due: "2026-10-31" }),
      wo({ wo_number: "WO-8", operator_id: "x", status: "awaiting_print" }),
    ];
    const stats = operatorStats(orders, "op", 4);
    expect(stats.waiting).toBe(2);
    expect(stats.printing).toBe(1);
    expect(stats.points).toBe(4);
   expect(stats.queue.map((o) => o.wo_number)).toEqual(["WO-6", "WO-7", "WO-5"]);
  });

  it("receptionStats returns correct flags", () => {
    const orders = [
      wo({ date_given: today }),
      wo({ status: "in_progress", client_wait_since: "2026-10-28T00:00:00Z" }),
      wo({ status: "printed", printed_at: "2026-10-28T00:00:00Z", ready_for_pickup_at: "2026-10-28T02:00:00Z" }),
      wo({ status: "todo", date_due: "2026-10-01", date_given: "2026-09-20" }),
    ];
   const stats = receptionStats(orders, today);
    expect(stats.openedToday).toBe(1);
    expect(stats.waitingOnClient).toBe(1);
    expect(stats.readyForRelease).toBe(1);
    expect(stats.overdue).toBe(1);
  });

  it("supplyStats returns correct item counts and recent movement", () => {
    const items = [
      { id: "a", name: "Ink", unit: "bottle", low_stock_threshold: 2, active: true },
      { id: "b", name: "Old", unit: "roll", low_stock_threshold: 5, active: false },
    ] as InventoryItem[];
    const stock = [
      { item_id: "a", site: "office", quantity: 1 },
      { item_id: "a", site: "production", quantity: 9 },
      { item_id: "b", site: "office", quantity: 0 },
    ] as InventoryStock[];
    const movements = [
      { item_id: "a", site: "office", movement_type: "receipt", quantity_delta: 10, created_at: "2026-10-20T00:00:00Z" },
      { item_id: "a", site: "office", movement_type: "usage", quantity_delta: -3, created_at: "2026-10-25T00:00:00Z" },
      { item_id: "a", site: "office", movement_type: "receipt", quantity_delta: 50, created_at: "2026-09-01T00:00:00Z" },
    ] as InventoryMovement[];
    const stats = supplyStats(items, stock, movements, new Date("2026-10-01T00:00:00Z"));
    expect(stats.items).toBe(1);
    expect(stats.low.length).toBe(1);
    expect(stats.low[0].site).toBe("office");
    expect(stats.low[0].quantity).toBe(1);
    expect(stats.received).toBe(10);
    expect(stats.used).toBe(3);
    expect(stats.recent[0].created_at).toBe("2026-10-25T00:00:00Z");
  });
});
