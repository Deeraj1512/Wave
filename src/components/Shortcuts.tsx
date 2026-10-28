"use client";

/**
 * Global keyboard shortcuts — Spotify-web parity with a few YTM keys, plus a "?"
 * help dialog for discoverability (Spotify's signature touch).
 *
 * Playback: Space/K play·pause · ←/→ seek ∓5s · J/L seek ∓10s · N next · P previous
 * Mixer:    ↑/↓ volume · M mute · S shuffle · R repeat · A autoplay
 * Chrome:   Q queue panel · F now-playing view · / search · ? this help · Esc close
 *
 * Keys are ignored while typing in inputs/editables. Space + arrows preventDefault
 * so the page never scroll-jumps. The player object is read through a latest-ref,
 * so the listener is attached once (no churn on every progress tick).
 */

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePlayer } from "@/lib/player";
import type { Screen } from "@/lib/types";

const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: "Playback",
    items: [
      ["Space / K", "Play or pause"],
      ["← / →", "Seek back / forward 5s"],
      ["J / L", "Seek back / forward 10s"],
      ["N", "Next song"],
      ["P", "Previous song"],
    ],
  },
  {
    title: "Mixer",
    items: [
      ["↑ / ↓", "Volume up / down"],
      ["M", "Mute or unmute"],
      ["S", "Shuffle"],
      ["R", "Repeat"],
      ["A", "Autoplay (radio)"],
    ],
  },
  {
    title: "App",
    items: [
      ["Q", "Toggle queue panel"],
      ["F", "Now-playing view"],
      ["/", "Search"],
      ["?", "Shortcut help"],
      ["Esc", "Close player / panels"],
    ],
  },
];

export function ShortcutsLayer({
  navigate,
  onToggleQueuePanel,
  onCloseQueuePanel,
}: {
  navigate: (s: Screen) => void;
  onToggleQueuePanel: () => void;
  onCloseQueuePanel: () => void;
}) {
  const p = usePlayer();
  const pRef = useRef(p);
  useEffect(() => {
    pRef.current = p;
  });
  const [helpOpen, setHelpOpen] = useState(false);

  // top-bar keyboard icon can open the help dialog
  useEffect(() => {
    const open = () => setHelpOpen(true);
    window.addEventListener("dhun:shortcuts-help", open);
    return () => window.removeEventListener("dhun:shortcuts-help", open);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const editable = el?.closest("input, textarea, select, [contenteditable='true']");
      if (editable) return;

      const P = pRef.current;
      const key = e.key;
      const dur = P.current?.duration ?? 0;
      const clamp = (s: number) => Math.max(0, dur ? Math.min(dur, s) : s);

      switch (key) {
        case " ":
        case "k":
        case "K":
          e.preventDefault();
          P.togglePlay();
          break;
        case "ArrowRight":
          e.preventDefault();
          P.seek(clamp(P.progress + 5));
          break;
        case "ArrowLeft":
          e.preventDefault();
          P.seek(clamp(P.progress - 5));
          break;
        case "j":
        case "J":
          P.seek(clamp(P.progress - 10));
          break;
        case "l":
        case "L":
          P.seek(clamp(P.progress + 10));
          break;
        case "n":
        case "N":
          P.next();
          break;
        case "p":
        case "P":
          P.prev();
          break;
        case "ArrowUp":
          e.preventDefault();
          P.setVolume(Math.min(1, Math.round((P.volume + 0.05) * 100) / 100));
          break;
        case "ArrowDown":
          e.preventDefault();
          P.setVolume(Math.max(0, Math.round((P.volume - 0.05) * 100) / 100));
          break;
        case "m":
        case "M":
          P.setVolume(P.volume === 0 ? 0.8 : 0);
          break;
        case "s":
        case "S":
          P.toggleShuffle();
          break;
        case "r":
        case "R":
          P.cycleRepeat();
          break;
        case "a":
        case "A":
          P.toggleAutoplay();
          break;
        case "q":
        case "Q":
          onToggleQueuePanel();
          break;
        case "f":
        case "F":
          P.setExpanded(!P.expanded);
          break;
        case "/":
          e.preventDefault();
          navigate({ name: "search" });
          break;
        case "?":
          setHelpOpen(true);
          break;
        case "Escape":
          if (P.expanded) P.setExpanded(false);
          else onCloseQueuePanel();
          setHelpOpen(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, onToggleQueuePanel, onCloseQueuePanel]);

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="max-w-lg border-white/10 bg-[#212121] text-foreground sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-black">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Drive Wave without leaving the keyboard.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-5 pb-2 sm:grid-cols-3">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="pb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">{g.title}</p>
              <ul className="space-y-2">
                {g.items.map(([keys, desc]) => (
                  <li key={keys} className="flex items-center justify-between gap-3">
                    <span className="text-[13px] text-foreground/85">{desc}</span>
                    <kbd className="shrink-0 rounded-md border border-white/10 bg-white/[0.07] px-1.5 py-0.5 text-[11px] font-bold text-foreground/80">
                      {keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
