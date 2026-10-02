import { readAccountCapabilities, readAppInfo } from "./auth-client";
import { assertOfflineAccess, captureOfflineAccess } from "./offline-access";
import { offlineDb } from "./offline-db";
import { safeHelpInfo, type HelpInfo } from "./help-diagnostics";

const SNAPSHOT_KEY = "help:last-known-capabilities:v1";

export async function readCachedHelpInfo(): Promise<HelpInfo | null> {
  const ticket = captureOfflineAccess(), db = offlineDb;
  const row = await db.settings.get(SNAPSHOT_KEY);
  assertOfflineAccess(ticket);
  const info = safeHelpInfo(row?.value);
  return info.checked_at ? info : null;
}

export async function refreshHelpInfo(signal?: AbortSignal): Promise<{ info: HelpInfo; saved: boolean }> {
  const ticket = captureOfflineAccess(), db = offlineDb;
  const [capabilities, app] = await Promise.all([readAccountCapabilities(signal), readAppInfo(signal)]);
  assertOfflineAccess(ticket);
  signal?.throwIfAborted();
  const info = safeHelpInfo({ capabilities, app, checked_at: new Date().toISOString() });
  let saved = true;
  try { await db.settings.put({ key: SNAPSHOT_KEY, value: info }); } catch { saved = false; }
  assertOfflineAccess(ticket);
  return { info, saved };
}
