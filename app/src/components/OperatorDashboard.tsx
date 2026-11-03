// A printer operator sees their own printing: points (1 per job printed, credited the same way as the Monthly Report), their queue and their printer.
import { useMemo, useState, useEffect } from "react";
import { useCreditEvents, usePrinterStatus, useWorkOrders } from "../lib/data";
import { credits, phDay } from "../lib/credits";
import { useSession } from "../lib/sessionContext";
import { printerStateAt, SITE_LABEL, type PrinterState } from "../lib/types";
import { DashHead, JobRows, Kpi } from "./DashParts";
import { operatorStats, periodStart, type Period } from "../lib/dashboardStats";

const STATE_LABEL: Record<PrinterState, string> = {
  working: "Working",
  cooldown: "Cooling down",
  broken: "Broken",
};

export default function OperatorDashboard() {
  const [period, setPeriod] = useState<Period>("30");
  const since = useMemo(() => periodStart(period), [period]);

  const { orders } = useWorkOrders();
  const { profile } = useSession();
  const me = profile?.id ?? "";

  const stamp = useMemo(
    () => `${orders.length}:${orders.reduce((m, o) => (o.updated_at > m ? o.updated_at : m), "")}`,
    [orders]
  );
  const events = useCreditEvents(stamp);

  const points = useMemo(() => {
    const from = phDay(since) ?? "";
    return credits(
      orders,
      (day) => !!day && day >= from,
      (id) => id ?? "",
      events
    ).printers.find((p) => p.id === me)?.count ?? 0;
  }, [orders, since, events, me]);

  const s = useMemo(() => operatorStats(orders, me, points), [orders, me, points]);

  const today = phDay(new Date().toISOString()) ?? "";

  const { rows } = usePrinterStatus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const site = profile?.site ?? null;
  const printer = rows.find((r) => r.site === site);
  const state = printerStateAt(printer, now);

  return (
    <div className="wrap wl">
      <DashHead
        eyebrow={`Hi ${profile?.full_name.split(" ")[0] ?? "there"} · your printing`}
        period={period}
        onPeriod={setPeriod}
      />
      <section className="wl-kpis">
        <Kpi
          label="Jobs printed"
          value={s.points}
          unit={s.points === 1 ? "job" : "jobs"}
          tone="hero"
        />
        <Kpi
          label="Waiting for you"
          value={s.waiting}
          unit="jobs"
          tone={s.waiting > 0 ? "warn" : undefined}
        />
        <Kpi
          label="Printing now"
          value={s.printing}
          unit="jobs"
        />
        <Kpi
          label="My printer"
          value={STATE_LABEL[state]}
          unit={site ? SITE_LABEL[site] : undefined}
          tone={state === "broken" ? "alert" : state === "cooldown" ? "warn" : undefined}
        />
      </section>
      <div className="wl-card">
        <div className="wl-card-head">
          <h2>My print queue</h2>
          <span className="wl-card-note">Printing first, then by due date</span>
        </div>
        <JobRows jobs={s.queue} today={today} empty="Nothing in your queue." />
      </div>
    </div>
  );
}
