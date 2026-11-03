/**
 * PWA web app manifest — static-safe for the APK build.
 *
 * `output: "export"` (NEXT_EXPORT=1, scripts/build-apk-web.mjs) refuses any
 * route handler that is not explicitly static: without the marker below the
 * build dies with
 *   "export const dynamic = "force-static"/export const revalidate not
 *    configured on route "/manifest.webmanifest" with "output: export""
 * which is exactly what broke the GitHub Actions "apk" job at
 * "Build web bundle + sync". Both constants here are load-bearing.
 *
 * The body is a compile-time constant (no request, no fs, no dynamic APIs),
 * so the response is prerendered once into the export bundle (out/) and the
 * same file serves the Netlify deployment unchanged.
 */
export const dynamic = "force-static";
export const revalidate = false;

const MANIFEST = {
  name: "Wave — Your music, your language",
  short_name: "Wave",
  description:
    "Stream and queue music with instant search, a persistent player and autoplay radio.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "portrait-primary",
  background_color: "#030303",
  theme_color: "#030303",
  icons: [
    {
      src: "/wave-mark.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/wave-mark.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
};

export async function GET() {
  return new Response(JSON.stringify(MANIFEST), {
    headers: { "content-type": "application/manifest+json" },
  });
}
