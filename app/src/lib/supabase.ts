import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured =
  !!url && !!key && !url.includes('YOUR-PROJECT') && !key.includes('YOUR-ANON');

/* Demo mode: no Supabase project yet, the app runs on built-in fictional data in the browser */
export const isDemo = !isConfigured || import.meta.env.VITE_DEMO === "1";

const demo = isDemo ? await import("../demo/demoFetch") : null;

if (demo) {
  try {
    localStorage.setItem("sb-demo-auth-token", JSON.stringify(demo.demoSession));
  } catch {}
}

const DEMO_URL = "https://demo.supabase.co";
const DEMO_KEY = "demo-anon-key";

class OfflineSocket {
  constructor(_url: string) {}
  readyState = 3;
  onopen: ((ev: any) => any) | null = null;
  onclose: ((ev: any) => any) | null = null;
  onerror: ((ev: any) => any) | null = null;
  onmessage: ((ev: any) => any) | null = null;
  send() {}
  close() {}
}

export const supabase = createClient(
  demo ? DEMO_URL : (url ?? "http://localhost"),
  demo ? DEMO_KEY : (key ?? "anon"),
  {
    auth: {
      persistSession: true,
      autoRefreshToken: !demo
    },
    ...(demo
      ? {
          global: { fetch: demo.demoFetch },
          realtime: { transport: OfflineSocket as unknown as typeof WebSocket }
        }
      : {})
  }
);

/**
 * The signed-in session's token, or null. A query whose empty answer the app
 * acts on should carry it explicitly (`.setHeader('Authorization', …)`): when
 * supabase-js cannot hand over a session at that moment it falls back to the
 * anon key, and row security then answers "no rows" with no error — which
 * looks exactly like "nothing there".
 */
export async function userBearer(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session ? `Bearer ${data.session.access_token}` : null;
}
