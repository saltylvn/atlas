import type { NextConfig } from "next";

// Static security headers on every response. The Content-Security-Policy is per
// request (it carries a nonce) and is set in proxy.ts.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  // A private app: keep every page, including the sign-in page, out of search engines.
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // Server-only secrets marked with taint cannot be passed to client components.
    taint: true,
    serverActions: { bodySizeLimit: "200kb" },
  },
  // Agent instructions are versioned files (agents/*/instructions.md) read at run time.
  outputFileTracingIncludes: { "/**/*": ["./agents/**/*.md"] },
  // The page was renamed; old links and bookmarks still land in the right place.
  async redirects() {
    return [{ source: "/connections", destination: "/connectors", permanent: true }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Personal data: never cache pages in shared caches.
      { source: "/((?!_next/static|.*\\.png$).*)", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default nextConfig;
