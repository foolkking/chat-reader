import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const standaloneBuild = process.env.NEXT_STANDALONE === "1";
const standaloneBuildCpus = Math.max(1, Number.parseInt(process.env.NEXT_BUILD_CPUS ?? "1", 10) || 1);
const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";

const apiInternalUrl = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

const contentSecurityPolicyReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "browsing-topics=(), camera=(), geolocation=(), microphone=(), payment=(), usb=(), serial=(), bluetooth=()",
  },
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicyReportOnly },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
  poweredByHeader: false,
  ...(standaloneBuild
    ? {
        output: "standalone",
        experimental: {
          outputFileTracingRoot: workspaceRoot,
          cpus: standaloneBuildCpus,
        },
      }
    : {}),
  async rewrites() {
    return {
      fallback: [
        {
          source: "/api/:path*",
          destination: `${apiInternalUrl}/api/:path*`,
        },
      ],
    };
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      { source: "/library-sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      { source: "/library/manifest.webmanifest", headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Content-Type", value: "application/manifest+json" },
      ] },
      { source: "/offline", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      { source: "/library", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      { source: "/((?!_next/static|icons/).*)", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
  webpack(config) {
    // PDF.js exposes an optional Node canvas integration. Browser viewers use
    // the DOM canvas path, so bundling the native addon would be both invalid
    // and unnecessary.
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };
    return config;
  },
};

export default nextConfig;
