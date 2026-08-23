import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/iclock/:path*',
        destination: '/api/iclock/:path*',
      },
    ];
  },
};

export default nextConfig;
