// Execute the real TS test callbacks with controlled transport failures.
// The separate PostgreSQL suite executes their exact Python seed/disposer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const web = resolve(root, "apps/web");
const require = createRequire(resolve(web, "package.json"));
const ts = require("typescript");
const source = readFileSync(resolve(web, "e2e/settings-task-center.spec.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;

for (const operation of ["retry", "cancel"]) {
  for (const failurePoint of ["initialization", "delayed-response"]) {
    test(`Task Center ${operation} fixture closes after ${failurePoint} failure without outrunning its route`, async () => {
      const callbacks = new Map(), events = [];
      const failure = new Error(`Synthetic ${failurePoint} interruption`);
      const receipt = {
        id: "11111111-1111-4111-8111-111111111111",
        conversation_id: "22222222-2222-4222-8222-222222222222",
        owner_id: "33333333-3333-4333-8333-333333333333",
        created_at: "2026-01-01T00:00:00+00:00", started_at: "2026-01-01T00:00:00+00:00",
        operation,
      };
      let routeHandler, routePromise, routeSettled = false;
      const playwrightTest = (name, callback) => { callbacks.set(name, callback); };
      playwrightTest.use = playwrightTest.skip = () => {};
      const expect = value => ({ toBe: expected => assert.equal(value, expected) });
      const execFileSync = (executable, args, options) => {
        assert.equal(executable, "python");
        assert.deepEqual(Array.from(args).slice(0, 2), ["-B", "-c"]);
        assert.equal(options.cwd, resolve(root, "apps/api"));
        assert.equal(options.timeout, 15_000);
        if (args[2].includes("receipt=json.loads")) {
          assert.deepEqual(JSON.parse(args[3]), receipt);
          assert.ok(failurePoint === "initialization" || routeSettled,
            "Teardown must not finish its task before the delayed action exits");
          events.push("finish");
          return "{}";
        }
        assert.equal(args[3], receipt.conversation_id);
        assert.equal(args[4], operation);
        events.push("seed");
        return JSON.stringify(receipt);
      };
      const admin = { dispose: async () => { events.push("dispose"); } };
      const modules = {
        "@playwright/test": { expect, test: playwrightTest },
        "node:child_process": { execFileSync },
        "./settings-test-helper": {
          settingsAdmin: async () => admin, settingsAppearance: async () => {},
        },
      };
      const sandbox = {
        exports: {}, console,
        process: { env: { E2E_SETTINGS_MAILBOX: "1" }, cwd: () => web },
        crypto: { randomUUID: () => "44444444-4444-4444-8444-444444444444" },
        require: name => modules[name] ?? require(name),
      };
      vm.runInNewContext(compiled, sandbox, { filename: "settings-task-center.spec.ts" });
      const route = {
        fetch: async () => {
          events.push("fetch");
          return { status: () => 200, json: async () => ({ status: operation === "retry" ? "queued" : "cancelling" }) };
        },
        fulfill: async () => { events.push("fulfill"); },
      };
      const locator = tag => ({
        getByRole: () => locator(tag),
        click: async () => {
          if (tag.includes("task-row-")) {
            assert.ok(routeHandler);
            routePromise = routeHandler(route).then(() => { routeSettled = true; });
          }
        },
      });
      const page = {
        setViewportSize: async () => { if (failurePoint === "initialization") throw failure; },
        goto: async () => {},
        getByTestId: locator, locator,
        route: async (_pattern, handler) => { routeHandler = handler; },
        evaluate: async () => { throw failure; },
        unrouteAll: async options => {
          assert.equal(options.behavior, "wait");
          events.push("unroute");
          if (routePromise) await routePromise;
        },
      };
      const context = { request: { post: async url => ({
        status: () => url === "/api/auth/register" || url === "/api/conversations" ? 201 : 200,
        json: async () => url === "/api/conversations"
          ? { conversation: { id: receipt.conversation_id } }
          : { user_id: receipt.owner_id },
      }) } };
      const callback = callbacks.get(`late ${operation} response cannot repopulate another account's task center`);
      assert.equal(typeof callback, "function");
      await assert.rejects(callback({ page, context, playwright: { request: {} }, baseURL: "https://synthetic.invalid" }),
        error => error === failure);
      assert.deepEqual(events, failurePoint === "initialization"
        ? ["seed", "unroute", "finish", "dispose"]
        : ["seed", "fetch", "unroute", "fulfill", "finish", "dispose"]);
    });
  }
}
