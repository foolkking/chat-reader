import type { QueryClient } from "@tanstack/react-query";
import type { SkillRead } from "./types";
import type { SystemSkill } from "./admin-client";

// A committed replacement owns its file metadata. Selection belongs to the
// account, so a system update must not overwrite a personal preference.
export async function acknowledgeSkillReplacement(client: QueryClient, value: SkillRead | SystemSkill, active: () => boolean) {
  await Promise.all(["skills", "admin-system-skills", "resolved-skill"].map(key => client.cancelQueries({ queryKey: [key] })));
  if (!active()) return;
  client.setQueriesData<SkillRead[]>({ queryKey: ["skills"] }, rows => rows?.map(row => {
    if (row.id !== value.id) return row;
    if ("source" in value) return { ...row, ...value };
    return { ...row, name: value.name, status: value.status, updated_at: value.updated_at,
      byte_size: value.byte_size, bundle_revision: value.bundle_revision,
      bundle_url: value.bundle_url, is_customized: value.is_customized };
  }));
  if (!("source" in value)) client.setQueriesData<SystemSkill[]>({ queryKey: ["admin-system-skills"] }, rows => rows?.map(row => row.id === value.id ? { ...row, ...value } : row));
  // Read errors belong to the list, not to the acknowledged mutation.
  for (const key of ["skills", "admin-system-skills"]) void client.invalidateQueries({ queryKey: [key] });
  // Resolved content and its download must come from the same revision. The
  // replacement response has metadata only, so discard the old content cache.
  void client.resetQueries({ queryKey: ["resolved-skill"] });
}
