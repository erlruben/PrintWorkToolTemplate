import type { MouseEvent as ReactMouseEvent } from 'react';

// Press-and-drag to pan a wide table sideways with a mouse — put it on the
// `.table-scroll` wrapper's onMouseDown. Touch already pans natively with a
// swipe. A drag past a small threshold pans and swallows the click, so it never
// opens a row or presses a button by accident; a plain click works as before.
// Starting on a dropdown, text box or a column-resize handle does not pan, so
// those keep working. Even when the table fits (nothing to scroll), a drag
// still never counts as a click.
// A row that can be dragged to another status (049) moves the task instead;
// the table still pans from its header or any spot that is not a task row.
const NO_PAN = 'select, input, textarea, option, [contenteditable="true"], .col-resize, [draggable="true"]';

export function startPan(e: ReactMouseEvent<HTMLElement>) {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest(NO_PAN)) return;
  const el = e.currentTarget;
  const startX = e.clientX;
  const startLeft = el.scrollLeft;
  let panned = false;
  const onMove = (ev: MouseEvent) => {
    const dx = ev.clientX - startX;
    if (!panned && Math.abs(dx) < 5) return;
    panned = true;
    el.classList.add('panning');
    el.scrollLeft = startLeft - dx;
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    el.classList.remove('panning');
    if (panned) {
      // Cancel the click that a drag would otherwise fire (open a row / sort / press).
      const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
      el.addEventListener('click', swallow, { capture: true });
      setTimeout(() => el.removeEventListener('click', swallow, true), 0);
    }
  };
  // If the browser starts a drag after all, stop panning and leave clicks alone.
  const onDragStart = () => { panned = false; onUp(); };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('dragstart', onDragStart, { once: true });
  const cleanup = () => window.removeEventListener('dragstart', onDragStart);
  window.addEventListener('mouseup', cleanup, { once: true });
}
