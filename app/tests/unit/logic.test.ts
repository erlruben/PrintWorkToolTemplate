// Unit tests for the pure logic in src/lib — no network, no database.
// Run: npm test (from app/)
import { describe, expect, it } from 'vitest';
import { periodBounds, periodLabelOf, periodTitle, previousPeriodLabel, recentLabels } from '../../src/lib/periods';
import { cleanUsername, isInternalEmail, loginNameOf, toLoginEmail } from '../../src/lib/identity';
import { csvCell, toCsv } from '../../src/lib/csv';
import { columnsOf, itemsOf, itemsSummary, itemsTotal, jobTitle, looksLikeItemList, moveDescriptionToItems, newColumnKey, parseItemsFromText } from '../../src/lib/items';
import { expandMentions, matchPeople, mentionQueryAt, parseBody, plainBody } from '../../src/lib/mentions';
import { extractLinks, linkBadge, parseLink } from '../../src/lib/links';
import { afterPrint, artistDoneOn, isAdminRole, isArchived, isReceptionRole, nameWithStatus, operatorsForSite, staffStatusOf } from '../../src/lib/types';
import { groupOf, moveTo } from '../../src/lib/boardMoves';
import { canCreateOrders, canEditOrder } from '../../src/lib/sessionContext';
import { canManageInventory, canRecordInventoryUsage, inventoryCategoryOptions, isLowStock, movementDelta } from '../../src/lib/inventory';
import type { Profile, WorkOrder } from '../../src/lib/types';

const person = (over: Partial<Profile>): Profile => ({
  id: '11111111-1111-1111-1111-111111111111', full_name: 'Ana Cruz', role: 'artist', active: true,
  ...over,
} as Profile);
const order = (over: Partial<WorkOrder>): WorkOrder => ({
  id: 'o1', wo_number: 'WO-1', description: 'Tarpaulin', status: 'todo', date_given: '2026-10-01',
  date_finished: null, printed_at: null, ready_for_pickup_at: null, released_at: null,
  archived_at: null, deleted_at: null, operator_id: null, print_state: null, reprint_count: 0,
  ...over,
} as WorkOrder);

describe('inventory', () => {
  it('suggests broad inventory categories while preserving custom categories', () => {
    expect(inventoryCategoryOptions(['Media', 'hardware materials', 'Ink', 'Media'])).toEqual([
      'Printing Materials',
      'Hardware Materials',
      'Tools & Equipment',
      'General',
      'Ink',
      'Media',
    ]);
  });

  it('enforces role actions and records signed stock changes', () => {
    expect(canManageInventory('admin')).toBe(true);
    expect(canManageInventory('moderator')).toBe(true);
    expect(canManageInventory('receptionist')).toBe(true);
    expect(canManageInventory('operator')).toBe(false);
    expect(canRecordInventoryUsage('operator')).toBe(true);
    expect(canRecordInventoryUsage('moderator')).toBe(true);
    expect(canRecordInventoryUsage('artist')).toBe(false);
    expect(movementDelta('receipt', 2.5)).toBe(2.5);
    expect(movementDelta('adjustment_in', 1)).toBe(1);
    expect(movementDelta('adjustment_out', 1)).toBe(-1);
    expect(movementDelta('usage', 0.25)).toBe(-0.25);
    expect(movementDelta('usage', 0)).toBeNull();
    expect(movementDelta('usage', Number.NaN)).toBeNull();
  });

  it('alerts only when a positive threshold is reached', () => {
    expect(isLowStock(3, 3)).toBe(true);
    expect(isLowStock(0, 3)).toBe(true);
    expect(isLowStock(3.01, 3)).toBe(false);
    expect(isLowStock(0, 0)).toBe(false);
  });
});

describe('periods (Philippine time)', () => {
  it('labels months, quarters and years', () => {
    const d = new Date('2026-10-22T03:00:00Z');
    expect(periodLabelOf('month', d)).toBe('2026-10');
    expect(periodLabelOf('quarter', d)).toBe('2026-Q4');
    expect(periodLabelOf('year', d)).toBe('2026');
  });
  it('uses Manila time at the month edge (UTC+8)', () => {
    // 16:30 UTC on Oct 31 is already Nov 1 in Manila.
    expect(periodLabelOf('month', new Date('2026-10-31T16:30:00Z'))).toBe('2026-11');
  });
  it('gives inclusive/exclusive bounds', () => {
    expect(periodBounds('month', '2026-02')).toMatchObject({ startDate: '2026-02-01', endDate: '2026-02-28', endIsoExclusive: '2026-03-01T00:00:00+08:00' });
    expect(periodBounds('quarter', '2026-Q4')).toMatchObject({ startDate: '2026-10-01', endDate: '2026-12-31' });
    expect(periodBounds('year', '2028')).toMatchObject({ endDate: '2028-12-31' });
  });
  it('steps back across a year', () => {
    expect(previousPeriodLabel('month', '2026-01')).toBe('2025-12');
    expect(previousPeriodLabel('quarter', '2026-Q1')).toBe('2025-Q4');
    expect(recentLabels('quarter', 3, new Date('2026-02-10T00:00:00Z'))).toEqual(['2026-Q1', '2025-Q4', '2025-Q3']);
  });
  it('titles', () => {
    expect(periodTitle('quarter', '2026-Q4')).toBe('2026 Q4');
    expect(periodTitle('year', '2026')).toBe('2026');
  });
});

describe('identity (username sign-in)', () => {
  it('maps a username to the internal email and back', () => {
    expect(toLoginEmail('  Jeff ')).toBe('jeff@printflow.local');
    expect(toLoginEmail('Owner@Example.com')).toBe('owner@example.com');
    expect(isInternalEmail('jeff@printflow.local')).toBe(true);
    expect(loginNameOf('jeff@printflow.local')).toBe('jeff');
    expect(loginNameOf('owner@example.com')).toBe('owner@example.com');
  });
  it('cleans unsafe username characters', () => {
    expect(cleanUsername(' Jé ff!@#.b_c-d ')).toBe('jff.b_c-d');
  });
});

describe('csv export', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
  });
  it('defuses spreadsheet formulas (CSV injection)', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+63 912')).toBe("'+63 912");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
  it('writes BOM + CRLF for Excel', () => {
    const out = toCsv(['A', 'B'], [[1, 'ñ']]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out).toBe('﻿A,B\r\n1,ñ\r\n');
  });
});

describe('items', () => {
  it('reads quantities the way the team types them', () => {
    const p = parseItemsFromText('Photographic Sticker on Sintra Board 3mm - A4 Size = 9pcs Back to back\n12 x 21ft Black-out tarpaulin printing - 1PC\n     - JB Ecowest\n1 Box Gaudia');
    expect(p.qtyLines).toBe(3);
    expect(p.items[0]).toMatchObject({ qty: 9 });
    expect(p.items[1]).toMatchObject({ name: '12 x 21ft Black-out tarpaulin printing', qty: 1, extra: { details: 'JB Ecowest' } });
    expect(p.items[2]).toMatchObject({ name: 'Box Gaudia', qty: 1 });
    expect(p.hasDetails).toBe(true);
  });
  it('only treats 2+ quantity lines as a list', () => {
    expect(looksLikeItemList('Just one tarpaulin')).toBe(false);
    expect(looksLikeItemList('A = 2pcs\nB = 3pcs')).toBe(true);
  });
  it('cleans, totals and titles', () => {
    const items = itemsOf({ items: [{ name: ' Tarp ', qty: 2 }, { name: '', qty: 5 }, { name: 'Sticker', qty: 100 }] as never });
    expect(items).toHaveLength(2);
    expect(itemsTotal(items)).toBe(102);
    expect(itemsSummary(items)).toBe('Tarp ×2 · Sticker ×100');
    expect(jobTitle({ description: 'fallback', items: [] })).toBe('fallback');
  });
  it('dedupes and caps extra columns', () => {
    const cols = columnsOf({ item_columns: [{ key: 'c1', label: 'Branch' }, { key: 'c1', label: 'dup' }, { key: 'c2', label: '' }] });
    expect(cols).toEqual([{ key: 'c1', label: 'Branch' }, { key: 'c2', label: 'Column' }]);
    expect(newColumnKey(cols)).toBe('c3');
  });
  it('moves a typed description into the table and adds a Details column', () => {
    const r = moveDescriptionToItems('A = 2pcs\n  - Branch 1\nB = 3pcs', [], []);
    expect(r.moved).toBe(2);
    expect(r.description).toBe('');
    expect(r.columns.map((c) => c.key)).toContain('details');
  });
});

describe('@mentions', () => {
  const ann = person({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', full_name: 'Ann' });
  const anna = person({ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', full_name: 'Anna Reyes' });
  it('expands longest name first and round-trips', () => {
    const body = expandMentions('hi @Anna Reyes and @Ann.', [ann, anna]);
    expect(body).toBe(`hi @[Anna Reyes](${anna.id}) and @[Ann](${ann.id}).`);
    expect(plainBody(body)).toBe('hi @Anna Reyes and @Ann.');
    expect(parseBody(body).filter((p) => 'id' in p)).toHaveLength(2);
  });
  it('collapses @everyone into one part', () => {
    const body = expandMentions('@everyone go', [ann], [ann, anna]);
    const parts = parseBody(body);
    expect(parts[0]).toMatchObject({ name: 'everyone', ids: [ann.id, anna.id] });
    expect(plainBody(body)).toBe('@everyone go');
  });
  it('expands a role tag to the active people in that role, shown as one @tag', () => {
    const paolo = person({ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', full_name: 'Paolo', role: 'artist' });
    const mika = person({ id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', full_name: 'Mika', role: 'artist' });
    const gone = person({ id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', full_name: 'Old', role: 'artist', active: false });
    const jun = person({ id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', full_name: 'Jun', role: 'operator' });
    const body = expandMentions('@artists please check, @Jun too', [paolo, mika, gone, jun], undefined, true);
    expect(body).toBe(`@[artists](${paolo.id})@[artists](${mika.id}) please check, @[Jun](${jun.id}) too`);
    expect(parseBody(body)[0]).toMatchObject({ name: 'artists', ids: [paolo.id, mika.id] });
    expect(plainBody(body)).toBe('@artists please check, @Jun too');
    // Off (a one-to-one chat) or nobody in the role: the text is left alone.
    expect(expandMentions('@artists hi', [paolo], undefined, false)).toBe('@artists hi');
    expect(expandMentions('@admins hi', [paolo], undefined, true)).toBe('@admins hi');
  });
  it('never opens the picker inside an email address', () => {
    expect(mentionQueryAt('mail a@b', 8)).toBeNull();
    expect(mentionQueryAt('hey @an', 7)).toEqual({ query: 'an', at: 4 });
    expect(matchPeople([ann, anna], 'rey')).toEqual([anna]);
  });
});

describe('links', () => {
  it('pulls links out of pasted text without trailing punctuation or repeats', () => {
    expect(extractLinks('see https://a.com/x). and https://a.com/x, https://b.com')).toEqual(['https://a.com/x', 'https://b.com']);
  });
  it('recognises Drive, Docs, Dropbox, OneDrive', () => {
    expect(parseLink('https://drive.google.com/file/d/1AbCdEfGhIjK/view')?.kind).toBe('drive-file');
    expect(parseLink('https://drive.google.com/drive/folders/1AbCdEfGhIjK')?.kind).toBe('drive-folder');
    expect(linkBadge('https://www.dropbox.com/s/x')).toBe('Dropbox');
    expect(linkBadge('https://1drv.ms/x')).toBe('OneDrive');
    expect(linkBadge('')).toBeNull();
  });
});

describe('roles, status and board moves', () => {
  it('admin-level roles', () => {
    expect(['admin', 'developer', 'support'].every((r) => isAdminRole(r as never))).toBe(true);
    expect(['moderator', 'receptionist', 'artist', 'operator'].some((r) => isAdminRole(r as never))).toBe(false);
    expect(isReceptionRole('moderator')).toBe(true);
    expect(isReceptionRole('admin')).toBe(false);
    const moderator = person({ role: 'moderator' });
    expect(canCreateOrders(moderator)).toBe(true);
    expect(canEditOrder(moderator, order({ status: 'todo' }))).toBe(true);
    expect(canEditOrder(moderator, order({ status: 'printed' }))).toBe(false);
  });
  it('an away status that has ended counts as working', () => {
    const now = Date.parse('2026-10-22T00:00:00Z');
    expect(staffStatusOf({ status: 'sick', status_until: '2026-10-21T00:00:00Z' }, now)).toBe('working');
    expect(staffStatusOf({ status: 'sick', status_until: '2026-10-23T00:00:00Z' }, now)).toBe('sick');
    expect(nameWithStatus({ full_name: 'Jeff', status: 'working', status_until: null })).toBe('Jeff');
  });
  it('operators for a printing area', () => {
    const ops = [person({ id: '1', site: 'a' as never }), person({ id: '2', site: 'b' as never }), person({ id: '3', site: null })];
    expect(operatorsForSite(ops, 'a' as never).map((p) => p.id)).toEqual(['1', '3']);
    expect(operatorsForSite(ops, '')).toHaveLength(3);
  });
  it('after-print stage and archive', () => {
    expect(afterPrint({ printed_at: null, ready_for_pickup_at: null, released_at: null })).toBeNull();
    expect(afterPrint({ printed_at: 'x', ready_for_pickup_at: 'y', released_at: null })).toBe('ready');
    expect(isArchived({ archived_at: '2026-10-02T00:00:00Z', released_at: '2026-10-01T00:00:00Z' })).toBe(true);
    expect(isArchived({ archived_at: '2026-10-01T00:00:00Z', released_at: '2026-10-02T00:00:00Z' })).toBe(false);
  });
  it('artist credit day is the earliest of finished / waiting for client', () => {
    expect(artistDoneOn({ date_finished: '2026-10-10', first_finished_on: '2026-10-05', client_wait_first_on: '2026-10-03' })).toBe('2026-10-03');
    expect(artistDoneOn({ date_finished: null, first_finished_on: null, client_wait_first_on: null })).toBeNull();
  });
  it('only admin and reception can drag tasks between groups', () => {
    const o = order({});
    expect(moveTo(o, 'in_progress', person({ role: 'artist' }))).toBeNull();
    expect(moveTo(o, 'in_progress', person({ role: 'operator' }))).toBeNull();
    expect(moveTo(o, 'in_progress', person({ role: 'receptionist' }))?.patch).toMatchObject({ stage: 'in_progress' });
    expect(moveTo(o, 'in_progress', null)).toBeNull();
  });
  it('never moves archived or deleted tasks, and asks before a reprint', () => {
    const admin = person({ role: 'admin' });
    expect(moveTo(order({ deleted_at: 'x' }), 'todo', admin)).toBeNull();
    const printed = order({ status: 'printed', printed_at: '2026-10-02T00:00:00Z' });
    expect(groupOf(printed)).toBe('to_review');
    const back = moveTo(printed, 'awaiting_print', admin);
    expect(back?.confirm).toMatch(/reprint/);
    expect(back?.patch).toMatchObject({ printed_at: null, reprint_count: 1 });
    // Marking printed straight from To Do is not offered.
    expect(moveTo(order({}), 'to_review', admin)).toBeNull();
  });
});
