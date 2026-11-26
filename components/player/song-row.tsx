"use client";

import { Play } from "lucide-react";
import { Track } from "@/lib/api";

export function SongRow({
  track,
  onPlay,
  active,
}: {
  track: Track;
  onPlay: () => void;
  active: boolean;
}) {
  return (
    <button
      onClick={onPlay}
      aria-label={`Play ${track.title}`}
      className={`group flex min-h-[64px] w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-zinc-900 ${
        active ? "bg-zinc-900" : ""
      }`}
    >
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-zinc-800">
        { }
        {track.thumb ? <img src={track.thumb} alt="" className="h-full w-full object-cover" /> : null}
        <div className="absolute inset-0 hidden items-center justify-center bg-black/50 group-hover:flex">
          <Play className="h-5 w-5 text-white" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-medium ${active ? "text-red-500" : "text-zinc-100"}`}>
          {track.title}
        </div>
        <div className="truncate text-xs text-zinc-400">
          {[track.artist, track.album].filter(Boolean).join(" • ") || "—"}
        </div>
      </div>
      {track.tier === 1 && (
        <span className="hidden shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500 sm:block">
          Original
        </span>
      )}
      <div className="hidden w-12 shrink-0 text-right text-xs text-zinc-500 sm:block">
        {track.duration ?? ""}
      </div>
    </button>
  );
}
