#!/usr/bin/env node
// Scrolled-viewport check (tests/ui/harness.mjs must be running).
// Full-page screenshots draw pinned elements once, at the top, so they never
// show a fixed button sitting on top of content the user has scrolled to.
// This opens each screen, scrolls it, saves a viewport screenshot and fails
// when anything other than its own bar shows behind the pinned header buttons.
//
//   node tests/ui/scrolled.mjs <outDir> [--sizes=desktop,laptop,tablet] [--themes=light,dark]
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const H = 'http://127.0.0.1:9444';
const out = resolve(process.argv[2] ?? 'ui-shots/scrolled');
const flag = (name, dflt) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]?.split(',') ?? dflt;
const SIZES = { desktop: [1440, 900], laptop: [1280, 720], tablet: [1024, 768] };
const sizes = flag('sizes', ['desktop', 'laptop', 'tablet']);
const themes = flag('themes', ['light', 'dark']);
const TABS = ['All Statistics', 'Work Orders', 'Print Queue', 'Inventory', 'Admin Tools'];
mkdirSync(out, { recursive: true });

const get = async (p) => (await fetch(H + p)).json();
const js = async (code) => (await fetch(H + '/eval', { method: 'POST', body: code })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const overlap = `(() => {
  const hits = [];
  for (const a of document.querySelectorAll('.workspace-actions > *')) {
    const b = a.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    for (const x of [b.left + 4, b.left + b.width / 2, b.right - 4]) for (const y of [b.top + 4, b.top + b.height / 2, b.bottom - 4]) {
      // The first thing BEHIND the button must be its own bar. Page content
      // showing through there is the bug, even when the button stays on top.
      const under = document.elementsFromPoint(x, y).find((e) => !e.closest('.workspace-actions'));
      if (under && !under.closest('.workspace-bar')) hits.push(typeof under.className === 'string' && under.className ? under.className : under.tagName);
    }
  }
  return [...new Set(hits)];
})()`;

let failed = 0;
let checked = 0;
for (const theme of themes) {
  for (const size of sizes) {
    const [w, h] = SIZES[size];
    for (const tab of TABS) {
      await get('/reload');
      // Demo mode opens a device-preview frame; test the app itself.
      if ((await js("!!document.querySelector('.demo-preview-frame')")).value) { await js("location.replace('/?devicePreview=1'); 1"); await sleep(2500); }
      await get(`/theme?t=${theme}`);
      await get(`/shot?out=${encodeURIComponent(`${out}/_warm.png`)}&w=${w}&h=${h}&wait=300`);
      const found = (await js(`(() => { const b = [...document.querySelectorAll('.sidebar-nav button')].find((e) => e.textContent.includes(${JSON.stringify(tab)})); b?.click(); return !!b; })()`)).value;
      if (!found) continue; // not on this role's menu
      checked++;
      await sleep(700);
      await js('window.scrollTo(0, Math.min(500, document.documentElement.scrollHeight)); 1');
      await sleep(300);
      const name = `${tab.replace(/\W+/g, '-').toLowerCase()}-${size}-${theme}.png`;
      await get(`/shot?out=${encodeURIComponent(`${out}/${name}`)}&w=${w}&h=${h}&wait=300`);
      const hits = (await js(overlap)).value ?? [];
      if (hits.length) { failed++; console.log(`FAIL ${name}: content behind the header buttons: ${hits.join(', ')}`); }
    }
  }
}
if (!checked) { failed++; console.log('FAIL no screens found: is the app signed in and the harness pointed at it?'); }
console.log(failed ? `${failed} scrolled view(s) with content behind pinned buttons` : 'scrolled views: only the header bar behind the pinned buttons');
process.exitCode = failed ? 1 : 0;
