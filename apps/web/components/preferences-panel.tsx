"use client";

import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronUp, Library, ShieldCheck, SlidersHorizontal, Database, Eraser, Sparkles, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { readAuthSession } from "../lib/auth-client";
import { usePreferences, useTranslations } from "./preferences-provider";

export type SettingsCategory = "data" | "security" | "formats" | "cleanup" | "skills" | "access";

export function PreferencesPanel({ compact = false, libraryMode = false, onlineHref = "/", onOpenCategory }: { compact?: boolean; libraryMode?: boolean; onlineHref?: string; onOpenCategory?: (category: SettingsCategory) => void }) {
  const preferences = usePreferences();
  const t = useTranslations();
  const [focusDefault, setFocusDefault] = useState(false);
  const [annotationPosition, setAnnotationPosition] = useState<"floating" | "docked">("floating");
  const [moreOpen, setMoreOpen] = useState(false);
  // Keep privileged categories hidden until the session has been resolved.
  // This prevents a multi-account user from seeing a maintenance control during
  // the first render before the server role is known.
  const [accessRole, setAccessRole] = useState<"ADMIN" | "USER" | null>(null);

  useEffect(() => {
    const currentDefault = window.localStorage.getItem("chat-reader:reader-default-focus");
    const legacyDefault = window.localStorage.getItem("chat-reader:reader-focus-mode");
    const migratedDefault = currentDefault ?? legacyDefault ?? "false";
    setFocusDefault(migratedDefault === "true");
    if (currentDefault === null) window.localStorage.setItem("chat-reader:reader-default-focus", migratedDefault);
    if (legacyDefault !== null) window.localStorage.removeItem("chat-reader:reader-focus-mode");
    setAnnotationPosition(window.localStorage.getItem("chat-reader:annotation-workspace-mode") === "docked" ? "docked" : "floating");
  }, []);

  useEffect(() => {
    if (libraryMode) return;
    let active = true;
    void readAuthSession().then((session) => {
      if (!active) return;
      setAccessRole(session.role === "ADMIN" ? "ADMIN" : "USER");
    }).catch(() => {
      if (active) setAccessRole("USER");
    });
    return () => { active = false; };
  }, [libraryMode]);

  const updateFocusDefault = (value: boolean) => {
    setFocusDefault(value);
    window.localStorage.setItem("chat-reader:reader-default-focus", String(value));
    window.dispatchEvent(new CustomEvent("chat-reader:reader-default-focus-change", { detail: value }));
  };

  const updateAnnotationPosition = (value: "floating" | "docked") => {
    setAnnotationPosition(value);
    window.localStorage.setItem("chat-reader:annotation-workspace-mode", value);
    window.dispatchEvent(new CustomEvent("chat-reader:annotation-workspace-mode-change", { detail: value }));
  };
  return (
    <section className={compact ? "space-y-3" : "space-y-4"} aria-label={t("settings")}>
      <SettingGroup label={t("theme")} compact={compact}>
        {(["light", "dark", "system"] as const).map((mode) => (
          <Segment key={mode} active={preferences.themeMode === mode} onClick={() => void preferences.setThemeMode(mode)}>
            {t(mode)}
          </Segment>
        ))}
      </SettingGroup>
      <button type="button" onClick={() => setMoreOpen((value) => !value)} className="flex min-h-9 w-full items-center justify-between border-t border-ui pt-2 text-sm font-medium text-secondary hover:text-primary" aria-expanded={moreOpen}>
        {moreOpen ? t("collapseSettings") : t("moreReadingSettings")}
        {moreOpen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
      </button>
      <div className={`settings-more-panel ${moreOpen ? "settings-more-panel-open" : ""}`} aria-hidden={!moreOpen}>
        <div className={compact ? "space-y-3" : "space-y-4"}>
        <SettingGroup label={t("readerDensity")} compact={compact}>
          {(["compact", "comfortable", "large"] as const).map((mode) => (
            <Segment key={mode} active={preferences.readerDensityMode === mode} onClick={() => void preferences.setReaderDensityMode(mode)}>
              {mode === "compact" ? t("densityCompact") : mode === "comfortable" ? t("densityComfortable") : t("densityLarge")}
            </Segment>
          ))}
        </SettingGroup>
        <div>
          <div className="mb-1 flex items-center justify-between gap-3"><p className="text-xs font-semibold text-secondary">{t("readerFontSize")}</p><button type="button" onClick={() => void preferences.setReaderFontSizePx(17)} disabled={preferences.readerFontSizePx === 17} className="text-xs font-medium text-accent disabled:opacity-40">{t("resetFontSize")}</button></div>
          <div className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center rounded-lg bg-subtle p-1">
            <button type="button" onClick={() => void preferences.setReaderFontSizePx(preferences.readerFontSizePx - 1)} disabled={preferences.readerFontSizePx <= 15} className="flex min-h-9 items-center justify-center rounded-md text-base font-semibold text-secondary hover:bg-surface disabled:opacity-35" aria-label={t("decreaseFontSize")}>A−</button>
            <output className="text-center text-sm font-medium text-primary" aria-live="polite">{preferences.readerFontSizePx}px</output>
            <button type="button" onClick={() => void preferences.setReaderFontSizePx(preferences.readerFontSizePx + 1)} disabled={preferences.readerFontSizePx >= 22} className="flex min-h-9 items-center justify-center rounded-md text-lg font-semibold text-secondary hover:bg-surface disabled:opacity-35" aria-label={t("increaseFontSize")}>A+</button>
          </div>
        </div>
        <SettingGroup label={t("language")} compact={compact}>
          {(["auto", "zh-CN", "en-US"] as const).map((mode) => (
            <Segment key={mode} active={preferences.localeMode === mode} onClick={() => void preferences.setLocaleMode(mode)}>
              {mode === "auto" ? t("automatic") : mode === "zh-CN" ? t("chinese") : t("english")}
            </Segment>
          ))}
        </SettingGroup>
        <SettingGroup label={t("readerWidth")} compact={compact}>
          {(["compact", "standard", "wide"] as const).map((mode) => (
            <Segment key={mode} active={preferences.readerWidthMode === mode} onClick={() => void preferences.setReaderWidthMode(mode)}>
              {t(mode)}
            </Segment>
          ))}
        </SettingGroup>
        <SettingGroup label={t("readerStartup")} columns={2} compact={compact}>
          <Segment active={!focusDefault} onClick={() => updateFocusDefault(false)}>{t("defaultReading")}</Segment>
          <Segment active={focusDefault} onClick={() => updateFocusDefault(true)}>{t("defaultFocus")}</Segment>
        </SettingGroup>
        <SettingGroup label={t("annotationDefaultPosition")} columns={2} compact={compact}>
          <Segment active={annotationPosition === "floating"} onClick={() => updateAnnotationPosition("floating")}>{t("floating")}</Segment>
          <Segment active={annotationPosition === "docked"} onClick={() => updateAnnotationPosition("docked")}>{t("docked")}</Segment>
        </SettingGroup>
        </div>
      </div>
      <Link href={libraryMode ? onlineHref : "/library"} className={`btn-secondary flex items-center justify-center gap-2 px-3 text-sm font-medium ${compact ? "min-h-9" : "min-h-10"}`}>
        {libraryMode ? <ArrowLeft className="h-4 w-4" aria-hidden="true" /> : <Library className="h-4 w-4" aria-hidden="true" />}
        {libraryMode ? t("backOnline") : t("offlineLibrary")}
      </Link>
      {!libraryMode ? <div className="settings-category-list space-y-2 border-t border-ui pt-3">
        <SettingsCategoryButton icon={ShieldCheck} label={t("accountSecurity")} description={t("accountSecurity")} onClick={() => onOpenCategory?.("security")} />
        {accessRole === "ADMIN" ? <SettingsCategoryButton icon={UsersRound} label={preferences.resolvedLocale === "zh-CN" ? "\u7528\u6237\u4e0e\u8bbf\u95ee" : "Users & access"} description={preferences.resolvedLocale === "zh-CN" ? "\u7ba1\u7406\u7528\u6237\u3001\u6ce8\u518c\u4e0e\u9080\u8bf7" : "Manage users, registration and invitations"} onClick={() => onOpenCategory?.("access")} /> : null}
        {accessRole === "ADMIN" ? <SettingsCategoryButton icon={Database} label={t("dataArchive")} description={t("dataArchiveDescription")} onClick={() => onOpenCategory?.("data")} /> : null}
        <SettingsCategoryButton icon={Sparkles} label={t("skillManagement")} description={t("skillManagementDescription")} onClick={() => onOpenCategory?.("skills")} />
        <SettingsCategoryButton icon={SlidersHorizontal} label={t("importFormats")} description={t("importFormatsDescription")} onClick={() => onOpenCategory?.("formats")} />
        <SettingsCategoryButton icon={Eraser} label={t("noiseRuleLibrary")} description={t("noiseRuleLibraryDescription")} onClick={() => onOpenCategory?.("cleanup")} />
      </div> : null}
    </section>
  );
}

function SettingsCategoryButton({ icon: Icon, label, description, onClick }: { icon: typeof Database; label: string; description: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-ui bg-surface px-3 py-2 text-left transition-colors hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-[var(--focus)]">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--accent-soft)] text-accent"><Icon className="h-4 w-4" aria-hidden="true" /></span>
    <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-primary">{label}</span><span className="mt-0.5 block text-xs text-secondary">{description}</span></span>
    <ChevronDown className="h-4 w-4 -rotate-90 shrink-0 text-secondary" aria-hidden="true" />
  </button>;
}

function SettingGroup({ label, children, columns = 3, compact = false }: { label: string; children: React.ReactNode; columns?: 2 | 3; compact?: boolean }) {
  return <div><p className={`${compact ? "mb-1" : "mb-2"} text-xs font-semibold text-secondary`}>{label}</p><div className={`grid ${columns === 2 ? "grid-cols-2" : "grid-cols-3"} rounded-lg bg-subtle p-1`}>{children}</div></div>;
}

function Segment({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`min-h-8 rounded-md px-2 text-xs ${active ? "bg-surface font-medium shadow-sm" : "text-secondary hover:text-primary"}`}>{children}</button>;
}
