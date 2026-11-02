import { useUpdateReady } from '../lib/appVersion';

/**
 * "A new version is ready — Refresh" (2026-10-13). Shown at the top of every
 * screen, in the same card as the print announcement, when a newer release is
 * out than the one this page runs. No sound. Tap the card to put it away, or
 * press Refresh. Nothing reloads by itself, so nobody loses what they are
 * typing; a dismissed prompt returns after an hour if the app is still old.
 */
export default function UpdatePrompt() {
  const { ready, dismiss, refresh } = useUpdateReady();
  if (!ready) return null;
  return (
    <div className="print-alarm-stack update-stack">
      <div className="print-alarm update-ready" role="status" onClick={dismiss} title="Tap to put this away">
        <span className="print-alarm-icon" aria-hidden>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
          </svg>
        </span>
        <span className="print-alarm-main">
          <strong>A new version of the tracker is ready</strong>
          <span>Refresh to get it. What you saved is kept. Tap here to do it later.</span>
        </span>
        <button className="btn sm" onClick={(e) => { e.stopPropagation(); refresh(); }}>Refresh</button>
      </div>
    </div>
  );
}
