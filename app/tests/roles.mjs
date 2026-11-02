#!/usr/bin/env node
// Role-based access test against the LIVE database — nothing is kept: every
// probe runs inside one transaction that is ALWAYS rolled back (the same
// method as scripts/rehearse-migration.mjs).
//
//   node app/tests/roles.mjs
//
// 1. Signed out (anon): must see 0 rows in every table and be refused writes.
// 2. Each role (admin, reception, artist, operator) against a list of
//    allowed / refused actions — any result that differs from EXPECTED fails.
// 3. Who can read what: row counts per role per table (printed, not asserted —
//    useful to eyeball, e.g. an operator should not read other people's DMs).
// 4. Supabase Security Advisor (splinter): any ERROR-level lint fails.
//
// Connection: supabase/db.env (SUPABASE_DB_URL=…, gitignored). Run off-hours:
// write probes hold row locks for a moment until their savepoint is undone.
import pg from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const envFile = join(root, 'supabase', 'db.env');
if (!existsSync(envFile)) { console.error('Missing supabase/db.env (see supabase/db.mjs).'); process.exit(1); }
const url = readFileSync(envFile, 'utf8').match(/^SUPABASE_DB_URL=(.+)$/m)?.[1]?.trim();
const splinter = readFileSync(join(root, 'supabase', 'tests', 'splinter.sql'), 'utf8');

const TABLES = ['profiles', 'app_settings', 'work_orders', 'messages', 'message_reads', 'direct_messages', 'notifications',
  'push_subscriptions', 'trusted_devices', 'work_order_drafts', 'chat_conversations', 'chat_members', 'chat_messages', 'chat_reactions'];

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

let sp = 0;
// Run `sql` as a signed-in person (uid) or as anon (uid = null) inside a
// savepoint, then undo it. Returns a row count, 'ok' for a write, or 'refused'.
async function as(uid, sql) {
  const s = `s${++sp}`;
  const setup = uid
    ? `set local role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, role: 'authenticated' })}', true), set_config('request.jwt.claim.sub', '${uid}', true);`
    : `set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true);`;
  try {
    const res = await c.query(`savepoint ${s}; ${setup} ${sql}; rollback to savepoint ${s}; reset role;`);
    const r = res[3];
    if (r.command === 'SELECT') return r.rows[0]?.n ?? r.rowCount;
    return r.rowCount > 0 ? 'ok' : 'none';   // 'none' = allowed to try, but row rules matched nothing
  } catch {
    await c.query(`rollback to savepoint ${s}; reset role;`);
    return 'refused';
  }
}
const lit = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
// A write counts as blocked when it is refused outright or matches no rows.
const blocked = (r) => r === 'refused' || r === 'none';

let fails = 0;
const t0 = Date.now();
try {
  await c.query('begin');
  await c.query("set local statement_timeout = '60s'; set local lock_timeout = '5s'");
  const one = async (q) => (await c.query(q)).rows[0]?.id ?? null;
  const P = {
    admin: await one(`select id from public.profiles where role = 'admin' and active order by full_name limit 1`),
    reception: await one(`select id from public.profiles where role = 'receptionist' and active order by full_name limit 1`),
    artist: await one(`select id from public.profiles where role = 'artist' and active order by full_name limit 1`),
    operator: await one(`select id from public.profiles where role = 'operator' and active order by full_name limit 1`),
  };
  const art2 = await one(`select id from public.profiles where role = 'artist' and active order by full_name offset 1 limit 1`);
  const wo = await one('select id from public.work_orders where deleted_at is null order by created_at limit 1');
  const woArt = await one(`select id from public.work_orders where artist_id = ${lit(P.artist)} limit 1`);
  const nOther = await one(`select id from public.notifications where user_id <> ${lit(P.reception)} limit 1`);

  // [what, who, sql, expectation: 'allowed' | 'blocked']
  const CASES = [
    ['reception edits a task', P.reception, `update public.work_orders set notes = notes where id = ${lit(wo)}`, 'allowed'],
    ['artist edits own task', P.artist, `update public.work_orders set notes = notes where id = ${lit(woArt)}`, 'allowed'],
    ['another artist edits that task', art2, `update public.work_orders set notes = notes where id = ${lit(woArt)}`, 'blocked'],
    ['reception deletes a task (hard)', P.reception, `delete from public.work_orders where id = ${lit(wo)}`, 'blocked'],
    ['reception edits others notification', P.reception, `update public.notifications set read_at = read_at where id = ${lit(nOther)}`, 'blocked'],
    ['reception deletes others notification', P.reception, `delete from public.notifications where id = ${lit(nOther)}`, 'blocked'],
    ['reception changes a setting', P.reception, `update public.app_settings set value = value where key = 'drive_folder_url'`, 'blocked'],
    ['admin changes a setting', P.admin, `update public.app_settings set value = value where key = 'drive_folder_url'`, 'allowed'],
    ['reception edits own profile', P.reception, `update public.profiles set full_name = full_name where id = ${lit(P.reception)}`, 'allowed'],
    ['reception edits another profile', P.reception, `update public.profiles set full_name = full_name where id = ${lit(P.artist)}`, 'blocked'],
    ['reception promotes self to admin', P.reception, `update public.profiles set role = 'admin' where id = ${lit(P.reception)}`, 'blocked'],
    ['artist promotes self to admin', P.artist, `update public.profiles set role = 'admin' where id = ${lit(P.artist)}`, 'blocked'],
    ['operator promotes self to admin', P.operator, `update public.profiles set role = 'admin' where id = ${lit(P.operator)}`, 'blocked'],
    ['admin edits another profile', P.admin, `update public.profiles set full_name = full_name where id = ${lit(P.artist)}`, 'allowed'],
    ['reception comments as self', P.reception, `insert into public.messages (work_order_id, author_id, body) values (${lit(wo)}, ${lit(P.reception)}, 'x')`, 'allowed'],
    ['reception comments as another', P.reception, `insert into public.messages (work_order_id, author_id, body) values (${lit(wo)}, ${lit(P.artist)}, 'x')`, 'blocked'],
    ['reception deletes all comments', P.reception, `delete from public.messages`, 'blocked'],
    ['reception messages as another', P.reception, `insert into public.direct_messages (sender_id, recipient_id, body) values (${lit(P.artist)}, ${lit(P.reception)}, 'x')`, 'blocked'],
    ['reception saves draft for another', P.reception, `insert into public.work_order_drafts (user_id, data) values (${lit(P.artist)}, '{}')`, 'blocked'],
    ['reception push sign-up for another', P.reception, `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (${lit(P.artist)}, 'https://x/rt1', 'a', 'b')`, 'blocked'],
    ['artist removes reception from chats', art2, `delete from public.chat_members where user_id = ${lit(P.reception)}`, 'blocked'],
    ['operator creates a task', P.operator, `insert into public.work_orders (wo_number, description) values ('WO-RTEST', 'x')`, 'blocked'],
  ];

  console.log('1) Signed out (anon)');
  for (const t of TABLES) {
    const n = await as(null, `select count(*)::int as n from public.${t}`);
    const ok = n === 0 || n === 'refused';
    if (!ok) fails++;
    console.log(`  ${ok ? '✓' : '✗'} anon reads ${t}: ${n}`);
  }
  for (const [what, sql] of [
    ['anon creates a task', `insert into public.work_orders (wo_number, description) values ('WO-ANON', 'x')`],
    ['anon edits settings', `update public.app_settings set value = value`],
    ['anon edits profiles', `update public.profiles set role = role`],
  ]) {
    const r = await as(null, sql);
    if (!blocked(r)) fails++;
    console.log(`  ${blocked(r) ? '✓' : '✗'} ${what}: ${r}`);
  }

  console.log('\n2) Role rules');
  for (const [what, uid, sql, want] of CASES) {
    if (!uid) { console.log(`  - ${what}: skipped (no such account)`); continue; }
    const r = await as(uid, sql);
    const ok = want === 'blocked' ? blocked(r) : r === 'ok';
    if (!ok) fails++;
    console.log(`  ${ok ? '✓' : '✗'} ${what}: ${r} (expected ${want})`);
  }

  console.log('\n3) Rows each role can read');
  const roles = Object.entries(P).filter(([, uid]) => uid);
  console.log('  ' + 'table'.padEnd(20) + roles.map(([r]) => r.padStart(10)).join(''));
  for (const t of TABLES) {
    const cells = [];
    for (const [, uid] of roles) cells.push(String(await as(uid, `select count(*)::int as n from public.${t}`)).padStart(10));
    console.log('  ' + t.padEnd(20) + cells.join(''));
  }

  console.log('\n4) Security advisor');
  await c.query('savepoint lints');
  const res = await c.query(splinter);
  const rows = (Array.isArray(res) ? res : [res]).filter((r) => r.rows?.length).at(-1)?.rows ?? [];
  await c.query('rollback to savepoint lints');
  const byLevel = {};
  for (const r of rows) (byLevel[r.level] ??= new Set()).add(r.name);
  for (const [lvl, names] of Object.entries(byLevel)) console.log(`  ${lvl}: ${[...names].join(', ')}`);
  if (byLevel.ERROR) { fails++; console.log('  ✗ ERROR-level lint present'); }
  else console.log('  ✓ no ERROR-level lints');
} catch (e) {
  fails++;
  console.log(`\nStopped: ${e.message}`);
} finally {
  await c.query('rollback').catch(() => {});
  await c.end();
  console.log(`\n${fails ? `✗ ${fails} failed` : '✓ all passed'} (rolled back — nothing kept; ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  process.exitCode = fails ? 1 : 0;
}
