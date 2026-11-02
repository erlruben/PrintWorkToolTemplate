/**
 * Hours, minutes and seconds as typed (2026-10-27: printing time in seconds).
 * Used by DurationInput for the printing timer and the printer's cool-down.
 */
export interface Duration { h: string; m: string; s: string }
export const NO_DURATION: Duration = { h: '', m: '', s: '' };

/** The whole duration in seconds (0 when nothing is typed). Minutes and seconds above 59 are read as 59. */
export function durationSecs(d: Duration | undefined): number {
  if (!d) return 0;
  const n = (v: string, max?: number) => {
    const x = Math.max(0, parseInt(v, 10) || 0);
    return max == null ? x : Math.min(x, max);
  };
  return n(d.h) * 3600 + n(d.m, 59) * 60 + n(d.s, 59);
}

/** "4m 12s", "1h 05m", "9s" — the time left until `until`. */
export function leftLabel(until: string | null, now: number): string {
  const s = Math.max(0, Math.ceil(((until ? new Date(until).getTime() : now) - now) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
}
