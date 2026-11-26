/**
 * Queue variety engine — kills the "same song = same queue, forever" bug.
 *
 * Two root causes were fixed around this module:
 *  1. YouTube's RDAMVM mix for a seed videoId is a FIXED list — the same ~50 songs,
 *     same order, every single call. Combined with our deterministic ranking
 *     (seed-artist-first, no shuffle), playing "Aeroplane" on any day built the
 *     identical queue. The player now caps artists per block, artist-spaces with a
 *     random shuffle, and taste-boosts — see extendRadio().
 *  2. Nothing remembered what the user ALREADY heard, so even a "fresh" build kept
 *     serving the same songs. This module is that memory: every song that plays or
 *     is skipped past is recorded, and radio blocks exclude songs heard on PREVIOUS
 *     days — while staying stable within the same listening day (Option A: same
 *     day → the queue keeps its flow; next day / ~8h → completely new queue).
 */

import type { Track } from "./types";

const LS_KEY = "wave.heard.v1";
const CAP = 500; // remember ~500 songs — a heavy day is 60-80 plays
const HEARD_TTL_MS = 5 * 864e5; // memory itself fades after 5 days

/**
 * Freshness window (Option A rule): a song heard LESS than this ago is fair game
 * (same-day continuity — replaying the seed rebuilds a similar flow), while a
 * song heard LONGER ago is excluded from new radio blocks (yesterday's queue must
 * not return tomorrow).
 */
export const FRESH_WINDOW_MS = 10 * 60 * 60 * 1000; // 10h

/** Session staleness (Option A rule): a restored queue older than this has its
 *  upcoming radio block dropped on app open — the prefill rebuilds it fresh. */
export const QUEUE_STALE_MS = 8 * 60 * 60 * 1000; // 8h

const heard = new Map<string, number>();
let hydrated = false;

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as Array<[string, number]>;
    const cutoff = Date.now() - HEARD_TTL_MS;
    for (const [id, at] of raw) {
      if (id && typeof at === "number" && at > cutoff) heard.set(id, at);
    }
  } catch {
    /* fresh install / corrupt entry — memory simply starts empty */
  }
}

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...heard.entries()].slice(-CAP)));
  } catch {
    /* private mode / quota — variety memory is best-effort */
  }
}

/** Record songs as "heard": every played track + every track skipped past. */
export function rememberHeard(ids: string | string[]) {
  hydrate();
  const arr = Array.isArray(ids) ? ids : [ids];
  let changed = false;
  const now = Date.now();
  for (const id of arr) {
    if (!id) continue;
    heard.set(id, now);
    changed = true;
  }
  if (!changed) return;
  if (heard.size > CAP) {
    const stale = [...heard.entries()].sort((a, b) => a[1] - b[1]).slice(0, heard.size - CAP);
    for (const [id] of stale) heard.delete(id);
  }
  persist();
}

/** When the song was last heard — null = never (as far as this memory knows). */
export function heardAt(id: string): number | null {
  hydrate();
  const at = heard.get(id);
  return typeof at === "number" ? at : null;
}

/**
 * The variety filter for radio blocks: drop songs heard on a PREVIOUS day
 * (heard more than FRESH_WINDOW_MS ago). Songs heard within the window and
 * never-heard songs pass. If filtering would starve the block (< minKeep
 * survivors), it steps aside — the queue must never run dry over variety.
 */
export function filterFresh(tracks: Track[], minKeep = 6): Track[] {
  hydrate();
  const now = Date.now();
  const fresh = tracks.filter((t) => {
    const at = heard.get(t.id);
    return at === undefined || now - at < FRESH_WINDOW_MS;
  });
  return fresh.length >= minKeep ? fresh : tracks;
}

/** True when a saved playback session is old enough that its upcoming radio
 *  block should be rebuilt instead of restored (the 8h / next-day rule). */
export function isStaleSession(savedAt: unknown): boolean {
  return typeof savedAt === "number" && Date.now() - savedAt > QUEUE_STALE_MS;
}
