import { describe, expect, it } from 'vitest';
import { summarizePrintDashboard } from '../../src/lib/printDashboard';
import type { WorkOrder } from '../../src/lib/types';

const order = (overrides: Partial<WorkOrder>): WorkOrder => ({
  id: 'id',
  wo_number: 'WO-1',
  job_order_number: null,
  artist_id: null,
  description: 'Print job',
  material: null,
  laminating: null,
  urgency: null,
  qty: null,
  printed_qty: 0,
  priority: false,
  notes: null,
  date_given: '2026-10-27',
  date_due: null,
  date_finished: null,
  preview_path: null,
  file_link: null,
  target_site: null,
  queued_at: null,
  operator_id: null,
  print_eta: null,
  print_pause_left: null,
  ready_at: null,
  printed_at: null,
  printed_by: null,
  printed_site: null,
  printed_file_link: null,
  reprint_count: 0,
  ready_for_pickup_at: null,
  archived_at: null,
  stage: 'todo',
  print_state: null,
  created_by: null,
  created_at: '2026-10-27T08:00:00.000Z',
  updated_at: '2026-10-27T08:00:00.000Z',
  status: 'todo',
  days_to_finish: null,
  ...overrides,
});

describe('print dashboard summary', () => {
  it('counts both printing areas and excludes released, archived, and older prints', () => {
    const now = new Date(2026, 9, 27, 12);
    const today = new Date(2026, 9, 27, 9).toISOString();
    const yesterday = new Date(2026, 9, 26, 9).toISOString();
    const jobs = [
      order({ id: 'office', wo_number: 'WO-O', status: 'awaiting_print', target_site: 'office', date_due: '2026-10-29' }),
      order({ id: 'production', wo_number: 'WO-P', status: 'awaiting_print', target_site: 'production', date_due: '2026-10-30', priority: true, print_state: 'printing' }),
      order({ id: 'today', status: 'printed', printed_at: today }),
      order({ id: 'archived', status: 'printed', printed_at: today, archived_at: today }),
      order({ id: 'released', status: 'printed', printed_at: today, released_at: today }),
      order({ id: 'yesterday', status: 'printed', printed_at: yesterday }),
    ];

    const summary = summarizePrintDashboard(jobs, now);

    expect(summary.waiting.map((job) => job.id)).toEqual(['production', 'office']);
    expect(summary.waiting.map((job) => job.target_site)).toEqual(['production', 'office']);
    expect(summary.printingNow).toBe(1);
    expect(summary.printedToday.map((job) => job.id)).toEqual(['today']);
  });
});
