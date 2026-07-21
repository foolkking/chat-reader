"use client";

import { useQuery } from "@tanstack/react-query";
import { getMessageVersions, restoreMessageVersion } from "../../lib/api";
import { RestoreVersionButton } from "./restore-version-button";
import { usePreferences } from "../../components/preferences-provider";

export function VersionHistoryPanel({
  messageId,
  onChanged,
}: {
  messageId: string;
  onChanged: () => Promise<void> | void;
}) {
  const { t, resolvedLocale } = usePreferences();
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
    return <p className="text-sm text-secondary">{t("loadingVersions")}</p>;
  }

  if (versionsQuery.isError) {
    return <p className="text-sm text-[var(--danger)]">{versionsQuery.error.message}</p>;
  }

  const versions = versionsQuery.data?.items ?? [];

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-ui bg-raised p-3">
      <h3 className="text-sm font-semibold text-primary">{t("versionHistory")}</h3>
      {versions.length === 0 ? <p className="text-sm text-secondary">{t("noVersions")}</p> : null}
      {versions.map((version) => (
        <details key={version.id} className="rounded-lg border border-ui bg-surface p-3">
          <summary className="cursor-pointer text-sm font-medium text-primary">
            v{version.version_number} · {version.edit_type}
            {version.is_current ? ` · ${t("current")}` : ""}
          </summary>
          <div className="mt-3 space-y-3">
            <div className="text-xs text-secondary">
              <span>{version.created_at ? new Date(version.created_at).toLocaleString(resolvedLocale) : t("unknownTime")}</span>
              {version.edit_reason ? <span> · {version.edit_reason}</span> : null}
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-subtle p-3 text-sm leading-6 text-primary">
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
