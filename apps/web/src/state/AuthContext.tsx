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
import {
  authErrorMessage,
  authRedirectUrl,
  clearAuthCallbackParams,
  readAuthCallbackError,
} from "../lib/auth";

type AuthValue = {
  loading: boolean;
  user: User | null;
  session: Session | null;
  authError: string | null;
  isDemo: boolean;
  signIn(email: string, password: string): Promise<string | null>;
  signInWithGoogle(): Promise<string | null>;
  sendMagicLink(email: string): Promise<string | null>;
  sendPasswordReset(email: string): Promise<string | null>;
  updatePassword(password: string): Promise<string | null>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(!appConfig.demoMode);
  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || appConfig.demoMode) return;
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) setAuthError(null);
      setLoading(false);
    });
    void (async () => {
      const callbackError = readAuthCallbackError(
        window.location.search,
        window.location.hash,
      );
      try {
        const { data: sessionData, error } = await supabase.auth.getSession();
        if (error) setAuthError(authErrorMessage(error.message));
        setSession(sessionData.session);
        if (!sessionData.session && callbackError) setAuthError(callbackError);
        if (callbackError || new URL(window.location.href).searchParams.has("code")) {
          window.history.replaceState(
            {},
            document.title,
            clearAuthCallbackParams(window.location.href),
          );
        }
      } catch (error) {
        setAuthError(
          authErrorMessage(
            error instanceof Error
              ? error.message
              : "Không thể kiểm tra phiên đăng nhập.",
          ),
        );
      } finally {
        setLoading(false);
      }
    })();
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
      authError,
      isDemo: appConfig.demoMode,
      async signIn(email, password) {
        if (!supabase || appConfig.demoMode) return null;
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        const message = authErrorMessage(error?.message);
        if (message) setAuthError(message);
        return message;
      },
      async signInWithGoogle() {
        if (!supabase || appConfig.demoMode) return null;
        setAuthError(null);
        try {
          const redirectTo = authRedirectUrl(
            window.location.origin,
            import.meta.env.BASE_URL,
          );
          const { data, error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo },
          });
          if (error) {
            const message = authErrorMessage(error.message);
            setAuthError(message);
            return message;
          }
          if (!data.url) {
            const message = "Không nhận được địa chỉ đăng nhập Google từ Supabase.";
            setAuthError(message);
            return message;
          }
          return null;
        } catch (error) {
          const message = authErrorMessage(
            error instanceof Error
              ? error.message
              : "Không thể bắt đầu đăng nhập Google.",
          );
          setAuthError(message);
          return message;
        }
      },
      async sendMagicLink(email) {
        if (!supabase || appConfig.demoMode) return null;
        const redirectTo = authRedirectUrl(
          window.location.origin,
          import.meta.env.BASE_URL,
        );
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: redirectTo,
            shouldCreateUser: false,
          },
        });
        const message = authErrorMessage(error?.message);
        if (message) setAuthError(message);
        return message;
      },
      async sendPasswordReset(email) {
        if (!supabase || appConfig.demoMode) return null;
        const redirectTo = authRedirectUrl(
          window.location.origin,
          import.meta.env.BASE_URL,
          "reset-password",
        );
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo,
        });
        const message = authErrorMessage(error?.message);
        if (message) setAuthError(message);
        return message;
      },
      async updatePassword(password) {
        if (!supabase || appConfig.demoMode) return null;
        const { error } = await supabase.auth.updateUser({ password });
        const message = authErrorMessage(error?.message);
        if (message) setAuthError(message);
        return message;
      },
      async signOut() {
        if (supabase) await supabase.auth.signOut();
      },
    }),
    [authError, loading, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}
