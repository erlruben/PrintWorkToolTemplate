// Reception sees the counter: what came in today, what waits on the client, what is ready to hand over, and what is late.
import { useMemo } from "react";
import { useWorkOrders } from "../lib/data";
import { phDay } from "../lib/credits";
import { receptionStats } from "../lib/dashboardStats";
import { useSession } from "../lib/sessionContext";
import { DashHead, JobRows, Kpi } from "./DashParts";

export default function ReceptionDashboard() {
  const { orders } = useWorkOrders();
  const { profile } = useSession();
  const today = phDay(new Date().toISOString()) ?? "";
  const s = useMemo(() => receptionStats(orders, today), [orders, today]);

  return (
    <div className="wrap wl">
      <DashHead eyebrow={`Hi ${profile?.full_name.split(" ")[0] ?? "there"} · the front desk`} />
      <section className="wl-kpis">
        <Kpi label="New today" value={s.openedToday} unit="jobs" />
        <Kpi label="Ready to release" value={s.readyForRelease} unit="jobs" tone="hero" />
        <Kpi label="Waiting on client" value={s.waitingOnClient} unit="jobs" tone={s.waitingOnClient > 0 ? "warn" : undefined} />
        <Kpi label="Past due" value={s.overdue} unit="jobs" tone={s.overdue > 0 ? "alert" : undefined} />
      </section>
      <section className="wl-lists">
        <div className="wl-card">
          <div className="wl-card-head">
            <h2>Ready to release</h2>
            <span className="wl-card-note">Oldest first</span>
          </div>
          <JobRows jobs={s.ready} today={today} empty="Nothing waiting for pickup." />
        </div>
        <div className="wl-card">
          <div className="wl-card-head">
            <h2>Waiting on the client</h2>
            <span className="wl-card-note">Approval or payment pending</span>
          </div>
          <JobRows jobs={s.clientWait} today={today} empty="No jobs waiting on a client." />
        </div>
      </section>
    </div>
  );
}
