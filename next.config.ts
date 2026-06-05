import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingIncludes: {
    '/api/**': [
      './node_modules/.prisma/**/*',
      './node_modules/@prisma/client/**/*',
      './node_modules/@prisma/adapter-libsql/**/*',
      './prisma/schema.prisma',
    ],
  },
};

export default nextConfig;
