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
  // Hosted setup (Render): the browser calls same-origin /api/*, Next forwards it to the API service.
  ...(!demo && (process.env.API_HOSTPORT || process.env.API_INTERNAL_URL) && {
    async rewrites() {
      const target = process.env.API_HOSTPORT ? `http://${process.env.API_HOSTPORT}` : process.env.API_INTERNAL_URL;
      return [{ source: "/api/:path*", destination: `${target}/api/:path*` }];
    },
  }),
};

export default nextConfig;
