"use client";

import { useIdentity } from "./identity";

/**
 * Account chip for Wave's TopBar — renders a "Sign in" pill when logged out,
 * and the user's name (opens the account modal with Sign out) when logged in.
 * Matches Wave's existing pill styling (bg-surface-2 / hover surface-3).
 */
export function IdentityButton() {
  const { user, ready, openLogin, openAccount } = useIdentity();

  if (!ready) return null;

  if (!user) {
    return (
      <button
        onClick={openLogin}
        className="flex h-9 shrink-0 items-center rounded-full bg-surface-2 px-4 text-sm text-foreground transition hover:bg-surface-3"
        aria-label="Sign in"
      >
        Sign in
      </button>
    );
  }

  const name =
    (user.userMetadata?.full_name as string | undefined) || user.name || user.email?.split("@")[0] || "Account";

  return (
    <button
      onClick={openAccount}
      title={`${user.email ?? ""} — manage account`}
      className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-surface-2 px-4 text-sm text-foreground transition hover:bg-surface-3"
      aria-label="Account"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ff0000]/90 text-xs font-medium text-white" aria-hidden>
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="hidden max-w-[10rem] truncate sm:inline">{name}</span>
    </button>
  );
}
