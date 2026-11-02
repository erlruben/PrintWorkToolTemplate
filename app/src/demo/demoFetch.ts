import { DEMO_ME, DEMO_TABLES, id } from "./demoData";

const db: Record<string, any[]> = structuredClone(DEMO_TABLES);

export const DEMO_ROLES = ["admin", "moderator", "receptionist", "artist", "operator", "supply_clerk"] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

export function demoRole(): DemoRole {
  try {
    const role = localStorage.getItem("printflow-demo-role");
    if (role && DEMO_ROLES.includes(role as any)) return role as DemoRole;
  } catch {}
  return "admin";
}

export function setDemoRole(role: DemoRole): void {
  try { localStorage.setItem("printflow-demo-role", role); } catch {}
}

// Each demo role signs in as one of the sample people, so their dashboard shows real work.
const PERSON: Record<DemoRole, string> = { admin: DEMO_ME, moderator: id(9), receptionist: id(2), artist: id(3), operator: id(5), supply_clerk: id(8) };
const ME = PERSON[demoRole()];
const exp = Math.floor(Date.now() / 1000) + 30 * 86400;

function base64url(o: any): string {
  const json = JSON.stringify(o);
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const user = {
  id: ME,
  aud: "authenticated",
  role: "authenticated",
  email: "testadmin@printflow.local",
  app_metadata: {},
  user_metadata: {},
  factors: [],
  created_at: new Date().toISOString(),
};

const jwt = `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url({
  sub: ME,
  role: "authenticated",
  aal: "aal1",
  amr: [{ method: "password", timestamp: 1 }],
  exp,
  email: user.email,
  session_id: "demo",
})}.demo`;

export const demoSession = {
  access_token: jwt,
  refresh_token: "demo",
  token_type: "bearer",
  expires_in: 30 * 86400,
  expires_at: exp,
  user,
};


function json(status: number, body?: unknown, extra: Record<string, string> = {}): Response {
  const headers = new Headers({
    "Content-Type": "application/json",
    ...extra
  });
  const bodyText = (status === 204 || typeof body === "undefined") ? null : JSON.stringify(body);
  return new Response(bodyText, { status, headers });
}

function applyFilters(rows: any[], params: URLSearchParams): any[] {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k) || k === 'or' || k === 'and')
      continue;
    const neg = v.startsWith('not.');
    const [op, ...rest] = (neg ? v.slice(4) : v).split('.');
    const val = rest.join('.');
    const test = (r: any) => {
      const x = r[k];
      switch (op) {
        case 'eq':
          return String(x) === val;
        case 'neq':
          return String(x) !== val;
        case 'is':
          return val === 'null' ? x == null : String(x) === val;
        case 'in':
          return val
            .replace(/^\(|\)$/g, "")
            .split(',')
            .map((s: string) => s.replace(/^"|"$/g, ''))
            .includes(String(x));
        case 'gt':
          return x != null && x > val;
        case 'gte':
          return x != null && x >= val;
        case 'lt':
          return x != null && x < val;
        case 'lte':
          return x != null && x <= val;
        default:
          return true;
      }
    };
    out = out.filter((r) => (neg ? !test(r) : test(r)));
  }
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split(',')[0].split('.');
    out = [...out].sort((a, b) =>
      (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1)
    );
  }
  const limit = params.get('limit');
  if (limit) out = out.slice(0, Number(limit));
  return out;
}

function rowsFor(table: string): any[] | undefined {
  if (table === 'profiles') {
    return db.profiles.map((p: any) => {
      if (p.id === ME) {
        return {
          ...p,
          role: demoRole(),
          site: demoRole() === 'operator' ? 'production' : p.site,
        };
      }
      return p;
    });
  }
  return db[table];
}

export async function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  const postData = typeof init?.body === "string" ? init.body : null;

  await new Promise((r) => setTimeout(r, 60));

  const path = url.pathname;
  if (method === "OPTIONS") return json(204);

  if (path.startsWith("/auth/v1/")) {
    if (path.endsWith("/user")) return json(200, user);
    if (path.endsWith("/token")) return json(200, demoSession);
    if (path.endsWith("/factors")) return json(200, []);
    return json(204);
  }

  if (path.startsWith("/functions/v1/")) {
    return json(200, {});
  }

  if (path.startsWith("/storage/v1/")) {
    if (method === "POST" && path.includes("/object/list")) return json(200, []);
    if (path.includes("/object/sign")) return json(200, { signedURL: "/favicon.svg" });
    return json(404, { message: "not found (offline demo)" });
  }

  const rest = path.match(/^\/rest\/v1\/(rpc\/)?([a-z_]+)/);
  if (!rest) return json(404, {});

  // RPC: set_printer_status
  if (rest[1] && rest[2] === "set_printer_status" && db.printer_status) {
    const a = postData ? JSON.parse(postData) : {};
    const row = db.printer_status.find((r) => r.site === a.p_site);
    if (row) {
      Object.assign(row, {
        state: a.p_state,
        note: a.p_state === "working" ? null : a.p_note ?? null,
        until: a.p_state === "cooldown"
          ? new Date(Date.now() + (a.p_seconds ?? 0) * 1000).toISOString()
          : null,
        changed_at: new Date().toISOString(),
        changed_by: ME,
        changed_by_name: "Test Admin",
      });
    }
    return json(200, row ?? null);
  }

  if (rest[1]) {
    return json(200, null);
  }

  const table = rest[2];
  const rows = rowsFor(table);
  if (!rows) {
    return json(404, { code: "PGRST205", message: `no table ${table}` });
  }

  const accept = headers.get("accept") ?? "";
  const prefer = headers.get("prefer") ?? "";
  const single = accept.includes("vnd.pgrst.object");
  const params = url.searchParams;

  if (method === "GET" || method === "HEAD") {
    const out = applyFilters(rows, params);
    const requestedRange = headers.get("range")?.match(/^(\d+)-(\d+)$/);
    const start = requestedRange ? Number(requestedRange[1]) : 0;
    const end = requestedRange ? Number(requestedRange[2]) : out.length - 1;
    const page = out.slice(start, end + 1);
    const range = { "Content-Range": page.length ? `${start}-${start + page.length - 1}/${out.length}` : `*/${out.length}` };
    if (method === "HEAD") return json(200, undefined, range);
    if (single) {
      return page.length
        ? json(200, page[0], range)
        : json(406, { code: "PGRST116", message: "no rows", details: "The result contains 0 rows" }, range);
    }
    return json(200, page, range);
  }

  const body = postData ? JSON.parse(postData) : null;
  let result: any[] = [];
  if (!db[table]) db[table] = [];
  switch (method) {
    case 'POST':
      result = (Array.isArray(body) ? body : [body]).map((r) => ({
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        ...r
      }));
      db[table].push(...result);
      break;
    case 'PATCH':
      result = applyFilters(db[table], params);
      for (const r of result) Object.assign(r, body);
      break;
    case 'DELETE':
      result = applyFilters(db[table], params);
      db[table] = db[table].filter((row) => !result.includes(row));
      break;
  }
  if (!prefer.includes('return=representation')) {
    return json(method === 'POST' ? 201 : 204)
  }
  return json(method === 'POST' ? 201 : 200, single ? (result[0] ?? null) : result)
}
