#!/usr/bin/env node
// Memory test (harness must be running): measure the heap and DOM after a
// warm-up, then after N rounds of normal use (open/close a ticket, switch every
// tab, open/close the chat and notifications). After garbage collection the
// heap and node counts should come back close to the warm-up numbers; steady
// growth round after round means something is leaking (listeners, timers,
// subscriptions that never unsubscribe).
//
//   node tests/ui/memory.mjs [rounds=30]
const H = 'http://127.0.0.1:9444';
const rounds = Number(process.argv[2] ?? 30);
const get = async (p) => (await fetch(H + p)).json();
const js = async (code) => (await fetch(H + '/eval', { method: 'POST', body: code })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (sel, text = '') => js(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent !== null && x.textContent.includes(${JSON.stringify(text)})); if (e) e.click(); return !!e; })()`);
const esc = () => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.querySelectorAll('.overlay .x').forEach((b) => b.click()); 1`);

async function round() {
  for (const t of ['All Statistics', 'Print Queue', 'Admin Tools', 'Chat', 'Work Orders']) { await click('.sidebar-nav button', t); await sleep(250); }
  await click('[role="tab"]', 'All Print'); await sleep(200);
  await click('[role="tab"]', 'Print Dashboard'); await sleep(200);
  await click('.quick-settings-trigger'); await sleep(100);
  await click('.quick-settings-trigger'); await sleep(100);
  await click('table.glance tbody tr td.wo-num'); await sleep(400); await esc(); await sleep(200);
  await js(`(() => { const b = document.querySelector('.sidebar-chat-action'); b?.click(); return !!b; })()`);
  await sleep(300); await js(`document.querySelector('.chat-panel-x')?.click(); 1`); await sleep(200);
  await click('.notif-bell'); await sleep(250); await click('.notif-bell'); await sleep(150);
}

await get('/perf');
await get('/reload');
await get('/reset');
for (let i = 0; i < 3; i++) await round();          // warm-up: caches, lazy chunks
const start = await get('/heap');
console.log(`after warm-up: heap ${start.usedMB} MB, DOM ${start.domNodes}, listeners ${start.metrics?.find((m) => m.name === 'JSEventListeners')?.value}`);
const samples = [];
for (let i = 1; i <= rounds; i++) {
  await round();
  if (i % 10 === 0) {
    const m = await get('/heap');
    samples.push(m);
    console.log(`round ${i}: heap ${m.usedMB} MB, DOM ${m.domNodes}, listeners ${m.metrics?.find((x) => x.name === 'JSEventListeners')?.value}`);
  }
}
const end = samples.at(-1);
const growMB = end.usedMB - start.usedMB;
const listen = (m) => m.metrics?.find((x) => x.name === 'JSEventListeners')?.value ?? 0;
const ok = growMB < 5 && end.domNodes < start.domNodes * 1.2 && listen(end) < listen(start) * 1.2 + 50;
console.log(`\n${ok ? '✓' : '✗'} after ${rounds} rounds: heap ${growMB >= 0 ? '+' : ''}${growMB.toFixed(2)} MB, DOM ${end.domNodes - start.domNodes >= 0 ? '+' : ''}${end.domNodes - start.domNodes}, listeners ${listen(end) - listen(start) >= 0 ? '+' : ''}${listen(end) - listen(start)}`);
process.exitCode = ok ? 0 : 1;
