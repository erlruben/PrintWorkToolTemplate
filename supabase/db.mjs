#!/usr/bin/env node
// Run Supabase CLI database commands against the live project without typing
// the connection string. It is read from supabase/db.env (gitignored — never
// commit it):
//
//   SUPABASE_DB_URL=postgresql://postgres.<project-ref>:<password>@<pooler-host>:5432/postgres
//
// Usage (from the repo root):
//   node supabase/db.mjs list              which migrations are applied on live
//   node supabase/db.mjs push --dry-run    what `push` would apply, without applying
//   node supabase/db.mjs push              apply the pending migrations to live
//   npx supabase migration new <name>      start a new migration file
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, 'db.env');
if (!existsSync(envFile)) {
  console.error('Missing supabase/db.env — create it with SUPABASE_DB_URL=… (see the top of this file).');
  process.exit(1);
}
const url = readFileSync(envFile, 'utf8').match(/^SUPABASE_DB_URL=(.+)$/m)?.[1]?.trim();
if (!url) { console.error('supabase/db.env has no SUPABASE_DB_URL line.'); process.exit(1); }

const [cmd, ...rest] = process.argv.slice(2);
const args = {
  list: ['migration', 'list'],
  push: ['db', 'push'],
  repair: ['migration', 'repair'],
}[cmd];
if (!args) {
  console.error('Use: node supabase/db.mjs list | push [--dry-run] | repair <version> --status applied|reverted');
  process.exit(1);
}
// The CLI version is pinned so everyone runs the same one.
const r = spawnSync('npx', ['--yes', 'supabase@2.119.0', ...args, ...rest, '--db-url', url], {
  cwd: join(here, '..'), stdio: 'inherit', shell: process.platform === 'win32',
});
process.exit(r.status ?? 1);
