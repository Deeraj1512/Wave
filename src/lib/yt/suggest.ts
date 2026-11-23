/**
 * Search suggestions — the YouTube typing experience the user asked for:
 * "I type two letters and YouTube already shows me the song".
 *
 * InnerTube endpoint: /music/get_search_suggestions (the same call YTM's own
 * search box fires per keystroke). Isomorphic like every yt/ module: server
 * route on web, in-process on the APK. Never throws — suggestions are a
 * nicety; search itself must never depend on them.
 */

import { API_YTM, INNERTUBE_KEY, WEB_REMIX } from "./clients";
import { getVisitorData, sessionReady } from "./innertube";

const cache = new Map<string, { at: number; items: string[] }>();
const TTL = 10 * 60 * 1000; // suggestion lists are stable for popular prefixes
const inflight = new Map<string, Promise<string[]>>();

function textOf(obj: any): string {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  if (obj.simpleText) return obj.simpleText;
  if (obj.runs) return obj.runs.map((r: any) => r.text ?? "").join("");
  return "";
}

/** Depth-capped walk collecting every searchSuggestionRenderer's text. */
function walk(node: any, out: string[], depth = 0) {
  if (!node || typeof node !== "object" || depth > 18) return;
  if (Array.isArray(node)) {
    for (const x of node) walk(x, out, depth + 1);
    return;
  }
  const s = node.searchSuggestionRenderer;
  if (s) {
    const t = textOf(s.suggestion).trim();
    if (t) out.push(t);
  }
  for (const k of Object.keys(node)) walk(node[k], out, depth + 1);
}

/**
 * Completion strings for a partial query ("ilaya" → "ilaya raja hits", the
 * song name, …). Empty on any failure — callers render nothing, never error.
 */
export async function searchSuggestions(query: string): Promise<string[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const hit = cache.get(q.toLowerCase());
  if (hit && Date.now() - hit.at < TTL) return hit.items;
  const pending = inflight.get(q.toLowerCase());
  if (pending) return pending;

  const p = (async () => {
    try {
      await sessionReady();
    } catch {
      /* keep going — suggestions answer without a visitor id (runSearch parity) */
    }
    let res: Response;
    try {
      res = await fetch(`${API_YTM}/music/get_search_suggestions?key=${INNERTUBE_KEY}&prettyPrint=false`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-YouTube-Client-Name": WEB_REMIX.id,
          "X-YouTube-Client-Version": WEB_REMIX.version,
          "X-Origin": "https://music.youtube.com",
          Referer: "https://music.youtube.com/",
          "User-Agent": WEB_REMIX.userAgent,
          ...(getVisitorData() ? { "X-Goog-Visitor-Id": getVisitorData()! } : {}),
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: WEB_REMIX.name,
              clientVersion: WEB_REMIX.version,
              gl: "IN",
              hl: "en",
              visitorData: getVisitorData() ?? undefined,
            },
          },
          input: q,
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      return [];
    }
    if (!res.ok) return [];
    let raw: any;
    try {
      raw = await res.json();
    } catch {
      return [];
    }
    const out: string[] = [];
    walk(raw, out);
    // dedupe (YTM repeats the typed query itself as the first suggestion)
    const seen = new Set<string>();
    const items = out.filter((s) => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (items.length > 0) cache.set(q.toLowerCase(), { at: Date.now(), items });
    return items;
  })();

  inflight.set(q.toLowerCase(), p);
  const out = await p;
  inflight.delete(q.toLowerCase());
  return out;
}
