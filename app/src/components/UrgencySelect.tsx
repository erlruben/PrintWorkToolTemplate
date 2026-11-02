import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { URGENCY_OPTIONS, type Urgency } from '../lib/types';
import UrgencyTag from './UrgencyTag';

/**
 * The priority tag in the table, clickable into a dropdown so it can be
 * changed without opening the ticket (PRD-adjacent, ClickUp-style). Read-only
 * viewers just see the tag.
 */
export default function UrgencySelect({
  orderId,
  level,
  editable,
}: {
  orderId: string;
  level: Urgency | null;
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    // The table scrolls horizontally, which would clip an absolutely-placed
    // menu, so it is fixed to the viewport and closes on any scroll.
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  function toggle() {
    if (open) { setOpen(false); return; }
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left });
    setOpen(true);
  }

  async function pick(next: Urgency | null) {
    setOpen(false);
    if (next === level) return;
    setBusy(true);
    await supabase.from('work_orders').update({ urgency: next }).eq('id', orderId);
    setBusy(false);
  }

  if (!editable) return <UrgencyTag level={level} />;

  return (
    <div className="urgency-select" ref={ref}>
      <button
        ref={triggerRef}
        className="urgency-trigger"
        disabled={busy}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
      >
        <UrgencyTag level={level} />
      </button>

      {open && pos && (
        <div
          className="urgency-menu"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          {URGENCY_OPTIONS.map((u) => (
            <button key={u} className={u === level ? 'on' : ''} onClick={() => pick(u)}>
              <UrgencyTag level={u} />
            </button>
          ))}
          <button className={level === null ? 'on' : ''} onClick={() => pick(null)}>
            <span className="muted">None</span>
          </button>
        </div>
      )}
    </div>
  );
}
