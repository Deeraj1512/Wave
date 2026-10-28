"use client";

/**
 * Library — the user's own collections only:
 *   Liked songs      → the heart-liked collection (real user data)
 *   Your playlists   → playlists the user created / added songs to (real user data)
 * The auto-derived Songs / Albums / Artists listings were removed on purpose: they
 * mirrored the live catalog rather than anything the user actually saved, so they
 * read as filler. Every card here is something the user genuinely owns.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Heart, ListMusic } from "lucide-react";
import { usePlayer } from "@/lib/player";
import { colorFor } from "@/lib/data";
import {
  getUserPlaylists,
  playlistsVersion,
  subscribePlaylists,
  type UserPlaylist,
} from "@/lib/playlists";

export function LibraryScreen({
  onOpenLiked,
  onOpenPlaylist,
}: {
  onOpenLiked: () => void;
  onOpenPlaylist: (id: string) => void;
}) {
  const { likedIds } = usePlayer();

  // Playlists live in an external store — stay current while songs are added/removed.
  const plV = useSyncExternalStore(subscribePlaylists, playlistsVersion, () => 0);
  // Hydration safety: localStorage is read only after mount (same pattern as Home).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);
  const playlists = useMemo<UserPlaylist[]>(
    () => (mounted ? getUserPlaylists() : []),
    [mounted, plV],
  );

  const likedCount = likedIds.size;

  return (
    <div className="space-y-6 pb-8">
      <header className="px-1 pt-2">
        <h1 className="text-3xl font-black tracking-tight">Library</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your liked songs and playlists.</p>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {/* Liked songs — the app's one real collection */}
        <button onClick={onOpenLiked} className="group text-left" aria-label="Open liked songs">
          <div className="relative">
            <div className="flex aspect-square w-full flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-[#4a4a4a] to-[#1c1c1c] shadow-lg shadow-black/40 transition group-hover:from-[#5a5a5a]">
              <Heart className="h-10 w-10 fill-white/90 text-white/90" />
              <p className="mt-2 text-sm font-medium text-white/90">
                {likedCount} song{likedCount === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <p className="mt-3 truncate text-sm font-bold">Liked songs</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">Your collection</p>
        </button>

        {/* User-created playlists — real data, newest first */}
        {playlists.map((pl) => {
          const [c0, c1] = colorFor(pl.id);
          return (
            <button
              key={pl.id}
              onClick={() => onOpenPlaylist(pl.id)}
              className="group text-left"
              aria-label={`Open playlist ${pl.name}`}
            >
              <div className="relative">
                <div
                  className="flex aspect-square w-full items-center justify-center rounded-2xl shadow-lg shadow-black/40 transition group-hover:brightness-110"
                  style={{ background: `linear-gradient(135deg, ${c0}, ${c1})` }}
                >
                  <ListMusic className="h-10 w-10 text-white/90 drop-shadow" />
                </div>
              </div>
              <p className="mt-3 truncate text-sm font-bold">{pl.name}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {pl.tracks.length} song{pl.tracks.length === 1 ? "" : "s"}
              </p>
            </button>
          );
        })}
      </div>

      {playlists.length === 0 && (
        <p className="px-1 text-sm text-muted-foreground">
          Playlists you create (from any song&apos;s ⋮ menu or the sidebar) collect here.
        </p>
      )}
    </div>
  );
}
