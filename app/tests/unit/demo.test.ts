// Unit tests for demo mode: the in-browser stand-in for Supabase (src/demo).
import { describe, expect, it } from "vitest";
import { demoFetch, demoRole } from "../../src/demo/demoFetch";
import { DEMO_ME, INVENTORY_ITEMS, INVENTORY_MOVEMENTS } from "../../src/demo/demoData";
import { canManageInventory } from "../../src/lib/inventory";
import { ROLE_LABEL } from "../../src/lib/types";

const api = (path: string, init?: RequestInit) =>
  demoFetch("https://demo.supabase.co" + path, init);

describe("demo backend", () => {
  it("list all orders with content-range matching length", async () => {
    const res = await api("/rest/v1/work_orders");
    const data: any[] = await res.json();
    const cr = res.headers.get("content-range");
    const total = cr?.split("/")[1];
    expect(data.length).toBeGreaterThan(0);
    expect(total).toBe(String(data.length));
  });

  it("eq filter works", async () => {
    const res = await api("/rest/v1/work_orders?status=eq.todo");
    const data: any[] = await res.json();
    data.forEach(r => expect(r.status).toBe("todo"));
    expect(data.length).toBeGreaterThan(0);
  });

  it("in filter works", async () => {
    const res = await api("/rest/v1/work_orders?status=in.(todo,printed)");
    const data: any[] = await res.json();
    data.forEach(r => expect(["todo", "printed"]).toContain(r.status));
    expect(data.length).toBeGreaterThan(0);
  });

  it("order desc + limit 2", async () => {
    const res = await api(
      "/rest/v1/work_orders?order=created_at.desc&limit=2"
    );
    const data: any[] = await res.json();
    expect(data).toHaveLength(2);
    expect(data[0].created_at >= data[1].created_at).toBe(true);
  });

  it("supports range pagination and reports the full result count", async () => {
    const firstPage = await api("/rest/v1/work_orders?order=created_at.desc", {
      headers: { Range: "0-1" },
    });
    const secondPage = await api("/rest/v1/work_orders?order=created_at.desc", {
      headers: { Range: "2-3" },
    });
    const firstRows: any[] = await firstPage.json();
    const secondRows: any[] = await secondPage.json();

    expect(firstRows).toHaveLength(2);
    expect(secondRows).toHaveLength(2);
    expect(firstRows.map((row) => row.id)).not.toEqual(secondRows.map((row) => row.id));
    expect(firstPage.headers.get("content-range")?.split("/")[1]).toBe(
      secondPage.headers.get("content-range")?.split("/")[1],
    );
  });

  it("single object with no match -> 406", async () => {
    const res = await api(
      "/rest/v1/work_orders?status=eq.nonexistent",
      { headers: { Accept: "application/vnd.pgrst.object+json" } }
    );
    expect(res.status).toBe(406);
  });

  it("POST a message and retrieve it", async () => {
    const body = { body: "test message", type: "generic" };
    const postRes = await api("/rest/v1/messages", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { Prefer: "return=representation", "Content-Type": "application/json" }
    });
    expect(postRes.status).toBe(201);
    const inserted: any[] = await postRes.json();
    expect(inserted.length).toBe(1);
    const id = inserted[0].id;
    const getRes = await api(`/rest/v1/messages?id=eq.${id}`);
    const fetched: any[] = await getRes.json();
    expect(fetched[0].body).toBe(body.body);
    const patchRes = await api(`/rest/v1/messages?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ body: "updated" }),
      headers: { "Content-Type": "application/json" }
    });
    expect(patchRes.status).toBe(204);
    const afterPatch = await api(`/rest/v1/messages?id=eq.${id}`);
    const updated: any[] = await afterPatch.json();
    expect(updated[0].body).toBe("updated");
    const delRes = await api(`/rest/v1/messages?id=eq.${id}`, { method: "DELETE" });
    expect(delRes.status).toBe(204);
    const afterDel = await api(`/rest/v1/messages?id=eq.${id}`);
    const empty: any[] = await afterDel.json();
    expect(empty).toHaveLength(0);
  });

  it("auth user id matches DEMO_ME", async () => {
    const res = await api("/auth/v1/user");
    const user: any = await res.json();
    expect(user.id).toBe(DEMO_ME);
  });

  it("demoRole default is admin", async () => {
    expect(demoRole()).toBe("admin");
  });
});

describe("supply clerk role", () => {
  it("canManageInventory true for supply_clerk", () => {
    expect(canManageInventory("supply_clerk")).toBe(true);
  });
  it("ROLE_LABEL.supply_clerk is 'Supply Clerk'", () => {
    expect(ROLE_LABEL.supply_clerk).toBe("Supply Clerk");
  });
});

describe("demo inventory", () => {
  it("includes November stock activity for every inventory category", () => {
    const november = `${new Date().getUTCFullYear()}-11-`;
    const movements = INVENTORY_MOVEMENTS.filter((movement) => movement.created_at.startsWith(november));
    const categories = [...new Set(INVENTORY_ITEMS.map((item) => item.category))];

    expect(movements).toHaveLength(INVENTORY_ITEMS.length * 2);
    for (const category of categories) {
      const itemIds = new Set(INVENTORY_ITEMS.filter((item) => item.category === category).map((item) => item.id));
      expect(movements.some((movement) => itemIds.has(movement.item_id))).toBe(true);
    }
  });
});
