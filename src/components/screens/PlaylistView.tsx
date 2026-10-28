"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Heart, ListMusic, Play, Shuffle, Trash2 } from "lucide-react";
import { TrackRow } from "../TrackRow";
import { usePlayer } from "@/lib/player";
import { deleteUserPlaylist, getUserPlaylist, subscribePlaylists } from "@/lib/playlists";
import { useToast } from "@/hooks/use-toast";
import type { Track } from "@/lib/types";

/**
 * Liked songs — the app's one real collection. Every like snapshots the full track,
 * so the view survives reloads even for live YouTube videoIds that exist in no catalog.
 */
export function LikedView({ onBack }: { onBack: () => void }) {
  const { playTrack, toggleShuffle, shuffle, likedTracks, likedIds } = usePlayer();

  const tracks = useMemo(() => {
    // newest-like first (likedTracks order); every like snapshots the full track,
    // so nothing needs resolving from any hardcoded list
    const byId = new Map<string, Track>();
    for (const t of likedTracks) if (likedIds.has(t.id)) byId.set(t.id, t);
    return [...byId.values()];
  }, [likedTracks, likedIds]);

  const totalMin = Math.round(tracks.reduce((s, t) => s + t.duration, 0) / 60);

  return (
    <div className="space-y-6 pb-8">
      {/* Hero */}
      <div className="relative -mx-4 -mt-4 overflow-hidden px-4 pb-6 pt-4 sm:-mx-6 sm:px-6" style={{ background: "linear-gradient(180deg, rgba(244,61,140,0.22) 0%, transparent 100%)" }}>
        <button onClick={onBack} className="mb-5 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 transition hover:bg-surface-3" aria-label="Back to library">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-end sm:text-left">
          <div className="flex h-40 w-40 shrink-0 flex-col items-center justify-center rounded-3xl bg-gradient-to-br from-[#4a4a4a] to-[#1c1c1c] shadow-xl shadow-black/40 sm:h-48 sm:w-48">
            <Heart className="h-12 w-12 fill-white/90 text-white/90" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Collection</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-5xl">Liked songs</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {tracks.length} song{tracks.length === 1 ? "" : "s"}
              {tracks.length > 0 && totalMin > 0 && <> · about {totalMin} min</>}
            </p>
            {tracks.length > 0 && (
              <div className="mt-5 flex items-center justify-center gap-3 sm:justify-start">
                <button
                  onClick={() => playTrack(tracks[0], tracks, "Liked songs")}
                  className="flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-medium text-black shadow-lg shadow-black/40 transition hover:bg-white"
                  aria-label="Play liked songs"
                >
                  <Play className="h-4 w-4 fill-black" /> Play
                </button>
                <button
                  onClick={() => { if (!shuffle) toggleShuffle(); playTrack(tracks[Math.floor(Math.random() * tracks.length)], tracks, "Liked songs"); }}
                  className="flex items-center gap-2 rounded-full border border-border bg-surface-2 px-5 py-3 text-sm font-medium transition hover:bg-surface-3"
                  aria-label="Shuffle liked songs"
                >
                  <Shuffle className="h-4 w-4" /> Shuffle
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tracks */}
      {tracks.length > 0 ? (
        <div className="space-y-0.5">
          {tracks.map((t, i) => (
            <TrackRow key={t.id} track={t} index={i + 1} context={tracks} label="Liked songs" />
          ))}
        </div>
      ) : (
        <div className="py-16 text-center">
          <Heart className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <p className="mt-4 text-lg font-bold">Songs you like live here</p>
          <p className="mt-1 text-sm text-muted-foreground">Tap the heart on any song — it lands in this list.</p>
        </div>
      )}
    </div>
  );
}

/**
 * A user-created playlist ("Your playlists" in the sidebar; add songs via any ⋮
 * menu's "Add to playlist"). Like liked songs, every entry is a full track
 * snapshot, so the view survives reloads for live videoIds too.
 */
export function UserPlaylistView({ id, onBack }: { id: string; onBack: () => void }) {
  const { playTrack, toggleShuffle, shuffle } = usePlayer();
  const { toast } = useToast();

  // external store — stay live while songs are added/removed from any menu
  const [plV, setPlV] = useState(0);
  useEffect(() => subscribePlaylists(() => setPlV((v) => v + 1)), []);
  const pl = useMemo(() => {
    void plV;
    return getUserPlaylist(id);
  }, [plV, id]);

  if (!pl) {
    return (
      <div className="py-20 text-center">
        <ListMusic className="mx-auto h-10 w-10 text-muted-foreground/50" />
        <p className="mt-4 text-lg font-bold">Playlist not found</p>
        <p className="mt-1 text-sm text-muted-foreground">It may have been deleted.</p>
        <button onClick={onBack} className="mt-5 rounded-full bg-surface-2 px-5 py-2.5 text-sm font-medium transition hover:bg-surface-3" aria-label="Back to library">
          Back to library
        </button>
      </div>
    );
  }

  const tracks = pl.tracks;
  const totalMin = Math.round(tracks.reduce((s, t) => s + t.duration, 0) / 60);

  const remove = () => {
    deleteUserPlaylist(pl.id);
    toast({ title: "Playlist deleted", description: pl.name, duration: 3000 });
    onBack();
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Hero */}
      <div className="relative -mx-4 -mt-4 overflow-hidden px-4 pb-6 pt-4 sm:-mx-6 sm:px-6" style={{ background: "linear-gradient(180deg, rgba(244,61,140,0.16) 0%, transparent 100%)" }}>
        <button onClick={onBack} className="mb-5 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 transition hover:bg-surface-3" aria-label="Back to library">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-end sm:text-left">
          <div className="flex h-40 w-40 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br from-[#3d3d52] to-[#16161f] shadow-xl shadow-black/40 sm:h-48 sm:w-48">
            <ListMusic className="h-12 w-12 text-white/85" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Your playlist</p>
            <h1 className="mt-1 break-words text-3xl font-black tracking-tight sm:text-5xl">{pl.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {tracks.length} song{tracks.length === 1 ? "" : "s"}
              {tracks.length > 0 && totalMin > 0 && <> · about {totalMin} min</>}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
              {tracks.length > 0 && (
                <>
                  <button
                    onClick={() => playTrack(tracks[0], tracks, pl.name)}
                    className="flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-medium text-black shadow-lg shadow-black/40 transition hover:bg-white"
                    aria-label={`Play ${pl.name}`}
                  >
                    <Play className="h-4 w-4 fill-black" /> Play
                  </button>
                  <button
                    onClick={() => { if (!shuffle) toggleShuffle(); playTrack(tracks[Math.floor(Math.random() * tracks.length)], tracks, pl.name); }}
                    className="flex items-center gap-2 rounded-full border border-border bg-surface-2 px-5 py-3 text-sm font-medium transition hover:bg-surface-3"
                    aria-label={`Shuffle ${pl.name}`}
                  >
                    <Shuffle className="h-4 w-4" /> Shuffle
                  </button>
                </>
              )}
              <button
                onClick={remove}
                className="flex items-center gap-2 rounded-full border border-border bg-surface-2 px-5 py-3 text-sm font-medium text-muted-foreground transition hover:bg-red-400/10 hover:text-red-300"
                aria-label={`Delete ${pl.name}`}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tracks */}
      {tracks.length > 0 ? (
        <div className="space-y-0.5">
          {tracks.map((t, i) => (
            <TrackRow key={t.id} track={t} index={i + 1} context={tracks} label={pl.name} />
          ))}
        </div>
      ) : (
        <div className="py-16 text-center">
          <ListMusic className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <p className="mt-4 text-lg font-bold">This playlist is empty</p>
          <p className="mt-1 text-sm text-muted-foreground">Tap the ⋮ on any song and choose “Add to playlist”.</p>
        </div>
      )}
    </div>
  );
}
