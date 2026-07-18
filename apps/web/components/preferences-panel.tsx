"use client";

import { usePreferences, useTranslations } from "./preferences-provider";

export function PreferencesPanel() {
  const preferences = usePreferences();
  const t = useTranslations();
  return (
    <section className="space-y-4" aria-label={t("appearanceLanguage")}>
      <SettingGroup label={t("theme")}>
        {(["light", "dark", "system"] as const).map((mode) => (
          <Segment key={mode} active={preferences.themeMode === mode} onClick={() => void preferences.setThemeMode(mode)}>
            {t(mode)}
          </Segment>
        ))}
      </SettingGroup>
      <SettingGroup label={t("language")}>
        {(["auto", "zh-CN", "en-US"] as const).map((mode) => (
          <Segment key={mode} active={preferences.localeMode === mode} onClick={() => void preferences.setLocaleMode(mode)}>
            {mode === "auto" ? t("automatic") : mode === "zh-CN" ? t("chinese") : t("english")}
          </Segment>
        ))}
      </SettingGroup>
      <SettingGroup label={t("readerWidth")}>
        {(["compact", "standard", "wide"] as const).map((mode) => (
          <Segment key={mode} active={preferences.readerWidthMode === mode} onClick={() => void preferences.setReaderWidthMode(mode)}>
            {t(mode)}
          </Segment>
        ))}
      </SettingGroup>
    </section>
  );
}

function SettingGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="mb-2 text-xs font-semibold text-secondary">{label}</p><div className="grid grid-cols-3 rounded-lg bg-subtle p-1">{children}</div></div>;
}

function Segment({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`min-h-9 rounded-md px-2 text-xs ${active ? "bg-surface font-medium shadow-sm" : "text-secondary hover:text-primary"}`}>{children}</button>;
}
