// Fictional demo data for the offline UI tests. Nothing here is real: names,
// clients and jobs are made up, so screenshots are safe to share.
export const ago = (days: number, h: number = 9) => new Date(Date.now() - days * 86400000 + h * 3600000 - 9 * 3600000).toISOString();
export const day = (days: number) => ago(days).slice(0, 10);
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const ME = id(1);
export const PEOPLE = [
  { id: ME, full_name: 'Test Admin', role: 'admin', username: 'testadmin', site: null },
  { id: id(2), full_name: 'Rina Dela Cruz', role: 'receptionist', username: 'rina', site: null },
  { id: id(3), full_name: 'Paolo Santos', role: 'artist', username: 'paolo', site: null },
  { id: id(4), full_name: 'Mika Reyes', role: 'artist', username: 'mika', site: null, status: 'sick', status_until: ago(-1) },
  { id: id(5), full_name: 'Jun Navarro', role: 'operator', username: 'jun', site: 'production' },
  { id: id(6), full_name: 'Lea Bautista', role: 'operator', username: 'lea', site: 'office' },
  { id: id(8), full_name: 'Carla Mendoza', role: 'supply_clerk', username: 'carla', site: null },
  { id: id(9), full_name: 'Ramon Villa', role: 'moderator', username: 'ramon', site: null },
  { id: id(7), full_name: 'Dev Support', role: 'developer', username: 'dev', site: null },
].map((p: Record<string, any>) => ({
  active: true, must_change_password: false, created_at: ago(90), deactivated_at: null,
  status: 'working', status_note: null, status_until: null, ...p,
}));

const base = {
  job_order_number: null, client_phone: null, material: 'Tarpaulin 13oz', laminating: null, urgency: 'mid',
  printed_qty: 0, priority: false, notes: null, date_due: null, date_finished: null, first_finished_on: null,
  sent_back_count: 0, client_wait_since: null, client_wait_first_on: null, preview_path: null, file_link: null,
  attachments: [], items: [], item_columns: [], target_site: null, queued_at: null, operator_id: null,
  planned_operator_id: null, print_eta: null, print_pause_left: null, ready_at: null, printed_at: null,
  printed_by: null, printed_site: null, printed_file_link: null, reprint_count: 0, ready_for_pickup_at: null,
  released_at: null, released_by: null, archived_at: null, deleted_at: null, stage: 'todo', print_state: null,
  printed_items: null, print_problem: null, print_problem_note: null, print_problem_at: null, print_problem_by: null,
  return_note: null, operator_note: null, created_by: id(2), days_to_finish: null,
};
let n = 1040;
const wo = (over: Record<string, any>) => {
  n += 1;
  const created = over.created_at ?? ago(over.age ?? 3);
  return { ...base, id: id(100 + n), wo_number: `WO-${n}`, created_at: created, updated_at: created, date_given: created.slice(0, 10), ...over };
};

export const ORDERS = [
  wo({ status: 'todo', stage: 'todo', description: 'Grand opening tarpaulin 4x8ft', client_name: 'Bayview Bakery', artist_id: id(3), urgency: 'urgent', age: 0, date_due: day(-2) }),
  wo({ status: 'todo', stage: 'todo', description: 'Menu board refresh — 3 panels', client_name: 'Kape Kalye', artist_id: id(4), urgency: 'low', age: 1 }),
  wo({ status: 'todo', stage: 'todo', description: 'Sintra signage for clinic hours, with a fairly long description that should truncate nicely in the table row', client_name: 'Dr. Lim Dental', artist_id: null, urgency: 'high', age: 6 }),
  wo({ status: 'in_progress', stage: 'in_progress', description: 'Event backdrop 10x8ft', client_name: 'Mindanao Run Club', artist_id: id(3), urgency: 'high', age: 2,
    items: [{ name: 'Backdrop 10x8ft', qty: 1, install: true }, { name: 'Standee 2x5ft', qty: 2 }] }),
  wo({ status: 'in_progress', stage: 'in_progress', description: 'Vehicle decal — side panels', client_name: 'QuickFix Aircon', artist_id: id(4), age: 4, client_wait_since: ago(1), client_wait_first_on: day(1) }),
  wo({ status: 'finished', stage: 'in_progress', description: 'Photographic stickers A4 x9', client_name: 'Lotus Spa', artist_id: id(3), age: 3, date_finished: day(0), first_finished_on: day(0),
    file_link: 'https://drive.google.com/file/d/1DEMOfileAAAAAAAAAA/view', attachments: [{ url: 'https://drive.google.com/file/d/1DEMOfileAAAAAAAAAA/view', name: 'stickers-a4.pdf' }] }),
  wo({ status: 'awaiting_print', stage: 'in_progress', description: 'Store hours vinyl', client_name: 'Kape Kalye', artist_id: id(3), age: 2, date_finished: day(1), queued_at: ago(0, 8), target_site: 'production', planned_operator_id: id(5), operator_id: id(5), priority: true, urgency: 'urgent',
    file_link: 'https://drive.google.com/file/d/1DEMOfileBBBBBBBBBB/view', attachments: [{ url: 'https://drive.google.com/file/d/1DEMOfileBBBBBBBBBB/view', name: 'store-hours.ai' }] }),
  wo({ status: 'awaiting_print', stage: 'in_progress', description: 'Roll-up banner x2', items: [{ name: 'Roll-up banner', qty: 2 }, { name: 'Icon sticker', qty: 120, per_sheet: 12 }], client_name: 'Bayview Bakery', artist_id: id(4), age: 3, date_finished: day(1), queued_at: ago(0, 7), target_site: 'office', operator_id: id(6), print_state: 'printing', print_eta: new Date(Date.now() + 25 * 60000).toISOString(), qty: 2 }),
  // Rare states, so screenshots cover them: returned for a reprint with a note,
  // a note for the operator, a problem at the press, a print timer past due.
  wo({ status: 'awaiting_print', stage: 'in_progress', description: 'Acrylic signage 2x3ft', client_name: 'Lotus Spa', artist_id: id(3), age: 4, date_finished: day(2), queued_at: ago(0, 6), target_site: 'production', operator_id: id(5),
    reprint_count: 1, return_note: 'Colours too dark — please reprint brighter.', operator_note: 'Use the matte vinyl roll, not glossy.' }),
  wo({ status: 'awaiting_print', stage: 'in_progress', description: 'Tarpaulin 3x6ft', client_name: 'QuickFix Aircon', artist_id: id(4), age: 2, date_finished: day(1), queued_at: ago(0, 5), target_site: 'office', operator_id: id(6),
    print_state: 'printing', print_eta: new Date(Date.now() - 10 * 60000).toISOString(), print_problem: 'printer_down', print_problem_note: 'Head clog on printer 2', print_problem_at: ago(0, 9), print_problem_by: id(6) }),
  wo({ status: 'printed', stage: 'in_progress', description: 'Flyers A5 x500', client_name: 'Mindanao Run Club', artist_id: id(3), age: 5, date_finished: day(2), queued_at: ago(1), printed_at: ago(0, 6), printed_by: id(5), operator_id: id(5), qty: 500, printed_qty: 500 }),
  wo({ status: 'printed', stage: 'in_progress', description: 'Window frost film', client_name: 'Dr. Lim Dental', artist_id: id(4), age: 7, date_finished: day(4), printed_at: ago(2), printed_by: id(6), ready_for_pickup_at: ago(1) }),
  wo({ status: 'printed', stage: 'in_progress', description: 'Calling cards x200', client_name: 'Lotus Spa', artist_id: id(3), age: 9, date_finished: day(6), printed_at: ago(4), printed_by: id(5), ready_for_pickup_at: ago(3), released_at: ago(2), released_by: id(2) }),
];

// Art done: 1 point per file an artist adds to a task (Paolo is ahead this month).
const credit = (k: number, artist: number, name: string, order: number, days: number) => ({ id: id(700 + k), artist_id: id(artist), artist_name: name, work_order_id: ORDERS[order].id, at: ago(days) });
export const FILE_CREDITS = [
  credit(1, 3, 'Paolo Santos', 0, 1),
  credit(2, 3, 'Paolo Santos', 1, 3),
  credit(3, 3, 'Paolo Santos', 2, 5),
  credit(4, 3, 'Paolo Santos', 3, 8),
  credit(5, 3, 'Paolo Santos', 4, 13),
  credit(6, 3, 'Paolo Santos', 5, 18),
  credit(7, 3, 'Paolo Santos', 6, 23),
  credit(8, 3, 'Paolo Santos', 7, 28),
  credit(9, 3, 'Paolo Santos', 8, 33),
  credit(10, 4, 'Mika Reyes', 9, 2),
  credit(11, 4, 'Mika Reyes', 10, 9),
  credit(12, 4, 'Mika Reyes', 11, 20),
  credit(13, 4, 'Mika Reyes', 12, 30),
  credit(14, 4, 'Mika Reyes', 0, 40),
];
export const NOTIFICATIONS = [
  { id: id(901), user_id: ME, kind: 'finished', title: 'Paolo Santos finished WO-1046', body: 'Photographic stickers A4 x9', ref_id: ORDERS[5].id, actor_id: id(3), created_at: ago(0, 8), read_at: null },
  { id: id(902), user_id: ME, kind: 'comment', title: 'Rina mentioned you on WO-1041', body: 'Client wants a bigger logo', ref_id: ORDERS[0].id, actor_id: id(2), created_at: ago(1), read_at: ago(0) },
];

// Inventory (stock screen and Supply Clerk dashboard): three items are low on stock.
const invItem = (n: number, name: string, category: string, unit: string, low: number) => ({
  id: id(500 + n),
  name,
  category,
  sku: `SKU-${100 + n}`,
  unit,
  low_stock_threshold: low,
  active: true,
  created_at: ago(60),
  updated_at: ago(2),
});

export const INVENTORY_ITEMS = [
  invItem(1, "Tarpaulin 13oz", "Media", "roll", 3),
  invItem(2, "Sticker vinyl glossy", "Media", "roll", 4),
  invItem(3, "Photo paper A4", "Media", "pack", 5),
  invItem(4, "Sintra board 3mm", "Boards", "sheet", 10),
  invItem(5, "Eco-solvent ink cyan", "Ink", "bottle", 2),
  invItem(6, "Eco-solvent ink magenta", "Ink", "bottle", 2),
  invItem(7, "Laminating film matte", "Finishing", "roll", 2),
  invItem(8, "Grommets", "Finishing", "box", 3),
  invItem(9, "Workshop fasteners", "Hardware Materials", "box", 20),
  invItem(10, "Shared hand tools", "Tools & Equipment", "item", 2),
];

const stock: [number, number, number][] = [
  [1, 50, 20],
  [2, 3, 30],   // below low
  [3, 40, 25],
  [4, 60, 35],
  [5, 15, 10],
  [6, 20, 1],   // below low
  [7, 70, 40],
  [8, 3, 12],   // below low
  [9, 80, 40],
  [10, 12, 4],
];

export const INVENTORY_STOCK = stock.flatMap(([n, office, production]) => [
  { item_id: id(500 + n), site: "office", quantity: office, updated_at: ago(1) },
  { item_id: id(500 + n), site: "production", quantity: production, updated_at: ago(1) },
]);

const move = (k: number, n: number, site: string, movement_type: string, quantity_delta: number, days: number, note: string | null) => ({
  id: id(600 + k),
  item_id: id(500 + n),
  site,
  movement_type,
  quantity_delta,
  work_order_id: null,
  note,
  actor_id: ME,
  created_at: ago(days),
});

const novemberMove = (k: number, n: number, site: string, movement_type: string, quantity_delta: number, dayOfMonth: number, note: string | null) => ({
  id: id(612 + k),
  item_id: id(500 + n),
  site,
  movement_type,
  quantity_delta,
  work_order_id: null,
  note,
  actor_id: ME,
  created_at: new Date(`${new Date().getUTCFullYear()}-11-${String(dayOfMonth).padStart(2, "0")}T09:00:00+08:00`).toISOString(),
});

export const INVENTORY_MOVEMENTS = [
  move(1, 1, "office", "receipt", 100, 24, "Supplier delivery"),
  move(2, 1, "office", "usage", -20, 23, null),
  move(3, 1, "production", "usage", -10, 22, null),
  move(4, 2, "office", "receipt", 50, 21, "Supplier delivery"),
  move(5, 2, "office", "usage", -5, 20, null),
  move(6, 2, "office", "adjustment_out", -1, 19, "Damaged roll"),
  move(7, 3, "office", "receipt", 80, 18, "Supplier delivery"),
  move(8, 3, "office", "usage", -30, 17, null),
  move(9, 4, "office", "receipt", 120, 16, "Supplier delivery"),
  move(10, 5, "office", "receipt", 60, 15, "Supplier delivery"),
  move(11, 6, "production", "receipt", 40, 14, "Supplier delivery"),
  move(12, 6, "production", "adjustment_in", 2, 13, "Count correction"),
  novemberMove(1, 1, "office", "receipt", 12, 1, "November supplier delivery"),
  novemberMove(2, 2, "office", "receipt", 8, 1, "November supplier delivery"),
  novemberMove(3, 3, "production", "receipt", 10, 1, "November supplier delivery"),
  novemberMove(4, 4, "office", "receipt", 15, 1, "November supplier delivery"),
  novemberMove(5, 5, "production", "receipt", 6, 1, "November supplier delivery"),
  novemberMove(6, 6, "production", "receipt", 6, 1, "November supplier delivery"),
  novemberMove(7, 7, "office", "receipt", 10, 1, "November supplier delivery"),
  novemberMove(8, 8, "production", "receipt", 12, 1, "November supplier delivery"),
  novemberMove(9, 9, "office", "receipt", 20, 1, "November supplier delivery"),
  novemberMove(10, 10, "production", "receipt", 3, 1, "November supplier delivery"),
  novemberMove(11, 1, "production", "usage", -3, 2, null),
  novemberMove(12, 2, "office", "usage", -2, 2, null),
  novemberMove(13, 3, "office", "usage", -5, 2, null),
  novemberMove(14, 4, "production", "usage", -4, 2, null),
  novemberMove(15, 5, "office", "usage", -2, 2, null),
  novemberMove(16, 6, "production", "usage", -1, 2, null),
  novemberMove(17, 7, "production", "usage", -3, 2, null),
  novemberMove(18, 8, "office", "usage", -2, 2, null),
  novemberMove(19, 9, "production", "usage", -5, 2, null),
  novemberMove(20, 10, "office", "usage", -1, 2, null),
];

const conv = id(950);
export const TABLES: Record<string, Record<string, any>[]> = {
  inventory_items: INVENTORY_ITEMS, inventory_stock: INVENTORY_STOCK, inventory_movements: INVENTORY_MOVEMENTS,
  profiles: PEOPLE,
  work_orders: ORDERS,
  notifications: NOTIFICATIONS,
  app_settings: [{ key: 'drive_folder_url', value: '' }],
  messages: [
    { id: id(960), work_order_id: ORDERS[0].id, author_id: id(2), body: 'Client wants a bigger logo, please.', created_at: ago(1) },
    { id: id(961), work_order_id: ORDERS[0].id, author_id: id(3), body: 'Noted, revising now.', created_at: ago(0, 8) },
  ],
  chat_conversations: [{ id: conv, is_group: true, title: 'Production team', created_by: ME, created_at: ago(30), last_message_at: ago(0, 8) }],
  chat_members: PEOPLE.map((p: Record<string, any>) => ({ conversation_id: conv, user_id: p.id, last_read_at: ago(1), added_at: ago(30), archived_at: null, cleared_at: null })),
  chat_messages: [
    { id: id(970), conversation_id: conv, sender_id: id(2), body: 'Good morning! Two urgent jobs today.', created_at: ago(0, 7), image_path: null },
    { id: id(971), conversation_id: conv, sender_id: ME, body: 'Thanks, on it.', created_at: ago(0, 8), image_path: null },
  ],
  chat_reactions: [],
  message_reads: [], direct_messages: [], push_subscriptions: [], trusted_devices: [], work_order_drafts: [],
  work_order_events: [], print_file_marks: [], file_credit_events: FILE_CREDITS, report_periods: [], support_tickets: [],
  // Printer status per area (2026-10-27): one broken, one cooling down — the busiest look.
  printer_status: [
    { site: 'office', state: 'broken', note: 'Head clogged on printer 2', until: null, changed_at: '2026-10-27T01:00:00Z', changed_by: null, changed_by_name: 'Argie Rellon' },
    { site: 'production', state: 'cooldown', note: null, until: new Date(Date.now() + 45 * 60_000).toISOString(), changed_at: '2026-10-27T01:00:00Z', changed_by: null, changed_by_name: 'Argie Rellon' },
  ],
  account_recovery: [], previews: [],
};
export { ME as DEMO_ME, PEOPLE as DEMO_PEOPLE, ORDERS as DEMO_ORDERS, NOTIFICATIONS as DEMO_NOTIFICATIONS, TABLES as DEMO_TABLES };
