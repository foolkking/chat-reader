export type OfflineContinuation = {
  version: 1;
  generation: number;
  revision_id: string;
  updated_at: string;
  system_validation: "not_performed";
  metadata?: Record<string, unknown>;
  members: Partial<Record<"current" | "index", { text: string; sha256: string; byte_size: number }>>;
};

export async function readOfflineContinuation(value: unknown): Promise<OfflineContinuation | undefined> {
  if (value == null) return undefined;
  const fail = () => { throw new Error("Offline Context files are malformed."); };
  if (typeof value !== "object" || Array.isArray(value)) return fail();
  const data = value as OfflineContinuation;
  if (data.version !== 1 || !Number.isSafeInteger(data.generation) || data.generation < 0
      || typeof data.revision_id !== "string" || typeof data.updated_at !== "string"
      || data.system_validation !== "not_performed" || !data.members || typeof data.members !== "object"
      || Array.isArray(data.members) || Object.keys(data.members).some(key => key !== "current" && key !== "index")) return fail();
  const members: OfflineContinuation["members"] = {};
  for (const name of ["current", "index"] as const) {
    const member = data.members[name];
    if (member === undefined) continue;
    if (!member || typeof member.text !== "string" || typeof member.sha256 !== "string") return fail();
    const bytes = new TextEncoder().encode(member.text);
    if (bytes.length !== member.byte_size || bytes.length === 0 || bytes.length > (name === "current" ? 1 : 8) * 1024 * 1024) return fail();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), part => part.toString(16).padStart(2, "0")).join("");
    if (digest !== member.sha256) return fail();
    if (name === "index") {
      const parsed: unknown = JSON.parse(member.text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail();
    }
    members[name] = { text: member.text, sha256: digest, byte_size: bytes.length };
  }
  const metadata = data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
    ? Object.fromEntries(Object.entries(data.metadata).filter(([key]) => ["schema_version", "continuation_revision", "trust", "coverage", "source_fingerprint", "raw_tail_start_seq"].includes(key))) : {};
  return { version: 1, generation: data.generation, revision_id: data.revision_id,
    updated_at: data.updated_at, system_validation: "not_performed", members, metadata };
}
