import type { NextConfig } from "next";

// `output: "standalone"` is for SELF-HOSTING only (Docker / VPS: node
// .next/standalone/server.js). Hosting platforms with their own Next.js
// packaging — Netlify's runtime, Vercel — must NOT receive a standalone
// build (it breaks their adapter → bare "Page not found" 404s), so it is
// strictly opt-in via NEXT_OUTPUT=standalone. `bun run build:standalone`.
const standalone = process.env.NEXT_OUTPUT === "standalone";

const nextConfig: NextConfig = {
  ...(standalone ? { output: "standalone" as const } : {}),
  devIndicators: false,
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  images: {
    // allow cache-busting query strings on local images (e.g. /wave-mark.png?v=2);
    // without a search clause, any query is permitted
    localPatterns: [{ pathname: "/**" }],
  },
};

export default nextConfig;
