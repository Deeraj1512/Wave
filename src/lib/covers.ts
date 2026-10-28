"use client";

/**
 * Album-art store — gives every seed-catalog track its real cover ("profile pic").
 *
 * Real YTM tracks already carry `cover` from search/radio responses. Mock seed tracks
 * (t01–t26) don't — useCover() registers them, a debounced batch POST /api/thumbs
 * resolves their art once, and every subscribed component re-renders with the real
 * picture. Resolved covers persist in localStorage: looked up at most once, ever.
 */
import { useSyncExternalStore } from "react";
import { thumbsApi } from "./api";

const LS_KEY = "dhun.covers.v1";
const STORE_KEY_ART = "dhun.artKey.v1"; // title|artist → url (mock tracks, stable across sessions)
const STORE_KEY_ID = "dhun.artId.v1"; // id → url (videoId-keyed, e.g. resolved by title swap)

const byKey = new Map<string, string>();
const byId = new Map<string, string>();
const listeners = new Set<() => void>();
let hydrated = false;

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(STORE_KEY_ART) ?? "{}") as Record<string, string>)) byKey.set(k, v);
    for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(LS_KEY) ?? "{}") as Record<string, string>)) byId.set(k, v);
  } catch {
    /* fresh install */
  }
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY_ART, JSON.stringify(Object.fromEntries(byKey)));
    localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(byId)));
  } catch {
    /* private mode — in-memory only */
  }
}

function notify() {
  for (const l of listeners) l();
}

export function subscribeCovers(l: () => void): () => void {
  hydrate();
  listeners.add(l);
  return () => listeners.delete(l);
}

let artVersion = 0;

// ── Batch resolution ──────────────────────────────────────────────────────────

interface PendingItem {
  id: string;
  key: string;
  title: string;
  artist: string;
}
const pending = new Map<string, PendingItem>(); // id → item (dedupe)
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function queueCover(item: PendingItem) {
  hydrate();
  if (byId.has(item.id)) return;
  if (byKey.has(item.key)) {
    byId.set(item.id, byKey.get(item.key)!);
    return;
  }
  if (pending.has(item.id)) return;
  pending.set(item.id, item);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 250);
}

async function flush() {
  flushTimer = null;
  const items = [...pending.values()];
  pending.clear();
  if (items.length === 0) return;
  try {
    const covers = await thumbsApi(items.map((i) => ({ id: i.id, title: i.title, artist: i.artist })));
    let changed = false;
    for (const item of items) {
      const url = covers[item.id];
      if (url) {
        byId.set(item.id, url);
        byKey.set(item.key, url);
        changed = true;
      }
    }
    if (changed) {
      artVersion++;
      persist();
      notify();
    }
  } catch {
    /* backend down — gradients stay, retried next mount */
  }
}

/** External-store read: id → cover url | undefined */
export function coverById(id: string): string | undefined {
  return byId.get(id);
}

// ── React hook ────────────────────────────────────────────────────────────────

export function useCover(track: { id: string; title: string; artist: string; cover?: string } | null | undefined): string | undefined {
  hydrate();
  // register for resolution (mock ids are "t01"-style; real videoIds are 11 chars)
  if (track && !/^[\w-]{11}$/.test(track.id)) {
    queueCover({
      id: track.id,
      key: `${track.title.toLowerCase().trim()}|${track.artist.split(",")[0].toLowerCase().trim()}`,
      title: track.title,
      artist: track.artist,
    });
  }
  // re-render whenever a cover lands
  useSyncExternalStore(
    subscribeCovers,
    () => artVersion,
    () => 0
  );
  if (!track) return undefined;
  if (track.cover) return track.cover;
  return byId.get(track.id);
}

/** Warm the store for a whole list (e.g. seed catalog) without rendering yet. */
export function warmCovers(tracks: Array<{ id: string; title: string; artist: string }>) {
  for (const t of tracks) {
    if (!/^[\w-]{11}$/.test(t.id)) {
      queueCover({ id: t.id, key: `${t.title.toLowerCase().trim()}|${t.artist.split(",")[0].toLowerCase().trim()}`, title: t.title, artist: t.artist });
    }
  }
}
