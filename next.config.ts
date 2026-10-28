import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
