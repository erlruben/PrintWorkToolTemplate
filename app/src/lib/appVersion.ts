/**
 * "A new version is ready" (2026-10-13). Every release gives the app's main
 * script a new name (index-<hash>.js). The page that is open knows the name it
 * was loaded with; a quiet look at the site's front page tells whether a newer
 * one has been released since. When it has, the person is asked to refresh —
 * no sound, and nothing is refreshed by itself.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const clock = () => Date.now();

const NAME = /assets\/(index-[A-Za-z0-9_-]+\.js)/;
/** How often to look, while the app stays open. */
const CHECK_MS = 5 * 60_000;
/** Not more often than this, however many times the tab is brought to the front. */
const MIN_GAP_MS = 60_000;
/** A dismissed prompt comes back after this long if the app is still not refreshed. */
const REMIND_MS = 60 * 60_000;

/** The build this page is running (null on the development server, which has no named build). */
export function currentBuild(doc: Document = document): string | null {
  for (const s of Array.from(doc.scripts)) {
    const m = (s.getAttribute('src') ?? '').match(NAME);
    if (m) return m[1];
  }
  return null;
}
/** The build the site serves right now (null when it cannot be read — offline, or an odd answer). */
export async function latestBuild(): Promise<string | null> {
  try {
    const res = await fetch(`/?v=${Date.now()}`, { cache: 'no-store', headers: { accept: 'text/html' } });
    if (!res.ok) return null;
    return (await res.text()).match(NAME)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Is a newer version out than the one this page runs? `dismiss` puts the
 * prompt away (it returns after an hour, or at once for a still newer release);
 * `refresh` reloads the page.
 */
export function useUpdateReady() {
  const [mine] = useState(() => currentBuild());
  const [latest, setLatest] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<{ build: string; at: number } | null>(null);
  const [now, setNow] = useState(clock);                 // moved on by each look and once a minute
  const lastCheck = useRef(0);

  const check = useCallback(async () => {
    if (!mine || document.visibilityState !== 'visible') return;
    if (clock() - lastCheck.current < MIN_GAP_MS) return;
    lastCheck.current = clock();
    const found = await latestBuild();
    if (found) setLatest(found);
    setNow(clock());
  }, [mine]);

  useEffect(() => {
    if (!mine) return;
    const first = window.setTimeout(check, 20_000);        // not in the middle of loading
    const every = window.setInterval(check, CHECK_MS);
    const remind = window.setInterval(() => setNow(clock()), 60_000);   // so a dismissed prompt can return
    const onShow = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    window.addEventListener('online', onShow);
    return () => {
      window.clearTimeout(first); window.clearInterval(every); window.clearInterval(remind);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onShow);
      window.removeEventListener('online', onShow);
    };
  }, [check, mine]);

  const newer = !!mine && !!latest && latest !== mine;
  const hidden = !!dismissed && dismissed.build === latest && now - dismissed.at < REMIND_MS;
  return {
    ready: newer && !hidden,
    dismiss: () => { if (latest) { setDismissed({ build: latest, at: clock() }); setNow(clock()); } },
    refresh: () => window.location.reload(),
  };
}
