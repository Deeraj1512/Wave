"use client";

import { useState } from "react";
import { ListPlus, ListStart, MoreVertical, Music, Play, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Track } from "@/lib/types";
import { usePlayer } from "@/lib/player";
import { useCover } from "@/lib/covers";
import { useToast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AddToPlaylistSheet } from "./PlayerMenus";
import { Cover } from "./Cover";

/**
 * The song three-dot menu — Play next · Add to queue · Add to playlist · Start
 * radio — shared by every card surface (Quick picks, home shelves, Explore) so
 * the queue + library actions follow the song wherever it appears (TrackRow
 * carries the same menu for lists).
 */
function SongCardMenu({ track }: { track: Track }) {
  const { playNext, addToQueue, startRadio } = usePlayer();
  const { toast } = useToast();
  const [plOpen, setPlOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          aria-label={`More options for ${track.title}`}
          className="flex h-8 w-8 items-center justify-center rounded-full text-white/85 transition hover:bg-white/15 hover:text-white focus:opacity-100"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="w-56">
        <DropdownMenuItem
          onClick={() => {
            playNext(track);
            toast({ title: "Playing next", duration: 2500 });
          }}
          className="gap-2.5"
        >
          <ListStart className="h-4 w-4 text-muted-foreground" /> Play next
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            addToQueue(track);
            toast({ title: "Added to queue", duration: 2500 });
          }}
          className="gap-2.5"
        >
          <ListPlus className="h-4 w-4 text-muted-foreground" /> Add to queue
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPlOpen(true)} className="gap-2.5">
          <Music className="h-4 w-4 text-muted-foreground" /> Add to playlist
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            startRadio(track);
            toast({ title: "Radio started", description: "Similar songs added to the queue", duration: 3000 });
          }}
          className="gap-2.5"
        >
          <Radio className="h-4 w-4 text-muted-foreground" /> Start radio
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
      <AddToPlaylistSheet track={track} open={plOpen} onClose={() => setPlOpen(false)} />
    </>
  );
}

// Square song card used in shelves (YTM: art, title, artist — no scale tricks).
// `radio` → YTM single-tap semantics: the tapped song plays now and its own radio
// (seeded by it, artist-led) fills the queue — used on recommendation/mix shelves.
// Without it, the card plays within `context` like a playlist (liked songs, etc.).
// The ⋮ sits over the artwork's top-right corner (hover on desktop, always-on mobile).
export function SongCard({ track, context, radio }: { track: Track; context?: Track[]; radio?: boolean }) {
  const { playTrack, playRadio } = usePlayer();
  const cover = useCover(track);
  return (
    <div className="group relative w-[168px] shrink-0 snap-start sm:w-[184px]">
      <button
        onClick={() => (radio ? playRadio(track, `${track.title} radio`) : playTrack(track, context))}
        className="block w-full text-left"
        aria-label={`Play ${track.title} by ${track.artist}`}
      >
        <div className="relative">
          <Cover from={track.colors[0]} to={track.colors[1]} seed={track.id} cover={cover} className="aspect-square w-full" />
          <span className="absolute bottom-2 right-2 flex h-11 w-11 translate-y-2 items-center justify-center rounded-full bg-[var(--accent)] opacity-0 shadow-xl shadow-black/40 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
            <Play className="h-5 w-5 fill-black text-black" />
          </span>
        </div>
        <p className="mt-3 truncate text-sm font-medium text-foreground">{track.title}</p>
        {(track.artist || track.album) && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{track.artist || track.album}</p>
        )}
      </button>
      <div className="absolute right-1.5 top-1.5 rounded-full bg-black/50 backdrop-blur-sm">
        <SongCardMenu track={track} />
      </div>
    </div>
  );
}

// Compact quick-pick tile (horizontal) — a recommendation surface, so tapping one
// starts the song's own radio, not the tile list (YTM parity). The ⋮ lives at the
// tile's right edge (hover on desktop, always visible on touch).
// `showPlays` renders YTM's list-row subline "Artist · 969M plays" (explore pages).
export function QuickPick({ track, className, showPlays }: { track: Track; className?: string; showPlays?: boolean }) {
  const { playRadio, current } = usePlayer();
  const cover = useCover(track);
  const active = current?.id === track.id;
  const subline =
    showPlays && track.plays && track.plays !== "0K"
      ? `${track.artist || track.album} · ${track.plays} plays`
      : track.artist || track.album;
  return (
    <div
      className={cn(
        "group flex h-16 items-center gap-1 overflow-hidden rounded-lg bg-surface-2 pr-1.5 text-left transition hover:bg-surface-3",
        active && "bg-surface-3 ring-1 ring-white/25",
        className
      )}
    >
      <button
        onClick={() => playRadio(track, `${track.title} radio`)}
        className="flex h-full min-w-0 flex-1 items-center gap-3 overflow-hidden text-left"
        aria-label={`Play ${track.title}`}
      >
        <Cover from={track.colors[0]} to={track.colors[1]} seed={track.id} cover={cover} glyphSize="text-xl" rounded="rounded-none" className="h-full w-16 shrink-0 shadow-none" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{track.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{subline}</span>
        </span>
        <span className={cn("mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition", active ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
          <Play className="h-4 w-4 fill-foreground text-foreground" />
        </span>
      </button>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/30 sm:bg-transparent">
        <SongCardMenu track={track} />
      </span>
    </div>
  );
}

// Speed-dial matrix cell — YTM's Speed dial: square art, tight radius, title (+
// artist) underneath, nothing else. Recommendation surface → tap starts the
// song's own radio (same single-tap semantics as every other home card).
export function SpeedDialTile({ track }: { track: Track }) {
  const { playRadio } = usePlayer();
  const cover = useCover(track);
  return (
    <button
      onClick={() => playRadio(track, `${track.title} radio`)}
      className="group block w-full text-left"
      aria-label={`Play ${track.title} by ${track.artist}`}
    >
      <div className="relative">
        <Cover
          from={track.colors[0]}
          to={track.colors[1]}
          seed={track.id}
          cover={cover}
          rounded="rounded-lg"
          className="aspect-square w-full"
        />
        <span className="absolute bottom-2 right-2 flex h-9 w-9 translate-y-1.5 items-center justify-center rounded-full bg-[var(--accent)] opacity-0 shadow-xl shadow-black/40 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
          <Play className="h-4 w-4 fill-black text-black" />
        </span>
      </div>
      <p className="mt-2 truncate text-[13px] font-medium text-foreground">{track.title}</p>
      {(track.artist || track.album) && (
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{track.artist || track.album}</p>
      )}
    </button>
  );
}
