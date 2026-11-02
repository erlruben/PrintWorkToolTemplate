import { useEffect, useRef, useState } from 'react';
import { STAFF_STATUS_LABEL, type StaffStatus } from '../lib/types';
import { StatusIcon } from './StaffStatus';

interface Props {
  name: string;
  role: string;
  initials: string;
  /** Your staff status now, and its line ("Sick · until tomorrow"); null = Working. */
  status?: StaffStatus;
  away?: string | null;
  /** Opens the status picker. */
  onSetStatus?: () => void;
  /** Opens Help: the User Manual, Chat Support and What's new. */
  onHelp?: () => void;
  /** Opens the Trash Bin (deleted work orders). */
  onTrash?: () => void;
  onSignOut: () => void;
}

/**
 * The signed-in person: avatar and name, clicking opens the account menu.
 * Closes on an outside click or Escape.
 */
export default function UserMenu({ name, role, initials, status = 'working', away, onSetStatus, onHelp, onTrash, onSignOut }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={ref}>
      <button
        className="user-menu-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="sidebar-avatar" aria-hidden="true">
          {initials}
          {/* Your current status as a small icon on the avatar — on a phone only the avatar shows. */}
          <span className={`avatar-status-badge ${status}`}><StatusIcon status={status} size={11} /></span>
        </span>
        <span className="user-menu-text">
          <strong>{name}</strong>
          {/* Current status, always: "Working · Receptionist" or "Sick · until tomorrow · Fever". */}
          <span className="user-status-line" title={away ?? `${STAFF_STATUS_LABEL[status]} · ${role}`}>
            <StatusIcon status={status} size={12} /> - {away ?? `${STAFF_STATUS_LABEL[status]} · ${role}`}
          </span>
        </span>
      </button>

      {open && (
        <div className="user-menu-pop" role="menu">
          {onSetStatus && (
            <button role="menuitem" className="user-menu-status" onClick={() => { setOpen(false); onSetStatus(); }}>
              {away ? 'Change status' : 'Set status'} <span className="user-menu-sub">{away ?? STAFF_STATUS_LABEL[status]}</span>
            </button>
          )}
          {onHelp && (
            <button role="menuitem" onClick={() => { setOpen(false); onHelp(); }}>
              Help
            </button>
          )}
          {onTrash && (
            <button role="menuitem" onClick={() => { setOpen(false); onTrash(); }}>
              Trash Bin
            </button>
          )}
          <button role="menuitem" onClick={() => { setOpen(false); onSignOut(); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
