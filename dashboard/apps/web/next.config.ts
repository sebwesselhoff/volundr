import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@vldr/shared'],
  // Fix workspace root inference warning
  outputFileTracingRoot: __dirname + '/../..',
};

export default nextConfig;
