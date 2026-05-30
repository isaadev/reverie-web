import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.ytimg.com' },
      { protocol: 'https', hostname: '**.googleusercontent.com' },
      { protocol: 'https', hostname: 'i1.sndcdn.com' },
      { protocol: 'https', hostname: 'i2.sndcdn.com' },
      { protocol: 'https', hostname: 'i3.sndcdn.com' },
      { protocol: 'https', hostname: '**.sndcdn.com' },
    ],
  },
};

export default nextConfig;
