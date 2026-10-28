"use client";

import { useState } from "react";
import { Heart, ListPlus, ListStart, MoreVertical, Music, Pause, Play, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtTime } from "@/lib/data";
import type { Track } from "@/lib/types";
import { usePlayer } from "@/lib/player";
import { useCover } from "@/lib/covers";
import { useToast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AddToPlaylistSheet } from "./PlayerMenus";
import { Cover, NowBars } from "./Cover";

interface TrackRowProps {
  track: Track;
  index?: number; // show number instead of cover when provided
  context?: Track[]; // queue context to play within
  showAlbum?: boolean;
  /** "Playing from" queue label when this row starts playback */
  label?: string;
  /** YTM single-tap semantics: play this row's own radio instead of the list context */
  radio?: boolean;
}

export function TrackRow({ track, index, context, showAlbum = true, label, radio }: TrackRowProps) {
  const { current, isPlaying, playTrack, playRadio, togglePlay, likedIds, toggleLike, playNext, addToQueue, startRadio } = usePlayer();
  const { toast } = useToast();
  const cover = useCover(track);
  const active = current?.id === track.id;
  const liked = likedIds.has(track.id);
  const [plOpen, setPlOpen] = useState(false);

  const handlePlay = () => {
    if (active) {
      togglePlay();
    } else if (radio) {
      playRadio(track, label ?? `${track.title} radio`);
    } else {
      playTrack(track, context, label);
    }
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors sm:gap-4 sm:px-3",
        active ? "bg-surface-2" : "hover:bg-surface-2/70"
      )}
    >
      {/* index / thumbnail */}
      <button
        onClick={handlePlay}
        className="relative h-11 w-11 shrink-0 sm:h-12 sm:w-12"
        aria-label={`${active && isPlaying ? "Pause" : "Play"} ${track.title}`}
      >
        {index !== undefined && !active ? (
          <>
            <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-muted-foreground group-hover:opacity-0">
              {index}
            </span>
            <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
              <Play className="h-4 w-4 fill-foreground text-foreground" />
            </span>
          </>
        ) : (
          <>
            <Cover from={track.colors[0]} to={track.colors[1]} seed={track.id} cover={cover} glyphSize="text-lg" rounded="rounded-lg" className="h-full w-full" />
            <span
              className={cn(
                "absolute inset-0 flex items-center justify-center rounded-lg bg-black/55 opacity-0 transition group-hover:opacity-100",
                active && isPlaying && "opacity-100"
              )}
            >
              {active && isPlaying ? <Pause className="h-4 w-4 fill-white text-white" /> : <Play className="h-4 w-4 fill-white text-white" />}
            </span>
          </>
        )}
      </button>

      {/* title + artist (album stands in when the source gave no artist credit) */}
      <button onClick={handlePlay} className="min-w-0 flex-1 text-left">
        <p className={cn("truncate text-sm font-semibold", active ? "text-[var(--accent)]" : "text-foreground")}>{track.title}</p>
        {(track.artist || showAlbum) && (
          <p className="truncate text-xs text-muted-foreground">
            {track.artist || ""}
            {showAlbum && <span className="hidden sm:inline">{track.artist ? " · " : ""}{track.album}</span>}
          </p>
        )}
      </button>

      {/* now-playing bars */}
      {active && <NowBars playing={isPlaying} className="mr-1 hidden sm:flex" />}

      {/* language + plays */}
      {track.lang && (
        <span className="hidden shrink-0 rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground md:inline">
          {track.lang}
        </span>
      )}
      <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground lg:inline">{fmtTime(track.duration)}</span>

      {/* like */}
      <button
        onClick={() => toggleLike(track.id, track)}
        aria-label={liked ? `Unlike ${track.title}` : `Like ${track.title}`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:bg-surface-3"
      >
        <Heart className={cn("h-4 w-4 transition", liked ? "fill-[var(--accent)] text-[var(--accent)]" : "text-muted-foreground opacity-0 group-hover:opacity-100")} />
      </button>

      {/* queue menu — every row feeds the queue, like YTM/Spotify list rows */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`More options for ${track.title}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-60 transition hover:bg-surface-3 hover:text-foreground focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
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
    </div>
  );
}
