/** Stroke icons for the sidebar, 18px grid, one weight. */
const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const IconList = () => (
  <svg {...base}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconChart = () => (
  <svg {...base}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);

export const IconMonitor = () => (
  <svg {...base}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);

export const IconMessage = () => (
  <svg {...base}>
    <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 8 8 0 0 1-3.5-.8L4 20l1.5-4A7.5 7.5 0 1 1 20 11.5Z" />
    <path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" />
  </svg>
);

export const IconInventory = () => (
  <svg {...base}>
    <path d="M3 7.5 12 3l9 4.5-9 4.5-9-4.5Z" />
    <path d="M3 7.5v9L12 21l9-4.5v-9M12 12v9" />
    <path d="m7.5 5.25 9 4.5" />
  </svg>
);

export const IconUsers = () => (
  <svg {...base}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4.5-6.2" />
  </svg>
);

export const IconAward = () => (
  <svg {...base}>
    <circle cx="12" cy="8" r="5.5" />
    <path d="M8.2 12.8 6 21l6-3 6 3-2.2-8.2" />
  </svg>
);

export const IconSettings = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

export const IconMegaphone = () => (
  <svg {...base}>
    <path d="M3 10v4a2 2 0 0 0 2 2h2l10 4V4L7 8H5a2 2 0 0 0-2 2Z" />
    <path d="m7 16 2 5h3l-2-4" />
    <path d="M20 9a4 4 0 0 1 0 6" />
  </svg>
);

export const IconChevron = ({ open }: { open: boolean }) => (
  <svg {...base} width={14} height={14} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const IconSide = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg {...base} width={20} height={20} strokeWidth={2.2}>
    <path d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
  </svg>
);

export const IconPlus = () => (
  <svg {...base} width={16} height={16}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconSearch = () => (
  <svg {...base} width={16} height={16}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);

/** Show / hide a password: an open eye, or the eye struck through. */
export const IconEye = ({ off }: { off?: boolean }) => (
  <svg {...base}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="M3 3l18 18" />}
  </svg>
);

// A filled bell, distinct from the outline sidebar icons.
export const IconBell = () => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2.2a1.15 1.15 0 0 1 1.15 1.15v.72a6 6 0 0 1 4.85 5.88v2.98l1.45 2.73a1 1 0 0 1-.88 1.47H5.38a1 1 0 0 1-.88-1.47L5.95 12.9V9.95A6 6 0 0 1 10.85 4.09v-.72A1.15 1.15 0 0 1 12 2.2Z" />
    <path d="M9.4 19.4a2.6 2.6 0 0 0 5.2 0Z" />
  </svg>
);

export const IconSun = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const IconMoon = () => (
  <svg {...base}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);
