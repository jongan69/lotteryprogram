/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.externals.push('encoding', 'pino-pretty', 'lokijs', 'node:crypto')
    return config
  },
}

module.exports = nextConfig 