"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

// Procedural album art: warm gradient + large glyph + subtle texture.
// Zero network images — instant load, cohesive look.

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

const GLYPHS = ["◆", "✦", "◉", "▲", "❋", "✺", "⬡", "✷", "◐", "✜", "❖", "✧"];

const emptySubscribe = () => () => {};

interface CoverProps {
  from: string;
  to: string;
  seed: string;
  label?: string;
  /** real album art URL — rendered over the gradient; gradient stays as loading/fallback */
  cover?: string;
  className?: string;
  glyphSize?: string;
  rounded?: string;
  /** mount fade (default on). Pass false where art must never appear translucent —
   *  e.g. the player's cover-carousel slots, which slide in fully opaque. */
  fade?: boolean;
}

export function Cover({ from, to, seed, label, cover, className, glyphSize = "text-5xl", rounded = "rounded-2xl", fade = true }: CoverProps) {
  const h = hashCode(seed);
  const glyph = GLYPHS[h % GLYPHS.length];
  const rot = (h % 40) - 20;
  const px = 20 + (h % 40);
  const py = 15 + ((h >> 3) % 40);
  // art comes from localStorage-backed stores → render only after mount (hydration-safe).
  // useSyncExternalStore mounted-gate: false during SSR + first paint, true after — no setState.
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  return (
    <div
      className={cn("relative overflow-hidden shadow-lg shadow-black/40", rounded, className)}
      style={{ background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }}
      aria-hidden="true"
    >
      {/* texture rings */}
      <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full border border-white/20" />
      <div className="absolute -right-2 -top-2 h-14 w-14 rounded-full border border-white/25" />
      <div className="absolute -left-8 -bottom-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
      {/* glyph */}
      <div
        className="absolute inset-0 flex items-center justify-center font-black text-white/85 drop-shadow-[0_4px_16px_rgba(0,0,0,0.35)] select-none"
        style={{ fontSize: glyphSize.includes("text-") ? undefined : glyphSize, transform: `translate(${px / 4 - 5}%, ${py / 6 - 3}%) rotate(${rot / 2}deg)` }}
      >
        <span className={glyphSize}>{glyph}</span>
      </div>
      {/* real album art — fades in over the procedural fallback (post-mount, hydration-safe) */}
      {mounted && cover && (
        <img
          src={cover}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          draggable={false}
          className={cn("absolute inset-0 h-full w-full object-cover select-none [-webkit-user-drag:none]", fade && "animate-fadein")}
          onError={(e) => {
            // art failed to load → fall back to the procedural cover beneath
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      {label && (
        <div className="absolute inset-x-0 bottom-0 p-3">
          <p className="truncate text-[13px] font-bold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]">{label}</p>
        </div>
      )}
    </div>
  );
}

// Animated equalizer bars for "now playing" indicator
export function NowBars({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <div className={cn("flex h-4 items-end gap-[3px]", className)} aria-label="Now playing">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn("w-[3px] rounded-full bg-[var(--accent)]", playing ? "animate-eq" : "")}
          style={{
            height: playing ? undefined : "30%",
            animationDelay: `${i * 0.15}s`,
            animationDuration: `${0.9 + (i % 2) * 0.25}s`,
          }}
        />
      ))}
    </div>
  );
}
