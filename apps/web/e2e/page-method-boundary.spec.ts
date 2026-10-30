import { expect, test } from "@playwright/test";

test("unsupported page methods never reach Server Action decoding or set a session", async ({ request }) => {
  for (const path of ["/login", "/register", "/", "/library", "/share/synthetic-action-probe"]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await request.fetch(path, {
        method,
        headers: { "Next-Action": "x", "Content-Type": "text/plain" },
        data: "[]",
        maxRedirects: 0,
      });
      expect(response.status(), `${method} ${path}`).toBe(405);
      expect(response.headers()["allow"]).toBe("GET, HEAD");
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(response.headers()["location"]).toBeUndefined();
      expect(response.headers()["set-cookie"]).toBeUndefined();
      expect(await response.text()).toBe("");
    }
  }
  expect((await request.get("/login")).status()).toBe(200);
  expect((await request.head("/login")).status()).toBe(200);
});
