"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { offlineDb } from "../lib/offline-db";
import { assertOfflineAccess, captureOfflineAccess } from "../lib/offline-access";

/** Device hints use the existing account-scoped settings, never unscoped storage. */
export function useGuidanceSetting<T>(key: string) {
  const client = useQueryClient();
  const db = offlineDb;
  const queryKey = ["guidance-setting", db.name, key];
  const query = useQuery({ queryKey, networkMode: "always", queryFn: async () => {
    const access = captureOfflineAccess();
    const item = await db.settings.get(`guidance:${key}`);
    assertOfflineAccess(access);
    return (item?.value as T | undefined) ?? null;
  } });
  const save = async (value: T) => {
    const access = captureOfflineAccess();
    // Keep dismissal effective in this session even if local storage is full.
    client.setQueryData(queryKey, value);
    try {
      await db.transaction("rw", db.settings, async () => {
        assertOfflineAccess(access);
        await db.settings.put({ key: `guidance:${key}`, value });
      });
    } catch { /* A hint must remain dismissible when storage is unavailable. */ }
  };
  return { value: query.data, ready: query.isSuccess, save };
}
