// Keep only an opaque request key and its intent hash in this owner's tab. No
// conversation IDs, project titles, message bodies or downloads are persisted.
export type BatchReceipt = { key: string; digest: string; time: number };
export function readBatchReceipt(slot: string): BatchReceipt | null {
  const raw = sessionStorage.getItem(slot);
  if (!raw) return null;
  const v = JSON.parse(raw) as BatchReceipt;
  if (!v || !/^batch-export-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v.key)
    || !/^[a-f0-9]{64}$/.test(v.digest) || !Number.isFinite(v.time)) throw Error("Invalid export receipt");
  if (Date.now() - v.time > 24 * 3600_000) { sessionStorage.removeItem(slot); return null; }
  return v;
}
export async function batchIntentDigest(ids: string[], scope: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([ids, scope ?? null]));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}
