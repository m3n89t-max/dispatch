import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: [
    '@prisma/client',
    '@prisma/adapter-libsql',
    '@libsql/client',
  ],
  outputFileTracingIncludes: {
    '/api/**': [
      './node_modules/.prisma/**/*',
      './node_modules/@prisma/**/*',
      './node_modules/@libsql/**/*',
      './prisma/schema.prisma',
    ],
  },
};

export default nextConfig;
