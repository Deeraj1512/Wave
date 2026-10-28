"use client";

import { ArrowLeft, Disc3, Play, Shuffle } from "lucide-react";
import { TrackRow } from "../TrackRow";
import { Cover } from "../Cover";
import { usePlayer } from "@/lib/player";
import { useCover } from "@/lib/covers";
import { getAlbumTracks } from "@/lib/albums";

/**
 * Album page (YTM-style) — opened from the Albums section of search results.
 * The user types an album name, lands here, and plays any song from the
 * tracklist without ever knowing the song's name. The tracklist is the exact
 * result group the album was detected from; rows play within the album queue.
 */
export function AlbumView({ id, onBack }: { id: string; onBack: () => void }) {
  const { playTrack, toggleShuffle, shuffle } = usePlayer();
  const tracks = getAlbumTracks(id) ?? [];
  const name = tracks[0]?.album?.trim() || "Album";
  const artist = tracks.map((t) => t.artist).find((a) => a && a !== "Unknown artist") ?? "";
  const cover = useCover(tracks[0]);
  const totalMin = Math.round(tracks.reduce((s, t) => s + t.duration, 0) / 60);

  if (tracks.length === 0) {
    return (
      <div className="py-20 text-center">
        <Disc3 className="mx-auto h-10 w-10 text-muted-foreground/50" />
        <p className="mt-4 text-lg font-bold">Album not found</p>
        <p className="mt-1 text-sm text-muted-foreground">Search for it again to refresh its songs.</p>
        <button onClick={onBack} className="mt-5 rounded-full bg-surface-2 px-5 py-2.5 text-sm font-medium transition hover:bg-surface-3" aria-label="Back to search results">
          Back to results
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Hero */}
      <div className="relative -mx-4 -mt-4 overflow-hidden px-4 pb-6 pt-4 sm:-mx-6 sm:px-6" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.07) 0%, transparent 100%)" }}>
        <button onClick={onBack} className="mb-5 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 transition hover:bg-surface-3" aria-label="Back to search results">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-end sm:text-left">
          {cover ? (
            <img src={cover} alt="" className="h-40 w-40 shrink-0 rounded-3xl object-cover shadow-xl shadow-black/40 sm:h-48 sm:w-48" />
          ) : (
            <Cover from={tracks[0].colors[0]} to={tracks[0].colors[1]} seed={tracks[0].id} glyphSize="text-5xl" className="h-40 w-40 shrink-0 rounded-3xl sm:h-48 sm:w-48" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Album</p>
            <h1 className="mt-1 break-words text-3xl font-black tracking-tight sm:text-5xl">{name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {artist && <span className="font-medium text-foreground/80">{artist} · </span>}
              {tracks.length} song{tracks.length === 1 ? "" : "s"}
              {totalMin > 0 && <> · about {totalMin} min</>}
            </p>
            <div className="mt-5 flex items-center justify-center gap-3 sm:justify-start">
              <button
                onClick={() => playTrack(tracks[0], tracks, name)}
                className="flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-medium text-black shadow-lg shadow-black/40 transition hover:bg-white"
                aria-label={`Play ${name}`}
              >
                <Play className="h-4 w-4 fill-black" /> Play
              </button>
              <button
                onClick={() => {
                  if (!shuffle) toggleShuffle();
                  playTrack(tracks[Math.floor(Math.random() * tracks.length)], tracks, name);
                }}
                className="flex items-center gap-2 rounded-full border border-border bg-surface-2 px-5 py-3 text-sm font-medium transition hover:bg-surface-3"
                aria-label={`Shuffle ${name}`}
              >
                <Shuffle className="h-4 w-4" /> Shuffle
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tracklist */}
      <div className="space-y-0.5">
        {tracks.map((t, i) => (
          <TrackRow key={t.id} track={t} index={i + 1} context={tracks} label={name} showAlbum={false} />
        ))}
      </div>
    </div>
  );
}
