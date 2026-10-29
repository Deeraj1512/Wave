#!/usr/bin/env node
/**
 * Regenerate Wave's PWA icon set from a square source image (default 1024x1024).
 *
 *   node scripts/generate-icons.mjs [sourceImage]
 *
 * Requires sharp (already a Wave dependency). Outputs to public/icons/:
 *   icon-192.png, icon-512.png        (purpose: any)
 *   maskable-192.png, maskable-512.png (purpose: maskable — content in 80% safe zone)
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const SRC = process.argv[2] ?? "src/app/icon.png";
const OUT = "public/icons";
const BG = { r: 3, g: 3, b: 3, alpha: 1 }; // matches themeColor #030303

mkdirSync(OUT, { recursive: true });

const meta = await sharp(SRC).metadata();
if (meta.width !== meta.height) {
  console.error(`[icons] source must be square — got ${meta.width}x${meta.height}`);
  process.exit(1);
}

// purpose: any — straight resizes
for (const s of [192, 512]) {
  await sharp(SRC).resize(s, s, { fit: "fill" }).png().toFile(`${OUT}/icon-${s}.png`);
  console.log(`[icons] icon-${s}.png`);
}

// purpose: maskable — shrink content into the safe zone on a themed backdrop
const base = sharp(SRC).resize(1024, 1024, { fit: "fill" }).flatten({ background: BG });
const inner = Math.round(1024 * 0.8);
const content = await base.resize(inner, inner, { fit: "fill" }).toBuffer();
for (const s of [192, 512]) {
  const pad = Math.round((s - inner * (s / 1024)) / 1); // scale-aware padding
  const innerScaled = inner * (s / 1024);
  const padScaled = Math.round((s - innerScaled) / 2);
  await sharp({
    create: { width: s, height: s, channels: 4, background: BG },
  })
    .composite([{ input: await sharp(content).resize(s - padScaled * 2).toBuffer(), top: padScaled, left: padScaled }])
    .png()
    .toFile(`${OUT}/maskable-${s}.png`);
  console.log(`[icons] maskable-${s}.png`);
}

console.log("[icons] done → public/icons/");
