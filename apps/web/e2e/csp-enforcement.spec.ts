import { expect, test, type Page } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Violation = {
  blockedKind: "data" | "blob" | "inline" | "same-origin" | "external-origin" | "other";
  disposition: string;
  effectiveDirective: string;
};

let attackOrigin = "";
let attackServer: http.Server;
const attackRequests = new Map<string, number>();

test.beforeAll(async () => {
  attackServer = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    attackRequests.set(requestUrl.pathname, (attackRequests.get(requestUrl.pathname) ?? 0) + 1);
    if (requestUrl.pathname === "/attack.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" });
      response.end("window.__cspExternalScriptExecuted = true;");
      return;
    }
    if (requestUrl.pathname === "/worker.js") {
      response.writeHead(200, { "Content-Type": "application/javascript" });
      response.end("self.postMessage('executed');");
      return;
    }
    if (requestUrl.pathname === "/pixel.svg") {
      response.writeHead(200, { "Content-Type": "image/svg+xml" });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
      return;
    }
    if (requestUrl.pathname === "/frame-parent") {
      const target = requestUrl.searchParams.get("target") ?? "about:blank";
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><title>CSP frame probe</title><iframe title="probe" src="${escapeHtml(target)}"></iframe>`);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("controlled CSP probe");
  });
  await new Promise<void>((resolve) => attackServer.listen(0, "127.0.0.1", resolve));
  const address = attackServer.address() as AddressInfo;
  attackOrigin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => attackServer.close((error) => error ? reject(error) : resolve()));
});

test.beforeEach(async ({ page }) => {
  attackRequests.clear();
  await installViolationCollector(page);
});

test("production response has one bounded enforcing policy", async ({ page }) => {
  const response = await page.goto("/library");
  expect(response).not.toBeNull();
  const headers = response!.headers();
  const policy = headers["content-security-policy"] ?? "";

  expect(headers["content-security-policy-report-only"]).toBeUndefined();
  expect(policy.match(/default-src/g)).toHaveLength(1);
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(policy).toContain("script-src-elem 'self' 'unsafe-inline'");
  expect(policy).toContain("script-src-attr 'none'");
  expect(policy).not.toContain("'unsafe-eval'");
  expect(policy).toContain("style-src 'self' 'unsafe-inline'");
  expect(policy).toContain("connect-src 'self'");
  expect(policy).toContain("img-src 'self' data: blob:");
  expect(policy).toContain("font-src 'self'");
  expect(policy).toContain("media-src 'self' blob:");
  expect(policy).toContain("worker-src 'self'");
  expect(policy).toContain("manifest-src 'self'");
  expect(policy).toContain("frame-src 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("base-uri 'none'");
  expect(policy).toContain("form-action 'self'");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).not.toMatch(/(?:^|;\s*)[^;]+\s\*/);
  expect(policy).not.toMatch(/(?:^|\s)https?:/);

  const html = await response!.text();
  expect((html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) ?? []).length).toBeGreaterThan(0);
  await expect(page.locator("body")).toBeVisible();
  await expect.poll(() => violations(page)).toEqual([]);
});

test("forbidden script, connect, image, worker, object, and inline handlers are blocked", async ({ page }) => {
  await page.goto("/library");

  const outcome = await page.evaluate(async (origin) => {
    const runtime = window as typeof window & {
      __cspExternalScriptExecuted?: boolean;
      __cspInlineHandlerExecuted?: boolean;
    };
    runtime.__cspExternalScriptExecuted = false;
    runtime.__cspInlineHandlerExecuted = false;

    const scriptBlocked = await new Promise<boolean>((resolve) => {
      const script = document.createElement("script");
      script.src = `${origin}/attack.js`;
      script.onload = () => resolve(false);
      script.onerror = () => resolve(true);
      document.head.append(script);
    });

    let connectBlocked = false;
    try {
      await fetch(`${origin}/connect`);
    } catch {
      connectBlocked = true;
    }

    const imageBlocked = await new Promise<boolean>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(false);
      image.onerror = () => resolve(true);
      image.src = `${origin}/pixel.svg`;
      document.body.append(image);
    });

    let workerBlocked = false;
    const workerUrl = URL.createObjectURL(new Blob(["self.postMessage('executed')"], { type: "application/javascript" }));
    try {
      const worker = new Worker(workerUrl);
      worker.onerror = () => { workerBlocked = true; };
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      worker.terminate();
    } catch {
      workerBlocked = true;
    } finally {
      URL.revokeObjectURL(workerUrl);
    }

    const object = document.createElement("object");
    object.data = `${origin}/object`;
    document.body.append(object);

    const inlineImage = document.createElement("img");
    inlineImage.setAttribute("onerror", "window.__cspInlineHandlerExecuted = true");
    inlineImage.src = "/__csp_missing_inline_event.png";
    document.body.append(inlineImage);

    await new Promise((resolve) => window.setTimeout(resolve, 250));
    return {
      connectBlocked,
      externalScriptExecuted: runtime.__cspExternalScriptExecuted,
      imageBlocked,
      inlineHandlerExecuted: runtime.__cspInlineHandlerExecuted,
      scriptBlocked,
      workerBlocked,
    };
  }, attackOrigin);

  expect(outcome).toEqual({
    connectBlocked: true,
    externalScriptExecuted: false,
    imageBlocked: true,
    inlineHandlerExecuted: false,
    scriptBlocked: true,
    workerBlocked: true,
  });
  expect(attackRequests.get("/attack.js") ?? 0).toBe(0);
  expect(attackRequests.get("/connect") ?? 0).toBe(0);
  expect(attackRequests.get("/pixel.svg") ?? 0).toBe(0);
  expect(attackRequests.get("/object") ?? 0).toBe(0);

  const observed = await violations(page);
  for (const directive of ["script-src-elem", "connect-src", "img-src", "worker-src", "object-src", "script-src-attr"]) {
    expect(observed.some((item) => item.effectiveDirective === directive && item.disposition === "enforce"), directive).toBe(true);
  }
  expect(observed.every((item) => item.blockedKind !== "other"), JSON.stringify(observed)).toBe(true);
});

test("same-origin, data, blob, inline style, manifest, and Service Worker resources remain available", async ({ page, request }) => {
  await page.goto("/library");
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/library");
    return registration?.active?.state === "activated";
  });
  const result = await page.evaluate(async () => {
    async function loadImage(source: string) {
      return new Promise<boolean>((resolve) => {
        const image = new Image();
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
        image.src = source;
        document.body.append(image);
      });
    }

    const localImage = await loadImage("/icons/icon-192.png");
    const dataImage = await loadImage("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E");
    const blobUrl = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'], { type: "image/svg+xml" }));
    const blobImage = await loadImage(blobUrl);
    URL.revokeObjectURL(blobUrl);

    const styled = document.createElement("div");
    styled.style.width = "7px";
    document.body.append(styled);
    const inlineStyle = getComputedStyle(styled).width === "7px";
    const serviceWorker = await navigator.serviceWorker.getRegistration("/library");
    return { blobImage, dataImage, inlineStyle, localImage, serviceWorkerActive: serviceWorker?.active?.state === "activated" };
  });

  expect(result).toEqual({
    blobImage: true,
    dataImage: true,
    inlineStyle: true,
    localImage: true,
    serviceWorkerActive: true,
  });
  expect((await request.get("/library/manifest.webmanifest")).status()).toBe(200);
  expect(await violations(page)).toEqual([]);
});

test("frame-ancestors blocks a controlled external parent", async ({ page, baseURL }) => {
  expect(baseURL).toBeTruthy();
  const frameErrors: string[] = [];
  page.on("console", (message) => {
    if (/frame-ancestors/i.test(message.text())) frameErrors.push(message.text());
  });

  const target = new URL("/library", baseURL).toString();
  await page.goto(`${attackOrigin}/frame-parent?target=${encodeURIComponent(target)}`);
  await expect.poll(() => frameErrors.length).toBeGreaterThan(0);
  expect(page.frames().some((frame) => frame.url() === target)).toBe(false);
});

async function installViolationCollector(page: Page) {
  await page.addInitScript(() => {
    const runtime = window as typeof window & { __cspViolations?: Violation[] };
    runtime.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      runtime.__cspViolations!.push({
        blockedKind: classifyBlockedUri(event.blockedURI, window.location.origin),
        disposition: event.disposition,
        effectiveDirective: event.effectiveDirective,
      });
    });

    function classifyBlockedUri(blockedUri: string, ownOrigin: string): Violation["blockedKind"] {
      if (blockedUri === "inline") return "inline";
      if (blockedUri === "blob" || blockedUri.startsWith("blob:")) return "blob";
      if (blockedUri === "data" || blockedUri.startsWith("data:")) return "data";
      try {
        return new URL(blockedUri).origin === ownOrigin ? "same-origin" : "external-origin";
      } catch {
        return "other";
      }
    }
  });
}

async function violations(page: Page): Promise<Violation[]> {
  return page.evaluate(() => (
    (window as typeof window & { __cspViolations?: Violation[] }).__cspViolations ?? []
  ));
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
