import type { WorkOrder } from './types';

export function summarizePrintDashboard(orders: WorkOrder[], now = new Date()) {
  const waiting = orders
    .filter((order) => order.status === 'awaiting_print')
    .sort(
      (a, b) =>
        Number(b.priority) - Number(a.priority) ||
        (a.date_due ?? '9999').localeCompare(b.date_due ?? '9999') ||
        (a.queued_at ?? '').localeCompare(b.queued_at ?? ''),
    );
  const printedToday = orders
    .filter((order) =>
      order.status === 'printed' &&
      !order.archived_at &&
      !order.released_at &&
      !!order.printed_at &&
      new Date(order.printed_at).toDateString() === now.toDateString(),
    )
    .sort((a, b) => (b.printed_at ?? '').localeCompare(a.printed_at ?? ''));

  return {
    waiting,
    printingNow: waiting.filter((order) => order.print_state === 'printing').length,
    printedToday,
  };
}
