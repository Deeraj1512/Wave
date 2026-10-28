"use client";

/**
 * Artist page (YTM-style) — opened from the Library's Artists tab.
 * The song list is the artist's tracks from the live catalog merged with a
 * fresh search for their name, so the page grows beyond what the session
 * catalog happens to carry. Rows play within the artist queue.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Music2, Play, Shuffle } from "lucide-react";
import { TrackRow } from "../TrackRow";
import { Cover } from "../Cover";
import { usePlayer } from "@/lib/player";
import { catalogNow } from "@/lib/catalog";
import { searchApi } from "@/lib/api";
import type { Track } from "@/lib/types";

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export function ArtistView({ name, onBack }: { name: string; onBack: () => void }) {
  const { playTrack, toggleShuffle, shuffle } = usePlayer();

  // Catalog tracks (module-cached → instant) + a live search for the artist.
  const [live, setLive] = useState<Track[] | null>(null);
  useEffect(() => {
    let alive = true;
    searchApi(name)
      .then((ts) => alive && setLive(ts))
      .catch(() => alive && setLive([]));
    return () => {
      alive = false;
    };
  }, [name]);

  const tracks = useMemo(() => {
    const target = fold(name);
    const isTheirs = (t: Track) =>
      t.artist
        .split(",")
        .map((a) => fold(a))
        .some((a) => a === target || (target.length > 3 && a.includes(target)));
    const seen = new Set<string>();
    const out: Track[] = [];
    for (const t of [...(catalogNow() ?? []), ...(live ?? [])]) {
      if (!isTheirs(t)) continue;
      const k = `${t.title.toLowerCase().trim()}|${fold(t.artist.split(",")[0])}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  }, [name, live]);

  const toNum = (p: string) => {
    const m = p.trim().match(/^([\d.]+)\s*([KMB])?$/i);
    if (!m) return 0;
    const mult = m[2]?.toUpperCase() === "B" ? 1e9 : m[2]?.toUpperCase() === "M" ? 1e6 : m[2]?.toUpperCase() === "K" ? 1e3 : 1;
    return (parseFloat(m[1]) || 0) * mult;
  };

  const sorted = useMemo(() => [...tracks].sort((a, b) => toNum(b.plays) - toNum(a.plays)), [tracks]);

  return (
    <div className="space-y-6 pb-8">
      {/* Hero */}
      <div className="relative -mx-4 -mt-4 overflow-hidden px-4 pb-6 pt-4 sm:-mx-6 sm:px-6" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.07) 0%, transparent 100%)" }}>
        <button onClick={onBack} className="mb-5 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 transition hover:bg-surface-3" aria-label="Back to library">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-end sm:text-left">
          <Cover from="#4a4a6a" to="#16161c" seed={`artist-page-${name}`} glyphSize="text-5xl" rounded="rounded-full" className="h-40 w-40 shrink-0 sm:h-48 sm:w-48" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Artist</p>
            <h1 className="mt-1 break-words text-3xl font-black tracking-tight sm:text-5xl">{name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {sorted.length} song{sorted.length === 1 ? "" : "s"}
            </p>
            {sorted.length > 0 && (
              <div className="mt-5 flex items-center justify-center gap-3 sm:justify-start">
                <button
                  onClick={() => playTrack(sorted[0], sorted, name)}
                  className="flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-medium text-black shadow-lg shadow-black/40 transition hover:bg-white"
                  aria-label={`Play ${name}`}
                >
                  <Play className="h-4 w-4 fill-black" /> Play
                </button>
                <button
                  onClick={() => {
                    if (!shuffle) toggleShuffle();
                    playTrack(sorted[Math.floor(Math.random() * sorted.length)], sorted, name);
                  }}
                  className="flex items-center gap-2 rounded-full border border-border bg-surface-2 px-5 py-3 text-sm font-medium transition hover:bg-surface-3"
                  aria-label={`Shuffle ${name}`}
                >
                  <Shuffle className="h-4 w-4" /> Shuffle
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tracklist */}
      {sorted.length === 0 ? (
        <div className="py-16 text-center">
          <Music2 className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <p className="mt-4 text-lg font-bold">No songs found</p>
          <p className="mt-1 text-sm text-muted-foreground">Play more of {name} and they&apos;ll show up here.</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {sorted.map((t, i) => (
            <TrackRow key={t.id} track={t} index={i + 1} context={sorted} label={name} showAlbum />
          ))}
        </div>
      )}
    </div>
  );
}
