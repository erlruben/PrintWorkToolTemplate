/**
 * Calendar math for the Report tabs (Monthly / Quarterly / Yearly), all in
 * the shop's own (Philippine) time — the same clock `lib/credits.ts` uses.
 */
export type PeriodType = 'month' | 'quarter' | 'year';

const PH_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' });

function phYmd(d: Date): [number, number, number] {
  const [y, m, day] = PH_DAY.format(d).split('-').map(Number);
  return [y, m, day];
}

/** The label of the period containing `d` (default: now), e.g. '2026-10', '2026-Q4', '2026'. */
export function periodLabelOf(type: PeriodType, d: Date = new Date()): string {
  const [y, m] = phYmd(d);
  if (type === 'year') return String(y);
  if (type === 'month') return `${y}-${String(m).padStart(2, '0')}`;
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

/** A period's bounds: an ISO instant at its start (inclusive) and end (exclusive), plus plain start/end dates for display. */
export function periodBounds(type: PeriodType, label: string): { startIso: string; endIsoExclusive: string; startDate: string; endDate: string } {
  let y: number, startMonth: number, monthsSpan: number;
  if (type === 'year') {
    y = Number(label); startMonth = 1; monthsSpan = 12;
  } else if (type === 'month') {
    const [yy, mm] = label.split('-').map(Number);
    y = yy; startMonth = mm; monthsSpan = 1;
  } else {
    const [yy, qq] = label.split('-Q').map(Number);
    y = yy; startMonth = (qq - 1) * 3 + 1; monthsSpan = 3;
  }
  const start = new Date(Date.UTC(y, startMonth - 1, 1));
  const end = new Date(Date.UTC(y, startMonth - 1 + monthsSpan, 1));
  const lastDay = new Date(end.getTime() - 86400000);
  const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return {
    startIso: `${ymd(start)}T00:00:00+08:00`,
    endIsoExclusive: `${ymd(end)}T00:00:00+08:00`,
    startDate: ymd(start),
    endDate: ymd(lastDay),
  };
}

/** The label of the period immediately before `label`. */
export function previousPeriodLabel(type: PeriodType, label: string): string {
  const before = new Date(new Date(periodBounds(type, label).startIso).getTime() - 86400000);
  return periodLabelOf(type, before);
}

/** True once this period's end has passed (so it's safe to archive). */
export function periodHasEnded(type: PeriodType, label: string): boolean {
  return new Date(periodBounds(type, label).endIsoExclusive).getTime() <= Date.now();
}

/** A readable date range, e.g. "Oct 1 – 31, 2026". */
export function periodRangeText(type: PeriodType, label: string): string {
  const b = periodBounds(type, label);
  const s = new Date(b.startDate + 'T00:00:00');
  const e = new Date(b.endDate + 'T00:00:00');
  return s.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ' – ' + e.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** A readable title, e.g. "October 2026", "2026 Q4", "2026". */
export function periodTitle(type: PeriodType, label: string): string {
  if (type === 'year') return label;
  if (type === 'quarter') return label.replace('-Q', ' Q');
  return new Date(label + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
}

/** The last `count` period labels up to and including the one containing `from`, newest first. */
export function recentLabels(type: PeriodType, count: number, from: Date = new Date()): string[] {
  const labels: string[] = [];
  let label = periodLabelOf(type, from);
  for (let i = 0; i < count; i++) {
    labels.push(label);
    label = previousPeriodLabel(type, label);
  }
  return labels;
}
