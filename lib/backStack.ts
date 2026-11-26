/**
 * Android hardware-back coordinator — ONE owner of window.__waveBack.
 *
 * MainActivity.onBackPressed asks the WebView "window.__waveBack()" every time
 * the user presses back: `true` = consumed by the web app, `false` = minimize
 * the app (music keeps playing — YTM's back behavior). Layers used to fight
 * over that single function (the full player assigned it, nobody else could),
 * so screens could never answer back and the app minimized from any page.
 *
 * Now every layer registers a handler with an explicit priority; the chain
 * always calls highest-priority first and stops at the first layer that
 * consumes the press:
 *
 *   30  album overlay   (page.tsx — "Go to album" opened OVER the full player)
 *   20  full player     (Player.tsx — ⋮ sheet → queue → minimize player)
 *   10  screen history  (page.tsx — walk back through visited pages)
 *
 * When no layer consumes the press the chain returns false and Android
 * minimizes the app, exactly like before.
 */

type BackHandler = () => boolean;

type Entry = {
  id: string;
  priority: number;
  fn: BackHandler;
};

const entries: Entry[] = [];

/** Register (or replace) a layer's back handler. Returns an unregister fn. */
export function registerBackHandler(id: string, priority: number, fn: BackHandler): () => void {
  const entry: Entry = { id, priority, fn };
  const i = entries.findIndex((e) => e.id === id);
  if (i >= 0) entries[i] = entry;
  else entries.push(entry);
  entries.sort((a, b) => b.priority - a.priority); // highest priority first
  return () => unregisterBackHandler(id);
}

export function unregisterBackHandler(id: string): void {
  const i = entries.findIndex((e) => e.id === id);
  if (i >= 0) entries.splice(i, 1);
}

declare global {
  interface Window {
    __waveBack?: () => boolean;
  }
}

// Module side-effect — imported by page.tsx and Player.tsx, so this runs once
// before anything renders and MainActivity's probe always finds the function.
if (typeof window !== "undefined") {
  window.__waveBack = () => {
    for (const e of entries) {
      try {
        if (e.fn()) return true; // this layer consumed the press
      } catch {
        // a broken layer must not strand the user — fall through to the next
      }
    }
    return false; // nothing consumed it → Android minimizes the app
  };
}
