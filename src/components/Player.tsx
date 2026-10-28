"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, animate, motion, Reorder, useDragControls, useMotionValue, useTransform } from "framer-motion";
import {
  ChevronDown, ChevronUp, ExternalLink, GripVertical, Heart, ListMusic, ListPlus, ListStart, MoreVertical, Music, Pause, Play, Radio, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2, VolumeX, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlayer, ytLinkFor, radioModeLabel, type QTrack, type RadioMode } from "@/lib/player";
import { useCover } from "@/lib/covers";
import { fmtTime } from "@/lib/data";
import { recentPlays, subscribeHistory, type RecentPlay } from "@/lib/history";
import { queueLangs } from "@/lib/langs";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDominantPalette } from "@/hooks/use-dominant-palette";
import { AddToPlaylistSheet, MoreOptionsSheet, SleepTimerSheet } from "./PlayerMenus";
import type { Lang, Track } from "@/lib/types";
import { Cover, NowBars } from "./Cover";

// ─────────────────────────────────────────────────────────────────────────────
// GradientWash — ONE dominant art color whose intensity decreases straight down
// the page: strongest at the top, smoothly gone by the bottom (mask fade, never
// a hue shift), over the opaque ink base. No diagonal seams, no glow blobs —
// just color. Crossfades when the song changes. Real album-art palette when
// available, procedural track colors as fallback, so it never looks broken.
// ─────────────────────────────────────────────────────────────────────────────
const WASH_FADE = "linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.82) 24%, rgba(0,0,0,0.58) 46%, rgba(0,0,0,0.34) 66%, rgba(0,0,0,0.14) 84%, transparent 100%)";

export function GradientWash({ colors, className }: { colors: [string, string]; className?: string }) {
  return (
    <div className={cn("absolute inset-0", className)}>
      {/* opaque ink base — OUTSIDE the crossfade and never animated, so nothing
          behind the player can bleed through mid-switch (two crossfading layers
          at ~50% each used to composite ~25% see-through for 0.9s every switch) */}
      <div className="absolute inset-0 bg-[#08080D]" />
      <AnimatePresence initial={false}>
        <motion.div
          key={`${colors[0]}|${colors[1]}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: "easeInOut" }}
          className="absolute inset-0"
        >
          {/* the dominant color only — intensity falls monotonically down the page */}
          <div
            className="absolute inset-0"
            style={{ backgroundColor: colors[0], maskImage: WASH_FADE, WebkitMaskImage: WASH_FADE }}
          />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SeekArea — YTM's expressive thick seek bar: hairline at rest, grows + thumb
// on hover. Shared by the desktop player bar and the now-playing view.
// ─────────────────────────────────────────────────────────────────────────────
function SeekArea({
  progress,
  duration,
  onSeek,
  tone = "base",
  className,
}: {
  progress: number;
  duration: number;
  onSeek: (sec: number) => void;
  tone?: "base" | "light";
  className?: string;
}) {
  const pct = duration > 0 ? Math.min(100, Math.max(0, (progress / duration) * 100)) : 0;
  const trackBg = tone === "light" ? "bg-white/20" : "bg-white/15";
  const fillBg = tone === "light" ? "bg-white" : "bg-foreground";
  return (
    <div
      className={cn("group/bar relative h-6 min-w-0 flex-1 cursor-pointer", className)}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - rect.left) / rect.width) * duration);
      }}
      role="slider"
      aria-label="Seek"
      aria-valuenow={Math.round(progress)}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      tabIndex={0}
    >
      <div className={cn("absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full transition-all group-hover/bar:h-1.5", trackBg)}>
        <div className={cn("h-full rounded-full transition-[width] duration-500 ease-linear", fillBg)} style={{ width: `${pct}%` }} />
      </div>
      <div
        className={cn("absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full opacity-0 shadow transition group-hover/bar:opacity-100", fillBg)}
        style={{ left: `calc(${pct}% - 6px)` }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Player bar — YTM web's three-zone layout on desktop (left: art + meta + like,
// center: transport + expressive seek, right: queue / volume / expand panel),
// compact glass bar on mobile. Spotify touches: title hover-underline opens the
// now-playing view, queue button lights when songs are manually queued.
// ─────────────────────────────────────────────────────────────────────────────
export function MiniPlayer({ onToggleQueuePanel, queuePanelOpen }: { onToggleQueuePanel: () => void; queuePanelOpen: boolean }) {
  const {
    current, isPlaying, progress, togglePlay, next, prev, setExpanded, likedIds, toggleLike, seek,
    shuffle, toggleShuffle, repeat, cycleRepeat, volume, setVolume, engine, buffering, soundBlocked,
    restoreSound, queue, queueIndex,
  } = usePlayer();
  const { toast } = useToast();
  const cover = useCover(current);
  const pal = useDominantPalette(current);

  // the engine gave up (bot-wall / offline) — explain instead of failing silently
  useEffect(() => {
    const onBlocked = () => {
      toast({
        title: "Playback is blocked on this network",
        description: "YouTube audio can't start here right now. Try again later or open the song on YouTube.",
        duration: 7000,
      });
    };
    const onSleepFired = () => {
      toast({ title: "Sleep timer finished", description: "Playback paused — sleep well.", duration: 4500 });
    };
    window.addEventListener("dhun:playback-blocked", onBlocked);
    window.addEventListener("dhun:sleep-fired", onSleepFired);
    return () => {
      window.removeEventListener("dhun:playback-blocked", onBlocked);
      window.removeEventListener("dhun:sleep-fired", onSleepFired);
    };
  }, [toast]);

  if (!current) return null;
  // the ONE total for the whole bar — 0 (unknown) until a truth source lands, never a
  // half-known value: keeps elapsed/remaining/seek math consistent (fixed "-0:00")
  const total = current.duration > 0 ? current.duration : 0;
  const pct = total > 0 ? (progress / total) * 100 : 0;
  const liked = likedIds.has(current.id);
  const manualQueued = queue.slice(queueIndex + 1).filter((x) => x.layer === "manual").length;

  // engine delivery is an implementation detail — only surface it when the user must
  // ACT (muted autoplay) or should KNOW (buffering / simulated preview). Labels like
  // "YouTube player" / "HD audio" leaked plumbing into the artist line (user-reported).
  const engineTag = soundBlocked ? " · muted — tap for sound" : buffering ? " · buffering…" : engine === "sim" ? " · preview mode" : "";

  return (
    <div className="pointer-events-auto relative">
      {/* muted-autoplay recovery pill — the very next tap restores sound */}
      {soundBlocked && isPlaying && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            restoreSound();
          }}
          className="absolute -top-11 right-3 z-20 flex animate-pulse items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-xs font-bold text-black shadow-xl"
          aria-label="Tap for sound"
        >
          <VolumeX className="h-3.5 w-3.5" />
          Tap for sound
        </button>
      )}

      {/* ══ mobile — compact glass bar (YTM mobile grammar) ══ */}
      <div className="md:hidden">
        <div className="h-[3px] w-full bg-white/10">
          <div className="h-full bg-[var(--accent)] transition-[width] duration-500 ease-linear" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center gap-3 border-t border-border bg-surface-2/85 px-3 py-2.5 backdrop-blur-2xl sm:px-4">
          <button onClick={() => setExpanded(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label="Expand player">
            <Cover from={current.colors[0]} to={current.colors[1]} seed={current.id} cover={cover} glyphSize="text-lg" rounded="rounded-lg" className="h-11 w-11 shrink-0 sm:h-12 sm:w-12" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-foreground">{current.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {current.artist}
                {engineTag}
              </span>
            </span>
          </button>
          <button onClick={() => toggleLike(current.id, current)} aria-label={liked ? "Unlike" : "Like"} className="hidden h-9 w-9 items-center justify-center rounded-full hover:bg-surface-3 sm:flex">
            <Heart className={cn("h-4 w-4", liked ? "fill-[var(--accent)] text-[var(--accent)]" : "text-muted-foreground")} />
          </button>
          {/* media controls — transport only: shuffle / prev / play / next;
              add-to-playlist + sleep timer live in the expanded player's ⋮ menu */}
          <div className="flex items-center gap-1 sm:gap-2">
            <button onClick={toggleShuffle} aria-label="Shuffle" aria-pressed={shuffle} title="Shuffle" className={cn("relative flex h-9 w-9 items-center justify-center rounded-full transition", shuffle ? "text-[var(--accent)]" : "text-muted-foreground hover:bg-surface-3 hover:text-foreground")}>
              <Shuffle className="h-4 w-4" />
              {shuffle && <span className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-[var(--accent)]" />}
            </button>
            <button onClick={prev} aria-label="Previous song" title="Previous song" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-3">
              <SkipBack className="h-4 w-4 fill-foreground text-foreground" />
            </button>
            <button onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"} className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background transition hover:scale-105">
              {isPlaying ? <Pause className="h-5 w-5 fill-background" /> : <Play className="h-5 w-5 fill-background" />}
            </button>
            <button onClick={next} aria-label="Next song" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-3">
              <SkipForward className="h-4 w-4 fill-foreground text-foreground" />
            </button>
            {engine === "sim" && (
              <a href={ytLinkFor(current)} target="_blank" rel="noreferrer" aria-label="Hear it on YouTube" title="Hear it on YouTube" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-3">
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </a>
            )}
          </div>
          <button onClick={() => setExpanded(true)} aria-label="Now playing bars" className="ml-1 hidden sm:block">
            <NowBars playing={isPlaying} />
          </button>
          {/* seek on hover strip (mobile) */}
          <input
            type="range"
            min={0}
            max={Math.max(1, total)}
            value={progress}
            onChange={(e) => seek(Number(e.target.value))}
            className="absolute -top-[3px] left-0 h-3 w-full cursor-pointer opacity-0"
            aria-label="Seek"
          />
        </div>
      </div>

      {/* ══ desktop — YTM three-zone player bar ══ */}
      <div className="hidden border-t border-border bg-surface-2/90 backdrop-blur-2xl md:block">
        <div className="grid h-[84px] grid-cols-[minmax(220px,1fr)_minmax(0,2.1fr)_minmax(220px,1fr)] items-center gap-4 px-4">
          {/* left: art + meta + like (art/title open the now-playing view — Spotify touch) */}
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => setExpanded(true)} aria-label="Open now playing view" className="shrink-0 transition hover:scale-[1.03]">
              <Cover from={current.colors[0]} to={current.colors[1]} seed={current.id} cover={cover} glyphSize="text-xl" rounded="rounded-lg" className="h-14 w-14" />
            </button>
            <span className="min-w-0">
              <button onClick={() => setExpanded(true)} className="block max-w-full truncate text-sm font-bold text-foreground hover:underline" aria-label={`Now playing view for ${current.title}`}>
                {current.title}
              </button>
              <span className="block truncate text-xs text-muted-foreground">
                {current.artist}
                {engineTag}
              </span>
            </span>
            <button onClick={() => toggleLike(current.id, current)} aria-label={liked ? "Unlike" : "Like"} className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-surface-3">
              <Heart className={cn("h-4 w-4", liked ? "fill-[var(--accent)] text-[var(--accent)]" : "text-muted-foreground")} />
            </button>
          </div>

          {/* center: transport over the expressive seek — exactly YTM's stack */}
          <div className="flex min-w-0 flex-col items-center gap-1">
            <div className="flex items-center gap-5">
              <button onClick={toggleShuffle} aria-label="Shuffle" aria-pressed={shuffle} className={cn("relative flex h-8 w-8 items-center justify-center rounded-full transition", shuffle ? "text-[var(--accent)]" : "text-muted-foreground hover:text-foreground")}>
                <Shuffle className="h-4 w-4" />
                {shuffle && <span className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-[var(--accent)]" />}
              </button>
              <button onClick={prev} aria-label="Previous" className="text-foreground/90 transition hover:scale-105 hover:text-foreground">
                <SkipBack className="h-5 w-5 fill-current" />
              </button>
              <button onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"} className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background shadow-lg transition hover:scale-105">
                {isPlaying ? <Pause className="h-5 w-5 fill-background" /> : <Play className="h-5 w-5 translate-x-[1px] fill-background" />}
              </button>
              <button onClick={next} aria-label="Next" className="text-foreground/90 transition hover:scale-105 hover:text-foreground">
                <SkipForward className="h-5 w-5 fill-current" />
              </button>
              <button onClick={cycleRepeat} aria-label={repeat === 2 ? "Loop one" : repeat === 1 ? "Loop all" : "Loop off"} aria-pressed={repeat !== 0} title={`Loop: ${repeat === 2 ? "one song" : repeat === 1 ? "all" : "off"}`} className={cn("relative flex h-8 w-8 items-center justify-center rounded-full transition", repeat !== 0 ? "text-[var(--accent)]" : "text-muted-foreground hover:text-foreground")}>
                {repeat === 2 ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
                {repeat !== 0 && <span className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-[var(--accent)]" />}
              </button>
            </div>
            <div className="flex w-full max-w-[580px] items-center gap-2.5">
              <span className="w-10 shrink-0 text-right text-[11px] font-semibold tabular-nums text-muted-foreground">{fmtTime(progress)}</span>
              <SeekArea progress={progress} duration={total} onSeek={seek} />
              {/* right label = the CONSTANT total (never a remaining-time countdown) */}
              <span className="w-10 shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">{total > 0 ? fmtTime(total) : "--:--"}</span>
            </div>
          </div>

          {/* right: queue panel toggle · volume · expand (YTM) */}
          <div className="flex items-center justify-end gap-2">
            {engine === "sim" && (
              <a href={ytLinkFor(current)} target="_blank" rel="noreferrer" aria-label="Hear it on YouTube" title="Hear it on YouTube" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-3">
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </a>
            )}
            <button
              onClick={onToggleQueuePanel}
              aria-label="Toggle queue panel"
              aria-pressed={queuePanelOpen}
              title="Queue (Q)"
              className={cn("relative flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-surface-3", queuePanelOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <ListMusic className="h-4.5 w-4.5" />
              {manualQueued > 0 && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
            </button>
            <button onClick={() => setVolume(volume === 0 ? 0.8 : 0)} aria-label={volume === 0 ? "Unmute" : "Mute"} title="Mute (M)" className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-surface-3 hover:text-foreground">
              {volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="slider-accent h-1 w-16 cursor-pointer appearance-none rounded-full bg-white/20 lg:w-24"
              aria-label="Volume"
              style={{ background: `linear-gradient(to right, #f5f3ef ${volume * 100}%, rgba(255,255,255,0.2) ${volume * 100}%)` }}
            />
            <button
              onClick={onToggleQueuePanel}
              aria-label={queuePanelOpen ? "Close queue panel" : "Open queue panel"}
              title={queuePanelOpen ? "Close queue" : "Open queue (Q)"}
              className="ml-1 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-surface-3 hover:text-foreground"
            >
              <ChevronUp className={cn("h-5 w-5 transition-transform duration-300", queuePanelOpen && "rotate-180")} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Full player — immersive now-playing view. Art-derived gradient wash (real
// album-art palette, crossfaded), expressive seek, queue sheet. YTM mobile
// grammar; the desktop player bar stays reachable via Esc / minimize.
// ─────────────────────────────────────────────────────────────────────────────
export function FullPlayer() {
  const {
    current, isPlaying, progress, expanded, setExpanded, togglePlay, next, prev,
    seek, shuffle, toggleShuffle, repeat, cycleRepeat, likedIds, toggleLike, volume, setVolume, queue, queueIndex,
    soundBlocked, restoreSound, engine,
  } = usePlayer();
  const cover = useCover(current);
  const pal = useDominantPalette(current);
  // carousel neighbors — queue order IS play order (shuffle reorders the queue
  // itself), so ±1 indices are always the truthful prev/next arts
  const prevTrack = queueIndex > 0 ? queue[queueIndex - 1] : undefined;
  const nextTrack = queueIndex < queue.length - 1 ? queue[queueIndex + 1] : undefined;
  const prevCover = useCover(prevTrack);
  const nextCover = useCover(nextTrack);
  const [queueOpen, setQueueOpen] = useState(false);
  const [sheet, setSheet] = useState<"playlist" | "sleep" | "options" | null>(null);
  const colors: [string, string] = pal ? [pal[0], pal[1]] : current?.colors ?? ["#15151f", "#08080d"];

  // swipe gestures — one channel per direction, driven by PURE PAN → motion values
  // (no React re-renders, compositor-only transforms → no dropped frames):
  //   up      → content lifts elastically (queueLiftY); release past threshold opens the queue
  //   down    → the WHOLE player follows the finger 1:1 (dismissY); release past threshold
  //             hands off seamlessly to the exit animation, otherwise springs back
  //   l / r   → the 3-slot cover strip follows the finger 1:1 (carouselX — YTM's
  //             cover carousel); release past threshold COMPLETES the slide so the
  //             neighbor art lands in the slot, then next/prev commits and the
  //             strip snaps to zero before paint — the incoming art becomes the center
  //             (neighbors ride fully opaque — visibility-gated, zero fading)
  // A direction lock picks the axis on first intent, so diagonal pans never cross channels.
  const queueLiftY = useMotionValue(0);
  const dismissY = useMotionValue(typeof window !== "undefined" ? window.innerHeight : 0);
  const carouselX = useMotionValue(0);
  const slidePitch = useMotionValue(360); // slot width + 20px gap — measured on mount/resize
  const prevSlideX = useTransform(() => carouselX.get() - slidePitch.get());
  const nextSlideX = useTransform(() => carouselX.get() + slidePitch.get());
  // neighbors are ALWAYS fully opaque — YTM slides covers in, it never fades
  // them. visibility (not opacity) keeps them out of sight at rest, so the
  // background wash can never bleed through the art mid-switch.
  const sideVisible = useTransform(carouselX, (v) => (Math.abs(v) > 0.5 ? "visible" : "hidden"));
  const artSlotRef = useRef<HTMLDivElement | null>(null);
  const commitRef = useRef<"next" | "prev" | null>(null);
  const panAxisRef = useRef<"x" | "y" | null>(null);
  // initial{} can't reset an externally owned motion value on re-open — re-seed it
  // before paint so the player always enters from fully off-screen
  useLayoutEffect(() => {
    if (expanded) dismissY.set(window.innerHeight);
  }, [expanded, dismissY]);
  // keep the slide pitch in sync with the real slot width (78vw phones / 340px desktop)
  useEffect(() => {
    const measure = () => {
      const w = artSlotRef.current?.clientWidth;
      if (w) slidePitch.set(w + 20);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [slidePitch]);
  // track changed — swipe commit, radio advance, queue jump — the strip snaps to
  // center BEFORE paint, so the art that just slid in simply becomes the center
  useLayoutEffect(() => {
    carouselX.set(0);
  }, [current?.id, carouselX]);

  return (
    <AnimatePresence>
      {expanded && current && (
        <motion.div
          key="fullplayer"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 300 }}
          style={{ y: dismissY, willChange: "transform" }}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden"
          role="dialog"
          aria-label="Now playing"
        >
          {/* art-derived wash — one dominant color fading down the page (procedural fallback) */}
          <GradientWash colors={colors} />

          {/* header — minimal chrome: minimize + ⋮ menu (playlist / sleep / queue
              live inside the menu, per user request; no title block) */}
          <div className="relative flex items-center justify-between px-5 py-4">
            <button onClick={() => setExpanded(false)} aria-label="Minimize player" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur transition hover:bg-white/20">
              <ChevronDown className="h-5 w-5 text-white" />
            </button>
            <button onClick={() => setSheet("options")} aria-label="More options" title="More options" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur transition hover:bg-white/20">
              <MoreVertical className="h-5 w-5 text-white" />
            </button>
          </div>

          {/* art + controls — the swipe surface (YTM mobile grammar). Pan is the
              single gesture system with a direction lock: HORIZONTAL pans slide
              the 3-slot cover carousel 1:1 (neighbors slide in fully opaque)
              and a >22%/fast-flick release completes the slide — the incoming
              art lands in the slot as the track switches (left = next, right =
              previous); UPWARD pans lift the content elastically and a >70px/
              fast-flick release opens the queue; DOWNWARD pans drag the entire
              player 1:1 and a >80px/fast-flick release closes it via the exit
              spring (continues from the dragged position — no jump). Small drags
              spring back. All channels write motion values only — zero React
              renders inside the gesture path. */}
          <motion.div
            style={{ y: queueLiftY, willChange: "transform" }}
            onPan={(_, info) => {
              // direction lock — the first axis to show intent owns the whole
              // pan (platform standard): horizontal drives the cover carousel,
              // vertical keeps the queue-lift / dismiss channels
              if (panAxisRef.current === null) {
                const dx = Math.abs(info.offset.x);
                const dy = Math.abs(info.offset.y);
                if (dx < 7 && dy < 7) return; // dead zone — decide with real intent
                panAxisRef.current = dx > dy ? "x" : "y";
              }
              if (panAxisRef.current === "x") {
                // 1:1 carousel follow; rubber-band when no neighbor exists to slide to
                const d = info.offset.x;
                if (d > 0 && !prevTrack) carouselX.set(d * 0.18);
                else if (d < 0 && !nextTrack) carouselX.set(d * 0.18);
                else carouselX.set(d);
                return;
              }
              queueLiftY.set(Math.min(0, info.offset.y * 0.45));
              dismissY.set(Math.max(0, info.offset.y));
            }}
            onPanEnd={(_, info) => {
              const settle = { type: "spring" as const, stiffness: 340, damping: 34 };
              const axis = panAxisRef.current;
              panAxisRef.current = null;
              if (axis === "x") {
                // YTM cover carousel: swipe art LEFT → next track, RIGHT → previous.
                // Release past threshold COMPLETES the slide — the neighbor art
                // lands exactly in the slot — then the track commits and the
                // strip resets to zero before paint (no bounce-back, no fade swap).
                const w = artSlotRef.current?.clientWidth ?? 320;
                const pitchNow = w + 20;
                const thr = Math.max(60, w * 0.22);
                const slide: { duration: number; ease: [number, number, number, number] } = { duration: 0.26, ease: [0.22, 0.61, 0.36, 1] };
                const finish = () => {
                  if (commitRef.current === "next") next();
                  else if (commitRef.current === "prev") prev();
                  commitRef.current = null;
                };
                if ((info.offset.x < -thr || info.velocity.x < -450) && nextTrack) {
                  commitRef.current = "next";
                  animate(carouselX, -pitchNow, { ...slide, onComplete: finish });
                } else if ((info.offset.x > thr || info.velocity.x > 450) && prevTrack) {
                  commitRef.current = "prev";
                  animate(carouselX, pitchNow, { ...slide, onComplete: finish });
                } else {
                  commitRef.current = null;
                  animate(carouselX, 0, settle);
                }
                return;
              }
              const openQueue = info.offset.y < -70 || info.velocity.y < -500;
              const dismiss = !openQueue && (info.offset.y > 80 || info.velocity.y > 600);
              if (openQueue) {
                animate(queueLiftY, 0, settle);
                if (dismissY.get() !== 0) animate(dismissY, 0, settle);
                setQueueOpen(true);
              } else if (dismiss) {
                setExpanded(false); // exit spring continues from the finger position
              } else {
                if (queueLiftY.get() !== 0) animate(queueLiftY, 0, settle);
                if (dismissY.get() !== 0) animate(dismissY, 0, settle);
              }
            }}
            className="relative flex flex-1 flex-col items-center justify-center gap-7 px-6 pb-8 touch-none sm:px-14"
          >
            {/* YTM cover carousel — 3 absolute slots: [previous · current · next].
                Horizontal pans slide all slots together; the neighbors ride
                fully opaque, visibility-gated so they only exist while a drag
                is live (nothing fades — art never goes translucent). On release
                past threshold the slide COMPLETES, the track commits, and the
                layout effect snaps the strip to zero before paint — so the art
                that slid in simply becomes the center. No bounce-back, no fade
                swap, no transparency. */}
            <div ref={artSlotRef} className="relative aspect-square w-full max-w-[min(78vw,340px)]">
              {prevTrack && (
                <motion.div className="absolute inset-0" style={{ x: prevSlideX, visibility: sideVisible, willChange: "transform" }}>
                  <Cover
                    from={prevTrack.colors[0]}
                    to={prevTrack.colors[1]}
                    seed={prevTrack.id}
                    cover={prevCover}
                    fade={false}
                    glyphSize="text-[110px]"
                    rounded="rounded-[28px]"
                    className="aspect-square w-full shadow-2xl shadow-black/60"
                  />
                </motion.div>
              )}
              {nextTrack && (
                <motion.div className="absolute inset-0" style={{ x: nextSlideX, visibility: sideVisible, willChange: "transform" }}>
                  <Cover
                    from={nextTrack.colors[0]}
                    to={nextTrack.colors[1]}
                    seed={nextTrack.id}
                    cover={nextCover}
                    fade={false}
                    glyphSize="text-[110px]"
                    rounded="rounded-[28px]"
                    className="aspect-square w-full shadow-2xl shadow-black/60"
                  />
                </motion.div>
              )}
              <motion.div className="absolute inset-0" style={{ x: carouselX, willChange: "transform" }}>
                <Cover
                  from={colors[0]}
                  to={colors[1]}
                  seed={current.id}
                  cover={cover}
                  glyphSize="text-[110px]"
                  rounded="rounded-[28px]"
                  className={cn("aspect-square w-full shadow-2xl shadow-black/60 transition-transform duration-500", isPlaying ? "scale-100" : "scale-[0.88]")}
                />
              </motion.div>
            </div>

            <div className="flex w-full max-w-xl items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-2xl font-black text-white sm:text-3xl">{current.title}</h2>
                <p className="mt-1 truncate text-sm font-medium text-white/70">
                  {[current.artist, current.year > 0 ? current.year : null, current.lang].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button onClick={() => toggleLike(current.id, current)} aria-label={likedIds.has(current.id) ? "Unlike" : "Like"} className="mt-1 shrink-0">
                <Heart className={cn("h-6 w-6 transition", likedIds.has(current.id) ? "scale-110 fill-white text-white" : "text-white/60 hover:text-white")} />
              </button>
            </div>

            {/* muted-autoplay recovery pill */}
            {soundBlocked && isPlaying && (
              <button
                onClick={restoreSound}
                className="flex animate-pulse items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-black text-black shadow-2xl"
                aria-label="Tap for sound"
              >
                <VolumeX className="h-4 w-4" />
                Tap for sound
              </button>
            )}

            {/* all engines failed — always-audible escape hatch */}
            {engine === "sim" && (
              <a
                href={ytLinkFor(current)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20"
              >
                <ExternalLink className="h-4 w-4" />
                Hear it on YouTube
              </a>
            )}

            {/* expressive seek bar (shared with the desktop player bar) */}
            <div className="w-full max-w-xl">
              <SeekArea progress={progress} duration={current ? (current.duration > 0 ? current.duration : 0) : 0} onSeek={seek} tone="light" className="h-8" />
              <div className="flex justify-between text-xs font-semibold tabular-nums text-white/60">
                <span>{fmtTime(progress)}</span>
                {/* right label = the CONSTANT total (never a remaining-time countdown) */}
                <span>{current && current.duration > 0 ? fmtTime(current.duration) : "--:--"}</span>
              </div>
            </div>

            {/* transport */}
            <div className="flex w-full max-w-xl items-center justify-between">
              <div className="flex items-center gap-2">
                <button onClick={toggleShuffle} aria-label="Shuffle" aria-pressed={shuffle} className={cn("flex h-10 w-10 items-center justify-center rounded-full transition", shuffle ? "text-white" : "text-white/50 hover:text-white")}>
                  <Shuffle className="h-5 w-5" />
                  {shuffle && <span className="absolute mt-7 h-1 w-1 rounded-full bg-[var(--accent)]" />}
                </button>
              </div>
              <div className="flex items-center gap-4 sm:gap-6">
                <button onClick={prev} aria-label="Previous" className="text-white transition hover:scale-105">
                  <SkipBack className="h-7 w-7 fill-white" />
                </button>
                <button onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"} className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-black shadow-2xl transition hover:scale-105">
                  {isPlaying ? <Pause className="h-7 w-7 fill-black" /> : <Play className="h-7 w-7 fill-black translate-x-[1px]" />}
                </button>
                <button onClick={next} aria-label="Next" className="text-white transition hover:scale-105">
                  <SkipForward className="h-7 w-7 fill-white" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={cycleRepeat} aria-label={repeat === 2 ? "Loop one" : repeat === 1 ? "Loop all" : "Loop off"} aria-pressed={repeat !== 0} title={`Loop: ${repeat === 2 ? "one song" : repeat === 1 ? "all" : "off"}`} className={cn("flex h-10 w-10 items-center justify-center rounded-full transition", repeat !== 0 ? "text-white" : "text-white/50 hover:text-white")}>
                  {repeat === 2 ? <Repeat1 className="h-5 w-5" /> : <Repeat className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {/* volume (desktop) */}
            <div className="hidden w-full max-w-xs items-center gap-3 sm:flex">
              <button onClick={() => setVolume(volume === 0 ? 0.8 : 0)} aria-label="Mute">
                {volume === 0 ? <VolumeX className="h-4 w-4 text-white/60" /> : <Volume2 className="h-4 w-4 text-white/60" />}
              </button>
              <input
                type="range" min={0} max={1} step={0.01} value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="slider-accent h-1 w-full cursor-pointer appearance-none rounded-full bg-white/20"
                aria-label="Volume"
                style={{ background: `linear-gradient(to right, #fff ${(volume * 100)}%, rgba(255,255,255,0.2) ${(volume * 100)}%)` }}
              />
            </div>
          </motion.div>

          {/* queue sheet — the best of Spotify + YouTube Music */}
          <AnimatePresence>
            {queueOpen && <QueueSheet current={current} onClose={() => setQueueOpen(false)} />}
          </AnimatePresence>

          {/* ⋮ menu → chained sheets — add-to-playlist / sleep timer / queue now
              route through MoreOptionsSheet instead of dedicated header buttons */}
          <MoreOptionsSheet
            open={sheet === "options"}
            onClose={() => setSheet(null)}
            onAddToPlaylist={() => setSheet("playlist")}
            onSleepTimer={() => setSheet("sleep")}
            onQueue={() => setQueueOpen(true)}
          />
          <AddToPlaylistSheet track={current} open={sheet === "playlist"} onClose={() => setSheet(null)} />
          <SleepTimerSheet open={sheet === "sleep"} onClose={() => setSheet(null)} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue — two bodies, one brain:
//   sheet (mobile) — YTM's drag-to-dismiss bottom sheet inside the full player
//   panel (desktop) — YTM web's right-side "Up next" panel beside the content
// YTM's flat, drag-to-reorder queue + Spotify's manual priority: manual rows
// jump the line ("Queued" chip), the source context follows, radio rows tail
// under the Autoplay marker. Every destructive action is undoable.
// ─────────────────────────────────────────────────────────────────────────────

const RECENT_COLORS: [string, string] = ["#3a3a3a", "#1c1c1c"];

/** history entry → playable row shape (never carries a uid that exists in the queue) */
function toQTrack(r: RecentPlay): QTrack {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    album: "",
    movie: "",
    duration: 0,
    year: 0,
    plays: "",
    colors: RECENT_COLORS,
    cover: r.cover,
    uid: `h:${r.id}`,
    layer: "context",
  };
}

function QueueSheet({ current, onClose, variant = "sheet" }: { current: Track; onClose: () => void; variant?: "sheet" | "panel" }) {
  const {
    queue, queueIndex, playingFrom, autoplay, toggleAutoplay, radioLoading,
    radioMode, setRadioMode,
    reorderUpcoming, clearManualQueue, reinsertQueueItem, removeFromQueue, startRadio,
    jumpTo, addToQueue, playNext, isPlaying, togglePlay, playTrack,
  } = usePlayer();
  const { toast } = useToast();
  const sheetControls = useDragControls();
  const isPanel = variant === "panel";
  // history lives in an external store — subscribe, recompute during render
  const [historyV, setHistoryV] = useState(0);
  useEffect(() => subscribeHistory(() => setHistoryV((v) => v + 1)), []);
  const recent = useMemo(() => {
    void historyV; // re-derive whenever the listening history changes
    return recentPlays(8).filter((r) => r.id !== current.id);
  }, [historyV, current.id]);

  const upcoming = queue.slice(queueIndex + 1);
  const manualCount = upcoming.filter((x) => x.layer === "manual").length;
  const firstRadioIdx = upcoming.findIndex((x) => x.layer === "radio");

  // YTM's queue chips — language filters detected from what's playing + what's queued
  const langChips = useMemo(
    () => queueLangs([current, ...upcoming.map(({ title, album, lang }) => ({ title, album, lang }))], 2),
    [current, upcoming]
  );

  const chipDefs = useMemo<Array<{ mode: RadioMode; label: string }>>(() => {
    const langs = [...langChips];
    // a persisted language mode stays visible (and selectable) even when the current
    // queue no longer contains that language
    if (radioMode.startsWith("lang:")) {
      const l = radioMode.slice(5) as Lang;
      if (!langs.includes(l)) langs.push(l);
    }
    return [
      { mode: "all", label: "All" },
      { mode: "familiar", label: "Familiar" },
      { mode: "discover", label: "Discover" },
      { mode: "party", label: "Party" },
      ...langs.map((l) => ({ mode: `lang:${l}` as RadioMode, label: l })),
    ];
  }, [langChips, radioMode]);

  const removeWithUndo = (t: QTrack) => {
    const idx = queue.findIndex((x) => x.uid === t.uid);
    removeFromQueue(t.uid);
    toast({
      title: "Removed from queue",
      description: t.title,
      duration: 6000,
      action: <ToastAction altText="Undo" onClick={() => reinsertQueueItem(t, idx)}>Undo</ToastAction>,
    });
  };

  /** "Play next" for a row already in the queue = a MOVE, not a duplicate (YTM behavior) */
  const moveNext = (t: QTrack) => {
    if (upcoming[0]?.uid === t.uid) return;
    reorderUpcoming([t, ...upcoming.filter((x) => x.uid !== t.uid)]);
    toast({ title: "Playing next", duration: 2500 });
  };

  const clearQueue = () => {
    clearManualQueue();
    toast({ title: "Queue cleared", duration: 2500 });
  };

  const startRadioAt = (t: QTrack) => {
    startRadio(t, t.uid);
    toast({ title: "Radio started", description: "Similar songs added to the queue", duration: 3000 });
  };

  const header = (
    <>
      <div className="flex items-center justify-between gap-2 px-5 pb-1 pt-3">
        <div className="min-w-0">
          <h3 className="text-lg font-black leading-tight text-white">Up next</h3>
          <p className="truncate text-xs text-white/50">
            {playingFrom ? `Playing from ${playingFrom}` : "Your queue"}
            {upcoming.length > 0 && ` · ${upcoming.length} song${upcoming.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {manualCount > 0 && (
            <button
              onClick={clearQueue}
              aria-label="Clear manually queued songs"
              className="rounded-full px-3 py-1.5 text-xs font-bold text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              Clear queue
            </button>
          )}
          <button onClick={onClose} aria-label="Close queue" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10">
            <X className="h-4 w-4 text-white/70" />
          </button>
        </div>
      </div>
      {/* autoplay — YTM position, pinned under the header */}
      <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-1.5">
        <div className="min-w-0">
          <p className="text-sm font-bold text-white">Autoplay</p>
          <p className="truncate text-xs text-white/50">Add similar songs to the end of the queue</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {radioLoading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-transparent" aria-label="Loading radio" />}
          <button
            onClick={toggleAutoplay}
            role="switch"
            aria-checked={autoplay}
            aria-label="Toggle autoplay"
            className={cn("relative h-5 w-9 rounded-full transition", autoplay ? "bg-[var(--accent)]" : "bg-white/20")}
          >
            <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", autoplay ? "left-[18px]" : "left-0.5")} />
          </button>
        </div>
      </div>
      {/* YTM's autoplay filter chips — steer what "similar" means (All / Familiar / Discover / Party / language) */}
      {autoplay && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-5 pb-3 pt-0.5" role="tablist" aria-label="Autoplay filter">
          {chipDefs.map(({ mode, label }) => {
            const on = radioMode === mode;
            return (
              <button
                key={mode}
                role="tab"
                aria-selected={on}
                onClick={() => setRadioMode(mode)}
                className={cn(
                  "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition active:scale-95",
                  on ? "bg-white text-black shadow" : "bg-white/[0.09] text-white/85 hover:bg-white/[0.15]"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </>
  );

  const body = (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-8">
      {/* now playing — Spotify-style card, tap to pause/resume */}
      <SectionTitle>Now playing</SectionTitle>
      <QueueRow track={current as QTrack} variant="active" />

      {/* flat upcoming — the whole play order, drag any row to rearrange (YTM) */}
      <Reorder.Group as="div" axis="y" values={upcoming} onReorder={reorderUpcoming} className="pb-1 pt-2">
        {upcoming.map((t, i) => (
          <Fragment key={t.uid}>
            {i === firstRadioIdx && (
              <p className="flex items-center gap-2 px-3 pb-1.5 pt-3 text-[11px] font-bold uppercase tracking-[0.18em] text-white/45">
                <Radio className="h-3.5 w-3.5" />
                {autoplay ? `Autoplay is on · ${radioModeLabel(radioMode)}` : "Autoplay is off"}
                {radioLoading && autoplay && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-transparent" />}
              </p>
            )}
            <QueueRow
              track={t}
              variant="queued"
              onRemove={() => removeWithUndo(t)}
              onPlayNext={() => moveNext(t)}
            />
          </Fragment>
        ))}
      </Reorder.Group>

      {upcoming.length === 0 && (
        <div className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-7 text-center">
          <p className="text-sm font-bold text-white/85">{autoplay ? "Autoplay is on" : "Nothing next"}</p>
          <p className="mx-auto mt-1 max-w-[280px] text-xs leading-relaxed text-white/45">
            {autoplay
              ? radioLoading
                ? "Finding similar songs…"
                : `Similar${radioMode === "all" ? "" : ` ${radioModeLabel(radioMode).toLowerCase()}`} songs will be added after this one — originals only.`
              : "Playback stops here. Turn on Autoplay to keep the music going."}
          </p>
        </div>
      )}

      {/* recently played — YTM keeps history right below the queue */}
      {recent.length > 0 && (
        <>
          <SectionTitle>Recently played</SectionTitle>
          {recent.map((r) => (
            <QueueRow key={`h:${r.id}`} track={toQTrack(r)} variant="plain" />
          ))}
        </>
      )}
    </div>
  );

  if (isPanel) {
    // desktop right panel — static, full height, no drag grammar
    return (
      <div className="flex h-full flex-col bg-[#0c0c14]">
        {header}
        {body}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", damping: 32, stiffness: 320 }}
      drag="y"
      dragListener={false}
      dragControls={sheetControls}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.5 }}
      onDragEnd={(_, info) => { if (info.offset.y > 120) onClose(); }}
      className="absolute inset-x-0 bottom-0 top-[9%] flex flex-col rounded-t-3xl border-t border-white/15 bg-[#0c0c14]/97 backdrop-blur-2xl"
    >
      {/* header — the only drag zone (rows inside scroll freely and reorder independently) */}
      <div className="shrink-0 touch-none select-none" onPointerDown={(e) => sheetControls.start(e)}>
        <div className="flex items-center justify-center px-5 pb-1 pt-3">
          <div className="h-1.5 w-12 rounded-full bg-white/25" />
        </div>
        {header}
      </div>
      {body}
    </motion.div>
  );
}

/** Desktop right-side "Up next" panel — YTM web grammar, exported for the shell. */
export function QueuePanel({ current, onClose }: { current: Track; onClose: () => void }) {
  return <QueueSheet current={current} onClose={onClose} variant="panel" />;
}

function SectionTitle({ children, hint, icon }: { children: React.ReactNode; hint?: string; icon?: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 px-3 pb-1.5 pt-4 text-[11px] font-bold uppercase tracking-[0.18em] text-white/45">
      {icon}
      {children}
      {hint && <span className="font-medium normal-case tracking-normal text-white/30">· {hint}</span>}
    </p>
  );
}

type RowVariant = "active" | "queued" | "plain";

/**
 * One queue row, three lives:
 *  active — the song playing now (tap = pause/resume, menu = add / radio)
 *  queued — sits in the physical queue (drag handle to reorder, removable, "Play next" moves it)
 *  plain  — history row below the queue (tap = play fresh, "Play next" inserts a copy)
 */
function QueueRow({ track, variant, onRemove, onPlayNext }: { track: QTrack; variant: RowVariant; onRemove?: () => void; onPlayNext?: () => void }) {
  const { isPlaying, jumpTo, addToQueue, playNext, startRadio, togglePlay, playRadio, likedIds, toggleLike } = usePlayer();
  const { toast } = useToast();
  const controls = useDragControls();
  const cover = useCover(track);
  const active = variant === "active";
  const [plOpen, setPlOpen] = useState(false);

  const playIt = () => {
    if (active) togglePlay();
    else if (variant === "queued") jumpTo(track.uid);
    else playRadio(track, `${track.title} radio`);
  };

  const addNext = () => {
    if (variant === "queued" && onPlayNext) {
      onPlayNext(); // move, don't duplicate — the row is already in the queue
      return;
    }
    playNext(track);
    toast({ title: "Playing next", duration: 2500 });
  };

  const addEnd = () => {
    addToQueue(track);
    toast({ title: "Added to queue", duration: 2500 });
  };

  const startRadioHere = () => {
    startRadio(track, variant === "plain" ? undefined : track.uid);
    toast({ title: "Radio started", description: "Similar songs added to the queue", duration: 3000 });
  };

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`More options for ${track.title}`}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/50 transition hover:bg-white/10 hover:text-white"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" sideOffset={6} className="w-56">
        {!active && (
          <DropdownMenuItem onClick={addNext} className="gap-2.5">
            <ListStart className="h-4 w-4 text-muted-foreground" /> Play next
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={addEnd} className="gap-2.5">
          <ListPlus className="h-4 w-4 text-muted-foreground" /> Add to queue
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPlOpen(true)} className="gap-2.5">
          <Music className="h-4 w-4 text-muted-foreground" /> Add to playlist
        </DropdownMenuItem>
        <DropdownMenuItem onClick={startRadioHere} className="gap-2.5">
          <Radio className="h-4 w-4 text-muted-foreground" /> Start radio
        </DropdownMenuItem>
        {onRemove && (
          <DropdownMenuItem onClick={onRemove} className="gap-2.5 text-red-400 focus:bg-red-400/10 focus:text-red-300">
            <X className="h-4 w-4" /> Remove from queue
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const row = (
    <div className={cn("group flex w-full items-center gap-1.5 rounded-xl px-2 py-1.5 text-left transition hover:bg-white/5", active && "bg-white/10")}>
      {variant === "queued" && (
        <button
          onPointerDown={(e) => {
            e.stopPropagation();
            controls.start(e);
          }}
          aria-label={`Reorder ${track.title}`}
          title="Drag to reorder"
          className="-ml-1 flex h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-white/25 transition hover:text-white/70 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <button
        onClick={playIt}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={active ? (isPlaying ? `Pause ${track.title}` : `Play ${track.title}`) : `Play ${track.title}`}
      >
        <Cover
          from={track.colors[0]}
          to={track.colors[1]}
          seed={track.id}
          cover={cover}
          glyphSize="text-base"
          rounded="rounded-lg"
          className={cn("shrink-0", active ? "h-12 w-12" : "h-11 w-11")}
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn("truncate text-sm font-bold", active ? "text-[var(--accent)]" : "text-white")}>{track.title}</span>
            {variant === "queued" && track.layer === "manual" && (
              <span className="shrink-0 rounded bg-white/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white/45">Queued</span>
            )}
          </span>
          <span className="block truncate text-xs text-white/50">{track.artist}</span>
        </span>
      </button>
      {active ? (
        <>
          {/* YTM's Save on the now-playing row */}
          <button
            onClick={() => toggleLike(track.id, track)}
            aria-label={likedIds.has(track.id) ? `Unlike ${track.title}` : `Save ${track.title}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <Heart className={cn("h-4 w-4", likedIds.has(track.id) && "fill-[var(--accent)] text-[var(--accent)]")} />
          </button>
          <NowBars playing={isPlaying} className="mr-1 shrink-0" />
        </>
      ) : track.duration > 0 ? (
        <span className="mr-1 hidden shrink-0 text-xs tabular-nums text-white/40 group-hover:hidden sm:block">{fmtTime(track.duration)}</span>
      ) : null}
      {menu}
      <AddToPlaylistSheet track={track} open={plOpen} onClose={() => setPlOpen(false)} />
    </div>
  );

  if (variant === "queued") {
    return (
      <Reorder.Item
        value={track}
        as="div"
        dragListener={false}
        dragControls={controls}
        whileDrag={{ scale: 1.02, backgroundColor: "#15151f", boxShadow: "0 16px 40px rgba(0,0,0,0.55)" }}
        className="rounded-xl"
      >
        {row}
      </Reorder.Item>
    );
  }
  return row;
}
