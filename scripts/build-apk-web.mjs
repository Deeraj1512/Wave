#!/usr/bin/env node
/**
 * Build the static SPA bundle that gets packaged into the Android APK.
 *
 * Why this exists: `output: "export"` refuses to build Next.js route handlers
 * (src/app/api/* is force-dynamic), and the APK doesn't carry a server anyway —
 * the device runs the Echo chain in-process. So this script:
 *   1. moves src/app/api → apkwork/api-stash
 *   2. runs `next build` with NEXT_EXPORT=1  → ./out
 *   3. ALWAYS restores src/app/api (success, failure, SIGINT, SIGTERM)
 *
 * The web deployment never runs this — it keeps its API routes.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API_DIR = join(ROOT, "src", "app", "api");
const STASH = join(ROOT, "apkwork", "api-stash");

let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  if (existsSync(STASH)) {
    rmSync(API_DIR, { recursive: true, force: true }); // build artifacts only
    mkdirSync(dirname(API_DIR), { recursive: true });
    renameSync(STASH, API_DIR);
    console.log("[build-apk-web] src/app/api restored");
  }
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { restore(); process.exit(1); });
process.on("exit", restore);

// 1) stash the server routes
if (existsSync(API_DIR)) {
  rmSync(STASH, { recursive: true, force: true });
  mkdirSync(join(ROOT, "apkwork"), { recursive: true });
  renameSync(API_DIR, STASH);
  console.log("[build-apk-web] src/app/api stashed (static export has no server routes)");
} else {
  console.warn("[build-apk-web] WARNING: src/app/api missing — was a previous run interrupted?");
  if (existsSync(STASH)) {
    restore();
  }
}

// 2) static export
try {
  rmSync(join(ROOT, "out"), { recursive: true, force: true });
  execSync("npx next build", {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, NEXT_EXPORT: "1" },
  });
  console.log("[build-apk-web] static SPA bundle ready → ./out");
} catch (e) {
  console.error("[build-apk-web] next build failed:", e.message);
  process.exitCode = 1;
}
