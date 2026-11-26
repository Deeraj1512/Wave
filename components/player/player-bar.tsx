"use client";

import { ListMusic, Pause, Play, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { usePlayer } from "./player-provider";

function fmt(s: number) {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function PlayerBar() {
  const p = usePlayer();
  const [queueOpen, setQueueOpen] = useState(false);
  const t = p.current;
  if (!t) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <div className="mx-auto max-w-5xl px-4">
        {/* seek row */}
        <div className="flex items-center gap-3 pt-2">
          <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-zinc-500">{fmt(p.time)}</span>
          <Slider
            value={[Math.min(p.time, p.duration || 1)]}
            max={p.duration || 1}
            step={1}
            onValueChange={(v) => p.seek(v[0])}
            aria-label="Seek"
            className="flex-1 [&_[data-slot=slider-track]]:h-1"
          />
          <span className="w-10 shrink-0 text-[11px] tabular-nums text-zinc-500">{fmt(p.duration)}</span>
        </div>

        {/* main row */}
        <div className="flex items-center gap-3 py-2">
          <div className="flex h-11 w-11 shrink-0 overflow-hidden rounded-md bg-zinc-800">
            { }
            {t.thumb ? <img src={t.thumb} alt="" className="h-full w-full object-cover" /> : null}
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{t.title}</div>
            <div className="truncate text-xs text-zinc-400">{t.artist ?? "—"}</div>
          </div>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={p.prev} aria-label="Previous" className="hidden sm:inline-flex">
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              onClick={p.toggle}
              aria-label={p.isPlaying ? "Pause" : "Play"}
              className="h-10 w-10 rounded-full bg-white text-black hover:bg-zinc-200"
            >
              {p.isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={p.next} aria-label="Next" className="hidden sm:inline-flex">
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          <div className="hidden w-28 items-center gap-2 md:flex" aria-label="Volume">
            <Volume2 className="h-4 w-4 shrink-0 text-zinc-500" />
            <Slider
              value={[p.volume]}
              min={0}
              max={1}
              step={0.05}
              onValueChange={(v) => p.setVolume(v[0])}
              aria-label="Volume slider"
              className="flex-1"
            />
          </div>

          <Sheet open={queueOpen} onOpenChange={setQueueOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Queue" className="relative shrink-0">
                <ListMusic className="h-4 w-4" />
                {p.queue.length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                    {p.queue.length}
                  </span>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full border-zinc-800 bg-zinc-950 p-0 sm:max-w-sm">
              <SheetHeader className="border-b border-zinc-800 px-4 py-3">
                <SheetTitle className="text-sm">Up next · {p.queue.length} tracks</SheetTitle>
              </SheetHeader>
              <div className="max-h-[calc(100vh-8rem)] overflow-y-auto p-2">
                {p.queue.map((track, i) => (
                  <button
                    key={`${track.videoId}-${i}`}
                    onClick={() => p.jumpTo(i)}
                    className={`flex w-full items-center gap-2 rounded-md p-2 text-left text-sm ${
                      i === p.index ? "bg-zinc-900 text-red-500" : "text-zinc-300 hover:bg-zinc-900"
                    }`}
                  >
                    <span className="w-5 shrink-0 text-center text-xs text-zinc-500">
                      {i === p.index ? "▶" : i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{track.title}</span>
                    <span className="shrink-0 text-xs text-zinc-500">{track.duration ?? ""}</span>
                  </button>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </div>
  );
}
