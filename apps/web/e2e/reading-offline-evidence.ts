// Browser-side E2E observation only. No production bridge or account/cache scan.
export async function readReadingOfflineEvidence(input: {
  conversationId: string; assets: string[]; allowUnboundTestStore: boolean; scaleAsset?: string;
}) {
  const user = localStorage.getItem("chat-reader:offline-active-user-v1");
  const owner = localStorage.getItem("chat-reader:offline-legacy-owner-v1");
  const empty = (state: string) => ({ state, rows: 0, bytesVerified: 0, scale: null as number | null });
  if (!user && (!input.allowUnboundTestStore || owner)) return empty("no-active-owner");
  // Only the explicit auth-disabled test profile starts in the unbound default
  // store. Protected sessions never fall back to it while signed out or locked.
  const suffix = !user || owner === user ? ""
    : `--user-${Array.from(new TextEncoder().encode(user), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  const dbName = `chat-reader-offline-library${suffix}`, cacheName = `chat-reader-offline-assets-v1${suffix}`;
  type Attachment = { id: string; sha256: string; byte_size: number; image_display_v1?: { scale_percent?: number } };
  const open = indexedDB.open(dbName);
  // A probe must not create an empty DB that later looks like a real package.
  let missing = false;
  open.onupgradeneeded = () => { missing = true; open.transaction?.abort(); };
  const rows = await new Promise<Attachment[] | null>((resolve, reject) => {
    open.onerror = () => missing ? resolve(null) : reject(open.error);
    open.onblocked = () => reject(new Error("Offline evidence database is blocked"));
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction("attachments", "readonly");
        const req = tx.objectStore("attachments").index("conversation_id").getAll(input.conversationId);
        tx.oncomplete = () => { db.close(); resolve(req.result); };
        tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
      } catch (error) { db.close(); reject(error); }
    };
  });
  if (!rows) return empty("no-package-database");
  const matching = new Map(rows.filter(r => input.assets.includes(r.id)).map(r => [r.id, r]));
  const scale = input.scaleAsset ? matching.get(input.scaleAsset)?.image_display_v1?.scale_percent ?? null : null;
  if (!await caches.has(cacheName)) return { state: "no-asset-cache", rows: matching.size, bytesVerified: 0, scale };
  const cache = await caches.open(cacheName);
  const verified = await Promise.all([...matching.values()].map(async row => {
    if (!/^[0-9a-f]{64}$/i.test(row.sha256)) return false;
    const sha = row.sha256.toLowerCase();
    const response = await cache.match(`https://offline.chat-reader.local/assets/${encodeURIComponent(row.id)}/${sha}`);
    if (!response?.ok) return false;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== row.byte_size) return false;
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(digest, b => b.toString(16).padStart(2, "0")).join("") === sha;
  }));
  return { state: "package", rows: matching.size, bytesVerified: verified.filter(Boolean).length, scale };
}
