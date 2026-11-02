import { parseItemsFromText } from '../lib/items';

/**
 * Under the Job description box (2026-10-10): when what is typed there is
 * really a list of items — two or more lines with a quantity, the way the team
 * writes them ("… = 9pcs", "… - 1PC") — offer to move it into the Items table
 * in one tap. Nothing moves by itself, and the move can be undone.
 */
export default function ItemsFromDescription({ description, onMove, undo }: {
  description: string;
  onMove: () => void;
  /** Set right after a move: how many items went, and how to put it back. */
  undo?: { moved: number; onUndo: () => void } | null;
}) {
  if (undo) {
    return (
      <div className="items-hint" role="status">
        <span className="items-hint-text">
          Moved <strong>{undo.moved} {undo.moved === 1 ? 'item' : 'items'}</strong> to the Items table — check them above.
        </span>
        <button type="button" className="btn ghost sm" onClick={undo.onUndo}>Undo</button>
      </div>
    );
  }
  const parsed = parseItemsFromText(description);
  if (parsed.qtyLines < 2) return null;
  return (
    <div className="items-hint" role="status">
      <span className="items-hint-text">
        Found <strong>{parsed.items.length} items</strong> in the description
        {parsed.hasDetails ? ' (with their details)' : ''}.
      </span>
      <button type="button" className="btn sm" onClick={onMove}>Move to Items table</button>
    </div>
  );
}
