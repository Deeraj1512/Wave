"use client";

/**
 * The Wave taste profile — Batch 2's onboarding brain.
 *
 * Created by the onboarding flow (login → languages → favorite artists) and
 * consulted everywhere taste matters:
 *   - the home feed's language anchor (profile langs rank above everything)
 *   - the progressive language rule (foreign languages never flood the feed)
 *   - search re-ranking (profile languages get listening-weight, English stays
 *     at the bottom unless the user actually picked it)
 *   - radio/familiarBoost (picked artists are "familiar" from day one)
 *
 * localStorage "wave.profile.v1"; subscribe/version mirror history.ts so
 * components re-render when the profile is saved or retaken.
 */

import type { Lang } from "./types";

export interface ArtistPick {
  name: string;
  lang: Lang;
}

export interface WaveProfile {
  /** the "login" name — what the app greets the user with */
  name: string;
  /** chosen languages, IN PICK ORDER (first = favorite) */
  langs: Lang[];
  /** favorite artists picked during onboarding (per language) */
  artists: ArtistPick[];
  createdAt: number;
  /** false only while the flow is open; a skipped onboarding records an empty profile once */
  skipped: boolean;
}

const LS_KEY = "wave.profile.v1";
const LS_OPEN_KEY = "wave.profile.opened"; // seen-once marker so "skip" doesn't nag every open

const listeners = new Set<() => void>();
let version = 0;
let cached: WaveProfile | null | undefined; // undefined = not hydrated yet

function hydrate(): WaveProfile | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (typeof window !== "undefined") {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? "null") as WaveProfile | null;
      if (raw && typeof raw === "object" && Array.isArray(raw.langs)) {
        cached = {
          name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Listener",
          langs: (raw.langs ?? []).filter((l): l is Lang => typeof l === "string"),
          artists: Array.isArray(raw.artists)
            ? raw.artists.filter((a) => a && typeof a.name === "string").map((a) => ({ name: a.name, lang: a.lang }))
            : [],
          createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
          skipped: !!raw.skipped,
        };
      }
    } catch {
      /* fresh install / corrupt — treat as no profile */
    }
  }
  return cached;
}

function persist(p: WaveProfile | null) {
  cached = p;
  try {
    if (p) localStorage.setItem(LS_KEY, JSON.stringify(p));
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* private mode — in-memory only */
  }
  version++;
  for (const l of listeners) l();
}

export function subscribeProfile(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function profileVersion(): number {
  return version;
}

/** The saved profile, or null when onboarding hasn't completed yet. */
export function getProfile(): WaveProfile | null {
  return hydrate();
}

/** Has the user seen (and finished OR explicitly skipped) onboarding? */
export function profileDone(): boolean {
  const p = hydrate();
  if (p) return true;
  if (typeof window === "undefined") return true; // SSR render: assume done, never flash the flow
  try {
    return localStorage.getItem(LS_OPEN_KEY) === "1";
  } catch {
    return true;
  }
}

/** Mark the flow as seen (skip). The empty profile is remembered once. */
export function markProfileOpened() {
  try {
    localStorage.setItem(LS_OPEN_KEY, "1");
  } catch {
    /* best-effort */
  }
}

export function saveProfile(p: Omit<WaveProfile, "createdAt" | "skipped"> & { skipped?: boolean }) {
  persist({
    name: p.name?.trim() || "Listener",
    langs: p.langs,
    artists: p.artists,
    createdAt: Date.now(),
    skipped: p.skipped ?? false,
  });
}

/** Retake — clears the saved profile (the flow opens again, prefilled). */
export function clearProfile() {
  persist(null);
}

/** Event fired to open the flow from inside the app (Library → "Your taste"). */
export const OPEN_PROFILE_EVENT = "wave:open-profile";

/** The language chips offered on step 2 (display order). */
export const ONBOARDING_LANGS: Lang[] = [
  "Telugu", "Hindi", "Tamil", "Punjabi", "Kannada", "Malayalam", "Bengali", "English",
];

// ── taste derivation (the rules the feed/search/radio obey) ─────────────────

/**
 * The listener's ranked languages — profile picks first (in pick order), then
 * history languages the profile missed, most-played first. This is THE ordered
 * taste list every ranking rule reads.
 */
export function rankedTasteLangs(historyWeights?: Map<string, number>): Lang[] {
  const p = hydrate();
  const out: Lang[] = [];
  const seen = new Set<string>();
  const push = (l?: string) => {
    if (!l || seen.has(l)) return;
    seen.add(l);
    out.push(l as Lang);
  };
  if (p) for (const l of p.langs) push(l);
  if (historyWeights) {
    for (const [l] of [...historyWeights.entries()].sort((a, b) => b[1] - a[1])) push(l);
  }
  return out;
}

/** The listener's favorite artist names (profile picks, folded-later by callers). */
export function profileArtists(): string[] {
  const p = hydrate();
  return p ? p.artists.map((a) => a.name) : [];
}

/** Does the profile exist with real picks? (drives UI copy, e.g. greeting) */
export function hasRealProfile(): boolean {
  const p = hydrate();
  return !!p && !p.skipped && (p.langs.length > 0 || p.artists.length > 0);
}
