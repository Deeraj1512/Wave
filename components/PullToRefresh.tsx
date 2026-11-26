"use client";

import { useEffect } from "react";

/**
 * Chrome-style pull-to-refresh, built for Wave's WebView shell (works in the
 * PWA too — the Android WebView has no native pull-to-refresh, so this owns
 * the gesture in JS):
 *
 *  • a touch that starts while every scroll container under the finger sits at
 *    its top, dragged DOWN (not sideways), becomes a pull;
 *  • a rubber-banded arc indicator slides in from under the status bar — past
 *    the threshold it locks (Wave accent + a haptic tick) and releasing
 *    reloads the app;
 *  • the reload is safe for playback: the session restore in player.tsx
 *    re-arms the last track at its saved second, and the APK WebView allows
 *    autoplay — so a playing song keeps flowing through the refresh.
 *
 * Overlays (full player, ⋮ menus, mini bar) are marked `data-wave-ptr-ignore`
 * and never trigger a refresh. Native overscroll stretch/glow is disabled in
 * MainActivity (OVER_SCROLL_NEVER) and `overscroll-behavior-y: none` in CSS,
 * so this indicator is the only response to an over-pull.
 */

const PULL_RESISTANCE = 0.42; // finger px → indicator px
const INDICATOR_TRAVEL = 64; // max indicator drop (px)
const ARM_OFFSET = 54; // indicator px that arms the refresh
const IDLE_STROKE = "rgba(255,255,255,.92)";
const ARMED_STROKE = "#ff0000";

export function PullToRefresh() {
  useEffect(() => {
    // DOM-built indicator — zero React renders in the gesture path.
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "position:fixed;left:50%;top:calc(env(safe-area-inset-top, 0px) + 6px);width:28px;height:28px;" +
      "margin-left:-14px;z-index:2147483000;pointer-events:none;opacity:0;will-change:transform,opacity;";
    host.innerHTML =
      '<svg viewBox="0 0 24 24" width="28" height="28">' +
      '<circle cx="12" cy="12" r="9" fill="none" stroke="' + IDLE_STROKE + '" stroke-width="2.6" ' +
      'stroke-linecap="round" stroke-dasharray="42.4 56.5"/></svg>';
    const svg = host.querySelector("svg");
    const arc = host.querySelector("circle");
    if (!svg || !arc) return;
    document.body.appendChild(host);

    let touchId = -1;
    let startY = 0;
    let startX = 0;
    let eligible = false; // touch began over content parked at the top
    let active = false; // locked-in vertical pull
    let cancelled = false; // a horizontal scroll won the gesture
    let armed = false; // past the refresh threshold
    let reloading = false;
    let lastOffset = 0;

    const setStroke = (color: string) => {
      arc.setAttribute("stroke", color);
    };

    const paint = (offset: number) => {
      lastOffset = offset;
      const progress = Math.min(offset / INDICATOR_TRAVEL, 1);
      host.style.opacity = String(Math.min(1, offset / 18));
      host.style.transform = `translateY(${(offset - 34).toFixed(1)}px)`;
      svg.style.transform = `rotate(${(progress * 260).toFixed(1)}deg)`;
    };

    const hide = () => {
      host.style.transition = "transform .28s cubic-bezier(.2,.6,.3,1), opacity .22s ease";
      host.style.opacity = "0";
      host.style.transform = "translateY(-34px)";
      window.setTimeout(() => {
        host.style.transition = "";
      }, 300);
    };

    const reset = () => {
      touchId = -1;
      eligible = false;
      active = false;
      cancelled = false;
      armed = false;
      setStroke(IDLE_STROKE);
      svg.classList.remove("wave-ptr-spin");
    };

    // Any scroll container under the finger that is scrolled down blocks the
    // pull (scrollTop > 0 implies a real vertical scroll container). Horizontal
    // carousels only carry scrollLeft — they never block.
    const chainAtTop = (start: EventTarget | null): boolean => {
      let el = start instanceof Element ? start : null;
      while (el && el !== document.body) {
        if (el instanceof HTMLElement && el.scrollTop > 0) return false;
        el = el.parentElement;
      }
      const se = document.scrollingElement;
      return !(se && se.scrollTop > 0);
    };

    const onStart = (e: TouchEvent) => {
      if (reloading) return;
      const t = e.changedTouches[0];
      touchId = t.identifier;
      startX = t.clientX;
      startY = t.clientY;
      eligible = false;
      active = false;
      cancelled = false;
      armed = false;
      const target = e.target;
      if (target instanceof Element && target.closest("[data-wave-ptr-ignore]")) return;
      eligible = chainAtTop(target);
    };

    const onMove = (e: TouchEvent) => {
      if (!eligible || reloading) return;
      let t: Touch | null = null;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchId) {
          t = e.changedTouches[i];
          break;
        }
      }
      if (!t) return;
      const dy = t.clientY - startY;
      const dx = t.clientX - startX;
      if (!active) {
        if (dy < 10) return; // upward or jitter — not a pull (yet)
        if (Math.abs(dx) > Math.abs(dy)) {
          cancelled = true; // horizontal scroll won — carousels, sliders
          return;
        }
        active = true;
      }
      if (cancelled) return;
      e.preventDefault(); // own the gesture — no scroll chaining, no native glow
      const offset = Math.min(Math.max(dy, 0) * PULL_RESISTANCE, INDICATOR_TRAVEL);
      const nowArmed = offset >= ARM_OFFSET;
      if (nowArmed !== armed) {
        armed = nowArmed;
        setStroke(nowArmed ? ARMED_STROKE : IDLE_STROKE);
        if (nowArmed) {
          try {
            navigator.vibrate?.(10);
          } catch {
            /* haptics are best-effort */
          }
        }
      }
      paint(offset);
    };

    const onEnd = () => {
      const fire = eligible && active && !cancelled && armed;
      const wasPull = eligible && active && !cancelled;
      reset();
      if (fire) {
        reloading = true;
        host.style.opacity = "1";
        host.style.transform = `translateY(${(lastOffset - 34).toFixed(1)}px)`;
        svg.classList.add("wave-ptr-spin");
        // a beat so the spinning state is visible, then refresh
        window.setTimeout(() => window.location.reload(), 220);
      } else if (wasPull) {
        hide();
      }
    };

    const onCancel = () => {
      reset();
      hide();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
      host.remove();
    };
  }, []);

  return null;
}
