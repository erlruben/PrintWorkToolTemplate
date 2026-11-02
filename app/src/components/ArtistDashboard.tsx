// An artist sees their own work: the points they earned (1 per file added to a task, the same count as the Monthly Report), their open jobs and what is due.

import { useMemo, useState } from "react";
import { useFileCreditEventsSince, useWorkOrders } from "../lib/data";
import { phDay } from "../lib/credits";
import { useSession } from "../lib/sessionContext";
import { DashHead, JobRows, Kpi } from "./DashParts";
import { artistStats, periodStart, type Period } from "../lib/dashboardStats";

export default function ArtistDashboard() {
  const [period, setPeriod] = useState<Period>("30");
  const since = useMemo(() => periodStart(period), [period]);

  const { orders } = useWorkOrders();
  const { profile } = useSession();

  const { rows } = useFileCreditEventsSince(since);
  const me = profile?.id ?? "";
  const points = rows.filter((r) => r.artist_id === me).length;

  const today = phDay(new Date().toISOString()) ?? "";
  const s = useMemo(
    () => artistStats(orders, me, today, points),
    [orders, me, today, points]
  );

  const first = profile?.full_name.split(" ")[0] ?? "there";

  return (
    <div className="wrap wl">
      <DashHead
        eyebrow={`Hi ${first} · your art work`}
        period={period}
        onPeriod={setPeriod}
      />
      <section className="wl-kpis">
        <Kpi label="My points" value={s.points} unit="points" tone="hero" badge="★" />
        <Kpi label="In progress" value={s.inProgress} unit="jobs" />
        <Kpi
          label="Due in 3 days"
          value={s.dueSoon}
          unit="jobs"
          tone={s.dueSoon > 0 ? "warn" : undefined}
        />
        <Kpi
          label="Past due"
          value={s.overdue}
          unit="jobs"
          tone={s.overdue > 0 ? "alert" : undefined}
        />
      </section>
      <div className="wl-card">
        <div className="wl-card-head">
          <h2>My open jobs</h2>
          <span className="wl-card-note">{s.todo} to do · {s.inProgress} in progress</span>
        </div>
        <JobRows jobs={s.jobs} today={today} empty="No open jobs right now." />
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        You earn 1 point for each file you add to a task in the selected period. Removing the file takes the point back.
        </p>
    </div>
  );
}
