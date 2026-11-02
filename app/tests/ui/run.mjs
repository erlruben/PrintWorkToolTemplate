#!/usr/bin/env node
// Walk every screen through the harness (tests/ui/harness.mjs must be running)
// and save screenshots, in light and dark, at desktop / tablet / phone sizes.
// Also records console errors and the a11y quick checks (tests/ui/checks.js).
//
//   node tests/ui/run.mjs <outDir> [--roles] [--sizes=desktop,phone] [--themes=light,dark]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const H = 'http://127.0.0.1:9444';
const out = process.argv[2] ?? 'ui-shots';
const flag = (name, dflt) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]?.split(',') ?? dflt;
const SIZES = { desktop: [1440, 900, 0], laptop: [1280, 720, 0], tablet: [820, 1180, 1], phone: [390, 844, 1], small: [360, 740, 1] };
const sizes = flag('sizes', ['desktop', 'phone']);
const themes = flag('themes', ['light', 'dark']);
const roles = process.argv.includes('--roles') ? ['admin', 'receptionist', 'artist', 'operator'] : ['admin'];
const checks = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'checks.js'), 'utf8');
mkdirSync(out, { recursive: true });

const get = async (p) => (await fetch(H + p)).json();
const js = async (code) => (await fetch(H + '/eval', { method: 'POST', body: code })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Click the first visible element matching a selector, optionally with text.
const click = (sel, text = '') => js(`(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.offsetParent !== null && (!${JSON.stringify(text)} || e.textContent.trim().includes(${JSON.stringify(text)})));
  if (!els[0]) return 'missing';
  els[0].click(); return 'ok';
})()`);
const escape = () => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.querySelectorAll('.overlay .x, .notif-panel .x, .chat-panel-x').forEach((b) => b.click()); 1`);
const tab = (label) => click('.sidebar-nav button', label);
const openChat = () => js(`(() => {
  const mobile = window.matchMedia('(max-width: 860px)').matches;
  const button = document.querySelector(mobile ? '.chat-toggle' : '.sidebar-chat-action');
  button?.click(); return !!button;
})()`);

// Each screen: a name and how to get there from a fresh load.
const SCREENS = [
  ['orders', async () => {}],
  ['ticket', async () => { await click('table.glance tbody tr td.wo-num'); }],
  ['new-order', async () => { await click('button', 'New work order'); }],
  ['whats-new', async () => {}],
  ['workload', async () => { await tab('All Statistics'); }],
  ['queue', async () => { await tab('Print Queue'); }],
  ['print-all', async () => { await tab('Print Queue'); await click('[role="tab"]', 'All Print'); }],
  ['accounts', async () => { await tab('Admin Tools'); }],
  ['notifications', async () => { await click('.notif-bell, button[aria-label*="otification"]'); }],
  // The bubble is draggable, so it opens on a tap (pointer) or Enter — not click.
  ['chat', async () => { await openChat(); }],
  ['user-menu', async () => { await click('.user-menu-trigger'); }],
  ['settings', async () => { await click('.quick-settings-trigger'); await click('.quick-settings-full', 'Open Settings'); }],
  ['help', async () => { await click('.user-menu-trigger'); await sleep(200); await click('.user-menu-pop button', 'Help'); }],
  ['trash', async () => { await click('.user-menu-trigger'); await sleep(200); await click('.user-menu-pop button', 'Trash'); }],
];

const report = [];
for (const role of roles) {
  await get(`/role?r=${role}`);
  for (const theme of themes) {
    await get(`/theme?t=${theme}`);
    for (const size of sizes) {
      const [w, h, mobile] = SIZES[size];
      for (const [name, go] of SCREENS) {
        await get(`/reset`);
        await get(`/reload`);
        await get(`/theme?t=${theme}`);
        await get(`/shot?out=${encodeURIComponent(join(out, '_warm.png'))}&w=${w}&h=${h}&mobile=${mobile}&wait=100`);
        await go();
        await sleep(700);
        const file = join(out, `${role}-${theme}-${size}-${name}.png`);
        await get(`/shot?out=${encodeURIComponent(file)}&w=${w}&h=${h}&mobile=${mobile}`);
        const c = await js(checks);
        report.push({ role, theme, size, name, ...(c.value ?? { error: c.error }) });
        await escape();
      }
    }
  }
}
const log = await get('/log?clear=1');
writeFileSync(join(out, 'report.json'), JSON.stringify({ report, log }, null, 1));
console.log(`${report.length} screens → ${out}`);
const issues = report.filter((r) => r.error || r.hscroll || r.smallTargets?.length || r.lowContrast?.length || r.unlabeled?.length);
console.log(`${issues.length} screens with quick-check findings; console: ${log.log.filter((l) => !l.startsWith('MOCK')).length} errors/warnings; unknown requests: ${log.unknown.length}`);
