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
      { source: "/offline", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
      { source: "/((?!_next/static|icons/).*)", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
};

export default nextConfig;
