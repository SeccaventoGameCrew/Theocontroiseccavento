/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Le Server Actions sono abilitate di default in Next 14.
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'prisma'],
  },
};

export default nextConfig;
