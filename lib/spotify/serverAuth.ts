/**
 * SERVER ONLY — Spotify Web API auth + fetch (Client Credentials flow).
 *
 * Imported exclusively by the /api/spotify/* routes; never by client code.
 * The app token is minted once and kept until 60s before its real expiry;
 * concurrent callers share one mint (in-flight dedup). Endpoints that are
 * quota-gated for new Spotify apps (recommendations, related-artists) throw
 * SpotifyUnavailableError with the real status — callers detect 403/404 with
 * isGated() and fall back instead of surfacing an error.
 */

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";

export class SpotifyUnavailableError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;
let minting: Promise<string> | null = null;

function credentials(): { id: string; secret: string } | null {
  const id = (process.env.SPOTIFY_CLIENT_ID || "").trim();
  const secret = (process.env.SPOTIFY_CLIENT_SECRET || "").trim();
  return id && secret ? { id, secret } : null;
}

/** True when server env carries a credential PAIR (does not verify it). */
export function spotifyConfigured(): boolean {
  return credentials() !== null;
}

function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return Promise.resolve(cachedToken.value);
  if (minting) return minting;
  const creds = credentials();
  if (!creds) {
    return Promise.reject(new SpotifyUnavailableError(500, "missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET"));
  }
  minting = (async () => {
    const basic = Buffer.from(`${creds.id}:${creds.secret}`).toString("base64");
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
    });
    if (!res.ok) {
      throw new SpotifyUnavailableError(res.status, `spotify token ${res.status}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    cachedToken = {
      value: data.access_token,
      expiresAt: Date.now() + Math.max(60, data.expires_in - 60) * 1000,
    };
    return cachedToken.value;
  })();
  return minting.finally(() => {
    minting = null;
  });
}

/** GET a Spotify API path with the cached app token. Throws SpotifyUnavailableError. */
export async function spotifyApi<T>(path: string): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 401) {
    cachedToken = null; // force a fresh mint next call
    throw new SpotifyUnavailableError(401, "spotify token rejected");
  }
  if (!res.ok) {
    throw new SpotifyUnavailableError(res.status, `spotify ${res.status} for ${path}`);
  }
  return (await res.json()) as T;
}

/** True when the credential pair actually mints a token (used by /status). */
export async function spotifyHealthy(): Promise<boolean> {
  try {
    await accessToken();
    return true;
  } catch {
    return false;
  }
}

/** True when an error means "this endpoint is not open to this app" (quota gating / gone). */
export function isGated(e: unknown): boolean {
  const st = (e as SpotifyUnavailableError)?.status;
  return st === 403 || st === 404;
}
