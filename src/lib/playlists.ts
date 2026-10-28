"use client";

/**
 * User playlists — Wave's own collections, persisted in localStorage.
 *
 * Every entry snapshots the FULL track (like liked songs), so a playlist keeps
 * playing after reloads even when the track is a live search result that exists
 * in no catalog. Same external-store pattern as history.ts: mutators persist +
 * notify, components subscribe via useSyncExternalStore.
 */

import type { Track } from "./types";

export interface UserPlaylist {
  id: string;
  name: string;
  tracks: Track[];
  createdAt: number;
  updatedAt: number;
}

const LS_KEY = "wave.playlists.v1";
const MAX_PLAYLISTS = 50;

const byId = new Map<string, UserPlaylist>();
const listeners = new Set<() => void>();
let hydrated = false;
let version = 0;

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    for (const p of JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as UserPlaylist[]) byId.set(p.id, p);
  } catch {
    /* fresh install */
  }
}

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...byId.values()]));
  } catch {
    /* private mode — in-memory only */
  }
}

function notify() {
  version++;
  for (const l of listeners) l();
}

export function subscribePlaylists(l: () => void): () => void {
  hydrate();
  listeners.add(l);
  return () => listeners.delete(l);
}

export function playlistsVersion(): number {
  return version;
}

/** All playlists, newest-created first. */
export function getUserPlaylists(): UserPlaylist[] {
  hydrate();
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getUserPlaylist(id: string): UserPlaylist | null {
  hydrate();
  return byId.get(id) ?? null;
}

export function createUserPlaylist(name: string, tracks: Track[] = []): UserPlaylist | null {
  const clean = name.trim().slice(0, 80);
  if (!clean) return null;
  hydrate();
  if (byId.size >= MAX_PLAYLISTS) return null;
  const pl: UserPlaylist = {
    id: `up-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: clean,
    tracks: dedupe(tracks),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  byId.set(pl.id, pl);
  persist();
  notify();
  return pl;
}

export function deleteUserPlaylist(id: string): void {
  hydrate();
  if (!byId.delete(id)) return;
  persist();
  notify();
}

export function renameUserPlaylist(id: string, name: string): void {
  const clean = name.trim().slice(0, 80);
  const pl = byId.get(id);
  if (!pl || !clean) return;
  byId.set(id, { ...pl, name: clean, updatedAt: Date.now() });
  persist();
  notify();
}

/** Add a track snapshot. Returns "added" or "exists" (same id already in). */
export function addToUserPlaylist(id: string, track: Track): "added" | "exists" | "missing" {
  const pl = byId.get(id);
  if (!pl) return "missing";
  if (pl.tracks.some((t) => t.id === track.id)) return "exists";
  byId.set(id, { ...pl, tracks: [...pl.tracks, track], updatedAt: Date.now() });
  persist();
  notify();
  return "added";
}

export function removeFromUserPlaylist(id: string, trackId: string): void {
  const pl = byId.get(id);
  if (!pl) return;
  byId.set(id, { ...pl, tracks: pl.tracks.filter((t) => t.id !== trackId), updatedAt: Date.now() });
  persist();
  notify();
}

export function isTrackInUserPlaylist(id: string, trackId: string): boolean {
  hydrate();
  return byId.get(id)?.tracks.some((t) => t.id === trackId) ?? false;
}

function dedupe(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}
