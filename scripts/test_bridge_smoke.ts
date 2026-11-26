/**
 * Offline smoke test for the Cloudflare Worker bridge (bridge/src/index.ts).
 * Run: bun scripts/test_bridge_smoke.ts
 * No Spotify network calls succeed in this test (credentials are absent), so
 * every path is exercised in its graceful-degradation mode — exactly the
 * behavior the app sees before the owner deploys credentials.
 */

import worker from "../bridge/src/index";
import type { Env } from "../bridge/src/index";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ""}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  (${detail})` : ""}`);
  }
}

const env = {} as Env;
const ctx = {} as never; // ExecutionContext — unused by the handler

async function get(path: string): Promise<Response> {
  return worker.fetch(new Request(`https://bridge.test${path}`), env, ctx);
}

// 1. status without credentials → configured:false (tab hides, no errors)
{
  const r = await get("/api/spotify/status");
  const d = (await r.json()) as { configured: boolean };
  check("status 200 + configured:false", r.status === 200 && d.configured === false);
}

// 2. search without q → 400
{
  const r = await get("/api/spotify/search");
  check("search missing q → 400", r.status === 400);
}

// 3. search with q, no credentials → graceful metadata-empty result
{
  const r = await get("/api/spotify/search?q=butta%20bomma");
  const d = (await r.json()) as { configured: boolean; tracks: unknown[]; artists: unknown[]; albums: unknown[] };
  check(
    "search no-creds → configured:false + empty lists",
    r.status === 200 && d.configured === false && d.tracks.length === 0 && d.artists.length === 0 && d.albums.length === 0
  );
}

// 4. picks with (dummy) credentials but no seeds → reason:"no seeds"
//    (the configured check runs first; with no credentials test 5 covers that lane)
{
  const credEnv = { SPOTIFY_CLIENT_ID: "dummy", SPOTIFY_CLIENT_SECRET: "dummy" } as Env;
  const r = await worker.fetch(new Request("https://bridge.test/api/spotify/picks"), credEnv, ctx);
  const d = (await r.json()) as { available: boolean; source: string; reason?: string };
  check("picks no seeds → available:false", r.status === 200 && d.available === false && d.source === "fallback" && d.reason === "no seeds");
}

// 5. picks with seeds, no credentials → reason:"not configured"
{
  const r = await get("/api/spotify/picks?genres=telugu");
  const d = (await r.json()) as { available: boolean; source: string; reason?: string };
  check("picks no-creds → available:false", r.status === 200 && d.available === false && d.source === "fallback" && d.reason === "not configured");
}

// 6. related without artist → reason:"missing artist"
{
  const r = await get("/api/spotify/related");
  const d = (await r.json()) as { available: boolean; reason?: string };
  check("related missing artist", r.status === 200 && d.available === false && d.reason === "missing artist");
}

// 7. related with artist, no credentials → artist lookup fails → graceful
{
  const r = await get("/api/spotify/related?artist=Someone");
  const d = (await r.json()) as { available: boolean; artists: unknown[]; reason?: string };
  check("related no-creds → available:false", r.status === 200 && d.available === false && d.artists.length === 0);
}

// 8. unknown path → 404
{
  const r = await get("/api/spotify/nope");
  check("unknown path → 404", r.status === 404);
}

// 9. CORS preflight → 204 with open CORS (browser callers only; APK is native HTTP)
{
  const r = await worker.fetch(
    new Request("https://bridge.test/api/spotify/status", { method: "OPTIONS" }),
    env,
    ctx
  );
  check(
    "OPTIONS → 204 + CORS",
    r.status === 204 && r.headers.get("Access-Control-Allow-Origin") === "*"
  );
}

// 10. short path form (no /api/spotify prefix) also routes
{
  const r = await get("/status");
  const d = (await r.json()) as { configured: boolean };
  check("short path /status works", r.status === 200 && d.configured === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
