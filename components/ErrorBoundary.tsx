"use client";

/**
 * Top-level crash net (batch 9). A render error anywhere in the app used to
 * unmount the whole React tree → the WebView showed a dead BLANK PAGE (the
 * user's report: tapping a song's ⋮ menu opened a blank screen). This boundary
 * catches any render error below it and shows a real "Something went wrong"
 * screen with a Reload button instead — the app stays recoverable, and the
 * error is logged for chrome://inspect instead of dying silently.
 *
 * Scope: it wraps PlayerProvider + AppShell in src/app/page.tsx, i.e. the
 * entire UI. Portaled content (Radix dropdowns, bottom sheets) still reports
 * to it, because React portals propagate errors to the parent React tree.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface BoundaryProps {
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // visible in chrome://inspect / adb logcat instead of a silent white page
    console.error("[wave] render error caught by ErrorBoundary:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-[var(--bg)] px-6 text-center text-foreground">
          <p className="text-lg font-black">Something went wrong</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Wave hit an unexpected error. Reload to continue — your downloads, likes and playlists are safe on this device.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-bold text-black shadow-lg shadow-black/30 transition hover:bg-white"
          >
            Reload Wave
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
