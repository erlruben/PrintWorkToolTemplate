// The Supply Clerk sees the stockroom: what is running low, what came in and what was used in the period, and the latest movements.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { formatStock, MOVEMENT_NAME, SITE_NAME, type InventoryItem, type InventoryMovement, type InventoryStock } from "../lib/inventory";
import { useSession } from "../lib/sessionContext";
import { DashHead, Kpi } from "./DashParts";
import { supplyStats, periodStart, type Period } from "../lib/dashboardStats";

export default function SupplyDashboard() {
  const { profile } = useSession();
  const [period, setPeriod] = useState<Period>("30");
  const since = useMemo(() => periodStart(period), [period]);

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [stock, setStock] = useState<InventoryStock[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.from("inventory_items").select("*").order("name"),
      supabase.from("inventory_stock").select("*"),
      supabase.from("inventory_movements").select("*").order("created_at", { ascending: false }).limit(150),
    ]).then(([a, b, c]) => {
      if (cancelled) return;
      setItems((a.data ?? []) as InventoryItem[]);
      setStock((b.data ?? []) as InventoryStock[]);
      setMovements((c.data ?? []) as InventoryMovement[]);
    });
    return () => { cancelled = true; };
  }, []);

  const s = useMemo(() => supplyStats(items, stock, movements, since), [items, stock, movements, since]);

  const nameOf = (id: string) => items.find((i) => i.id === id)?.name ?? "Unknown item";

  return (
    <div className="wrap wl">
      <DashHead eyebrow={`Hi ${profile?.full_name.split(" ")[0] ?? "there"} · the stockroom`} period={period} onPeriod={setPeriod} />
      <section className="wl-kpis">
        <Kpi label="Running low" value={s.low.length} unit="items" tone="hero" badge="!" />
        <Kpi label="Items tracked" value={s.items} unit="items" />
        <Kpi label="Received" value={formatStock(s.received)} unit="units" />
        <Kpi label="Used" value={formatStock(s.used)} unit="units" />
      </section>
      <section className="wl-lists">
        <div className="wl-card">
          <div className="wl-card-head">
            <h2>Running low</h2>
            <span className="wl-card-note">At or below the reorder level</span>
          </div>
          {s.low.length === 0 ? (
            <p className="wl-empty">Everything is stocked.</p>
          ) : (
            <ul className="wl-rows">
              {s.low.map((l) => (
                <li className="wl-row wl-job" key={l.item.id + l.site}>
                  <span className="wl-row-pct">{formatStock(l.quantity)}</span>
                  <span className="wl-row-name">
                    {l.item.name}
                    <small>
                      {SITE_NAME[l.site]} · reorder at {l.item.low_stock_threshold} {l.item.unit}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="wl-card">
          <div className="wl-card-head">
            <h2>Latest movements</h2>
            <span className="wl-card-note">Newest first</span>
          </div>
          {s.recent.length === 0 ? (
            <p className="wl-empty">No movements yet.</p>
          ) : (
            <ul className="wl-rows">
              {s.recent.map((m) => (
                <li className="wl-row wl-job" key={m.id}>
                  <span className="wl-row-pct">{m.quantity_delta > 0 ? "+" : ""}{formatStock(m.quantity_delta)}</span>
                  <span className="wl-row-name">
                    {nameOf(m.item_id)}
                    <small>
                      {MOVEMENT_NAME[m.movement_type]} · {SITE_NAME[m.site]} · {new Date(m.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
