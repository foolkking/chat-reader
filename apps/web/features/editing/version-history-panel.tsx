"use client";

import { useQuery } from "@tanstack/react-query";
import { getMessageVersions, restoreMessageVersion } from "../../lib/api";
import { RestoreVersionButton } from "./restore-version-button";

export function VersionHistoryPanel({
  messageId,
  onChanged,
}: {
  messageId: string;
  onChanged: () => Promise<void> | void;
}) {
  const versionsQuery = useQuery({
    queryKey: ["message-versions", messageId],
    queryFn: () => getMessageVersions(messageId),
  });

  async function restore(versionId: string, versionNumber: number) {
    await restoreMessageVersion(messageId, versionId, {
      editReason: `Restore version ${versionNumber}`,
    });
    await versionsQuery.refetch();
    await onChanged();
  }

  if (versionsQuery.isLoading) {
    return <p className="text-sm text-slate-500">Loading versions.</p>;
  }

  if (versionsQuery.isError) {
    return <p className="text-sm text-red-700">{versionsQuery.error.message}</p>;
  }

  const versions = versionsQuery.data?.items ?? [];

  return (
    <div className="mt-4 space-y-3 rounded-md border border-slate-200 bg-white/80 p-3">
      <h3 className="text-sm font-semibold text-slate-950">Version history</h3>
      {versions.length === 0 ? <p className="text-sm text-slate-500">No versions found.</p> : null}
      {versions.map((version) => (
        <details key={version.id} className="rounded-md border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-800">
            v{version.version_number} · {version.edit_type}
            {version.is_current ? " · Current" : ""}
          </summary>
          <div className="mt-3 space-y-3">
            <div className="text-xs text-slate-500">
              <span>{version.created_at ? new Date(version.created_at).toLocaleString() : "Unknown time"}</span>
              {version.edit_reason ? <span> · {version.edit_reason}</span> : null}
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-800">
              {version.display_text || version.plain_text || ""}
            </pre>
            {!version.is_current ? (
              <RestoreVersionButton
                versionNumber={version.version_number}
                onRestore={() => restore(version.id, version.version_number)}
              />
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}
