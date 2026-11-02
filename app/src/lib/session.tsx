import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { SessionContext, type SessionValue } from './sessionContext';
import type { Profile } from './types';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  // Arrived from a reset-password email link (Supabase's PASSWORD_RECOVERY).
  const [recovering, setRecovering] = useState(false);
  // Which user id the loaded profile belongs to — so a token refresh (same
  // user) never triggers a reload or a loading flash.
  const loadedFor = useRef<string | null>(null);

  /**
   * Load the profile, returning true once the QUERY succeeded — the data may
   * still be null, which genuinely means "this user has no profile". A network
   * or auth error (e.g. an expired token) is retried a few times rather than
   * being mistaken for "no profile", which used to strand a valid user on the
   * "No profile yet" screen.
   *
   * The query carries the session's own token. Without it, supabase-js falls
   * back to the anon key whenever it cannot hand over a session at that moment
   * (a refresh failing on a flaky network); row security then returns zero
   * rows with no error, which looked exactly like "no profile". An empty
   * answer is retried too, since every account gets a profile when created.
   */
  async function loadProfile(userId: string, accessToken?: string): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let query = supabase.from('profiles').select('*').eq('id', userId);
      if (accessToken) query = query.setHeader('Authorization', `Bearer ${accessToken}`);
      const { data, error } = await query.maybeSingle();
      if (!error && (data || attempt === 2)) {
        setProfile((data as Profile) ?? null);
        loadedFor.current = userId;
        return true;
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
    return false;
  }

  useEffect(() => {
    let cancelled = false;

    async function sync(next: Session | null) {
      if (cancelled) return;
      setSession(next);

      if (!next) {
        setProfile(null);
        loadedFor.current = null;
        setLoading(false);
        return;
      }

      // Same signed-in user (e.g. a periodic token refresh) — nothing to do.
      if (loadedFor.current === next.user.id) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const ok = await loadProfile(next.user.id, next.access_token);
      if (cancelled) return;

      if (!ok) {
        // The session cannot read its own profile after several tries —
        // almost always a stale or expired token. Sign out so the person gets
        // a clean login rather than a dead-end "No profile yet" screen. The
        // resulting SIGNED_OUT event re-runs sync and clears loading.
        await supabase.auth.signOut();
        return;
      }
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data }) => sync(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') setRecovering(false);
      sync(next);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value: SessionValue = {
    session,
    profile,
    loading,
    refreshProfile: async () => {
      if (session) await loadProfile(session.user.id, session.access_token);
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
    recovering,
    endRecovery: () => setRecovering(false),
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
