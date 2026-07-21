"use client";

import { useTranslations } from "../../components/preferences-provider";

export function VersionHistoryButton({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations();
  return (
    <button
      type="button"
      onClick={onToggle}
      className="min-h-10 rounded-full border border-ui bg-raised px-3 text-xs font-medium text-primary hover:bg-subtle"
    >
      {isOpen ? t("hideVersions") : t("versions")}
    </button>
  );
}
