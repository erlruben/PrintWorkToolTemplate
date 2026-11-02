/**
 * The month's jobs as a spreadsheet file (2026-10-14), for the office to check
 * against invoices outside the tracker. It opens in Excel as it is: UTF-8 with
 * the mark Excel looks for (so ñ and — read right), commas, Windows line ends.
 */

/** One cell. A cell that starts like a formula (= + - @) is kept as text, so a
 *  customer name or job typed that way can never run as a formula in Excel. */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A whole sheet: the heading row, then one row per job. */
export function toCsv(head: string[], rows: unknown[][]): string {
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Hand the file to the person (it lands in Downloads). */
export function downloadCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
