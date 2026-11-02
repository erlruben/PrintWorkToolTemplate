/**
 * A one-page receipt of a work order — a frozen snapshot of the job for the
 * records ("a copy of the task for future uses"). Built from the ticket data, so
 * it always matches what the tracker holds at the moment it is made.
 *
 * The same builder feeds two things: the "Download receipt" button on the ticket
 * now, and the automatic copy dropped into the job's Drive folder later.
 */
import { SITE_LABEL, STATUS_LABEL, URGENCY_LABEL, fmtDate, type WorkOrder } from './types';
import { hasPerSheet, itemsOf, sheetsTotal } from './items';
import { jobFiles } from './links';

export interface ReceiptNames {
  artist: string;
  printedBy: string;
}

/** One comment on the work order, for the chat-history section of the receipt. */
export interface ReceiptComment {
  author: string;
  body: string;
  at: string; // ISO timestamp
}

/** Build the receipt as a PDF blob plus a sensible file name. */
export async function buildReceipt(
  order: WorkOrder,
  names: ReceiptNames,
  chat: ReceiptComment[] = [],
): Promise<{ blob: Blob; filename: string }> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a5' });   // ~420 x 595 pt
  const M = 36;
  const W = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 46;

  // Start a fresh page when the next block wouldn't fit (the chat can run long).
  const newPageIfNeeded = (need: number) => {
    if (y + need > pageH - 40) { doc.addPage(); y = 46; }
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(20, 22, 26);
  doc.text('Work Order Receipt', M, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text('Your organization', M, y + 15);

  // The work order number, large and to the right.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(20, 22, 26);
  doc.text(order.wo_number, W - M, y, { align: 'right' });
  y += 34;

  doc.setDrawColor(226, 229, 234);
  doc.line(M, y, W - M, y);
  y += 16;

  // Pieces ordered; when items fit several to a sheet, the sheets too — and the
  // printed count is in sheets, like the print queue's (2026-10-27).
  const its = itemsOf(order);
  const sheets = hasPerSheet(its) ? sheetsTotal(its) : null;
  const target = sheets ?? order.qty;
  const unit = sheets != null ? 'sheets' : 'pcs';
  const qtyLine =
    order.qty == null
      ? '—'
      : `${order.qty} pcs${sheets != null ? ` on ${sheets} sheets` : ''}` +
        (target != null && order.printed_qty > 0 && order.printed_qty < target
          ? ` (${order.printed_qty} ${unit} printed, ${target - order.printed_qty} left)` : '');

  const rows: [string, string][] = [
    ['Status', STATUS_LABEL[order.status]],
    ['Artist', names.artist],
    ['Material', order.material || '—'],
    ['Laminating', order.laminating || '—'],
    ['Quantity', qtyLine],
    ['Priority', order.urgency ? URGENCY_LABEL[order.urgency] : '—'],
    ['Printing area', order.target_site ? SITE_LABEL[order.target_site] : 'Either'],
    ['Date given', fmtDate(order.date_given)],
    ['Date due', fmtDate(order.date_due)],
    ['Date finished', fmtDate(order.date_finished)],
    ['Printed', order.printed_at ? `${fmtDate(order.printed_at)} by ${names.printedBy}` : '—'],
  ];

  doc.setFontSize(9.5);
  for (const [label, value] of rows) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(107, 114, 128);
    doc.text(label, M, y);
    doc.setTextColor(20, 22, 26);
    const lines = doc.splitTextToSize(value, W - M - 150) as string[];
    doc.text(lines, 150, y);
    y += 14 * lines.length + 4;
  }

  // Description and notes get their own wrapped blocks.
  for (const [label, value] of [
    ['Description', order.description],
    ['Client notes', order.notes || ''],
  ] as [string, string][]) {
    if (!value.trim()) continue;
    y += 6;
    doc.setTextColor(107, 114, 128);
    doc.text(label, M, y);
    y += 14;
    doc.setTextColor(20, 22, 26);
    const lines = doc.splitTextToSize(value, W - 2 * M) as string[];
    doc.text(lines, M, y);
    y += 14 * lines.length;
  }

  const files = jobFiles(order);
  if (files.length) {
    y += 10;
    doc.setTextColor(107, 114, 128);
    doc.text(files.length > 1 ? `Files (${files.length})` : 'File', M, y);
    doc.setTextColor(37, 99, 235);
    for (const f of files) {
      const label = [f.folder, f.name].filter(Boolean).join(' / ');   // the folder it was uploaded in, then the file
      const lines = doc.splitTextToSize(label ? `${label} — ${f.url}` : f.url, W - M - 150) as string[];
      newPageIfNeeded(14 * lines.length);
      doc.text(lines, 150, y);
      y += 14 * lines.length;
    }
  }

  // Chat history — the work order's comment thread, oldest first.
  if (chat.length) {
    newPageIfNeeded(50);
    y += 12;
    doc.setDrawColor(226, 229, 234);
    doc.line(M, y, W - M, y);
    y += 16;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(20, 22, 26);
    doc.text(`Chat history (${chat.length})`, M, y);
    y += 16;

    doc.setFontSize(9);
    for (const c of chat) {
      const head = `${c.author} · ${new Date(c.at).toLocaleString('en-PH')}`;
      const bodyLines = doc.splitTextToSize(c.body.trim() || '—', W - 2 * M) as string[];
      newPageIfNeeded(13 + 12 * bodyLines.length + 8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(107, 114, 128);
      doc.text(head, M, y);
      y += 13;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(20, 22, 26);
      doc.text(bodyLines, M, y);
      y += 12 * bodyLines.length + 8;
    }
  }

  doc.setFontSize(8);
  doc.setTextColor(154, 161, 172);
  doc.text(
    `Generated ${new Date().toLocaleString('en-PH')}`,
    M,
    pageH - 24,
  );

  return { blob: doc.output('blob'), filename: `${order.wo_number} receipt.pdf` };
}

/** Build and save the receipt straight to the browser's downloads. */
export async function downloadReceipt(order: WorkOrder, names: ReceiptNames): Promise<void> {
  const { blob, filename } = await buildReceipt(order, names);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
