import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { appConfig } from "../lib/config";
import { supabase } from "../lib/supabase";

type AuthValue = {
  loading: boolean;
  user: User | null;
  session: Session | null;
  isDemo: boolean;
  signIn(email: string, password: string): Promise<string | null>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(!appConfig.demoMode);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!supabase || appConfig.demoMode) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      loading,
      user: appConfig.demoMode
        ? ({
            id: "00000000-0000-4000-8000-000000000001",
            email: "demo@local",
          } as User)
        : (session?.user ?? null),
      session,
      isDemo: appConfig.demoMode,
      async signIn(email, password) {
        if (!supabase || appConfig.demoMode) return null;
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        return error?.message ?? null;
      },
      async signOut() {
        if (supabase) await supabase.auth.signOut();
      },
    }),
    [loading, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}
