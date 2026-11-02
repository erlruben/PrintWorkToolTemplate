import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { AFTER_PRINT_LABEL, afterPrint, STATUS_LABEL, type Status, type WorkOrder } from '../lib/types';
import { isReviewerRole, useSession } from '../lib/sessionContext';

const today = () => new Date().toISOString().slice(0, 10);

// The stages the team moves by hand. The rest — Waiting and Printed — still
// come from attaching the Drive link and the operator's check-off, so the
// safeguards hold and they are not offered here.
const MANUAL: { key: 'todo' | 'in_progress' | 'finished'; cls: Status }[] = [
  { key: 'todo', cls: 'todo' },
  { key: 'in_progress', cls: 'in_progress' },
  { key: 'finished', cls: 'finished' },
];

type PickKey = 'todo' | 'in_progress' | 'finished';

/**
 * Advances a job through the manual part of the flow. On the board it is the
 * status dot, clickable; on the ticket (`full`) it is the status pill. When a
 * job has reached Waiting or Printed it is shown read-only, because those come
 * from the link and the operator.
 */
export default function StageSelect({
  order,
  editable,
  full = false,
}: {
  order: WorkOrder;
  editable: boolean;
  full?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const manual =
    editable &&
    (order.status === 'todo' || order.status === 'in_progress' || order.status === 'finished');

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
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
    if (r) setPos({ top: r.bottom + 6, left: r.left });
    setOpen(true);
  }

  // A job is finished once its print-ready file is attached — or by an admin or
  // reception without one (049; the operator works from the operator note).
  const { profile } = useSession();
  const reviewer = isReviewerRole(profile);
  const canFinish = !!order.file_link || reviewer;

  async function pick(key: PickKey) {
    setOpen(false);
    if (key === order.status) return;   // already in that stage — nothing to do
    if (key === 'finished' && !canFinish) return;
    setBusy(true);
    const patch =
      key === 'todo'
        ? { stage: 'todo', date_finished: null }
        : key === 'in_progress'
          ? { stage: 'in_progress', date_finished: null }
          : { stage: 'in_progress', date_finished: today() };
    await supabase.from('work_orders').update(patch).eq('id', order.id);
    setBusy(false);
  }

  // Read-only: either the viewer cannot edit, or the job has moved past the
  // manual stages into Waiting / Printed / Released.
  if (!manual) {
    const after = afterPrint(order);
    const cls = after === 'released' ? 'released' : after === 'ready' ? 'ready' : order.status;
    const label = after ? AFTER_PRINT_LABEL[after] : STATUS_LABEL[order.status];
    return full
      ? <span className={`pill ${cls}`}><i className="dot" />{label}</span>
      : <span className={`row-dot ${cls}`} />;
  }

  return (
    <span className={`stage-select ${full ? 'full' : ''}`} ref={ref}>
      <button
        ref={triggerRef}
        className={full ? 'stage-trigger-full' : 'stage-trigger'}
        disabled={busy}
        title="Change status"
        aria-label={`Status: ${STATUS_LABEL[order.status]}. Change status`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
      >
        {full ? (
          <span className={`pill ${order.status}`}>
            <i className="dot" />{STATUS_LABEL[order.status]}<span className="stage-caret" aria-hidden>▾</span>
          </span>
        ) : (
          <span className={`row-dot ${order.status}`} />
        )}
      </button>

      {open && pos && (
        <div className="stage-menu" style={{ top: pos.top, left: pos.left }} onClick={(e) => e.stopPropagation()}>
          {MANUAL.map((s) => {
            const disabled = s.key === 'finished' && !canFinish;
            return (
              <button
                key={s.key}
                className={order.status === s.cls ? 'on' : ''}
                disabled={disabled}
                title={disabled ? 'Attach the print-ready Drive link first' : undefined}
                onClick={() => pick(s.key)}
              >
                <span className={`row-dot ${s.cls}`} />
                {STATUS_LABEL[s.cls]}
              </button>
            );
          })}
          <div className="stage-menu-note">
            {canFinish
              ? <><strong>File Attached for Review</strong> sends it for review; the artist, an admin or reception sends it to print.
                  {!order.file_link && ' No file yet — add a note for the operator on the ticket.'}</>
              : <>Attach the print file in the ticket — that marks it <strong>File Attached for Review</strong>.</>}
          </div>
        </div>
      )}
    </span>
  );
}
