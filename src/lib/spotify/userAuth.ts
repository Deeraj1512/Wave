/**
 * CLIENT-SIDE — "Login with Spotify" (Authorization Code + PKCE).
 *
 * Private-app design: ONE user (the owner) logs in with THEIR Spotify
 * account inside the system browser (Spotify forbids WebViews for login).
 * PKCE means NO client secret exists anywhere in this flow — the public
 * client id (fetched from the bridge's /status) + a per-login code verifier
 * is all the exchange needs, so the tokens stay entirely on the device:
 *
 *   login()  → build verifier/challenge → open system browser → Spotify
 *              login → redirect to com.deeraj.wave://callback?code=… →
 *              the app captures the deep link → exchange → store tokens.
 *   token()  → cached access token, refreshed silently when < 60s remain.
 *
 * The bridge/worker NEVER participates in user auth — api.spotify.com is
 * called directly from the app (CapacitorHttp native → no CORS).
 *
 * Dashboard prerequisites (see SPOTIFY-SETUP.md):
 *   - redirect URI `com.deeraj.wave://callback` added to the Spotify app
 *   - the owner's account email added under User Management (dev mode only
 *     allows allow-listed users to log in)
 */

import { IS_NATIVE } from "../api";
import { spotifyClientId } from "./bridge";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

const SCOPES = [
  "user-library-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-top-read",
  "user-read-email",
].join(" ");

const STORE_KEY = "wave.sp.user";
const FLOW_KEY = "wave.sp.flow";

/** redirect_uri registered in the Spotify dashboard — EXACT match required. */
function redirectUri(): string {
  // APK: custom scheme deep link back into the app (intent filter in the
  // manifest). WEB dev: the local /callback page.
  return IS_NATIVE ? "com.deeraj.wave://callback" : `${window.location.origin}/callback`;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  email?: string;
}

interface FlowState {
  verifier: string;
  state: string;
  at: number;
}

// ── tiny reactive store (useSyncExternalStore-friendly) ─────────────────────

let cached: StoredTokens | null = null;
let inflightRefresh: Promise<string> | null = null;
const listeners = new Set<() => void>();

function read(): StoredTokens | null {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) cached = JSON.parse(raw) as StoredTokens;
  } catch {
    /* corrupt = logged out */
  }
  return cached;
}

function write(t: StoredTokens | null) {
  cached = t;
  try {
    if (t) localStorage.setItem(STORE_KEY, JSON.stringify(t));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* private mode — session-only login */
  }
  for (const l of listeners) l();
}

/** Logged in (a refresh token exists)? Instant, no network. */
export function spotifyLoggedIn(): boolean {
  return read() !== null;
}

export function spotifyUserEmail(): string | undefined {
  return read()?.email;
}

export function subscribeUserAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ── PKCE primitives ──────────────────────────────────────────────────────────

/** Exported for the offline PKCE test (scripts/test_spotify_pkce.ts). */
export function randomB64(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Exported for the offline PKCE test (scripts/test_spotify_pkce.ts). */
export async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ── token exchange / refresh ────────────────────────────────────────────────

async function exchangeCode(code: string, verifier: string): Promise<StoredTokens> {
  const clientId = spotifyClientId();
  if (!clientId) throw new Error("bridge not ready — no client id");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      client_id: clientId,
      code_verifier: verifier,
    }).toString(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`token exchange ${res.status}`);
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  if (!data.refresh_token) throw new Error("no refresh token granted");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + Math.max(60, data.expires_in - 60) * 1000,
    email: read()?.email,
  };
}

async function refreshTokens(refreshToken: string): Promise<StoredTokens> {
  const clientId = spotifyClientId();
  if (!clientId) throw new Error("bridge not ready — no client id");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`token refresh ${res.status}`);
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    accessToken: data.access_token,
    // Spotify occasionally omits refresh_token on refresh — keep the old one
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + Math.max(60, data.expires_in - 60) * 1000,
    email: read()?.email,
  };
}

/** A valid access token, refreshing transparently. Throws when logged out or
 *  the refresh fails (callers treat that as "logged out"). */
export async function spotifyUserToken(): Promise<string> {
  const t = read();
  if (!t) throw new Error("not logged in");
  if (Date.now() < t.expiresAt) return t.accessToken;
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async () => {
    try {
      const next = await refreshTokens(t.refreshToken);
      write(next);
      return next.accessToken;
    } catch (e) {
      // refresh rejected → the session is dead; surface as logged-out
      write(null);
      throw e instanceof Error ? e : new Error("refresh failed");
    }
  })().finally(() => {
    inflightRefresh = null;
  });
  return inflightRefresh;
}

/** Force a refresh (used after a 401 — the cached token was rejected). */
export async function spotifyUserTokenFresh(): Promise<string> {
  const t = read();
  if (!t) throw new Error("not logged in");
  write({ ...t, expiresAt: 0 });
  return spotifyUserToken();
}

// ── login / logout ───────────────────────────────────────────────────────────

let loginInFlight = false;

/** Build the authorize URL + persist the PKCE flow state. Shared by both
 *  runtimes: the APK awaits the deep link; WEB stores the flow and navigates
 *  away — the /callback page then calls spotifyCompleteLoginFromUrl(). */
async function beginLogin(): Promise<string> {
  const clientId = spotifyClientId();
  if (!clientId) throw new Error("bridge not reachable — cannot start login");

  const verifier = randomB64(64);
  const state = randomB64(16);
  const flow: FlowState = { verifier, state, at: Date.now() };
  localStorage.setItem(FLOW_KEY, JSON.stringify(flow));

  return (
    `${AUTH_URL}?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri())}` +
    `&code_challenge_method=S256` +
    `&code_challenge=${await challenge(verifier)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&state=${state}`
  );
}

/** Open the system browser for Spotify login and wait for the deep link
 *  (APK runtime). Resolves when the full exchange finished. */
export async function spotifyLogin(): Promise<void> {
  if (!IS_NATIVE) {
    // WEB dev runtime: navigate away; src/app/callback/page.tsx finishes.
    window.location.href = await beginLogin();
    return;
  }
  if (loginInFlight) throw new Error("login already in progress");
  loginInFlight = true;
  try {
    const url = await beginLogin();
    const flow = JSON.parse(localStorage.getItem(FLOW_KEY) ?? "null") as FlowState | null;
    if (!flow) throw new Error("could not persist login flow");

    const code = await new Promise<string>((resolve, reject) => {
      let cancel = () => {};
      const fail = (err: unknown) => {
        cancel();
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      (async () => {
        try {
          const { App } = await import("@capacitor/app");
          const handle = await App.addListener("appUrlOpen", (data) => {
            try {
              const u = new URL(data.url);
              if (!data.url.startsWith("com.deeraj.wave://callback")) return; // other deep link
              const err = u.searchParams.get("error");
              if (err) return fail(new Error(err === "access_denied" ? "login cancelled" : err));
              if (u.searchParams.get("state") !== flow.state) return fail(new Error("state mismatch"));
              const code = u.searchParams.get("code");
              if (!code) return fail(new Error("no code in redirect"));
              cancel();
              resolve(code);
            } catch (e) {
              fail(e);
            }
          });
          cancel = () => handle.remove();
          const { Browser } = await import("@capacitor/browser");
          await Browser.open({ url });
        } catch (e) {
          fail(e);
        }
      })();
    });

    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.close().catch(() => {});
    } catch {
      /* plugin may already be gone */
    }
    await finishLogin(code, flow.verifier);
  } finally {
    loginInFlight = false;
  }
}

/** WEB dev runtime: called by src/app/callback/page.tsx with the URL Spotify
 *  redirected to (?code=…&state=…). Validates + exchanges + stores. */
export async function spotifyCompleteLoginFromUrl(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const flow = JSON.parse(localStorage.getItem(FLOW_KEY) ?? "null") as FlowState | null;
    if (!flow) return { ok: false, error: "no pending login" };
    const u = new URL(url);
    const err = u.searchParams.get("error");
    if (err) return { ok: false, error: err === "access_denied" ? "login cancelled" : err };
    if (u.searchParams.get("state") !== flow.state) return { ok: false, error: "state mismatch" };
    const code = u.searchParams.get("code");
    if (!code) return { ok: false, error: "no code in redirect" };
    await finishLogin(code, flow.verifier);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "login failed" };
  }
}

async function finishLogin(code: string, verifier: string): Promise<void> {
  const tokens = await exchangeCode(code, verifier);
  // who logged in? /me is one cheap call and powers the account chip
  try {
    const me = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      cache: "no-store",
    });
    if (me.ok) {
      const data = (await me.json()) as { email?: string; display_name?: string };
      tokens.email = data.email ?? data.display_name;
    }
  } catch {
    /* email chip is cosmetic */
  }
  localStorage.removeItem(FLOW_KEY);
  write(tokens);
}

export function spotifyLogout(): void {
  write(null);
}
