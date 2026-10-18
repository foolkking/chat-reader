import { expect, type APIRequestContext } from "@playwright/test";
import type { AdaptiveImportSession } from "../lib/types";

/** Await the real worker; never replace background analysis with test-side parsing. */
export async function waitForAdaptiveAnalysis(
  request: APIRequestContext,
  initial: AdaptiveImportSession,
  options: { baseURL?: string; headers?: Record<string, string> } = {},
): Promise<AdaptiveImportSession> {
  let session = initial;
  await expect.poll(async () => {
    const response = await request.get(
      `${options.baseURL ?? ""}/api/adaptive-import/sessions/${initial.import_id}`,
      { headers: options.headers },
    );
    expect(response.ok()).toBe(true);
    session = await response.json() as AdaptiveImportSession;
    return ["COLLECTING", "ANALYZING", "CANCELING"].includes(session.state);
  }, { message: "The real worker must finish staged import analysis", timeout: 60_000, intervals: [200, 500, 1000] }).toBe(false);
  expect(session.state, session.error_message ?? "Import analysis must be reviewable").not.toMatch(/FAILED|CANCELED/);
  return session;
}
