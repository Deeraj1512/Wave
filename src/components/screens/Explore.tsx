"use client";

/**
 * Explore — YTM's second surface: New releases, Charts, Moods & genres.
 * Mood/genre tiles route into Search (via the parent's onSearch), shelves behave
 * exactly like Home's (tap a song → its own radio takes over).
 */

import { useEffect, useState } from "react";
import { Flame, Sparkles } from "lucide-react";
import { Shelf } from "../Shelf";
import { TrackRow } from "../TrackRow";
import { SongCard } from "../Cards";
import { GENRE_TILES, MOOD_CHIPS, MOOD_COLORS } from "@/lib/data";
import { searchApi } from "@/lib/api";
import type { Track } from "@/lib/types";

function dedupe(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

const MOODS = MOOD_CHIPS.filter((m) => m !== "All");

const NEW_QUERIES = ["new hindi songs 2025", "latest punjabi songs 2025", "new tamil songs", "new telugu hits"];

export function ExploreScreen({ onSearch }: { onSearch: (q: string) => void }) {
  const [fresh, setFresh] = useState<Track[] | null>(null);
  const [trending, setTrending] = useState<Track[] | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all(NEW_QUERIES.map((q) => searchApi(q).catch(() => [] as Track[]))).then((groups) => {
      if (alive) setFresh(dedupe(groups.flat()).slice(0, 12));
    });
    searchApi("trending songs india")
      .then((ts) => alive && setTrending(ts.slice(0, 10)))
      .catch(() => alive && setTrending([])); // failed → hide the section, never fake it
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-10 pb-8">
      <header className="px-1 pt-2">
        <p className="text-[13px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Explore</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-foreground sm:text-4xl">What&apos;s new &amp; what&apos;s next</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">New releases, live charts and moods for every moment.</p>
      </header>

      {/* Moods & genres — YTM's colorful tile wall */}
      <section aria-label="Moods and genres">
        <h2 className="mb-4 flex items-center gap-2 px-1 text-xl font-extrabold tracking-tight sm:text-[22px]">
          <Sparkles className="h-5 w-5 text-[var(--accent)]" /> Moods &amp; genres
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {MOODS.map((m) => {
            const c = MOOD_COLORS[m] ?? ["#2A2A3A", "#1A1A26"];
            return (
              <button
                key={m}
                onClick={() => onSearch(`${m.toLowerCase()} songs`)}
                className="group relative overflow-hidden rounded-2xl p-4 text-left transition-transform hover:scale-[1.02]"
                style={{ background: `linear-gradient(135deg, ${c[0]}, ${c[1]})` }}
                aria-label={`Browse ${m} songs`}
              >
                <p className="text-[15px] font-black text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)]">{m}</p>
                <p className="mt-0.5 text-xs font-medium text-white/75">{m === "Party" ? "Bangers only" : "Made for the moment"}</p>
                <div className="absolute -bottom-5 -right-5 h-20 w-20 rotate-12 rounded-2xl bg-black/25 backdrop-blur-[2px] transition-transform duration-300 group-hover:rotate-3" />
              </button>
            );
          })}
        </div>
      </section>

      {/* New releases */}
      {(fresh === null || fresh.length > 0) && (
        <Shelf title="New releases">
          {fresh
            ? fresh.map((t) => <SongCard key={t.id} track={t} radio />)
            : [...Array(6)].map((_, i) => <div key={i} className="aspect-square w-[168px] shrink-0 animate-pulse rounded-2xl bg-surface-2 sm:w-[184px]" />)}
        </Shelf>
      )}

      {/* Charts */}
      {(trending === null || trending.length > 0) && (
      <section aria-label="Charts" className="rounded-3xl border border-border bg-surface-2/60 p-4 sm:p-6">
        <div className="mb-2 flex items-end justify-between px-1">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight sm:text-[22px]">
              <Flame className="h-5 w-5 text-[var(--accent)]" /> Top charts · India
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">The 10 songs everyone is humming right now</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-2">
          {(trending ?? [...Array(10)]).map((t, i) =>
            t ? (
              <TrackRow key={(t as Track).id} track={t as Track} index={i + 1} radio showAlbum={false} />
            ) : (
              <div key={i} className="flex items-center gap-4 px-3 py-2">
                <div className="h-12 w-12 shrink-0 animate-pulse rounded-lg bg-surface-3" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-1/3 animate-pulse rounded bg-surface-3" />
                  <div className="h-3 w-1/4 animate-pulse rounded bg-surface-2" />
                </div>
              </div>
            )
          )}
        </div>
      </section>
      )}

      {/* Genre browse tiles */}
      <section aria-label="Browse all genres">
        <h2 className="mb-4 px-1 text-xl font-extrabold tracking-tight sm:text-[22px]">Browse all</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {GENRE_TILES.map((g) => (
            <button
              key={g.name}
              onClick={() => onSearch(g.name)}
              className="group relative overflow-hidden rounded-2xl p-4 text-left transition-transform hover:scale-[1.02]"
              style={{ background: `linear-gradient(135deg, ${g.colors[0]}, ${g.colors[1]})` }}
              aria-label={`Browse ${g.name}`}
            >
              <p className="text-[15px] font-black text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]">{g.name}</p>
              <div className="absolute -bottom-5 -right-5 h-20 w-20 rotate-12 rounded-2xl bg-black/25 backdrop-blur-[2px] transition-transform duration-300 group-hover:rotate-3" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
