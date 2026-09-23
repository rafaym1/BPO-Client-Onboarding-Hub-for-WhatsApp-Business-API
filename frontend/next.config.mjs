const demo = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // Static demo build for GitHub Pages: `npm run build:demo` (in-browser mock backend, no server needed)
  ...(demo && {
    output: "export",
    basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
    images: { unoptimized: true },
  }),
};

export default nextConfig;
