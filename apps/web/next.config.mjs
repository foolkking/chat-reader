import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const standaloneBuild = process.env.NEXT_STANDALONE === "1";
const standaloneBuildCpus = Math.max(1, Number.parseInt(process.env.NEXT_BUILD_CPUS ?? "1", 10) || 1);
const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";
const buildRevision = process.env.BUILD_REVISION ?? "";
if (buildRevision && !/^[0-9a-f]{40}$/.test(buildRevision)) throw new Error("BUILD_REVISION must be a complete lowercase Git commit hash.");

const apiInternalUrl = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const scriptSource = process.env.NODE_ENV === "production"
  ? "script-src 'self' 'wasm-unsafe-eval'"
  : "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'";

const contentSecurityPolicy = [
  "default-src 'self'",
  scriptSource,
  "script-src-elem 'self' 'unsafe-inline'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "connect-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
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
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
];

const staticSkillHeaders = [
  { key: "Content-Type", value: "text/markdown; charset=utf-8" },
  {
    key: "Content-Security-Policy",
    value: "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_BUILD_REVISION: buildRevision,
    NEXT_PUBLIC_PWA_NEGATIVE_TESTS: process.env.NEXT_PUBLIC_PWA_NEGATIVE_TESTS === "1" ? "1" : "0",
  },
  ...(standaloneBuild
    ? {
        output: "standalone",
      }
    : {}),
  // A bounded build is also useful on local machines. Previously this option
  // only affected standalone images; ordinary builds could still spawn 15 workers.
  ...(standaloneBuild || process.env.NEXT_BUILD_CPUS
    ? { experimental: {
        ...(standaloneBuild ? { outputFileTracingRoot: workspaceRoot } : {}),
        cpus: standaloneBuildCpus,
      } }
    : {}),
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/library/_next/static/:path*",
          destination: "/_next/static/:path*",
        },
      ],
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
      { source: "/skills/:path*", headers: staticSkillHeaders },
      { source: "/skills/:file*.zip", headers: [
        ...staticSkillHeaders.filter((header) => header.key !== "Content-Type"),
        { key: "Content-Type", value: "application/zip" },
        { key: "Content-Disposition", value: "attachment" },
      ] },
      { source: "/import-rescue/:path*", headers: staticSkillHeaders },
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
  webpack(config, { isServer }) {
    // A dedicated worker is its own client: its entry must be inside the
    // Library service-worker scope to start from Cache Storage while offline.
    if (!isServer) config.output.workerPublicPath = "/library/_next/";
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
