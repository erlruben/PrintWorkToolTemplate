import { useEffect, useRef, useState } from 'react';
import { cleanPerSheet, hasPerSheet, INSTALL_LABEL, itemExtras, itemsOf, itemsTotal, sheetsLabel, sheetsTotal } from '../lib/items';
import type { Item, ItemColumn } from '../lib/types';

/**
 * The Items cell on the Work Orders board (049): a short summary — the one item,
 * or "3 items · 502 pcs" — that shows the whole list on hover, and on a click or
 * tap (phones). The list floats above the table so the cell never grows.
 */
export default function ItemsPreview({ items, description, columns = [] }: { items?: Item[] | null; description?: string; columns?: ItemColumn[] }) {
  const list = itemsOf({ items });
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const up = r.bottom + 220 > window.innerHeight && r.top > 240;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 300)), top: up ? r.top - 6 : r.bottom + 6, up });
  };
  const close = () => { setPos(null); setPinned(false); };

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [pos]);

  if (!list.length) {
    // Older tasks have only a description.
    return <span className="items-cell-text" title={description || undefined}>{description?.trim() || '—'}</span>;
  }
  const total = itemsTotal(list);
  // Several to a sheet: the sheets to print as well (2026-10-27).
  const sheets = hasPerSheet(list) ? sheetsTotal(list) : null;
  const sheetsNote = sheets != null ? ` · ${sheetsLabel(sheets)}` : '';
  const summary = list.length === 1
    ? `${list[0].name}${list[0].qty != null ? ` ×${list[0].qty}` : ''}${sheetsNote}`
    : `${list.length} items${total != null ? ` · ${total} pcs` : ''}${sheetsNote}`;

  return (
    <span
      ref={ref}
      className="items-cell"
      role="button"
      tabIndex={0}
      aria-label={`${summary}. Show the item list`}
      aria-expanded={!!pos}
      onMouseEnter={() => { if (!pinned) place(); }}
      onMouseLeave={() => { if (!pinned) setPos(null); }}
      onClick={(e) => { e.stopPropagation(); if (pinned) close(); else { place(); setPinned(true); } }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (pos) close(); else { place(); setPinned(true); } } }}
    >
      <span className="items-cell-text">{summary}</span>
      {pos && (
        <span
          className={`items-pop ${pos.up ? 'up' : ''}`}
          style={{ left: pos.left, top: pos.top }}
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="items-pop-head">{list.length} {list.length === 1 ? 'item' : 'items'}{total != null ? ` · ${total} pcs` : ''}{sheetsNote}</span>
          {list.map((it, i) => (
            <span className="items-pop-row" key={i}>
              <span className="items-pop-name">{it.name}</span>
              <span className="items-pop-qty">{it.qty != null ? `×${it.qty}` : ''}{cleanPerSheet(it.per_sheet) ? ` · ${it.per_sheet}/sheet` : ''}</span>
              {it.install && <span className="items-pop-install">{INSTALL_LABEL.yes}</span>}
              {itemExtras(it, columns).map(([label, value]) => (
                <span className="item-extras" key={label}>{label}: {value}</span>
              ))}
            </span>
          ))}
          {description?.trim() && <span className="items-pop-desc">{description}</span>}
        </span>
      )}
    </span>
  );
}
