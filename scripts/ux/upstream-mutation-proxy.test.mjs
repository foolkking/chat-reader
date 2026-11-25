import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import { test } from "node:test";

const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { proxyRequest } = requireWeb("next/dist/server/lib/router-utils/proxy-request");
const { getCloneableBody } = requireWeb("next/dist/server/body-streams");
const { parseUrl } = requireWeb("next/dist/shared/lib/router/utils/parse-url");
const hostname = "127.0.0.1";

async function listen(t, server) {
  const connections = new Set();
  server.on("connection", (socket) => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, hostname, resolve);
  });
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    for (const socket of connections) socket.destroy();
  }));
  return server.address().port;
}

async function startProxy(t, targetPort, proxyTimeout) {
  const errors = [];
  const server = http.createServer((req, res) => {
    const target = parseUrl(`http://${hostname}:${targetPort}${req.url}`);
    const body = getCloneableBody(req).cloneBodyStream();
    proxyRequest(req, res, target, undefined, body, proxyTimeout).catch((error) => errors.push(error.code));
  });
  return { port: await listen(t, server), errors };
}

function request(port, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname, port, method, path, agent: false, signal: AbortSignal.timeout(10_000),
      headers: { connection: "keep-alive", ...headers },
    }, async (res) => {
      try {
        const chunks = [];
        for await (const chunk of res) chunks.push(chunk);
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() });
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
    req.end(body);
  });
}

// Arm the upstream TCP connection after its seed response. If the proxy reuses
// that connection, reset it before a second request can reach the HTTP server.
async function seedPool(t) {
  const mutations = [];
  const api = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (req.url !== "/seed") mutations.push(req.method);
      res.writeHead(204).end();
    });
  });
  api.keepAliveTimeout = 60_000;
  const apiPort = await listen(t, api);
  const pairs = [];
  let resets = 0;
  const relay = net.createServer((incoming) => {
    const outgoing = net.connect(apiPort, hostname);
    pairs.push({ incoming, outgoing });
    incoming.on("error", () => outgoing.destroy());
    outgoing.on("error", () => incoming.destroy());
    incoming.once("close", () => outgoing.destroy());
    incoming.pipe(outgoing).pipe(incoming);
  });
  const proxy = await startProxy(t, await listen(t, relay));
  assert.equal((await request(proxy.port, "GET", "/seed")).status, 204);
  assert.equal(pairs.length, 1);
  const { incoming, outgoing } = pairs[0];
  incoming.unpipe(outgoing);
  incoming.once("data", () => {
    resets++;
    incoming.resetAndDestroy();
    outgoing.destroy();
  });
  incoming.resume();
  return { ...proxy, mutations, observations: () => ({ connections: pairs.length, resets }) };
}

for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
  test(`${method} opens a fresh upstream connection and reaches the API exactly once`, async (t) => {
    const proxy = await seedPool(t);
    // The failing browser DELETE already sent this header.
    const result = await request(proxy.port, method, "/mutation", { headers: { connection: "close" } });
    assert.deepEqual({
      status: result.status, methodsAtApi: proxy.mutations, ...proxy.observations(),
    }, { status: 204, methodsAtApi: [method], connections: 2, resets: 0 });
  });
}

test("GET still chooses the seeded pool socket when the peer resets it", async (t) => {
  const proxy = await seedPool(t);
  assert.equal((await request(proxy.port, "GET", "/read")).status, 500);
  assert.deepEqual(proxy.errors, ["ECONNRESET"]);
  assert.deepEqual(proxy.mutations, []);
  assert.deepEqual(proxy.observations(), { connections: 1, resets: 1 });
});

test("GET, HEAD and OPTIONS still reuse a healthy upstream socket", async (t) => {
  const sockets = [], methods = [];
  const api = http.createServer((req, res) => {
    sockets.push(req.socket);
    methods.push(req.method);
    res.writeHead(200, { "content-length": "0" }).end();
  });
  const proxy = await startProxy(t, await listen(t, api));
  const expected = ["GET", "GET", "HEAD", "OPTIONS"];
  for (const method of expected) assert.equal((await request(proxy.port, method, "/read")).status, 200);
  assert.deepEqual(methods, expected);
  assert.equal(new Set(sockets).size, 1);
});

test("writes preserve credentials, origin, body, and upstream rejection responses", async (t) => {
  const received = [];
  const api = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({
      cookie: req.headers.cookie, origin: req.headers.origin, authorization: req.headers.authorization,
      host: req.headers.host, forwardedHost: req.headers["x-forwarded-host"],
      method: req.method, url: req.url, body: Buffer.concat(chunks).toString(),
    });
    const status = Number(req.url.split("/")[2].split("?")[0]);
    res.writeHead(status, { "content-type": "application/json", "set-cookie": "synthetic=result; HttpOnly" });
    res.end(JSON.stringify({ status }));
  });
  const apiPort = await listen(t, api);
  const proxy = await startProxy(t, apiPort);
  const headers = {
    cookie: "synthetic=session", origin: `http://${hostname}:${proxy.port}`, authorization: "Bearer synthetic",
    "content-type": "application/json",
  };
  const body = JSON.stringify({ message: "合成\ntext" });
  const cases = [[401, "POST"], [403, "PATCH"], [409, "PUT"], [422, "DELETE"], [500, "PATCH"], [503, "POST"]];
  for (const [status, method] of cases) {
    const path = `/status/${status}?part=1&part=2`;
    const result = await request(proxy.port, method, path, {
      headers: { ...headers, "content-length": Buffer.byteLength(body) }, body,
    });
    assert.equal(result.status, status);
    assert.deepEqual(JSON.parse(result.body), { status });
    assert.deepEqual(result.headers["set-cookie"], ["synthetic=result; HttpOnly"]);
    assert.deepEqual(received.at(-1), {
      cookie: headers.cookie, origin: headers.origin, authorization: headers.authorization,
      host: `${hostname}:${apiPort}`, forwardedHost: `${hostname}:${proxy.port}`, method, url: path, body,
    });
  }
  assert.equal(received.length, cases.length);
  assert.deepEqual(proxy.errors, []);
});

test("losing the response after the upstream accepted the write does not replay it", async (t) => {
  let accepted = 0;
  const api = http.createServer((req) => {
    req.resume();
    req.once("end", () => {
      accepted++;
      req.socket.resetAndDestroy();
    });
  });
  const proxy = await startProxy(t, await listen(t, api));
  assert.equal((await request(proxy.port, "POST", "/accept", { body: "synthetic" })).status, 500);
  assert.deepEqual(proxy.errors, ["ECONNRESET"]);
  assert.equal(accepted, 1);
});

test("the configured upstream inactivity timeout still aborts a stalled write", async (t) => {
  let accepted = 0;
  const api = http.createServer((req) => {
    req.resume();
    req.once("end", () => { accepted++; });
  });
  const proxy = await startProxy(t, await listen(t, api), 750);
  const result = await request(proxy.port, "PATCH", "/stall", { body: "synthetic" });
  assert.equal(result.status, 500);
  assert.deepEqual(proxy.errors, ["ECONNRESET"]);
  assert.equal(accepted, 1);
});

test("a streaming upload and response both deliver their first chunk before the last", async (t) => {
  let uploadStarted, releaseResponse;
  const firstUpload = new Promise((resolve) => { uploadStarted = resolve; });
  const responseTail = new Promise((resolve) => { releaseResponse = resolve; });
  t.after(releaseResponse);
  const api = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
      uploadStarted(chunk.toString());
    }
    res.write("received:");
    await responseTail;
    res.end(Buffer.concat(chunks));
  });
  const proxy = await startProxy(t, await listen(t, api));
  let client;
  const result = new Promise((resolve, reject) => {
    client = http.request({
      hostname, port: proxy.port, method: "PUT", path: "/stream", signal: AbortSignal.timeout(10_000),
    }, async (res) => {
      try {
        const chunks = [];
        for await (const chunk of res) {
          chunks.push(chunk);
          if (chunks.length === 1) {
            assert.equal(chunk.toString(), "received:");
            releaseResponse();
          }
        }
        resolve(Buffer.concat(chunks).toString());
      } catch (error) {
        reject(error);
      }
    });
    client.on("error", reject);
    client.write("part-one");
  });
  assert.equal(await Promise.race([firstUpload, result]), "part-one");
  client.end("-two");
  assert.equal(await result, "received:part-one-two");
});

test("the ESM build passes the same HTTP proxy options as the exercised CommonJS build", () => {
  function webOptions(build) {
    const source = readFileSync(requireWeb.resolve(`next/dist/${build}server/lib/router-utils/proxy-request.js`), "utf8");
    const call = source.match(/proxy\.web\(req, res, \{([\s\S]*?)\}\)/);
    assert.ok(call, "expected the Next HTTP proxy entry point");
    return call[1].trim();
  }
  assert.equal(webOptions("esm/"), webOptions(""));
});
