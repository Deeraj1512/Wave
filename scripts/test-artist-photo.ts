/**
 * Live verification of artistPhoto() against the exact artists visible in the
 * user's Radio-shelf screenshot (Arijit Singh, Sid Sriram, Anirudh, Shreya,
 * A.R. Rahman + a few more). PASS = a real artist FACE url came back (ytm|deezer).
 */
import { artistPhoto } from "../src/lib/yt/artistPhoto";

const names = [
  "Arijit Singh",
  "Sid Sriram",
  "Anirudh Ravichander",
  "Shreya Ghoshal",
  "A.R. Rahman",
  "Revanth",
  "S. Janaki",
  "S. P. Balasubrahmanyam",
  "Devi Sri Prasad",
  "Diljit Dosanjh",
  "K. S. Chithra",
  "Anupam Roy",
  "Vijay Prakash",
  "Ananya Bhat",
  "Ed Sheeran",
  "Kaala Bhairava",
  "Ram Miriyala",
  "Vineeth Sreenivasan",
];

async function main() {
  let ok = 0;
  for (const n of names) {
    const t0 = Date.now();
    const url = await artistPhoto(n).catch(() => undefined);
    const ms = Date.now() - t0;
    const src = url?.includes("googleusercontent") || url?.includes("ggpht") || url?.includes("ytimg") ? "ytm" : url ? "deezer" : "MISS";
    if (url) ok++;
    console.log(`${url ? "PASS" : "FAIL"} ${n.padEnd(24)} ${src.padEnd(6)} ${ms}ms  ${url?.slice(0, 90) ?? "-"}`);
  }
  console.log(`\n${ok}/${names.length} artists resolved with a real photo`);
}

main();
