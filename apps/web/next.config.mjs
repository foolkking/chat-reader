import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const standaloneBuild = process.env.NEXT_STANDALONE === "1";
const standaloneBuildCpus = Math.max(1, Number.parseInt(process.env.NEXT_BUILD_CPUS ?? "1", 10) || 1);

const apiInternalUrl = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
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
