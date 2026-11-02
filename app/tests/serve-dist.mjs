#!/usr/bin/env node
// Serve the built app (app/dist) on localhost the way Cloudflare does: the
// headers from public/_headers (copied into dist/_headers by the build) and the
// one-page-app fallback to index.html. For testing the Content-Security-Policy
// and other headers before a release.
//
//   npm run build && node tests/serve-dist.mjs [port=4180]
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const PORT = Number(process.argv[2] ?? 4180);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.txt': 'text/plain' };

// _headers: a path line, then indented "Name: value" lines. Only the patterns
// this app uses: an exact path, or one ending in "*".
const rules = [];
let cur = null;
for (const raw of readFileSync(join(DIST, '_headers'), 'utf8').split(/\r?\n/)) {
  if (!raw.trim() || raw.trim().startsWith('#')) continue;
  if (!/^\s/.test(raw)) { cur = { path: raw.trim(), headers: [] }; rules.push(cur); continue; }
  const i = raw.indexOf(':');
  if (cur && i > 0) cur.headers.push([raw.slice(0, i).trim(), raw.slice(i + 1).trim()]);
}
const headersFor = (path) => rules
  .filter((r) => (r.path.endsWith('*') ? path.startsWith(r.path.slice(0, -1)) : path === r.path))
  .flatMap((r) => r.headers);

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(DIST, path));
  if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end(); }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');   // one-page app
  for (const [k, v] of headersFor(path)) res.setHeader(k, v);
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}).listen(PORT, '127.0.0.1', () => console.log(`dist on http://localhost:${PORT} with ${rules.length} header rules`));
