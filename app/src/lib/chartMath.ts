export function niceAxis(max: number, maxTicks = 5) {
  if (max <= 0) {
    return { step: 1, top: 4, ticks: [0, 1, 2, 3, 4] };
  }
  const raw = max / (maxTicks - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const candidates = [1, 2, 5, 10];
  let step = candidates.reduce((best, cur) => {
    const candidate = cur * mag;
    if (candidate >= raw && candidate >= 1 && candidate < best) {
      return candidate;
    }
    return best;
  }, Infinity);
  if (!step || step === Infinity) step = 10 * mag;
  step = Math.max(step, 1);
  step = Math.ceil(step);
  let top = Math.ceil(max / step) * step;
  if (top === max) top += step;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) {
    ticks.push(v);
  }
  return { step, top, ticks };
}

export interface Bucket {
  from: string;
  to: string;
  label: string;
  range: string;
  value: number;
}

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const utcMs = Date.UTC(y, m - 1, d);
  const newMs = utcMs + n * 86400000;
  const newDate = new Date(newMs);
  const yy = newDate.getUTCFullYear();
  const mm = newDate.getUTCMonth() + 1;
  const dd = newDate.getUTCDate();
  return `${yy.toString().padStart(4, '0')}-${mm
    .toString()
    .padStart(2, '0')}-${dd.toString().padStart(2, '0')}`;
}

function formatAbbr(d: Date): string {
  return `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function dayBuckets(firstDay: string, lastDay: string, size: number): Bucket[] {
  const [fy, fm, fd] = firstDay.split('-').map(Number);
  const [ly, lm, ld] = lastDay.split('-').map(Number);
  const startMs = Date.UTC(fy, fm - 1, fd);
  const endMs = Date.UTC(ly, lm - 1, ld);
  const buckets: Bucket[] = [];
  let toMs = endMs;
  while (toMs >= startMs) {
    const fromMs = toMs - (size - 1) * 86400000;
    if (fromMs < startMs) break; // a partial bucket at the start would under-read
    const fromDate = new Date(fromMs);
    const toDate = new Date(toMs);
    const label = formatAbbr(fromDate);
    const range =
      size === 1 ? label : `${label} – ${formatAbbr(toDate)}`;
    buckets.unshift({
      from: `${fromDate.getUTCFullYear()}-${(fromDate.getUTCMonth() + 1)
        .toString()
        .padStart(2, '0')}-${fromDate.getUTCDate().toString().padStart(2, '0')}`,
      to: `${toDate.getUTCFullYear()}-${(toDate.getUTCMonth() + 1)
        .toString()
        .padStart(2, '0')}-${toDate.getUTCDate().toString().padStart(2, '0')}`,
      label,
      range,
      value: 0
    });
    toMs -= size * 86400000;
  }
  return buckets;
}

export function monthBuckets(firstDay: string, lastDay: string): Bucket[] {
  const [fy, fm] = firstDay.split("-").map(Number);
  const [ly, lm, ld] = lastDay.split("-").map(Number);
  const buckets: Bucket[] = [];
  let year = fy;
  let month = fm;
  while (year < ly || (year === ly && month <= lm)) {
    const fromDate = `${year}-${String(month).padStart(2, "0")}-01`;
    if (year === ly && month === lm) {
      const toDate = `${ly}-${String(lm).padStart(2, "0")}-${String(ld).padStart(2, "0")}`;
      buckets.push({
        from: fromDate,
        to: toDate,
        label: `${MONTH_ABBR[month - 1]} '${String(year).slice(2)}`,
        range: `${MONTH_FULL[month - 1]} ${year}`,
        value: 0,
      });
      break;
    } else {
      const nextMonthFirst = Date.UTC(year, month, 1);
      const prevMonthLast = new Date(nextMonthFirst - 86400000).toISOString().slice(0, 10);
      buckets.push({
        from: fromDate,
        to: prevMonthLast,
        label: `${MONTH_ABBR[month - 1]} '${String(year).slice(2)}`,
        range: `${MONTH_FULL[month - 1]} ${year}`,
        value: 0,
      });
    }
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return buckets;
}

export function countInto(buckets: Bucket[], days: (string | null | undefined)[]): Bucket[] {
  return buckets.map(b => ({
    ...b,
    value: days.filter(d => d && d >= b.from && d <= b.to).length,
  }));
}
