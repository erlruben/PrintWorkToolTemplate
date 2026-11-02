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

export interface Bar {
  label: string;
  value: number;
}

/** One bar per time bucket on a gridded track, scaled to the busiest bucket. */
export function TrendBars({ data, empty }: { data: Bar[]; empty: string }) {
  const maxValue = Math.max(0, ...data.map((d) => d.value));
  const step = Math.max(1, Math.ceil((maxValue + 1) / 4));
  const axisMax = step * 4;
  const columns = Math.max(1, data.length);
  const ticks = Array.from({ length: 5 }, (_, i) => axisMax - i * step);
  const summary = data.map((d) => `${d.label}: ${d.value}`).join(', ');

  return (
    <div className="wl-trend" role="img" aria-label={`Jobs finished by period. ${summary || empty}`}>
      <div className="wl-trend-scale" aria-hidden="true">
        {ticks.map((tick, i) => (
          <span key={tick} style={{ top: `${i * 25}%` }}>{tick}</span>
        ))}
      </div>
      <div className="wl-trend-plot" aria-hidden="true">
        {ticks.map((tick, i) => (
          <span key={tick} className="wl-trend-gridline" style={{ top: `${i * 25}%` }} />
        ))}
        {maxValue === 0 && <span className="wl-trend-empty">{empty}</span>}
        <div className="wl-trend-bars" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {data.map((d, i) => {
            const height = (d.value / axisMax) * 100;
            return (
              <div className="wl-trend-col" key={`${d.label}-${i}`} title={`${d.label}: ${d.value}`}>
                <span className="wl-trend-value" style={{ bottom: `${height}%` }}>{d.value}</span>
                <span className="wl-trend-bar" style={{ height: `${height}%` }} />
              </div>
            );
          })}
        </div>
      </div>
      <div className="wl-trend-labels" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {data.map((d, i) => (
          <span className="wl-trend-x" key={`${d.label}-${i}`}>{d.label}</span>
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
