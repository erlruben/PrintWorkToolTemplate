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

  const [loadError, setLoadError] = useState<string | null>(null);

  // Movements are fetched for the whole period (newest first), so Received and
  // Used count every delivery and usage in it — not just the latest page.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.from("inventory_items").select("*").order("name"),
      supabase.from("inventory_stock").select("*"),
      supabase.from("inventory_movements").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(5000),
    ]).then(([a, b, c]) => {
      if (cancelled) return;
      const failed = a.error ?? b.error ?? c.error;
      setLoadError(failed ? `Could not load the stockroom: ${failed.message}` : null);
      setItems((a.data ?? []) as InventoryItem[]);
      setStock((b.data ?? []) as InventoryStock[]);
      setMovements((c.data ?? []) as InventoryMovement[]);
    });
    return () => { cancelled = true; };
  }, [since]);

  const s = useMemo(() => supplyStats(items, stock, movements, since), [items, stock, movements, since]);

  const itemOf = (id: string) => items.find((i) => i.id === id);

  return (
    <div className="wrap wl">
      <DashHead eyebrow={`Hi ${profile?.full_name.split(" ")[0] ?? "there"} · the stockroom`} period={period} onPeriod={setPeriod} />
      <section className="wl-kpis">
        <Kpi label="Running low" value={s.lowItems} unit={s.lowItems === 1 ? "item" : "items"} tone={s.lowItems > 0 ? "alert" : undefined} />
        <Kpi label="Items tracked" value={s.items} unit={s.items === 1 ? "item" : "items"} />
        <Kpi label="Received" value={s.receipts} unit={s.receipts === 1 ? "delivery" : "deliveries"} />
        <Kpi label="Used" value={s.usages} unit={s.usages === 1 ? "entry" : "entries"} />
      </section>
      {loadError && <p className="error" role="alert">{loadError}</p>}
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
                      {l.item.unit} left · {SITE_NAME[l.site]} · reorder at {formatStock(l.item.low_stock_threshold)}
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
            <span className="wl-card-note">Newest first, in the period</span>
          </div>
          {s.recent.length === 0 ? (
            <p className="wl-empty">No deliveries or usage in this period.</p>
          ) : (
            <ul className="wl-rows">
              {s.recent.map((m) => (
                <li className="wl-row wl-job" key={m.id}>
                  <span className="wl-row-pct">{m.quantity_delta > 0 ? "+" : ""}{formatStock(m.quantity_delta)}</span>
                  <span className="wl-row-name">
                    {itemOf(m.item_id)?.name ?? "Unknown item"}
                    <small>
                      {itemOf(m.item_id)?.unit ?? ""} · {MOVEMENT_NAME[m.movement_type]} · {SITE_NAME[m.site]} · {new Date(m.created_at).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
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
