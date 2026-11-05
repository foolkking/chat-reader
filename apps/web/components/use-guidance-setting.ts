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
    let persisted = false;
    try {
      await db.transaction("rw", db.settings, async () => {
        assertOfflineAccess(access);
        await db.settings.put({ key: `guidance:${key}`, value });
      });
      persisted = true;
    } catch { /* A hint must remain dismissible when storage is unavailable. */ }
    // Publish only after the transaction settles: hiding the hint must not
    // signal completion while a refresh can still abort its persistent write.
    // A read begun before the write must not overwrite the new cached value.
    assertOfflineAccess(access);
    await client.cancelQueries({ queryKey, exact: true });
    assertOfflineAccess(access);
    client.setQueryData(queryKey, value);
    return { persisted };
  };
  return { value: query.data, ready: query.isSuccess, save };
}
