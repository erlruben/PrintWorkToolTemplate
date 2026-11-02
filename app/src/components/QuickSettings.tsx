import { useEffect, useRef, useState } from 'react';
import { useTheme, type ThemeChoice } from '../lib/theme';
import { IconMonitor, IconMoon, IconSettings, IconSun } from './Icons';

const choices: { value: ThemeChoice; label: string; icon: typeof IconSun }[] = [
  { value: 'light', label: 'Light', icon: IconSun },
  { value: 'dark', label: 'Dark', icon: IconMoon },
  { value: 'system', label: 'System', icon: IconMonitor },
];

export default function QuickSettings({
  active,
  onOpenSettings,
}: {
  active: boolean;
  onOpenSettings: () => void;
}) {
  const { choice, setChoice } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="quick-settings" ref={ref}>
      <button
        type="button"
        className={`quick-settings-trigger${active ? ' on-settings' : ''}`}
        aria-label="Settings and appearance"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Settings and appearance"
        onClick={() => setOpen((value) => !value)}
      >
        <IconSettings />
      </button>
      {open && (
        <div className="quick-settings-pop" role="dialog" aria-label="Appearance and settings">
          <strong className="quick-settings-title">Appearance</strong>
          <div className="quick-settings-options" role="radiogroup" aria-label="Color theme">
            {choices.map(({ value, label, icon: Icon }) => (
              <button
                type="button"
                role="radio"
                aria-checked={choice === value}
                className={`quick-settings-option${choice === value ? ' selected' : ''}`}
                key={value}
                onClick={() => setChoice(value)}
              >
                <Icon />
                <span>{label}</span>
                {choice === value && <span className="quick-settings-check" aria-hidden="true">Selected</span>}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="quick-settings-full"
            onClick={() => { setOpen(false); onOpenSettings(); }}
          >
            Open Settings
          </button>
        </div>
      )}
    </div>
  );
}
