import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @ts-ignore
  allowedDevOrigins: [
    "employed-providence-settled-connecting.trycloudflare.com",
    "determination-sheets-blades-portfolio.trycloudflare.com",
    "localhost:3000"
  ],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8003/api/:path*"
      }
    ];
  }
};

export default nextConfig;
