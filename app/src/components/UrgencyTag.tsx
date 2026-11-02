import { URGENCY_LABEL, type Urgency } from '../lib/types';

/** The priority chip — a flag glyph plus the level, coloured by severity. */
export default function UrgencyTag({ level }: { level: Urgency | null }) {
  if (!level) return <span className="muted">—</span>;
  return (
    <span className={`urgency-tag ${level}`}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M5 3v18M5 4h11l-2 4 2 4H5" stroke="currentColor" strokeWidth="2"
          strokeLinejoin="round" fill="none" />
      </svg>
      {URGENCY_LABEL[level]}
    </span>
  );
}
