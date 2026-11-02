import { useEffect, useRef, useState } from 'react';
import type { Item, ItemColumn } from '../lib/types';
import { cleanPerSheet, hasPerSheet, INSTALL_LABEL, itemsTotal, MAX_COLUMN_LABEL, MAX_ITEM_COLUMNS, newColumnKey, sheetsLabel, sheetsTotal } from '../lib/items';

/**
 * What the job is, line by line: an item, how many of it, and whether it comes
 * with installation (049). Rows can be added and removed; the total quantity
 * is the sum. Blank rows are ignored on save.
 *
 * A task can also have its own extra columns (2026-10-10) — "Branch", "Size",
 * whatever the job needs: added with "+ Add column", renamed by typing in the
 * column's heading, removed with its ×. Item, Qty and Installation always stay.
 */
export default function ItemsEditor({ items, onChange, disabled, columns = [], onColumnsChange }: {
  items: Item[];
  onChange: (items: Item[]) => void;
  disabled?: boolean;
  /** This task's extra columns. */
  columns?: ItemColumn[];
  /** Given: columns can be added, renamed and removed. */
  onColumnsChange?: (columns: ItemColumn[]) => void;
}) {
  const rows = items.length ? items : [{ name: '', qty: null }];
  const setRow = (k: number, patch: Partial<Item>) =>
    onChange(rows.map((r, i) => (i === k ? { ...r, ...patch } : r)));
  const named = rows.filter((r) => r.name.trim());
  const total = itemsTotal(named);
  // Several to a sheet ("12 icons per sheet"): the sheets to print, beside the pieces.
  const sheets = hasPerSheet(named) ? sheetsTotal(named) : null;
  const canCols = !disabled && !!onColumnsChange;

  // Mark every item With / Without Installation in one go — after asking, since
  // it overwrites what each row says.
  const markAll = (install: boolean) => {
    const label = install ? INSTALL_LABEL.yes : INSTALL_LABEL.no;
    if (!confirm(`Mark all ${rows.length} items as "${label}"?`)) return;
    onChange(rows.map((r) => ({ ...r, install })));
  };

  // ---- extra columns ----
  const [focusCol, setFocusCol] = useState<string | null>(null);   // a just-added column: its name is typed next
  const headRefs = useRef<Record<string, HTMLInputElement | null>>({});
  useEffect(() => {
    if (!focusCol) return;
    const el = headRefs.current[focusCol];
    if (el) { el.focus(); el.select(); }
  }, [focusCol]);
  const addColumn = () => {
    if (!onColumnsChange || columns.length >= MAX_ITEM_COLUMNS) return;
    const key = newColumnKey(columns);
    onColumnsChange([...columns, { key, label: 'New column' }]);
    setFocusCol(key);
  };
  const renameColumn = (key: string, label: string) =>
    onColumnsChange?.(columns.map((c) => (c.key === key ? { ...c, label: label.slice(0, MAX_COLUMN_LABEL) } : c)));
  const removeColumn = (c: ItemColumn) => {
    const filled = rows.filter((r) => (r.extra?.[c.key] ?? '').trim()).length;
    if (filled && !confirm(`Remove the "${c.label || 'Column'}" column?\n\nWhat is typed in it (${filled} ${filled === 1 ? 'item' : 'items'}) will be removed too.`)) return;
    onColumnsChange?.(columns.filter((x) => x.key !== c.key));
    if (filled) onChange(rows.map((r) => { if (!r.extra) return r; const rest = { ...r.extra }; delete rest[c.key]; return { ...r, extra: rest }; }));
  };
  const setExtra = (k: number, key: string, value: string) =>
    setRow(k, { extra: { ...(rows[k].extra ?? {}), [key]: value } });

  // With extra columns the table gets wider than a phone: it keeps one row per
  // item and scrolls sideways inside its box (the page itself never does).
  const wide = columns.length > 0;
  const grid = wide
    ? { gridTemplateColumns: `minmax(160px, 1.4fr) 64px 72px 165px ${columns.map(() => 'minmax(110px, 1fr)').join(' ')} 28px` }
    : undefined;
  const minWidth = wide ? 160 + 64 + 72 + 165 + columns.length * 110 + 28 + (columns.length + 4) * 6 : undefined;

  return (
    <div className={`items-ed${wide ? ' wide' : ''}`}>
      <div className="items-ed-scroll">
        <div style={minWidth ? { minWidth } : undefined}>
          <div className="items-ed-head" style={grid}>
            <span>Item</span>
            <span>Qty</span>
            <span title="How many fit on one printed sheet — e.g. 12 icons on one sheet. Leave blank for one per sheet.">Per sheet</span>
            <span>Installation</span>
            {columns.map((c) => (
              canCols ? (
                <span className="items-ed-colhead" key={c.key}>
                  <input
                    ref={(el) => { headRefs.current[c.key] = el; }}
                    type="text"
                    value={c.label}
                    maxLength={MAX_COLUMN_LABEL}
                    placeholder="Column name"
                    aria-label={`Name of column ${c.label || 'Column'}`}
                    onChange={(e) => renameColumn(c.key, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                    onBlur={() => { if (focusCol === c.key) setFocusCol(null); }}
                  />
                  <button type="button" className="items-ed-x" aria-label={`Remove column ${c.label || 'Column'}`} title="Remove this column"
                    onClick={() => removeColumn(c)}>×</button>
                </span>
              ) : <span key={c.key} title={c.label}>{c.label}</span>
            ))}
            <span aria-hidden />
          </div>
          {rows.map((r, k) => (
            <div className="items-ed-row" key={k} style={grid}>
              <input
                type="text"
                value={r.name}
                disabled={disabled}
                placeholder={k === 0 ? 'e.g. Tarpaulin 3x6 ft' : 'Item'}
                title={r.name || undefined}
                aria-label={`Item ${k + 1}`}
                onChange={(e) => setRow(k, { name: e.target.value })}
                onKeyDown={(e) => {
                  // Enter on the last row starts a new one.
                  if (e.key === 'Enter') { e.preventDefault(); if (k === rows.length - 1 && r.name.trim()) onChange([...rows, { name: '', qty: null }]); }
                }}
              />
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={r.qty ?? ''}
                disabled={disabled}
                placeholder="0"
                aria-label={`Quantity of item ${k + 1}`}
                onChange={(e) => setRow(k, { qty: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))) })}
              />
              <input
                type="number"
                min="1"
                inputMode="numeric"
                value={r.per_sheet ?? ''}
                disabled={disabled}
                placeholder="1"
                title="How many fit on one printed sheet (blank = one per sheet)"
                aria-label={`Per sheet of item ${k + 1}`}
                onChange={(e) => setRow(k, { per_sheet: e.target.value === '' ? null : cleanPerSheet(Number(e.target.value)) ?? (Number(e.target.value) >= 1 ? 1 : null) })}
              />
              <select
                value={r.install ? 'yes' : 'no'}
                disabled={disabled}
                aria-label={`Installation for item ${k + 1}`}
                onChange={(e) => setRow(k, { install: e.target.value === 'yes' })}
              >
                <option value="no">{INSTALL_LABEL.no}</option>
                <option value="yes">{INSTALL_LABEL.yes}</option>
              </select>
              {columns.map((c) => (
                <input
                  key={c.key}
                  type="text"
                  value={r.extra?.[c.key] ?? ''}
                  disabled={disabled}
                  maxLength={200}
                  aria-label={`${c.label || 'Column'} of item ${k + 1}`}
                  onChange={(e) => setExtra(k, c.key, e.target.value)}
                />
              ))}
              {!disabled && rows.length > 1 ? (
                <button type="button" className="items-ed-x" aria-label={`Remove item ${k + 1}`}
                  onClick={() => onChange(rows.filter((_, i) => i !== k))}>×</button>
              ) : <span aria-hidden />}
            </div>
          ))}
        </div>
      </div>
      <div className="items-ed-foot">
        {!disabled && (
          <button type="button" className="linkbtn items-ed-add" onClick={() => onChange([...rows, { name: '', qty: null }])}>+ Add item</button>
        )}
        {canCols && columns.length < MAX_ITEM_COLUMNS && (
          <button type="button" className="linkbtn items-ed-addcol" onClick={addColumn} title="Add your own column, e.g. Branch or Size">+ Add column</button>
        )}
        {!disabled && rows.length > 1 && (
          <select
            className="items-ed-markall"
            value=""
            aria-label="Mark all items With or Without Installation"
            onChange={(e) => { if (e.target.value) markAll(e.target.value === 'yes'); }}
          >
            <option value="">Mark all…</option>
            <option value="yes">{INSTALL_LABEL.yes}</option>
            <option value="no">{INSTALL_LABEL.no}</option>
          </select>
        )}
        {total != null && <span className="items-ed-total">Total: {total} pcs{sheets != null ? ` · ${sheetsLabel(sheets)}` : ''}</span>}
      </div>
    </div>
  );
}
