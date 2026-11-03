import type { ReactNode } from "react";
import { daysUntil, PERIODS, TODAY, type Period } from "../lib/dashboardStats";
import { waitingForClient, type WorkOrder } from "../lib/types";

// Building blocks shared by the role dashboards: the date header with its period pills, a headline figure, and a job list. They use the Workload styles (workload.css).

export function DashHead({
  eyebrow,
  period,
  onPeriod,
}: {
  eyebrow: string;
  period?: Period;
  onPeriod?: (p: Period) => void;
}) {
  return (
    <header className="wl-head">
      <div>
        <p className="wl-eyebrow">{eyebrow}</p>
        <h1 className="wl-date">{TODAY.format(new Date())}</h1>
      </div>
      {period && onPeriod && (
        <div className="wl-range" role="group" aria-label="Period">
          {PERIODS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={period === id ? "on" : ""}
              aria-pressed={period === id}
              onClick={() => onPeriod(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}

export function Kpi({
  label,
  value,
  unit,
  tone,
  badge,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: "hero" | "warn" | "alert";
  badge?: string;
}) {
  return (
    <div className={"wl-card wl-kpi" + (tone ? ` ${tone}` : "")}>
      <span className="wl-kpi-k">{label}</span>
      {badge && <span className="wl-kpi-badge" aria-hidden="true">{badge}</span>}
      <span className={"wl-kpi-n" + (typeof value === "string" ? " is-text" : "")}>
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

export function DueChip({
  due,
  today,
  waiting = false,
}: {
  due: string | null;
  today: string;
  /** Waiting on the client: not late, whatever the date says (same rule as isOverdue). */
  waiting?: boolean;
}) {
  if (waiting) return <span className="wl-due">Waiting on client</span>;
  if (!due) return null;
  const d = daysUntil(due, today);
  let text: string;
  if (d < 0) text = `${-d} day${-d === 1 ? "" : "s"} late`;
  else if (d === 0) text = "Due today";
  else if (d === 1) text = "Due tomorrow";
  else text = `Due in ${d} days`;
  return <span className={"wl-due" + (d < 0 ? " late" : d <= 3 ? " soon" : "")}>{text}</span>;
}

export function JobRows({
  jobs,
  today,
  empty,
}: {
  jobs: WorkOrder[];
  today: string;
  empty: string;
}) {
  if (jobs.length === 0) return <p className="wl-empty">{empty}</p>;
  return (
    <ul className="wl-rows">
      {jobs.map((o) => (
        <li className="wl-row wl-job" key={o.id}>
          <span className="wl-row-pct">{o.wo_number}</span>
          <span className="wl-row-name">
            {o.client_name}
            <small>{o.description}</small>
          </span>
          <DueChip due={o.date_due} today={today} waiting={waitingForClient(o)} />
        </li>
      ))}
    </ul>
  );
}
