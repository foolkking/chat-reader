/** Local privacy preference, NOT a server credential or a substitute for API auth. */
export const DEVICE_TRUST_KEY = "chat-reader:trusted-offline-devices-v1";
type TrustRecord = { userId: string; confirmedAt: string };
export function deviceTrusted(userId: string | null): boolean {
  if (!userId) return false;
  try {
    const records: unknown = JSON.parse(localStorage.getItem(DEVICE_TRUST_KEY) ?? "[]");
    return Array.isArray(records) && records.some((record: TrustRecord) =>
      record?.userId === userId && typeof record.confirmedAt === "string");
  } catch { return false; }
}
export function setDeviceTrusted(userId: string, trusted: boolean): void {
  const raw: unknown = JSON.parse(localStorage.getItem(DEVICE_TRUST_KEY) ?? "[]");
  const records: TrustRecord[] = Array.isArray(raw) ? raw.filter((row: TrustRecord) =>
    row && typeof row.userId === "string" && row.userId !== userId && typeof row.confirmedAt === "string") : [];
  if (trusted) records.push({ userId, confirmedAt: new Date().toISOString() });
  localStorage.setItem(DEVICE_TRUST_KEY, JSON.stringify(records));
}
