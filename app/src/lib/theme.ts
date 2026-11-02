// Light/dark theme, per device. The choice is applied to <html data-theme>
// (an inline script in index.html sets it before first paint to avoid a flash)
// and remembered in localStorage. With nothing saved ("System"), the device's
// own light/dark setting is followed — live, if it changes while open.

import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
/** What the person picked: a fixed look, or follow the device. */
export type ThemeChoice = Theme | 'system';
const KEY = 'printflow-theme';
const EVENT = 'printflow-theme';
const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);

export function getChoice(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'dark' || t === 'light') return t;
  } catch { /* storage blocked */ }
  return 'system';
}

const systemTheme = (): Theme => (media()?.matches ? 'dark' : 'light');

export function getTheme(): Theme {
  const c = getChoice();
  return c === 'system' ? systemTheme() : c;
}

// The browser bar / installed-app title bar follows the theme too.
function paint(t: Theme) {
  document.documentElement.setAttribute('data-theme', t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#151c18' : '#f5f2eb');
}

export function applyChoice(c: ThemeChoice) {
  try {
    if (c === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, c);
  } catch { /* ignore */ }
  paint(c === 'system' ? systemTheme() : c);
  window.dispatchEvent(new Event(EVENT));
}

/** Kept for callers that set a fixed look. */
export const applyTheme = (t: Theme) => applyChoice(t);

// On load: the inline script already set data-theme; match the browser bar to it.
if (typeof document !== 'undefined') paint(getTheme());

// Following the device: repaint when its setting flips while the app is open.
media()?.addEventListener?.('change', () => {
  if (getChoice() === 'system') { paint(systemTheme()); window.dispatchEvent(new Event(EVENT)); }
});

export function useTheme() {
  const [state, setState] = useState(() => ({ theme: getTheme(), choice: getChoice() }));
  // The quick appearance menu, full Settings and device preference stay in step.
  useEffect(() => {
    const sync = () => setState({ theme: getTheme(), choice: getChoice() });
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const setChoice = (c: ThemeChoice) => applyChoice(c);
  return {
    theme: state.theme,
    choice: state.choice,
    setChoice,
    setTheme: (t: Theme) => setChoice(t),
    toggle: () => setChoice(state.theme === 'dark' ? 'light' : 'dark'),
  };
}
