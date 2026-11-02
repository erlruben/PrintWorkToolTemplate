# Tests

Everything here is safe to run against the live app: nothing writes to the
production database. Run from `app/`.

| What | Command | Touches live data? |
|---|---|---|
| **Unit** — pure logic in `src/lib` (periods, identity, CSV, items, @mentions, links, roles, board moves) | `npm test` | No |
| **Smoke** — type-check, lint, production build | `npx tsc -b && npm run lint && npm run build` | No |
| **API** — signed-out visitor can read nothing; sign-up is closed; the live site's security headers | `npm run test:api` | Read-only, as a signed-out visitor |
| **UI / UX / Device / Role** — every screen, light + dark, desktop → small phone, as each role, with quick a11y checks | `npm run test:ui` (see below) | No — Supabase is answered from demo data |
| **Headers / CSP** — the built app served like Cloudflare (`_headers` + one-page fallback); the Content-Security-Policy allows what the app uses and refuses inline/foreign scripts, foreign requests, framing | `npm run build && node tests/serve-dist.mjs` (port 4180), then the `csp` suite of the regression runner (`csp-test.mjs`) | No |
| **Memory** — heap, DOM and listener growth over 30 rounds of normal use | `npm run test:memory` | No |
| **Role rules (database)** — what each role may read/write, signed-out access, Security Advisor | `npm run test:roles` | Runs on live, inside one transaction that is **always rolled back**. Needs `supabase/db.env`. Run off-hours, and only with the owner's go. |

## UI test harness (`tests/ui/`)

The app runs in a throwaway Chrome profile, "signed in" with a fake session.
`harness.mjs` answers every Supabase request from `fixtures.mjs` (made-up
people and jobs) and blocks realtime, so no request reaches the live project
and no password is needed. Writes only change the in-memory demo data.

```sh
npm run dev -- --port 5180 --strictPort            # 1. the app
"C:/Program Files/Google/Chrome/Application/chrome.exe" --remote-debugging-port=9333 \
  --user-data-dir=<a temp folder> http://localhost:5180   # 2. a throwaway browser
node tests/ui/harness.mjs                           # 3. the fake backend + control port :9444
node tests/ui/run.mjs <outDir> --roles --sizes=desktop,tablet,phone,small
node tests/ui/memory.mjs 30
```

`run.mjs` saves a screenshot per role × theme × size × screen and a
`report.json` with, per screen: horizontal page scroll, tap targets under
24px on phones, controls without a label, and text under WCAG AA contrast
(`checks.js`), plus any console errors. Control the harness by hand with
`/role?r=operator`, `/theme?t=dark`, `/shot?out=x.png&w=390&h=844&mobile=1`,
`/eval` (POST JS), `/heap`, `/log`.
