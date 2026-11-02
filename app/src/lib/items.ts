import type { Item, ItemColumn, WorkOrder } from './types';

/** The filled-in extra values of an item (blank ones dropped), or nothing. */
function cleanExtra(extra: Item['extra']): Record<string, string> | undefined {
  if (!extra || typeof extra !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(extra)) if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  return Object.keys(out).length ? out : undefined;
}

/** "Per sheet" kept only as a whole number of 2 or more (1 or blank = one per sheet). */
export function cleanPerSheet(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 2 ? Math.min(Math.floor(n), 10000) : null;
}

/** A job's item lines, cleaned (rows with no name are dropped). */
export function itemsOf(o: { items?: Item[] | null }): Item[] {
  return (Array.isArray(o.items) ? o.items : [])
    .filter((i) => i && typeof i.name === 'string' && i.name.trim())
    .map((i) => {
      const extra = cleanExtra(i.extra);
      const per = cleanPerSheet(i.per_sheet);
      return { name: i.name.trim(), qty: typeof i.qty === 'number' && Number.isFinite(i.qty) ? i.qty : null,
        ...(i.install ? { install: true } : {}), ...(per ? { per_sheet: per } : {}), ...(extra ? { extra } : {}) };
    });
}

// ---- A task's own extra columns (2026-10-10) ---------------------------------
export const MAX_ITEM_COLUMNS = 6;
export const MAX_COLUMN_LABEL = 30;

/** A task's extra columns, cleaned: a key and a name each, no repeats. */
export function columnsOf(o: { item_columns?: ItemColumn[] | null }): ItemColumn[] {
  const seen = new Set<string>();
  return (Array.isArray(o.item_columns) ? o.item_columns : [])
    .filter((c) => c && typeof c.key === 'string' && c.key && !seen.has(c.key) && seen.add(c.key))
    .map((c) => ({ key: c.key, label: (typeof c.label === 'string' ? c.label : '').trim().slice(0, MAX_COLUMN_LABEL) || 'Column' }))
    .slice(0, MAX_ITEM_COLUMNS);
}
/** A key no column of this task uses yet. */
export function newColumnKey(columns: ItemColumn[]): string {
  for (let n = columns.length + 1; ; n++) if (!columns.some((c) => c.key === `c${n}`)) return `c${n}`;
}
/** An item's extra values in column order: [["Branch", "JB Ecowest"], …] (blank ones left out). */
export function itemExtras(item: Item, columns: ItemColumn[]): [string, string][] {
  return columns.map((c) => [c.label, (item.extra?.[c.key] ?? '').trim()] as [string, string]).filter(([, v]) => v);
}

// ---- Reading items out of a typed Job Description (2026-10-10) ----------------
// How the team types them (seen in the live tasks):
//   "Photographic Sticker on Sintra Board 3mm - A4 Size = 9pcs Back to back"   → qty at "= 9pcs"
//   "12 x 21ft Black-out tarpaulin printing - 1PC"                              → qty at "- 1PC"
//   "     - JB Ecowest"   (indented, under an item)                            → that item's detail
//   "1 Box Gaudia"                                                              → qty first
const UNIT = '(?:pcs?|pieces?|sets?|box(?:es)?|units?|sheets?|copies|copy|rolls?|reams?|pads?|books?|booklets?|packs?)';
const QTY_TAIL = new RegExp(`\\s*[=\\-\\u2013\\u2014:]\\s*(\\d[\\d,]*)\\s*${UNIT}\\b\\.?`, 'i');
const QTY_HEAD = new RegExp(`^(\\d[\\d,]*)\\s*(${UNIT})\\b\\.?\\s+(\\S.*)$`, 'i');
const PER_SHEET = /\s*[-\u2013\u2014,;(]?\s*(?:(\d+)\s*(?:pcs?\s*)?(?:per|\/|a|each)\s*sheet|(\d+)\s*-?\s*up)\b\s*\)?/i;
const DETAIL = /^\s+[-\u2013\u2014\u2022*]\s*(\S.*)$/;       // indented "- text"
const BULLET = /^[-\u2013\u2014\u2022*]\s+/;                  // a list mark at the start of a line
export const DETAILS_KEY = 'details';

export interface ParsedItems {
  items: Item[];
  /** How many lines carried a quantity ("= 9pcs") — the sign that this is a list of items. */
  qtyLines: number;
  /** Some item has a detail line under it. */
  hasDetails: boolean;
}

/** Each line of the text as an item: its quantity pulled out, an indented "- …" line as its detail. */
export function parseItemsFromText(text: string | null | undefined): ParsedItems {
  const items: Item[] = [];
  let qtyLines = 0, hasDetails = false;
  for (const raw of String(text ?? '').replace(/\r/g, '').split('\n')) {
    if (!raw.trim()) continue;
    const detail = raw.match(DETAIL);
    if (detail && items.length) {
      const last = items[items.length - 1];
      const had = last.extra?.[DETAILS_KEY];
      last.extra = { ...(last.extra ?? {}), [DETAILS_KEY]: had ? `${had}; ${detail[1].trim()}` : detail[1].trim() };
      hasDetails = true;
      continue;
    }
    const line = raw.trim().replace(BULLET, '').replace(/\s+/g, ' ');
    let name = line, qty: number | null = null;
    const head = line.match(QTY_HEAD);
    const tail = line.match(QTY_TAIL);
    if (head) {
      qty = Number(head[1].replace(/,/g, ''));
      // "1 Box Gaudia" keeps its unit ("Box Gaudia"); "3 pcs Sticker" does not.
      name = /^p/i.test(head[2]) ? head[3].trim() : `${head[2]} ${head[3].trim()}`;
    } else if (tail && tail.index != null) {
      qty = Number(tail[1].replace(/,/g, ''));
      const before = line.slice(0, tail.index).trim();
      const after = line.slice(tail.index + tail[0].length).trim();
      name = [before, after].filter(Boolean).join(' - ') || line;
    }
    if (qty != null && (!Number.isFinite(qty) || qty < 0)) qty = null;
    if (qty != null) qtyLines += 1;
    // "12 per sheet", "12/sheet", "12-up": how many fit on one printed sheet.
    const per = name.match(PER_SHEET);
    const perSheet = per ? cleanPerSheet(Number(per[1] ?? per[2])) : null;
    if (per && per.index != null) name = (name.slice(0, per.index) + name.slice(per.index + per[0].length)).replace(/\s*[-\u2013\u2014,;]\s*$/, '').replace(/\s{2,}/g, ' ').trim() || name;
    if (name) items.push({ name, qty, ...(perSheet ? { per_sheet: perSheet } : {}) });
  }
  return { items, qtyLines, hasDetails };
}

/** Is this description really a typed list of items worth moving into the table? (2+ lines with a quantity) */
export const looksLikeItemList = (text: string | null | undefined) => parseItemsFromText(text).qtyLines >= 2;

export const INSTALL_LABEL = { yes: 'With Installation', no: 'Without Installation' } as const;
/** How many lines need installation. */
export const installCount = (items: Item[]) => items.filter((i) => i.install).length;

/** "Tarpaulin 3x6 ×2 · Icon sticker ×120 (10 sheets)" */
export const itemsSummary = (items: Item[]) =>
  items.map((i) => (i.qty != null ? `${i.name} ×${i.qty}${i.per_sheet && i.per_sheet > 1 ? ` (${sheetsLabel(sheetsOf(i))})` : ''}` : i.name)).join(' · ');

/** The total quantity, or null when no line has one. */
export function itemsTotal(items: Item[]): number | null {
  const qs = items.map((i) => i.qty).filter((q): q is number => q != null);
  return qs.length ? qs.reduce((a, b) => a + b, 0) : null;
}

/**
 * Sheets to print for one line (2026-10-27): 120 icons at 12 per sheet = 10
 * sheets; with no "per sheet" each piece is its own sheet. Null without a qty.
 * The Print Queue counts these, and so does the database when a job is done.
 */
export function sheetsOf(i: Pick<Item, 'qty' | 'per_sheet'>): number | null {
  if (i.qty == null) return null;
  const per = cleanPerSheet(i.per_sheet);
  return per ? Math.ceil(i.qty / per) : i.qty;
}
/** Sheets to print for the whole job, or null when no line has a qty. */
export function sheetsTotal(items: Item[]): number | null {
  const qs = items.map(sheetsOf).filter((q): q is number => q != null);
  return qs.length ? qs.reduce((a, b) => a + b, 0) : null;
}
/** Does any line fit several to a sheet (so sheets differ from pieces)? */
export const hasPerSheet = (items: Item[]) => items.some((i) => cleanPerSheet(i.per_sheet));
export const sheetsLabel = (n: number | null) => (n == null ? '—' : `${n} ${n === 1 ? 'sheet' : 'sheets'}`);

/** What to call a job in lists: its items, or else its description. */
export function jobTitle(o: Pick<WorkOrder, 'description'> & { items?: Item[] | null }): string {
  const items = itemsOf(o);
  return items.length ? itemsSummary(items) : o.description;
}

/** Everything typed in a task's extra columns, lower-cased — so search still finds "JB Ecowest". */
export function itemExtrasText(o: { items?: Item[] | null }): string {
  return itemsOf(o).flatMap((i) => Object.values(i.extra ?? {})).join(' ').toLowerCase();
}

/** What a task's Items table becomes when its typed description is moved into it. */
export function moveDescriptionToItems(description: string, items: Item[], columns: ItemColumn[]): {
  items: Item[]; columns: ItemColumn[]; description: string; moved: number;
} {
  const parsed = parseItemsFromText(description);
  // A detail line needs its column: "Details", unless the task has it already.
  const cols = parsed.hasDetails && !columns.some((c) => c.key === DETAILS_KEY) && columns.length < MAX_ITEM_COLUMNS
    ? [...columns, { key: DETAILS_KEY, label: 'Details' }]
    : columns;
  const keep = items.filter((i) => i.name.trim());
  return { items: [...keep, ...parsed.items], columns: cols, description: '', moved: parsed.items.length };
}
