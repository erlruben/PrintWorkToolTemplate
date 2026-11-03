import { describe, expect, it } from "vitest";
import { addDays, countInto, dayBuckets, monthBuckets, niceAxis } from "../../src/lib/chartMath";

describe("chartMath", () => {
  it("niceAxis works for small values", () => {
    expect(niceAxis(0)).toEqual({ step: 1, top: 4, ticks: [0, 1, 2, 3, 4] });
    expect(niceAxis(4).ticks).toEqual([0, 1, 2, 3, 4, 5]);
    expect(niceAxis(8)).toEqual({ step: 2, top: 10, ticks: [0, 2, 4, 6, 8, 10] });
    expect(niceAxis(13)).toEqual({ step: 5, top: 15, ticks: [0, 5, 10, 15] });
    expect(niceAxis(1).top).toBe(2);
  });

  it("niceAxis respects bounds and tick count for 1-200", () => {
    for (let max = 1; max <= 200; max++) {
      const ax = niceAxis(max);
      expect(ax.top).toBeGreaterThan(max);
      expect(ax.ticks.length).toBeLessThanOrEqual(6);
      ax.ticks.forEach(t => {
        expect(Number.isInteger(t)).toBeTruthy();
      });
    }
  });

  it("addDays handles positive and negative offsets", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("dayBuckets with 3-day buckets", () => {
    const buckets = dayBuckets("2026-10-05", "2026-11-03", 3);
    expect(buckets.length).toBe(10);
    expect(buckets[0].from).toBe("2026-10-05");
    const last = buckets[buckets.length - 1];
    expect(last.to).toBe("2026-11-03");
    expect(last.from).toBe("2026-11-01");
    buckets.forEach(b => {
      expect(addDays(b.from, 2)).toBe(b.to);
    });
    expect(last.range).toBe("Nov 1 – Nov 3");
  });

  it("dayBuckets with 10-day buckets", () => {
    const buckets = dayBuckets("2026-08-06", "2026-11-03", 10);
    expect(buckets.length).toBe(9);
    expect(buckets[buckets.length - 1].to).toBe("2026-11-03");
    expect(buckets[0].from).toBe("2026-08-06");
  });

  it("dayBuckets with 3-day buckets no partial start", () => {
    const buckets = dayBuckets("2026-10-01", "2026-10-08", 3);
    expect(buckets.length).toBe(2);
    expect(buckets[0].from).toBe("2026-10-03");
  });

  it("monthBuckets generates correct labels and ranges", () => {
    const buckets = monthBuckets("2025-11-20", "2026-02-10");
    const labels = buckets.map(b => b.label);
    expect(labels).toEqual(["Nov '25", "Dec '25", "Jan '26", "Feb '26"]);
    const first = buckets[0];
    expect(first.from).toBe("2025-11-01");
    expect(first.to).toBe("2025-11-30");
    const last = buckets[buckets.length - 1];
    expect(last.to).toBe("2026-02-10");
    expect(buckets[3].range).toBe("February 2026");
  });

  it("countInto aggregates correct counts", () => {
    const buckets = dayBuckets("2026-10-01", "2026-10-06", 3);
    const values = countInto(buckets, [
      "2026-10-01",
      "2026-10-03",
      "2026-10-04",
      null,
      "2026-09-30",
      "2026-10-07",
    ]);
    expect(values.map((b) => b.value)).toEqual([2, 1]);
  });
});
