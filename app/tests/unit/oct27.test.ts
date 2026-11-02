// Unit tests for the 2026-10-27 batch — no network, no database.
//   sheets (items several to a sheet), the h/m/s duration, folder names and
//   upload warnings, the printer status, and the recovery email domain check.
// Run: npm test (from app/)
import { describe, expect, it } from 'vitest';
import { cleanPerSheet, hasPerSheet, itemsOf, itemsSummary, parseItemsFromText, sheetsLabel, sheetsOf, sheetsTotal } from '../../src/lib/items';
import { durationSecs, leftLabel, NO_DURATION } from '../../src/lib/duration';
import { MAX_BROWSER_UPLOAD, notUploaded, splitUpload, tagFolders, folderOf, type PickedFiles } from '../../src/lib/folders';
import { canSetPrinter, printerStateAt } from '../../src/lib/types';
import { emailDomain, likelyTypo } from '../../src/lib/emailCheck';

const file = (name: string, size = 10) => {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('sheets: several to a sheet', () => {
  it('counts sheets, rounding up', () => {
    expect(sheetsOf({ qty: 120, per_sheet: 12 })).toBe(10);
    expect(sheetsOf({ qty: 500, per_sheet: 12 })).toBe(42);
    expect(sheetsOf({ qty: 5 })).toBe(5);
    expect(sheetsOf({ qty: 5, per_sheet: 1 })).toBe(5);
    expect(sheetsOf({ qty: null, per_sheet: 12 })).toBeNull();
    expect(sheetsTotal([{ name: 'a', qty: 500, per_sheet: 12 }, { name: 'b', qty: 2 }])).toBe(44);
    expect(sheetsTotal([{ name: 'a', qty: null }])).toBeNull();
  });
  it('keeps per_sheet only as a whole number of 2 or more', () => {
    expect(cleanPerSheet(12)).toBe(12);
    expect(cleanPerSheet('12')).toBe(12);
    expect(cleanPerSheet(12.7)).toBe(12);
    for (const v of [1, 0, -3, 'twelve', null, undefined, NaN]) expect(cleanPerSheet(v)).toBeNull();
    expect(itemsOf({ items: [{ name: 'a', qty: 2, per_sheet: 1 }, { name: 'b', qty: 5, per_sheet: 12 }] }))
      .toEqual([{ name: 'a', qty: 2 }, { name: 'b', qty: 5, per_sheet: 12 }]);
    expect(hasPerSheet([{ name: 'a', qty: 2 }])).toBe(false);
  });
  it('reads "per sheet" out of a typed description', () => {
    expect(parseItemsFromText('Icon sticker - 120 pcs - 12 per sheet').items).toEqual([{ name: 'Icon sticker', qty: 120, per_sheet: 12 }]);
    expect(parseItemsFromText('Labels = 500pcs (12/sheet)').items).toEqual([{ name: 'Labels', qty: 500, per_sheet: 12 }]);
    expect(parseItemsFromText('Stickers 2x2 - 300 pcs 24-up').items).toEqual([{ name: 'Stickers 2x2', qty: 300, per_sheet: 24 }]);
    expect(parseItemsFromText('Tarpaulin 3x6 - 1PC').items).toEqual([{ name: 'Tarpaulin 3x6', qty: 1 }]);
  });
  it('says the sheets in a summary', () => {
    expect(itemsSummary([{ name: 'Icon', qty: 120, per_sheet: 12 }, { name: 'Tarp', qty: 2 }])).toBe('Icon ×120 (10 sheets) · Tarp ×2');
    expect(sheetsLabel(1)).toBe('1 sheet');
    expect(sheetsLabel(null)).toBe('—');
  });
});

describe('duration (printing time in seconds)', () => {
  it('adds up hours, minutes and seconds', () => {
    expect(durationSecs({ h: '', m: '1', s: '30' })).toBe(90);
    expect(durationSecs({ h: '2', m: '', s: '' })).toBe(7200);
    expect(durationSecs(NO_DURATION)).toBe(0);
    expect(durationSecs(undefined)).toBe(0);
  });
  it('reads minutes and seconds above 59 as 59, and ignores nonsense', () => {
    expect(durationSecs({ h: '', m: '75', s: '99' })).toBe(59 * 60 + 59);
    expect(durationSecs({ h: '-2', m: 'x', s: '5' })).toBe(5);
  });
  it('shows the time left', () => {
    const now = Date.parse('2026-10-27T00:00:00Z');
    expect(leftLabel('2026-10-27T00:04:12Z', now)).toBe('4m 12s');
    expect(leftLabel('2026-10-27T01:05:00Z', now)).toBe('1h 05m');
    expect(leftLabel('2026-10-27T00:00:09Z', now)).toBe('9s');
    expect(leftLabel('2026-10-26T23:00:00Z', now)).toBe('0s');
  });
});

describe('folder uploads', () => {
  const pick = (paths: string[]) => tagFolders(paths.map((p) => ({ file: file(p.split('/').pop()!), path: p })));
  it('names files after the inner folders when the whole job (2+ folders) is chosen', () => {
    const files = pick(['Job/400 x 304/a.png', 'Job/500 x 304/b.png', 'Job/notes.pdf']);
    expect(files.map((f) => [f.name, folderOf(f)])).toEqual([['a.png', '400 x 304'], ['b.png', '500 x 304'], ['notes.pdf', null]]);
  });
  it('keeps every name otherwise (a folder with one folder inside)', () => {
    const files = pick(['500 x 304/b1.png', '500 x 304/proofs/p.png']);
    expect(files.map((f) => folderOf(f))).toEqual(['500 x 304', '500 x 304 / proofs']);
    const two = pick(['A/a.png', 'B/b.png', 'B/proofs/p.png']);
    expect(two.map((f) => folderOf(f))).toEqual(['A', 'B', 'B / proofs']);
  });
  it('drops only the files a computer adds by itself', () => {
    const files = pick(['Job/A/Thumbs.db', 'Job/A/desktop.ini', 'Job/A/.DS_Store', 'Job/A/._front.png', 'Job/A/~$brief.docx', 'Job/A/.hidden-art.ai', 'Job/B/b.png']);
    expect(files.map((f) => f.name).sort()).toEqual(['.hidden-art.ai', 'b.png']);
  });
  it('names what cannot go up: too big, unreadable', () => {
    const picked: PickedFiles = [file('ok.png'), file('huge.tif', MAX_BROWSER_UPLOAD + 1)];
    picked.unreadable = ['A/locked.psd'];
    const { ok, warning } = splitUpload(picked);
    expect(ok.map((f) => f.name)).toEqual(['ok.png']);
    expect(warning).toContain('huge.tif is over 200MB');
    expect(warning).toContain('1 file could not be read and was not uploaded: A/locked.psd');
    expect(splitUpload([file('a.png')]).warning).toBeNull();
    expect(notUploaded([file('a.png'), file('b.png')])).toBe('Not uploaded: a.png, b.png. Upload them again.');
  });
});

describe('printer status', () => {
  const now = Date.parse('2026-10-27T00:00:00Z');
  it('a cool-down whose time is up reads as Working', () => {
    expect(printerStateAt({ state: 'cooldown', until: '2026-10-27T00:05:00Z' }, now)).toBe('cooldown');
    expect(printerStateAt({ state: 'cooldown', until: '2026-10-26T23:59:59Z' }, now)).toBe('working');
    expect(printerStateAt({ state: 'broken', until: null }, now)).toBe('broken');
    expect(printerStateAt(null, now)).toBe('working');
  });
  it('only operators, reception and admins may change it', () => {
    expect(['operator', 'receptionist', 'admin', 'developer', 'support'].every((r) => canSetPrinter(r as never))).toBe(true);
    expect(canSetPrinter('artist')).toBe(false);
    expect(canSetPrinter(null)).toBe(false);
  });
});

describe('recovery email domain check', () => {
  it('reads the domain', () => {
    expect(emailDomain(' Jamie@Gmail.com ')).toBe('gmail.com');
    expect(emailDomain('no-at-sign')).toBe('');
  });
  it('catches the misspellings people really type', () => {
    expect(likelyTypo('gmial.com')).toBe('gmail.com');
    expect(likelyTypo('GAMIL.com')).toBe('gmail.com');
    expect(likelyTypo('yahooo.com')).toBe('yahoo.com');
    expect(likelyTypo('hotmial.com')).toBe('hotmail.com');
    expect(likelyTypo('gmail.com')).toBeNull();
    expect(likelyTypo('printshop.example')).toBeNull();
  });
});
