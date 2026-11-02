#!/usr/bin/env node
// API test — READ-ONLY, as a signed-out visitor (the public anon key every
// browser already has). Nothing is written. Checks that:
//   1. no table hands rows to someone who is not signed in;
//   2. public sign-up is closed (accounts are made by the admin);
//   3. the live site sends its security headers.
//
//   node tests/api.mjs        (reads VITE_SUPABASE_URL / _ANON_KEY from app/.env.local)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const env = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local'), 'utf8');
const val = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim();
const URL_ = val('VITE_SUPABASE_URL');
const KEY = val('VITE_SUPABASE_ANON_KEY');
const SITE = 'https://visuals-inmotion.erlrbn-dev.workers.dev';
const TABLES = ['profiles', 'app_settings', 'work_orders', 'messages', 'message_reads', 'direct_messages', 'notifications',
  'push_subscriptions', 'trusted_devices', 'work_order_drafts', 'chat_conversations', 'chat_members', 'chat_messages',
  'chat_reactions', 'work_order_events', 'print_file_marks', 'file_credit_events', 'report_periods', 'support_tickets',
  'account_recovery'];

let fails = 0;
const check = (ok, line) => { if (!ok) fails++; console.log(`  ${ok ? '✓' : '✗'} ${line}`); };
const h = { apikey: KEY, Authorization: `Bearer ${KEY}` };

console.log('1) Signed-out reads');
for (const t of TABLES) {
  const r = await fetch(`${URL_}/rest/v1/${t}?select=*&limit=1`, { headers: h });
  const body = await r.json().catch(() => null);
  const rows = Array.isArray(body) ? body.length : 0;
  check(rows === 0, `${t}: HTTP ${r.status}, ${rows} row(s)`);
}

console.log('\n2) Auth settings');
const s = await (await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: KEY } })).json();
check(s.disable_signup === true, `public sign-up disabled: ${s.disable_signup}`);
console.log(`    providers on: ${Object.entries(s.external ?? {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`);

console.log('\n3) Live site headers');
const page = await fetch(SITE, { redirect: 'manual' });
const hd = (n) => page.headers.get(n);
check(page.status === 200, `GET / → ${page.status}`);
for (const n of ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'strict-transport-security', 'permissions-policy'])
  check(!!hd(n), `${n}: ${hd(n) ? hd(n).slice(0, 90) : 'missing'}`);
// Recommended, not required yet: a CSP has to allow Supabase, Google Drive
// previews and sign-in before it can be switched on without breaking them.
console.log(`  ${hd('content-security-policy') ? '✓' : '·'} content-security-policy: ${hd('content-security-policy') ? 'set' : 'not set (recommended)'}`);
const sw = await fetch(`${SITE}/sw.js`);
check(sw.ok, `service worker served: ${sw.status}`);
const mf = await fetch(`${SITE}/manifest.webmanifest`);
check(mf.ok, `manifest served: ${mf.status}`);

console.log(`\n${fails ? `✗ ${fails} failed` : '✓ all passed'} (read-only)`);
process.exitCode = fails ? 1 : 0;
