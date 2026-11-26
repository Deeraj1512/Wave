"use client";

import { useRef, useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShelfProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

// YTM shelf: plain medium-weight title, hover arrows, snap carousel. No subtitle.
export function Shelf({ title, children, className }: ShelfProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [canL, setCanL] = useState(false);
  const [canR, setCanR] = useState(true);

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setCanL(el.scrollLeft > 8);
    setCanR(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  };

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const nudge = (dir: number) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(320, el.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <section className={cn("group/shelf", className)} aria-label={title}>
      <div className="mb-4 flex items-end justify-between gap-4 px-1">
        <h2 className="text-xl font-medium text-foreground sm:text-[22px]">{title}</h2>
        <div className="hidden gap-2 sm:flex">
          <button
            onClick={() => nudge(-1)}
            disabled={!canL}
            aria-label={`Scroll ${title} left`}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-foreground/90 opacity-0 transition group-hover/shelf:opacity-100 hover:bg-surface-3 disabled:opacity-0"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => nudge(1)}
            disabled={!canR}
            aria-label={`Scroll ${title} right`}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-foreground/90 opacity-0 transition group-hover/shelf:opacity-100 hover:bg-surface-3 disabled:opacity-0"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div ref={ref} className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-2">
        {children}
      </div>
    </section>
  );
}
