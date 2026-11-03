import { niceAxis, type Bucket } from "../lib/chartMath";

/** Small, dependency-free charts for the production workload screen. */
export interface Stage {
  label: string;
  value: number;
  focus?: boolean;
}

export function ProductionFlow({ stages, total }: { stages: Stage[]; total: number }) {
  return (
    <ol className="wl-flow">
      {stages.map((stage) => {
        const share = total ? Math.round((stage.value / total) * 100) : 0;
        return (
          <li key={stage.label} className={`wl-flow-row${stage.focus && stage.value > 0 ? ' is-focus' : ''}`}>
            <span className="wl-flow-name">{stage.label}</span>
            <strong className="wl-flow-count">{stage.value}</strong>
            <span className="wl-flow-track" aria-hidden="true">
              <span style={{ width: `${share}%` }} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** One bar per time bucket on a gridded track, scaled to a round axis just above the busiest bucket. */
export function TrendBars({
  data,
  empty,
  noun = "finished"
}: {
  data: Bucket[];
  empty: string;
  noun?: string;
}) {
  const maxValue = Math.max(0, ...data.map((d) => d.value));
  const axis = niceAxis(maxValue);
  const { top: axisMax, ticks } = axis;
  const ticksReversed = [...ticks].reverse();
  const columns = Math.max(1, data.length);
  const summary = data.map((d) => `${d.range}: ${d.value} ${noun}`).join(
    ", "
  );

  return (
    <div
      className="wl-trend"
      role="img"
      aria-label={`Jobs ${noun} per period. ${summary || empty}`}
    >
      <div className="wl-trend-scale" aria-hidden="true">
        {ticksReversed.map((tick, i) => (
          <span key={tick} style={{ top: `${(i / (ticksReversed.length - 1)) * 100}%` }}>
            {tick}
          </span>
        ))}
      </div>
      <div className="wl-trend-plot" aria-hidden="true">
        {ticksReversed.map((tick, i) => (
          <span
            key={tick}
            className="wl-trend-gridline"
            style={{ top: `${(i / (ticksReversed.length - 1)) * 100}%` }}
          />
        ))}
        {maxValue === 0 && <span className="wl-trend-empty">{empty}</span>}
        <div
          className="wl-trend-bars"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {data.map((d, i) => {
            const height = (d.value / axisMax) * 100;
            return (
              <div
                className="wl-trend-col"
                key={`${d.from}-${i}`}
                title={`${d.range}: ${d.value} ${noun}`}
              >
                {(d.value > 0 || maxValue === 0) && (
                  <span className="wl-trend-value" style={{ bottom: `${height}%` }}>
                    {d.value}
                  </span>
                )}
                <span className="wl-trend-bar" style={{ height: `${height}%` }} />
              </div>
            );
          })}
        </div>
      </div>
      <div
        className="wl-trend-labels"
        aria-hidden="true"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {data.map((d, i) => (
          <span className="wl-trend-x" key={`${d.from}-${i}`}>
            {data.length <= 8 || (data.length - 1 - i) % 2 === 0 ? d.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A slim progress bar for a share from 0 to 100. */
export function ShareBar({ pct }: { pct: number }) {
  return (
    <span className="wl-bar" aria-hidden="true">
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}
