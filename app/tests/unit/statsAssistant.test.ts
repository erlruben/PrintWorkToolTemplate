// Unit tests for the dashboard statistics assistant (src/lib/statsAssistant).
import { describe, expect, it } from "vitest";
import { answer, bestIntent, suggestions, type AskContext } from "../../src/lib/statsAssistant";
import type { WorkOrder } from "../../src/lib/types";

const job = { wo_number: "WO-1041", client_name: "Bayview Bakery", date_due: "2026-10-31" } as WorkOrder;
const artist = { role: "artist", period: "last 30 days", s: { points: 8, todo: 1, inProgress: 1, dueSoon: 1, overdue: 0, jobs: [job] } } as AskContext;
const operator = { role: "operator", period: "last 30 days", s: { points: 2, waiting: 2, printing: 0, queue: [] }, printer: "Cooling down" } as AskContext;
const supply = { role: "supply", period: "last 30 days", s: { items: 8, low: [{ item: { name: "Grommets", unit: "box" }, site: "office", quantity: 3 }], received: 450, used: 65, recent: [] }, stock: [{ name: "Tarpaulin 13oz", site: "office", quantity: 50, unit: "roll" }, { name: "Grommets", site: "office", quantity: 3, unit: "box" }] } as AskContext;
const team = { role: "team", period: "last 30 days", inProgress: 2, waiting: 4, overdue: 1, artists: [{ name: "Mika Reyes", total: 5, open: 1, done: 4 }, { name: "Paolo Santos", total: 7, open: 1, done: 6 }], printers: [{ name: "Jun Navarro", printed: 2 }] } as AskContext;

describe("statistics assistant", () => {
  it("should understand points query", () => {
    const res = answer("ilan points ko?", artist);
    expect(res.understood).toBe(true);
    expect(res.text).toContain("8 points");
  });

  it("should suggest next job", () => {
    expect(answer("ano ang susunod?", artist).text).toContain("WO-1041");
  });

  it("should report printer status", () => {
    expect(answer("is my printer broken?", operator).text).toContain("cooling down");
  });

  it("should report left tarpaulin", () => {
    const txt = answer("how much tarpaulin is left?", supply).text;
    expect(txt).toContain("Tarpaulin 13oz");
    expect(txt).toContain("50 roll");
    expect(txt).not.toContain("Grommets");
  });

  it("should report low grommets", () => {
    expect(answer("anong ubos na?", supply).text).toContain("Grommets");
  });

  it("should identify top artist", () => {
    const txt = answer("sino ang may pinakamarami?", team).text;
    expect(txt).toContain("Paolo Santos");
    expect(txt).toContain("7 jobs");
  });

  it("should not understand weather query", () => {
    const res = answer("what is the weather?", artist);
    expect(res.understood).toBe(false);
    expect(res.text).toContain("How many points do I have?");
  });

  it("should return correct suggestion lengths", () => {
    expect(suggestions(team).length).toBe(4);
    expect(suggestions(artist).length).toBe(5);
  });

  it("should match whole words only in bestIntent", () => {
    const intent = bestIntent("printed", [{ id: "p", ask: "", keys: ["print"], reply: () => "" }]);
    expect(intent).toBeNull();
  });
});
