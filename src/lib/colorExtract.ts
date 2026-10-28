"use client";

/**
 * Dominant-color extraction from real album art — the YTM/Spotify trick where the
 * player surfaces tint themselves to the artwork.
 *
 * Loads the cover image with CORS (i.ytimg.com serves Access-Control-Allow-Origin: *),
 * downsamples to a tiny canvas, and votes hues weighted by saturation + mid-lightness.
 * Produces a YTM-style gradient pair [top, deep] plus a glow color for the ambient
 * blobs. Any failure (CORS, broken URL) returns null — callers keep their procedural
 * gradient colors, so this can never break the UI.
 *
 * Results are cached per art URL in a module Map: extraction runs at most once per
 * cover per session.
 */

const cache = new Map<string, [string, string, string]>(); // url → [top, deep, glow]

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(((h % 360) + 360) % 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

export async function extractPalette(url: string): Promise<[string, string, string] | null> {
  if (!url || typeof document === "undefined") return null;
  const hit = cache.get(url);
  if (hit) return hit;

  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("art load timeout")), 8000);
      img.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      img.onerror = () => {
        clearTimeout(timer);
        reject(new Error("art load failed"));
      };
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) return null;

    const N = 32;
    const canvas = document.createElement("canvas");
    canvas.width = N;
    canvas.height = N;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, N, N);

    let pixels: Uint8ClampedArray;
    try {
      pixels = ctx.getImageData(0, 0, N, N).data; // throws on tainted canvas (CORS)
    } catch {
      return null;
    }

    // 24 hue bins, weighted by saturation and mid-lightness (vibrant colors win)
    const bins = new Float64Array(24);
    let total = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i] / 255;
      const g = pixels[i + 1] / 255;
      const b = pixels[i + 2] / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      const d = max - min;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      if (s < 0.12 || l < 0.08 || l > 0.94) continue; // skip grays / near-black / near-white
      let h = 0;
      if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h = (h * 60 + 360) % 360;
      }
      bins[Math.floor(h / 15) % 24] += s * (1 - Math.abs(l - 0.5) * 1.1);
      total += 1;
    }
    if (total <= 0) return null;

    let b1 = 0;
    for (let i = 1; i < 24; i++) if (bins[i] > bins[b1]) b1 = i;
    let b2 = -1;
    for (let i = 0; i < 24; i++) {
      const adjacent = Math.min(Math.abs(i - b1), 24 - Math.abs(i - b1));
      if (adjacent < 2) continue; // runner-up must be a different color region
      if (bins[i] < total * 0.08) continue;
      if (b2 === -1 || bins[i] > bins[b2]) b2 = i;
    }

    const hue = b1 * 15 + 7.5;
    const hue2 = b2 === -1 ? hue + 40 : b2 * 15 + 7.5;
    const out: [string, string, string] = [
      hsl(hue, 0.62, 0.5), // top gradient stop — the art's dominant vibe
      hsl(hue2, 0.5, 0.2), // deep stop — darker, cinematic falloff
      hsl(hue, 0.7, 0.4), // ambient glow blob
    ];
    cache.set(url, out);
    return out;
  } catch {
    return null;
  }
}
