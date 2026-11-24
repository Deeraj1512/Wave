/**
 * Unit tests (bun) for the SOUND QUALITY picker (src/lib/yt/resolve.ts):
 *   - decode capability gate (aac-only player never receives opus)
 *   - "high" picks the max-bitrate decodable stream (256k AAC when served,
 *     else opus 251 ~160k, else 128k m4a)
 *   - "saver" picks the smallest usable stream
 *   - the preference persists (dhun.quality)
 * NOT testable here: live stream resolution (bot-gated in sandbox by design).
 */
import { pickFormat, setPreferredQuality, getPreferredQuality } from "../src/lib/yt/resolve";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

type F = { itag: number; url?: string; mimeType?: string; bitrate?: number };

// The standard audio ladder YouTube serves + a 256k AAC lane some clients give.
const full: F[] = [
  { itag: 22, mimeType: "video/mp4", bitrate: 1000000, url: "https://gvideo/v" }, // video — must be ignored
  { itag: 139, mimeType: "audio/mp4", bitrate: 48000, url: "https://gvideo/139" },
  { itag: 140, mimeType: "audio/mp4", bitrate: 128000, url: "https://gvideo/140" },
  { itag: 141, mimeType: "audio/mp4", bitrate: 256000, url: "https://gvideo/141" },
  { itag: 249, mimeType: "audio/webm", bitrate: 50000, url: "https://gvideo/249" },
  { itag: 250, mimeType: "audio/webm", bitrate: 70000, url: "https://gvideo/250" },
  { itag: 251, mimeType: "audio/webm", bitrate: 160000, url: "https://gvideo/251" },
  { itag: 999, mimeType: "audio/mp4", bitrate: 999000 }, // no plain URL — unusable
];

console.log("\n[1] high quality = max bitrate the device can DECODE");
check("opus-capable picks 256k AAC (141) — best decodable", pickFormat(full, "opus", "high")?.itag === 141, JSON.stringify(pickFormat(full, "opus", "high")));
check("aac-only player ALSO picks 141 (webm gated out)", pickFormat(full, "aac", "high")?.itag === 141, JSON.stringify(pickFormat(full, "aac", "high")));
check("video formats never win", pickFormat(full, "opus", "high")?.mimeType?.startsWith("audio/"), "");

console.log("\n[2] no 256k lane served → opus 251 beats m4a 140 on bitrate");
const no141 = full.filter((f) => f.itag !== 141);
check("opus-capable picks opus 251 (160k)", pickFormat(no141, "opus", "high")?.itag === 251, JSON.stringify(pickFormat(no141, "opus", "high")?.itag));
check("aac-only picks m4a 140 (128k)", pickFormat(no141, "aac", "high")?.itag === 140, JSON.stringify(pickFormat(no141, "aac", "high")?.itag));

console.log("\n[3] data saver = smallest usable stream");
check("opus saver picks 139 (48k)", pickFormat(full, "opus", "saver")?.itag === 139, JSON.stringify(pickFormat(full, "opus", "saver")?.itag));
check("aac saver never falls into webm", pickFormat(full, "aac", "saver")?.itag === 139, JSON.stringify(pickFormat(full, "aac", "saver")?.itag));

console.log("\n[4] empty / hostile format lists");
check("no audio at all → undefined", pickFormat([{ itag: 22, mimeType: "video/mp4", url: "https://x" }], "opus", "high") === undefined);
check("opus-only ladder, aac player → undefined (never serve undecodable)", pickFormat(full.filter((f) => (f.mimeType ?? "").includes("webm")), "aac", "high") === undefined);

console.log("\n[5] preference persistence (dhun.quality)");
setPreferredQuality("saver");
check("get reflects saver", getPreferredQuality() === "saver");
check("persisted to localStorage", (typeof localStorage !== "undefined" ? localStorage.getItem("dhun.quality") : "saver") === "saver");
setPreferredQuality("high");
check("back to high", getPreferredQuality() === "high" && (typeof localStorage === "undefined" || localStorage.getItem("dhun.quality") === "high"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
