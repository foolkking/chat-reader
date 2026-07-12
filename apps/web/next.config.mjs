import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const standaloneBuild = process.env.NEXT_STANDALONE === "1";

const apiInternalUrl = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(standaloneBuild
    ? {
        output: "standalone",
        experimental: {
          outputFileTracingRoot: workspaceRoot,
        },
      }
    : {}),
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiInternalUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
