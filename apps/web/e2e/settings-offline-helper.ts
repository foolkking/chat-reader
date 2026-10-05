import type { Page } from "@playwright/test";

export async function readLocal(page: Page, userId: string) {
  return page.evaluate(async (userId) => {
    const namespace = Array.from(new TextEncoder().encode(userId), (b) => b.toString(16).padStart(2, "0")).join("");
    const name = localStorage.getItem("chat-reader:offline-legacy-owner-v1") === userId ? "chat-reader-offline-library" : `chat-reader-offline-library--user-${namespace}`;
    if (!(await indexedDB.databases()).some((db) => db.name === name)) return { conversations: [], notebooks: [], outbox: [], settings: [] };
    return new Promise<{ conversations: unknown[]; notebooks: Array<{ title: string; blocks: unknown[] }>; outbox: unknown[]; settings: Array<{ key: string; value: unknown }> }>((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(["conversations", "notebooks", "outbox", "settings"]);
        const conversations = tx.objectStore("conversations").getAll(), notebooks = tx.objectStore("notebooks").getAll(), outbox = tx.objectStore("outbox").getAll();
        const settings = tx.objectStore("settings").getAll();
        tx.oncomplete = () => { db.close(); resolve({ conversations: conversations.result, notebooks: notebooks.result, outbox: outbox.result, settings: settings.result }); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }, userId);
}
