"use client";

/**
 * Downloads (batch 8) — every song saved on-device, playable with ZERO
 * network. Mirrors LikedView's grammar: hero (art tile, count · size,
 * Play/Shuffle) then the rows. Rows are plain TrackRows, so each one keeps
 * its own three-dot menu (which flips "Download" → "Remove download" here).
 * Playback: the player arms the saved blob before any network path, so this
 * page works in airplane mode — covers gracefully fall back to gradients.
 */

import { useMemo } from "react";
import { ArrowLeft, Download, Play, Shuffle } from "lucide-react";
import { TrackRow } from "@/components/TrackRow";
import { usePlayer } from "@/lib/player";
import { fmtSize, metaToTrack, useDownloadsList } from "@/lib/downloads";

export function DownloadsView({ onBack }: { onBack: () => void }) {
  const { playTrack, toggleShuffle, shuffle } = usePlayer();
  const { metas, totalSize } = useDownloadsList();

  const tracks = useMemo(() => metas.map(metaToTrack), [metas]);
  const totalMin = Math.round(tracks.reduce((s, t) => s + t.duration, 0) / 60);

  return (
    <div className="space-y-6 pb-8">
      {/* Hero */}
      <div className="relative -mx-4 -mt-4 overflow-hidden px-4 pb-6 pt-4 sm:-mx-6 sm:px-6" style={{ background: "linear-gradient(180deg, rgba(47,93,80,0.30) 0%, transparent 100%)" }}>
        <button onClick={onBack} className="mb-5 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 transition hover:bg-surface-3" aria-label="Back to library">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-end sm:text-left">
          <div className="flex h-40 w-40 shrink-0 flex-col items-center justify-center rounded-3xl bg-gradient-to-br from-[#2f5d50] to-[#12211d] shadow-xl shadow-black/40 sm:h-48 sm:w-48">
            <Download className="h-12 w-12 text-white/90" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">On this device</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-5xl">Downloads</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {tracks.length} song{tracks.length === 1 ? "" : "s"}
              {tracks.length > 0 && (
                <>
                  {" · "}{fmtSize(totalSize)}
                  {totalMin > 0 && <> · about {totalMin} min</>}
                </>
              )}
              {tracks.length > 0 && <> · plays offline</>}
            </p>
            {tracks.length > 0 && (
              <div className="mt-5 flex items-center justify-center gap-3 sm:justify-start">
                <button
                  onClick={() => playTrack(tracks[0], tracks, "Downloads")}
                  className="flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-medium text-black shadow-lg shadow-black/40 transition hover:bg-white"
                  aria-label="Play downloads"
                >
                  <Play className="h-4 w-4 fill-black" /> Play
                </button>
                <button
                  onClick={() => { if (!shuffle) toggleShuffle(); playTrack(tracks[Math.floor(Math.random() * tracks.length)], tracks, "Downloads"); }}
                  className="flex items-center gap-2 rounded-full border border-border bg-surface-2 px-5 py-3 text-sm font-medium transition hover:bg-surface-3"
                  aria-label="Shuffle downloads"
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
            <TrackRow key={t.id} track={t} index={i + 1} context={tracks} label="Downloads" />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-surface-2 px-6 py-10 text-center">
          <Download className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-semibold">No downloads yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Tap any song&apos;s ⋮ menu → Download. Saved songs play here with no internet at all.
          </p>
        </div>
      )}

      {tracks.length > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          Saved copies stay on this device only — remove one anytime from its ⋮ menu with &ldquo;Remove download&rdquo;.
        </p>
      )}
    </div>
  );
}
