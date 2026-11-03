import { describe, expect, it } from "vitest";
import { finishedTrend, windowFirstDay, windowStartIso } from "../../src/lib/dashboardStats";

const job = (first_finished_on: string | null, date_finished: string | null = null) => ({ first_finished_on, date_finished });

describe("dashboardStats", () => {
  it("calculates windowFirstDay correctly", () => {
    expect(windowFirstDay("30", "2026-11-03")).toBe("2026-10-05");
    expect(windowFirstDay("90", "2026-11-03")).toBe("2026-08-06");
    expect(windowFirstDay("all", "2026-11-03")).toBeNull();
  });

  it("calculates windowStartIso correctly", () => {
    expect(windowStartIso("30", "2026-11-03")).toBe("2026-10-05T00:00:00+08:00");
    expect(windowStartIso("all", "2026-11-03")).toBe("1970-01-01T00:00:00+08:00");
  });

  it("produces correct finishedTrend for 30 day window", () => {
    const t = finishedTrend(
      [
        job("2026-11-03"),
        job("2026-11-01"),
        job("2026-10-05"),
        job("2026-10-04"),
        job(null, "2026-10-20"),
        job(null, null),
      ],
      "30",
      "2026-11-03"
    );
    expect(t.length).toBe(10);
    expect(t[9].from).toBe("2026-11-01");
    expect(t[9].to).toBe("2026-11-03");
    expect(t[9].value).toBe(2);
    expect(t[0].value).toBe(1);
    const total = t.reduce((sum, cur) => sum + cur.value, 0);
    expect(total).toBe(4);
  });

  it("prioritizes first_finished_on over date_finished", () => {
    const t = finishedTrend([job("2026-11-02", "2026-09-01")], "30", "2026-11-03");
    const total = t.reduce((sum, cur) => sum + cur.value, 0);
    expect(total).toBe(1);
  });

  it("produces correct trend for all window", () => {
    const a = finishedTrend([job("2026-09-15"), job("2026-11-02")], "all", "2026-11-03");
    const labels = a.map((item) => item.label);
    const values = a.map((item) => item.value);
    expect(labels).toEqual(["Sep '26", "Oct '26", "Nov '26"]);
    expect(values).toEqual([1, 0, 1]);
  });

  it("returns a single zero value for empty list with all window", () => {
    const res = finishedTrend([], "all", "2026-11-03");
    expect(res.length).toBe(1);
    expect(res[0].value).toBe(0);
  });
});
