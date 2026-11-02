#!/usr/bin/env node
// Offline UI test harness. Drives a Chrome started with
//   --remote-debugging-port=9333 --user-data-dir=<a throwaway profile>
// and answers every Supabase call from tests/ui/fixtures.mjs, so the app runs
// signed in with demo data and NOTHING reaches the live project (realtime is
// blocked; writes only change the in-memory demo data).
//
//   node tests/ui/harness.mjs [appUrl=http://localhost:5180]
// then control it over http://127.0.0.1:9444 (see tests/ui/run.mjs):
//   /role?r=artist   /theme?t=dark   /nav?hash=queue   /shot?out=x.png&w=390&h=844&mobile=1
//   /eval (POST body = JS)   /reset   /log   /heap
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { ME, TABLES } from './fixtures.mjs';

const APP = process.argv[2] ?? 'http://localhost:5180';
const state = { role: 'admin', log: [], unknown: [] };
const db = structuredClone(TABLES);

// ---- CDP ------------------------------------------------------------------
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
let page = list.find((t) => t.type === 'page' && t.url.startsWith(APP)) ?? list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const waiting = new Map();
const send = (method, params = {}) => new Promise((r) => { const i = ++seq; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
  if (m.method === 'Fetch.requestPaused') onRequest(m.params).catch((err) => console.error('mock error', err));
  if (m.method === 'Runtime.exceptionThrown') state.log.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
    state.log.push(`${m.params.type.toUpperCase()} ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
};
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable');
await send('Network.enable');
// Realtime is a websocket (Fetch can't answer it) — block it outright.
await send('Network.setBlockedURLs', { urls: ['*supabase.co/realtime*', 'wss://*supabase.co*'] });
await send('Fetch.enable', { patterns: [{ urlPattern: '*supabase.co*', requestStage: 'Request' }] });

// ---- fake auth --------------------------------------------------------------
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
const user = { id: ME, aud: 'authenticated', role: 'authenticated', email: 'testadmin@printflow.local', app_metadata: {}, user_metadata: {}, factors: [], created_at: new Date().toISOString() };
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ME, role: 'authenticated', aal: 'aal1', amr: [{ method: 'password', timestamp: 1 }], exp, email: user.email, session_id: 'demo' })}.demo`;
const session = { access_token: jwt, refresh_token: 'demo', token_type: 'bearer', expires_in: 30 * 86400, expires_at: exp, user };

// ---- a tiny PostgREST ----------------------------------------------------------
function applyFilters(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k) || k === 'or' || k === 'and') continue;
    const neg = v.startsWith('not.');
    const [op, ...rest] = (neg ? v.slice(4) : v).split('.');
    const val = rest.join('.');
    const test = (r) => {
      const x = r[k];
      switch (op) {
        case 'eq': return String(x) === val;
        case 'neq': return String(x) !== val;
        case 'is': return val === 'null' ? x == null : String(x) === val;
        case 'in': return val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(x));
        case 'gt': return x != null && x > val;
        case 'gte': return x != null && x >= val;
        case 'lt': return x != null && x < val;
        case 'lte': return x != null && x <= val;
        default: return true;
      }
    };
    out = out.filter((r) => (neg ? !test(r) : test(r)));
  }
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split(',')[0].split('.');
    out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  const limit = params.get('limit');
  if (limit) out = out.slice(0, Number(limit));
  return out;
}

function rowsFor(table) {
  if (table === 'profiles') return db.profiles.map((p) => (p.id === ME ? { ...p, role: state.role, site: state.role === 'operator' ? 'production' : p.site } : p));
  return db[table];
}

async function reply(requestId, status, body, extraHeaders = {}) {
  const text = body === undefined ? '' : JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*', ...extraHeaders };
  await send('Fetch.fulfillRequest', {
    requestId, responseCode: status,
    responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value: String(value) })),
    body: Buffer.from(text).toString('base64'),
  });
}

async function onRequest({ requestId, request }) {
  const u = new URL(request.url);
  const m = request.method;
  const path = u.pathname;
  if (m === 'OPTIONS') return reply(requestId, 204);
  if (path.startsWith('/auth/v1/')) {
    if (path.endsWith('/user')) return reply(requestId, 200, user);
    if (path.endsWith('/token')) return reply(requestId, 200, session);
    if (path.endsWith('/factors')) return reply(requestId, 200, []);
    return reply(requestId, 204);
  }
  if (path.startsWith('/functions/v1/')) { state.log.push(`MOCK function ${path}`); return reply(requestId, 200, {}); }
  if (path.startsWith('/storage/v1/')) {
    if (m === 'POST' && path.includes('/object/list')) return reply(requestId, 200, []);
    if (path.includes('/object/sign')) return reply(requestId, 200, { signedURL: '/favicon.svg' });
    return reply(requestId, 404, { message: 'not found (offline demo)' });
  }
  const rest = path.match(/^\/rest\/v1\/(rpc\/)?([a-z_]+)/);
  if (!rest) { state.unknown.push(`${m} ${path}`); return reply(requestId, 404, {}); }
  // Printer status per area (2026-10-27): change the demo row, like set_printer_status does.
  if (rest[1] && rest[2] === 'set_printer_status' && db.printer_status) {
    const a = request.postData ? JSON.parse(request.postData) : {};
    const row = db.printer_status.find((r) => r.site === a.p_site);
    if (row) Object.assign(row, { state: a.p_state, note: a.p_state === 'working' ? null : a.p_note ?? null,
      until: a.p_state === 'cooldown' ? new Date(Date.now() + (a.p_seconds ?? 0) * 1000).toISOString() : null,
      changed_at: new Date().toISOString(), changed_by: ME, changed_by_name: 'Test Admin' });
    return reply(requestId, 200, row ?? null);
  }
  if (rest[1]) { state.log.push(`MOCK rpc ${rest[2]}`); return reply(requestId, 200, null); }
  const table = rest[2];
  const rows = rowsFor(table);
  if (!rows) { state.unknown.push(`table ${table}`); return reply(requestId, 404, { code: 'PGRST205', message: `no table ${table}` }); }
  const accept = Object.entries(request.headers).find(([k]) => k.toLowerCase() === 'accept')?.[1] ?? '';
  const prefer = Object.entries(request.headers).find(([k]) => k.toLowerCase() === 'prefer')?.[1] ?? '';
  const single = accept.includes('vnd.pgrst.object');
  const params = u.searchParams;

  if (m === 'GET' || m === 'HEAD') {
    const out = applyFilters(rows, params);
    const range = { 'Content-Range': `0-${Math.max(out.length - 1, 0)}/${out.length}` };
    if (m === 'HEAD') return reply(requestId, 200, undefined, range);
    if (single) return out.length ? reply(requestId, 200, out[0], range) : reply(requestId, 406, { code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' });
    return reply(requestId, 200, out, range);
  }
  // Writes only touch the in-memory demo data.
  const body = request.postData ? JSON.parse(request.postData) : null;
  state.log.push(`MOCK ${m} ${table}`);
  let result = [];
  if (m === 'POST') {
    result = (Array.isArray(body) ? body : [body]).map((r) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r }));
    db[table]?.push(...result);
  } else if (m === 'PATCH') {
    result = applyFilters(db[table], params);
    for (const r of result) Object.assign(r, body);
  } else if (m === 'DELETE') {
    result = applyFilters(db[table], params);
    db[table] = db[table].filter((r) => !result.includes(r));
  }
  if (!prefer.includes('return=representation')) return reply(requestId, m === 'POST' ? 201 : 204);
  return reply(requestId, m === 'POST' ? 201 : 200, single ? result[0] ?? null : result);
}

// ---- page helpers -------------------------------------------------------------------
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text };
  return { value: r.result?.result?.value };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The storage key is "sb-<project ref>-auth-token"; learn the ref from the configured URL.
// A built app (tests/serve-dist.mjs) has no /src to read: pass SUPABASE_REF=<project ref> then.
const projectRef = process.env.SUPABASE_REF || (await evaluate(`(async()=>{try{const m=await import('/src/lib/supabase.ts');return new URL(m.supabase.supabaseUrl||m.supabase.rest?.url||'').hostname.split('.')[0]}catch(e){return ''}})()`)).value;
const KEY = `sb-${projectRef}-auth-token`;
console.log('project ref found:', !!projectRef);
async function boot(hash = '') {
  await evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(session))}); 1`);
  await send('Page.navigate', { url: `${APP}/${hash ? '#' + hash : ''}` });
  await sleep(2500);
}
await boot();

// ---- control server -----------------------------------------------------------------
http.createServer(async (req, res) => {
  const q = new URL(req.url, 'http://x');
  let body = '';
  for await (const chunk of req) body += chunk;
  const done = (v) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(v, null, 1)); };
  try {
    switch (q.pathname) {
      case '/role': state.role = q.searchParams.get('r'); await boot(q.searchParams.get('hash') ?? ''); return done({ role: state.role });
      case '/reload': await boot(q.searchParams.get('hash') ?? ''); return done({ ok: true });
      case '/theme': return done(await evaluate(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(q.searchParams.get('t'))}); localStorage.setItem('theme', ${JSON.stringify(q.searchParams.get('t'))}); 1`));
      case '/eval': return done(await evaluate(body));
      case '/shot': {
        const w = +(q.searchParams.get('w') ?? 1440), h = +(q.searchParams.get('h') ?? 900), mobile = q.searchParams.get('mobile') === '1';
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
        await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
        await sleep(+(q.searchParams.get('wait') ?? 600));
        const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: q.searchParams.get('full') === '1' });
        writeFileSync(q.searchParams.get('out'), Buffer.from(r.result.data, 'base64'));
        return done({ saved: q.searchParams.get('out') });
      }
      case '/media': {
        // e.g. prefers-reduced-motion / prefers-color-scheme emulation
        await send('Emulation.setEmulatedMedia', { features: [...q.searchParams].map(([name, value]) => ({ name, value })) });
        return done({ ok: true });
      }
      case '/heap': {
        await send('HeapProfiler.enable');
        await send('HeapProfiler.collectGarbage');
        const m = await send('Runtime.getHeapUsage');
        const dom = await evaluate('document.getElementsByTagName("*").length');
        const perf = await send('Performance.getMetrics').catch(() => null);
        return done({ usedMB: +(m.result.usedSize / 1048576).toFixed(2), totalMB: +(m.result.totalSize / 1048576).toFixed(2), domNodes: dom.value, metrics: perf?.result?.metrics?.filter((x) => ['JSEventListeners', 'Nodes', 'Documents'].includes(x.name)) });
      }
      case '/perf': { await send('Performance.enable'); return done({ ok: true }); }
      case '/log': { const v = { log: state.log, unknown: [...new Set(state.unknown)] }; if (q.searchParams.get('clear')) { state.log = []; state.unknown = []; } return done(v); }
      case '/reset': await send('Emulation.clearDeviceMetricsOverride'); return done({ ok: true });
      default: res.statusCode = 404; return done({ error: 'unknown' });
    }
  } catch (e) { res.statusCode = 500; done({ error: String(e) }); }
}).listen(9444, '127.0.0.1', () => console.log('harness ready on :9444'));
