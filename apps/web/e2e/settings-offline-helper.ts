import type { Page } from "@playwright/test";

export async function readLocal(page: Page, userId: string) {
  return page.evaluate(async (userId) => {
    const namespace = Array.from(new TextEncoder().encode(userId), (b) => b.toString(16).padStart(2, "0")).join("");
    const name = localStorage.getItem("chat-reader:offline-legacy-owner-v1") === userId ? "chat-reader-offline-library" : `chat-reader-offline-library--user-${namespace}`;
    if (!(await indexedDB.databases()).some((db) => db.name === name)) return { conversations: [], notebooks: [], outbox: [], settings: [] };
    return new Promise<{ conversations: unknown[]; notebooks: Array<{ title: string; blocks: unknown[] }>; outbox: unknown[]; settings: Array<{ key: string; value: unknown }> }>((resolve, reject) => {
      let settled = false;
      let db: IDBDatabase | undefined;
      const finish = (error?: unknown, value?: { conversations: unknown[]; notebooks: Array<{ title: string; blocks: unknown[] }>; outbox: unknown[]; settings: Array<{ key: string; value: unknown }> }) => {
        if (settled) return;
        settled = true; clearTimeout(timer); db?.close();
        if (error) reject(error); else resolve(value!);
      };
      const timer = setTimeout(() => finish(new Error("Local-data inspection did not settle within 5 seconds")), 5_000);
      let open: IDBOpenDBRequest;
      try { open = indexedDB.open(name); }
      catch (error) { finish(error); return; }
      open.onerror = () => finish(open.error ?? new Error("Local-data inspection could not open the database"));
      open.onblocked = () => finish(new Error("Local-data inspection is blocked by a pending database operation"));
      open.onupgradeneeded = () => {
        // The database can disappear after databases(). A read-only assertion
        // must not recreate it or hang after trying absent object stores.
        open.transaction?.abort();
        finish(new Error("The downloaded database disappeared during local-data inspection"));
      };
      open.onsuccess = () => {
        db = open.result;
        if (settled) { db.close(); return; }
        db.onversionchange = () => db?.close();
        try {
          const tx = db.transaction(["conversations", "notebooks", "outbox", "settings"]);
          const conversations = tx.objectStore("conversations").getAll(), notebooks = tx.objectStore("notebooks").getAll(), outbox = tx.objectStore("outbox").getAll();
          const settings = tx.objectStore("settings").getAll();
          tx.oncomplete = () => finish(undefined, { conversations: conversations.result, notebooks: notebooks.result, outbox: outbox.result, settings: settings.result });
          tx.onabort = () => finish(tx.error ?? new Error("Local-data inspection transaction was aborted"));
          tx.onerror = () => finish(tx.error ?? new Error("Local-data inspection transaction failed"));
        } catch (error) { finish(error); }
      };
    });
  }, userId);
}
