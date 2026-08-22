import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @ts-ignore
  allowedDevOrigins: [
    "employed-providence-settled-connecting.trycloudflare.com",
    "determination-sheets-blades-portfolio.trycloudflare.com",
    "localhost:3000", "lightbox-shortly-junior-initial.trycloudflare.com", "*.trycloudflare.com"
  ],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8006/api/:path*"
      }
    ];
  }
};

export default nextConfig;
