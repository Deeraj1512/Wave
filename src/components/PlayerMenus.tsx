"use client";

/**
 * Player action sheets — companions to the players' media controls. The full
 * player keeps its chrome minimal: "Add to playlist", "Sleep timer" and
 * "Queue" live inside its three-dot MoreOptionsSheet, which chains into the
 * dedicated sheets below.
 *
 * One bottom-sheet grammar everywhere (mobile-native; centered column on
 * desktop) with three bodies:
 *   options  — the ⋮ menu itself (routes to the two sheets below + the queue)
 *   sleep    — customizable sleep timer (presets + custom minutes + end-of-song)
 *   playlist — pick one of your playlists (checkmark = in there; tap to toggle)
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ListMusic, ListPlus, Music, Plus, Timer, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlayer, type SleepTimerState } from "@/lib/player";
import { useToast } from "@/hooks/use-toast";
import {
  addToUserPlaylist,
  createUserPlaylist,
  getUserPlaylists,
  removeFromUserPlaylist,
  subscribePlaylists,
  playlistsVersion,
  isTrackInUserPlaylist,
} from "@/lib/playlists";
import type { Track } from "@/lib/types";

/** External-store hook — re-renders on every playlists mutation. */
export function usePlaylists() {
  const v = useSyncExternalStore(subscribePlaylists, playlistsVersion, () => 0);
  return useMemo(() => {
    void v;
    return getUserPlaylists();
  }, [v]);
}

// ── shared sheet chrome ────────────────────────────────────────────────────────

function SheetFrame({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // portal to <body> — the sheet is opened from song rows/cards that sit inside
  // backdrop-blur / transform wrappers, which would otherwise become the containing
  // block for this fixed overlay and pin it to a 32px icon
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
      className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-[2px]"
      role="dialog"
      aria-label={title}
    >
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 32, stiffness: 340 }}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[78dvh] w-full max-w-[440px] flex-col rounded-t-3xl border border-white/10 bg-[#12121b] pb-[env(safe-area-inset-bottom)] text-white shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-center px-5 pt-3">
          <div className="h-1.5 w-12 rounded-full bg-white/25" />
        </div>
        <div className="flex items-center gap-1 px-4 pb-1 pt-2">
          <div className="min-w-0 flex-1 px-1">
            <h3 className="truncate text-base font-black leading-tight">{title}</h3>
            {subtitle && <p className="truncate text-xs text-white/50">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:bg-white/10">
            <X className="h-4.5 w-4.5 text-white/70" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-1">{children}</div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

function SheetRow({ icon, title, subtitle, onClick, trailing }: { icon: React.ReactNode; title: string; subtitle?: string; onClick: () => void; trailing?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left transition hover:bg-white/[0.07]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-white/85">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{title}</span>
        {subtitle && <span className="block truncate text-xs text-white/50">{subtitle}</span>}
      </span>
      {trailing}
    </button>
  );
}

// ── sleep timer body ───────────────────────────────────────────────────────────

const SLEEP_PRESETS = [5, 10, 15, 30, 45, 60, 90];

function fmtRemaining(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function SleepTimerBody({ onPicked }: { onPicked: () => void }) {
  const { sleepTimer, setSleepTimer } = usePlayer();
  const { toast } = useToast();
  const [, tick] = useState(0);
  const [custom, setCustom] = useState("");

  // live countdown while the sheet is open (1 Hz, cosmetic only)
  useEffect(() => {
    const id = setInterval(() => tick((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const subtitleFor = (t: SleepTimerState): string => {
    if (!t) return "Off";
    if (t.mode === "track") return "After the current song";
    return `${t.minutes} min · ${fmtRemaining(t.endsAt - Date.now())} left`;
  };

  const pick = (apply: () => void, label: string) => {
    apply();
    toast({ title: label, duration: 2500 });
    onPicked();
  };

  const activeMinutes = sleepTimer?.mode === "time" ? sleepTimer.minutes : null;

  return (
    <div className="space-y-0.5">
      <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">
        {sleepTimer ? `Sleep timer — ${subtitleFor(sleepTimer)}` : "Sleep timer"}
      </p>
      <SheetRow
        icon={<Timer className="h-4.5 w-4.5" />}
        title="Off"
        subtitle={sleepTimer ? "Cancel the timer" : "Play without a timer"}
        onClick={() => pick(() => setSleepTimer(null), sleepTimer ? "Sleep timer cancelled" : "Sleep timer is off")}
        trailing={sleepTimer === null ? <Check className="h-4 w-4 text-[var(--accent)]" /> : undefined}
      />
      <SheetRow
        icon={<Timer className="h-4.5 w-4.5" />}
        title="End of current song"
        subtitle="Pause when this song finishes"
        onClick={() => pick(() => setSleepTimer("track"), "Music stops after this song")}
        trailing={sleepTimer?.mode === "track" ? <Check className="h-4 w-4 text-[var(--accent)]" /> : undefined}
      />
      {SLEEP_PRESETS.map((m) => (
        <SheetRow
          key={m}
          icon={<Timer className="h-4.5 w-4.5" />}
          title={`${m} minutes`}
          onClick={() => pick(() => setSleepTimer({ minutes: m }), `Music stops in ${m} min`)}
          trailing={activeMinutes === m ? <Check className="h-4 w-4 text-[var(--accent)]" /> : undefined}
        />
      ))}
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const m = Number(custom);
              if (m >= 1) pick(() => setSleepTimer({ minutes: m }), `Music stops in ${m} min`);
            }
          }}
          inputMode="numeric"
          placeholder="Custom"
          aria-label="Custom minutes"
          className="h-10 w-full flex-1 rounded-xl bg-white/[0.07] px-3.5 text-sm outline-none ring-white/15 placeholder:text-white/35 focus:ring-1"
        />
        <button
          onClick={() => {
            const m = Number(custom);
            if (m >= 1) pick(() => setSleepTimer({ minutes: m }), `Music stops in ${m} min`);
          }}
          disabled={!(Number(custom) >= 1)}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-white px-4 text-sm font-bold text-black transition disabled:opacity-35"
        >
          <Plus className="h-4 w-4" /> Set
        </button>
      </div>
    </div>
  );
}

// ── add-to-playlist body ───────────────────────────────────────────────────────

export function AddToPlaylistBody({ track, onPicked }: { track: Track; onPicked?: () => void }) {
  const playlists = usePlaylists();
  const { toast } = useToast();
  const [name, setName] = useState("");

  const createAndAdd = () => {
    const pl = createUserPlaylist(name, [track]);
    if (!pl) return;
    setName("");
    toast({ title: "Created playlist", description: `“${pl.name}” · 1 song`, duration: 3000 });
    onPicked?.();
  };

  const toggle = (id: string, plName: string) => {
    if (isTrackInUserPlaylist(id, track.id)) {
      removeFromUserPlaylist(id, track.id);
      toast({ title: "Removed from playlist", description: plName, duration: 2500 });
    } else {
      addToUserPlaylist(id, track);
      toast({ title: "Added to playlist", description: plName, duration: 2500 });
    }
  };

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2 px-2 pb-2 pt-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) createAndAdd();
          }}
          placeholder="New playlist name"
          aria-label="New playlist name"
          maxLength={80}
          className="h-10 w-full flex-1 rounded-xl bg-white/[0.07] px-3.5 text-sm outline-none ring-white/15 placeholder:text-white/35 focus:ring-1"
        />
        <button
          onClick={createAndAdd}
          disabled={!name.trim()}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-white px-4 text-sm font-bold text-black transition disabled:opacity-35"
        >
          <Plus className="h-4 w-4" /> Create
        </button>
      </div>

      {playlists.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-white/40">No playlists yet — name one above and it lands here.</p>
      ) : (
        playlists.map((pl) => {
          const inPl = pl.tracks.some((t) => t.id === track.id);
          return (
            <SheetRow
              key={pl.id}
              icon={<Music className="h-4.5 w-4.5" />}
              title={pl.name}
              subtitle={`${pl.tracks.length} song${pl.tracks.length === 1 ? "" : "s"}`}
              onClick={() => toggle(pl.id, pl.name)}
              trailing={
                inPl ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-[var(--accent)]">
                    <Check className="h-4 w-4" /> Added
                  </span>
                ) : (
                  <ListPlus className="h-4 w-4 shrink-0 text-white/40" />
                )
              }
            />
          );
        })
      )}
    </div>
  );
}

// ── the players' direct sheets ──────────────────────────────────────────────

/** "More options" — the full player's ⋮ menu: routes to Add to playlist,
 *  Sleep timer and the Queue. Lives as the single action button in the
 *  expanded player's header. */
export function MoreOptionsSheet({
  open, onClose, onAddToPlaylist, onSleepTimer, onQueue,
}: {
  open: boolean;
  onClose: () => void;
  onAddToPlaylist: () => void;
  onSleepTimer: () => void;
  onQueue: () => void;
}) {
  const { sleepTimer, queue, queueIndex } = usePlayer();
  const upcoming = Math.max(0, queue.length - queueIndex - 1);
  const sleepSub = !sleepTimer ? "Off" : sleepTimer.mode === "track" ? "After the current song" : `${sleepTimer.minutes} min`;
  return (
    <AnimatePresence>
      {open && (
        <SheetFrame title="More options" onClose={onClose}>
          <div className="space-y-0.5 pb-2 pt-1">
            <SheetRow
              icon={<ListPlus className="h-4.5 w-4.5" />}
              title="Add to playlist"
              subtitle="Save this song to your playlists"
              onClick={() => { onClose(); onAddToPlaylist(); }}
            />
            <SheetRow
              icon={<Timer className="h-4.5 w-4.5" />}
              title="Sleep timer"
              subtitle={sleepSub}
              onClick={() => { onClose(); onSleepTimer(); }}
            />
            <SheetRow
              icon={<ListMusic className="h-4.5 w-4.5" />}
              title="Queue"
              subtitle={upcoming > 0 ? `${upcoming} song${upcoming === 1 ? "" : "s"} up next` : "See what's up next"}
              onClick={() => { onClose(); onQueue(); }}
            />
          </div>
        </SheetFrame>
      )}
    </AnimatePresence>
  );
}

/** "Add to playlist" — opened from the ⋮ menu (was its own header button). */
export function AddToPlaylistSheet({ track, open, onClose }: { track: Track; open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <SheetFrame title="Add to playlist" subtitle={`${track.title} · ${track.artist}`} onClose={onClose}>
          <AddToPlaylistBody track={track} />
        </SheetFrame>
      )}
    </AnimatePresence>
  );
}

/** "Sleep timer" — opened from the ⋮ menu (was its own header button). */
export function SleepTimerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { sleepTimer } = usePlayer();
  const sub = !sleepTimer ? "Off" : sleepTimer.mode === "track" ? "After the current song" : `${sleepTimer.minutes} min`;
  return (
    <AnimatePresence>
      {open && (
        <SheetFrame title="Sleep timer" subtitle={sub} onClose={onClose}>
          <SleepTimerBody onPicked={onClose} />
        </SheetFrame>
      )}
    </AnimatePresence>
  );
}
