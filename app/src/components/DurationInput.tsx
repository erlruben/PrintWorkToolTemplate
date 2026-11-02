/**
 * Hours, minutes and seconds in three small boxes (2026-10-27: printing time
 * in seconds). Used for the printing timer and the printer's cool-down. Empty
 * boxes count as 0; minutes and seconds above 59 are read as 59 (lib/duration).
 */
import { NO_DURATION, type Duration } from '../lib/duration';

export default function DurationInput({ value, onChange, onEnter, idPrefix }: {
  value: Duration | undefined;
  onChange: (next: Duration) => void;
  /** Enter in any box. */
  onEnter?: () => void;
  idPrefix?: string;
}) {
  const v = value ?? NO_DURATION;
  const box = (key: keyof Duration, placeholder: string, unit: string, max?: number) => (
    <>
      <input className="pq-mins" type="number" min="0" max={max} placeholder={placeholder} inputMode="numeric"
        id={idPrefix ? `${idPrefix}-${key}` : undefined}
        aria-label={placeholder === 'hr' ? 'Hours' : placeholder === 'min' ? 'Minutes' : 'Seconds'}
        value={v[key]} onChange={(e) => onChange({ ...v, [key]: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.(); }} />
      <span className="pq-mins-label">{unit}</span>
    </>
  );
  return (
    <>
      {box('h', 'hr', 'h')}
      {box('m', 'min', 'm', 59)}
      {box('s', 'sec', 's', 59)}
    </>
  );
}
