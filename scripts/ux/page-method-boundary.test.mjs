import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const ts = require("typescript");
const { NextRequest } = require("next/server");
const source = readFileSync(new URL("../../apps/web/proxy.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function loadProxy(env) {
  const module = { exports: {} };
  // Execute the actual proxy with an isolated environment, not a copy of its policy.
  new Function("require", "module", "exports", "process", compiled)(require, module, module.exports, { env });
  return module.exports.proxy;
}
const environments = [
  { APP_ENV: "production" },
  { APP_ENV: "test", AUTH_ENABLED: "true" },
  { APP_ENV: "test" },
];
const pagePaths = ["/", "/login", "/register", "/library", "/search", "/share/synthetic-action-probe"];
const unsafeMethods = ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

for (const [index, env] of environments.entries()) {
  test(`page methods fail closed before auth or action decoding in environment ${index}`, () => {
    const proxy = loadProxy(env);
    for (const path of pagePaths) for (const method of unsafeMethods) for (const withCookie of [false, true]) {
      const request = new NextRequest(`https://reader.example.test${path}`, {
        method,
        headers: { "Next-Action": "x", ...(withCookie ? { Cookie: "chat_reader_session=synthetic" } : {}) },
      });
      const response = proxy(request);
      assert.equal(response.status, 405, `${method} ${path}`);
      assert.equal(response.headers.get("allow"), "GET, HEAD");
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.has("location"), false);
      assert.equal(response.headers.has("set-cookie"), false);
    }
  });

  test(`all API methods remain owned by API authentication and routing in environment ${index}`, () => {
    const proxy = loadProxy(env);
    for (const path of ["/api/auth/login", "/api/auth/register", "/api/preferences", "/api/attachments/uploads"]) {
      for (const method of ["GET", "HEAD", ...unsafeMethods]) {
        const response = proxy(new NextRequest(`https://reader.example.test${path}`, { method }));
        assert.equal(response.headers.get("x-middleware-next"), "1", `${method} ${path}`);
        assert.equal(response.headers.has("allow"), false);
        assert.equal(response.headers.has("location"), false);
      }
    }
  });
}

test("GET and HEAD retain the existing public/share and protected-page auth contracts", () => {
  const proxy = loadProxy({ APP_ENV: "production" });
  for (const method of ["GET", "HEAD"]) {
    for (const path of ["/login", "/register", "/library/sw.webmanifest", "/share/synthetic-action-probe"]) {
      const response = proxy(new NextRequest(`https://reader.example.test${path}`, { method }));
      assert.equal(response.headers.get("x-middleware-next"), "1", `${method} ${path}`);
    }
    const protectedPage = proxy(new NextRequest("https://reader.example.test/search", { method }));
    assert.equal(protectedPage.status, 307);
    assert.equal(protectedPage.headers.get("location"), "https://reader.example.test/login?return_to=%2Fsearch");
    const ownerPage = proxy(new NextRequest("https://reader.example.test/search", {
      method, headers: { Cookie: "chat_reader_session=synthetic" },
    }));
    assert.equal(ownerPage.headers.get("x-middleware-next"), "1");
  }
});
