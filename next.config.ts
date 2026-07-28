import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/erp-system',
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
