"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AuthError,
  MissingIdentityError,
  getUser,
  handleAuthCallback,
  login,
  logout as identityLogout,
  onAuthChange,
  requestPasswordRecovery,
  signup,
  updateUser,
  type User,
} from "@netlify/identity";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Wave identity layer — wraps Netlify Identity via the headless
 * @netlify/identity client, exposed as a React context with Wave's own
 * sign-in / sign-up / account dialog.
 *
 * Same-origin on Netlify, so no CORS config is needed; works identically
 * inside the Android TWA (the app IS the live site). Locally, run
 * `netlify dev` so /.netlify/identity is available.
 */

export type IdentityUser = User;

type View = "login" | "signup" | "recover" | "reset" | "user";

interface IdentityContextValue {
  user: IdentityUser | null;
  ready: boolean;
  openLogin: () => void;
  openSignup: () => void;
  openAccount: () => void;
  logout: () => void;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

function describeError(err: unknown): string {
  if (err instanceof MissingIdentityError) return "Accounts aren't available right now.";
  if (err instanceof AuthError) {
    if (err.status === 401) return "Invalid email or password.";
    if (err.status === 403) return "Sign-ups are currently closed.";
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<IdentityUser | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    // Process confirmation / recovery / OAuth links (#..._token=...) first,
    // then fall back to any existing session.
    (async () => {
      try {
        const result = await handleAuthCallback();
        if (result?.type === "confirmation") setNotice("Email confirmed — you're signed in.");
        if (result?.type === "recovery") setView("reset");
      } catch (err) {
        console.warn("[identity]", err);
      }
      const u = await getUser();
      if (!mounted) return;
      setUser(u);
      setReady(true);
    })();

    const unsubscribe = onAuthChange((_event, u) => {
      if (mounted) setUser(u ?? null);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const open = useCallback((v: View) => {
    setNotice(null);
    setView(v);
  }, []);
  const openLogin = useCallback(() => open("login"), [open]);
  const openSignup = useCallback(() => open("signup"), [open]);
  const openAccount = useCallback(() => open("user"), [open]);
  const logout = useCallback(() => {
    identityLogout()
      .catch((err) => console.warn("[identity]", err))
      .finally(() => {
        setUser(null);
        setView(null);
      });
  }, []);

  return (
    <IdentityContext.Provider value={{ user, ready, openLogin, openSignup, openAccount, logout }}>
      {children}
      <IdentityDialog
        view={view}
        setView={setView}
        user={user}
        notice={notice}
        setNotice={setNotice}
        onLogout={logout}
      />
    </IdentityContext.Provider>
  );
}

const fieldClass =
  "h-10 w-full rounded-lg bg-surface-2 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-white/20";
const primaryBtn =
  "flex h-10 w-full items-center justify-center rounded-full bg-white text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-60";
const linkBtn = "text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";

const TITLES: Record<View, string> = {
  login: "Sign in to Wave",
  signup: "Create your Wave account",
  recover: "Reset your password",
  reset: "Choose a new password",
  user: "Your account",
};

function IdentityDialog({
  view,
  setView,
  user,
  notice,
  setNotice,
  onLogout,
}: {
  view: View | null;
  setView: (v: View | null) => void;
  user: IdentityUser | null;
  notice: string | null;
  setNotice: (n: string | null) => void;
  onLogout: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = (v: View) => {
    setError(null);
    setNotice(null);
    setView(v);
  };

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "");

    if (view === "login") {
      run(async () => {
        await login(email, password);
        setView(null);
      });
    } else if (view === "signup") {
      run(async () => {
        const u = await signup(email, password, { full_name: name });
        if (u.confirmedAt) {
          setView(null);
        } else {
          setNotice("Check your email to confirm your account.");
          setView("login");
        }
      });
    } else if (view === "recover") {
      run(async () => {
        await requestPasswordRecovery(email);
        setNotice("Check your email for a password reset link.");
      });
    } else if (view === "reset") {
      run(async () => {
        await updateUser({ password });
        setNotice("Password updated.");
        setView("user");
      });
    }
  }

  const name =
    (user?.userMetadata?.full_name as string | undefined) || user?.name || user?.email?.split("@")[0];

  return (
    <Dialog open={view !== null} onOpenChange={(o) => !o && setView(null)}>
      <DialogContent className="border-surface-3 bg-surface-raised sm:max-w-sm">
        {view && (
          <>
            <DialogHeader>
              <DialogTitle>{TITLES[view]}</DialogTitle>
              {notice && <DialogDescription>{notice}</DialogDescription>}
            </DialogHeader>

            {view === "user" ? (
              <div className="flex flex-col gap-4">
                <div className="text-sm">
                  <div className="font-medium">{name}</div>
                  <div className="text-muted-foreground">{user?.email}</div>
                </div>
                <button className={primaryBtn} onClick={onLogout}>
                  Sign out
                </button>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="flex flex-col gap-3">
                {view === "signup" && (
                  <input name="name" placeholder="Name" autoComplete="name" className={fieldClass} />
                )}
                {view !== "reset" && (
                  <input
                    name="email"
                    type="email"
                    required
                    placeholder="Email"
                    autoComplete="email"
                    className={fieldClass}
                  />
                )}
                {view !== "recover" && (
                  <input
                    name="password"
                    type="password"
                    required
                    placeholder={view === "reset" ? "New password" : "Password"}
                    autoComplete={view === "login" ? "current-password" : "new-password"}
                    className={fieldClass}
                  />
                )}
                {error && <p className="text-sm text-red-400">{error}</p>}
                <button type="submit" disabled={busy} className={primaryBtn}>
                  {busy
                    ? "Please wait…"
                    : view === "login"
                      ? "Sign in"
                      : view === "signup"
                        ? "Sign up"
                        : view === "recover"
                          ? "Send reset link"
                          : "Save password"}
                </button>
                <div className="flex justify-between">
                  {view === "login" && (
                    <>
                      <button type="button" className={linkBtn} onClick={() => go("signup")}>
                        Create account
                      </button>
                      <button type="button" className={linkBtn} onClick={() => go("recover")}>
                        Forgot password?
                      </button>
                    </>
                  )}
                  {(view === "signup" || view === "recover") && (
                    <button type="button" className={linkBtn} onClick={() => go("login")}>
                      Back to sign in
                    </button>
                  )}
                </div>
              </form>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function useIdentity(): IdentityContextValue {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error("useIdentity must be used inside <IdentityProvider>");
  return ctx;
}
