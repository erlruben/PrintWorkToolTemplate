#!/usr/bin/env node
// Rehearse database migration(s) against the LIVE project without keeping
// anything: everything runs in one transaction that is ALWAYS rolled back.
//
//   node app/scripts/rehearse-migration.mjs supabase/migrations/<file>.sql [more.sql …]
//
// It reports:
//   1. Access before vs after — for each role (admin, reception, artist,
//      operator): how many rows they can see in every table, and the outcome of
//      ~35 write attempts (allowed / refused). Any difference is listed, so a
//      migration can never quietly change who can see or do what.
//   2. Supabase's own Security & Performance Advisor lints (splinter) after the
//      migration — what was added or removed.
//   3. Any error applying the migration.
//
// Connection: supabase/db.env (SUPABASE_DB_URL=…, gitignored). Run off-hours:
// while the migration is applied inside the transaction it can hold locks on
// the tables it touches (usually a few seconds).
import pg from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const files = process.argv.slice(2);
if (!files.length) { console.error('Usage: node app/scripts/rehearse-migration.mjs <migration.sql> [...]'); process.exit(1); }
const envFile = join(root, 'supabase', 'db.env');
if (!existsSync(envFile)) { console.error('Missing supabase/db.env (see supabase/db.mjs).'); process.exit(1); }
const url = readFileSync(envFile, 'utf8').match(/^SUPABASE_DB_URL=(.+)$/m)?.[1]?.trim();
const splinter = readFileSync(join(root, 'supabase', 'tests', 'splinter.sql'), 'utf8');
const sqls = files.map((f) => ({ f, sql: readFileSync(resolve(f), 'utf8') }));

const TABLES = ['profiles', 'app_settings', 'work_orders', 'messages', 'message_reads', 'direct_messages', 'notifications',
  'push_subscriptions', 'trusted_devices', 'work_order_drafts', 'chat_conversations', 'chat_members', 'chat_messages', 'chat_reactions'];

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

// One round trip per probe: run it as a signed-in person inside a savepoint,
// then undo it. Returns the row count, or 'refused'.
let sp = 0;
async function as(uid, sql) {
  const s = `s${++sp}`;
  const claims = JSON.stringify({ sub: uid, role: 'authenticated' }).replace(/'/g, "''");
  try {
    const res = await c.query(`savepoint ${s}; set local role authenticated;
      select set_config('request.jwt.claims', '${claims}', true), set_config('request.jwt.claim.sub', '${uid}', true);
      ${sql};
      rollback to savepoint ${s}; reset role;`);
    const r = res[3];
    return r.command === 'SELECT' ? r.rows[0]?.n ?? r.rowCount : `ok ${r.rowCount}`;
  } catch {
    await c.query(`rollback to savepoint ${s}; reset role;`);
    return 'refused';
  }
}
const lit = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

let failed = false;
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
  const nMine = await one(`select id from public.notifications where user_id = ${lit(P.reception)} limit 1`);
  const nOther = await one(`select id from public.notifications where user_id <> ${lit(P.reception)} limit 1`);
  const conv = await one(`select conversation_id as id from public.chat_members where user_id = ${lit(P.reception)} limit 1`);
  const probes = [
    ['reception edits a task', P.reception, `update public.work_orders set notes = notes where id = ${lit(wo)}`],
    ['operator edits a task (row rule)', P.operator, `update public.work_orders set priority = priority where id = ${lit(wo)}`],
    ['another artist edits an artist task', art2, `update public.work_orders set notes = notes where id = ${lit(woArt)}`],
    ['artist edits own task', P.artist, `update public.work_orders set notes = notes where id = ${lit(woArt)}`],
    ['artist creates task for self', P.artist, `insert into public.work_orders (wo_number, description, artist_id) values ('WO-RHSL1', 'x', ${lit(P.artist)})`],
    ['artist creates task for another', P.artist, `insert into public.work_orders (wo_number, description, artist_id) values ('WO-RHSL2', 'x', ${lit(art2)})`],
    ['operator creates task', P.operator, `insert into public.work_orders (wo_number, description) values ('WO-RHSL3', 'x')`],
    ['reception deletes task', P.reception, `delete from public.work_orders where id = ${lit(wo)}`],
    ['admin deletes task', P.admin, `delete from public.work_orders where id = ${lit(wo)}`],
    ['reception edits own notification', P.reception, `update public.notifications set read_at = read_at where id = ${lit(nMine)}`],
    ['reception edits others notification', P.reception, `update public.notifications set read_at = read_at where id = ${lit(nOther)}`],
    ['reception deletes others notification', P.reception, `delete from public.notifications where id = ${lit(nOther)}`],
    ['reception changes a setting', P.reception, `update public.app_settings set value = value where key = 'drive_folder_url'`],
    ['admin changes a setting', P.admin, `update public.app_settings set value = value where key = 'drive_folder_url'`],
    ['reception adds a setting', P.reception, `insert into public.app_settings (key, value) values ('rehearsal_probe', 'x')`],
    ['admin adds a setting', P.admin, `insert into public.app_settings (key, value) values ('rehearsal_probe', 'x')`],
    ['reception deletes a setting', P.reception, `delete from public.app_settings where key = 'drive_account_note'`],
    ['admin deletes a setting', P.admin, `delete from public.app_settings where key = 'drive_account_note'`],
    ['reception edits own profile', P.reception, `update public.profiles set full_name = full_name where id = ${lit(P.reception)}`],
    ['reception edits another profile', P.reception, `update public.profiles set full_name = full_name where id = ${lit(P.artist)}`],
    ['admin edits another profile', P.admin, `update public.profiles set full_name = full_name where id = ${lit(P.artist)}`],
    ['reception comments as self', P.reception, `insert into public.messages (work_order_id, author_id, body) values (${lit(wo)}, ${lit(P.reception)}, 'x')`],
    ['reception comments as another', P.reception, `insert into public.messages (work_order_id, author_id, body) values (${lit(wo)}, ${lit(P.artist)}, 'x')`],
    ['reception deletes comments', P.reception, `delete from public.messages`],
    ['reception marks own read', P.reception, `insert into public.message_reads (user_id, work_order_id) values (${lit(P.reception)}, ${lit(wo)}) on conflict (user_id, work_order_id) do update set last_read_at = now()`],
    ['reception marks another read', P.reception, `insert into public.message_reads (user_id, work_order_id) values (${lit(P.artist)}, ${lit(wo)})`],
    ['reception saves own draft', P.reception, `insert into public.work_order_drafts (user_id, data) values (${lit(P.reception)}, '{}')`],
    ['reception saves draft for another', P.reception, `insert into public.work_order_drafts (user_id, data) values (${lit(P.artist)}, '{}')`],
    ['reception messages as self', P.reception, `insert into public.direct_messages (sender_id, recipient_id, body) values (${lit(P.reception)}, ${lit(P.artist)}, 'x')`],
    ['reception messages as another', P.reception, `insert into public.direct_messages (sender_id, recipient_id, body) values (${lit(P.artist)}, ${lit(P.reception)}, 'x')`],
    ['reception chats in own conversation', P.reception, `insert into public.chat_messages (conversation_id, sender_id, body) values (${lit(conv)}, ${lit(P.reception)}, 'x')`],
    ['artist removes reception from chats', art2, `delete from public.chat_members where user_id = ${lit(P.reception)}`],
    ['reception push sign-up for another', P.reception, `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (${lit(P.artist)}, 'https://x/rh1', 'a', 'b')`],
    ['reception push sign-up for self', P.reception, `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (${lit(P.reception)}, 'https://x/rh2', 'a', 'b')`],
  ];

  async function snapshot() {
    const out = {};
    for (const [role, uid] of Object.entries(P)) {
      if (!uid) continue;
      for (const t of TABLES) out[`${role} sees ${t}`] = await as(uid, `select count(*)::int as n from public.${t}`);
    }
    for (const [name, uid, sql] of probes) if (uid) out[name] = await as(uid, sql);
    return out;
  }
  async function lints() {
    await c.query('savepoint lints');
    const res = await c.query(splinter);
    const rows = (Array.isArray(res) ? res : [res]).filter((r) => r.rows?.length).at(-1)?.rows ?? [];
    await c.query('rollback to savepoint lints');
    return rows.map((r) => `${r.level} ${r.name}: ${String(r.detail).replace(/\s+/g, ' ').slice(0, 140)}`);
  }

  console.log('Recording access before…');
  const before = await snapshot();
  const lintBefore = await lints();
  for (const { f, sql } of sqls) {
    try { await c.query(sql); console.log(`✓ applied ${f}`); } catch (e) { console.log(`✗ ${f}: ${e.message}`); failed = true; throw e; }
  }
  console.log('Recording access after…');
  const after = await snapshot();
  const lintAfter = await lints();

  const diffs = Object.keys(before).filter((k) => before[k] !== after[k]);
  console.log(`\nAccess: ${Object.keys(before).length} checks, ${diffs.length} changed`);
  for (const k of diffs) console.log(`  CHANGED  ${k}: ${before[k]} → ${after[k]}`);
  const added = lintAfter.filter((l) => !lintBefore.includes(l));
  const removed = lintBefore.filter((l) => !lintAfter.includes(l));
  console.log(`\nAdvisor lints: ${lintBefore.length} → ${lintAfter.length} (${removed.length} fixed, ${added.length} new)`);
  for (const l of added) console.log(`  NEW    ${l}`);
  if (lintAfter.some((l) => l.startsWith('ERROR'))) { console.log('  ✗ advisor ERROR present'); failed = true; }
  if (diffs.length) console.log('\nReview every CHANGED line: each must be an intended change.');
} catch (e) {
  failed = true;
  if (!String(e.message).includes('applied')) console.log(`\nStopped: ${e.message}`);
} finally {
  await c.query('rollback').catch(() => {});
  await c.end();
  console.log(`\n(rolled back — nothing kept; ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  process.exitCode = failed ? 1 : 0;
}
