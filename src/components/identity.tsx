"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Wave identity layer — wraps Netlify Identity (GoTrue) via
 * netlify-identity-widget, exposed as a React context.
 *
 * Same-origin on Netlify, so no CORS config is needed; works identically
 * inside the Android TWA (the app IS the live site).
 */

/** Minimal shape of the widget's user — extend as Wave starts using profile fields. */
export interface IdentityUser {
  id: string;
  email?: string;
  user_metadata?: { full_name?: string };
  app_metadata?: { provider?: string };
}

/** The deployed site — used as the Identity API for `next dev` on localhost
 *  (localhost has no /.netlify/identity of its own). Update if the domain changes. */
const SITE_IDENTITY_URL = "https://wave-musical.netlify.app/.netlify/identity";

type WidgetApi = {
  init: (opts: { APIUrl: string; locale?: string }) => void;
  on: (event: string, cb: (payload?: unknown) => void) => void;
  open: (tab?: "login" | "signup" | "user") => void;
  close: () => void;
  logout: () => void;
  currentUser: () => IdentityUser | null;
};

interface IdentityContextValue {
  user: IdentityUser | null;
  ready: boolean;
  openLogin: () => void;
  openSignup: () => void;
  openAccount: () => void;
  logout: () => void;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<IdentityUser | null>(null);
  const [ready, setReady] = useState(false);
  const widgetRef = useRef<WidgetApi | null>(null);

  useEffect(() => {
    let mounted = true;

    // Dynamic import keeps the DOM-touching widget out of SSR entirely.
    import("netlify-identity-widget")
      .then((mod) => {
        const identity = (mod.default ?? mod) as unknown as WidgetApi;
        if (!mounted) return;
        widgetRef.current = identity;

        const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
        // On localhost, borrow the deployed site's Identity service.
        identity.init({
          APIUrl: isLocalhost ? SITE_IDENTITY_URL : `${window.location.origin}/.netlify/identity`,
          locale: "en",
        });

        identity.on("init", (u) => {
          if (!mounted) return;
          setUser((u as IdentityUser) ?? null);
          setReady(true);
        });
        identity.on("login", (u) => {
          if (!mounted) return;
          setUser((u as IdentityUser) ?? null);
          identity.close();
        });
        identity.on("logout", () => {
          if (!mounted) return;
          setUser(null);
        });
        identity.on("error", (err) => {
          console.warn("[identity]", err);
        });
      })
      .catch((err) => console.warn("[identity] failed to load widget:", err));

    return () => {
      mounted = false;
    };
  }, []);

  const openLogin = useCallback(() => widgetRef.current?.open("login"), []);
  const openSignup = useCallback(() => widgetRef.current?.open("signup"), []);
  const openAccount = useCallback(() => widgetRef.current?.open("user"), []);
  const logout = useCallback(() => widgetRef.current?.logout(), []);

  return (
    <IdentityContext.Provider value={{ user, ready, openLogin, openSignup, openAccount, logout }}>
      {children}
    </IdentityContext.Provider>
  );
}

export function useIdentity(): IdentityContextValue {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error("useIdentity must be used inside <IdentityProvider>");
  return ctx;
}
