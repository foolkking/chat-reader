"use client";

import Link from "next/link";
import { Activity, CircleHelp, ArrowLeft, ChevronDown, ChevronUp, FileClock, RefreshCw, Library, LockKeyhole, ShieldCheck, SlidersHorizontal, Database, Eraser, Sparkles, Wrench, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ACCOUNT_CAPABILITIES_CHANGED_EVENT, readAccountCapabilities } from "../lib/auth-client";
import { usePreferences, useTranslations } from "./preferences-provider";
import { PreferenceSyncStatus } from "./preference-sync-status";

export type SettingsCategory = "help" | "admin-runtime" | "offline" | "shares" | "data" | "security" | "formats" | "cleanup" | "skills" | "access" | "admin-users" | "admin-access" | "admin-skills" | "admin-formats" | "admin-noise" | "admin-features" | "admin-system" | "admin-audit";

export function PreferencesPanel({ compact = false, libraryMode = false, onlineHref = "/", onOpenCategory }: { compact?: boolean; libraryMode?: boolean; onlineHref?: string; onOpenCategory?: (category: SettingsCategory) => void }) {
  const preferences = usePreferences();
  const t = useTranslations();
  const focusDefault = preferences.readerDefaultFocus;
  const annotationPosition = preferences.annotationDefaultPosition;
  const [moreOpen, setMoreOpen] = useState(false);
  // Keep privileged categories hidden until the session has been resolved.
  // This prevents a multi-account user from seeing a maintenance control during
  // the first render before the server role is known.
  const [capabilityError, setCapabilityError] = useState(false);
  const [capabilityAttempt, setCapabilityAttempt] = useState(0);
  const [accessRole, setAccessRole] = useState<"ADMIN" | "USER" | null>(null);
  useEffect(() => {
    const reload = () => setCapabilityAttempt((value) => value + 1);
    window.addEventListener(ACCOUNT_CAPABILITIES_CHANGED_EVENT, reload);
    return () => window.removeEventListener(ACCOUNT_CAPABILITIES_CHANGED_EVENT, reload);
  }, []);

  useEffect(() => {
    if (libraryMode) return;
    let active = true;
    setCapabilityError(false);
    void readAccountCapabilities().then((session) => {
      if (!active) return;
      setAccessRole(session.role === "ADMIN" ? "ADMIN" : "USER");
    }).catch(() => {
      if (active) { setAccessRole("USER"); setCapabilityError(true); }
    });
    return () => { active = false; };
  }, [libraryMode, capabilityAttempt]);

  const updateFocusDefault = (value: boolean) => {
    void preferences.setReaderDefaultFocus(value);
  };

  const updateAnnotationPosition = (value: "floating" | "docked") => {
    void preferences.setAnnotationDefaultPosition(value);
  };
  return (
    <section className={compact ? "space-y-3" : "space-y-4"} aria-label={t("settings")}>
      <PreferenceSyncStatus />
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
      <div className={`settings-more-panel ${moreOpen ? "settings-more-panel-open" : ""}`} aria-hidden={!moreOpen} inert={!moreOpen}>
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
      <SettingsCategoryButton icon={RefreshCw} label={preferences.resolvedLocale === "zh-CN" ? "离线与同步" : "Offline & sync"} onClick={() => onOpenCategory?.("offline")} />
      <SettingsCategoryButton icon={CircleHelp} label={preferences.resolvedLocale === "zh-CN" ? "帮助与诊断" : "Help & diagnostics"} onClick={() => onOpenCategory?.("help")} />
      {!libraryMode && capabilityError ? <div role="alert" className="text-xs text-secondary"><p>{preferences.resolvedLocale === "zh-CN" ? "无法读取账户功能和限制。" : "Account capabilities are unavailable."}</p><button type="button" onClick={() => setCapabilityAttempt((value) => value + 1)} className="btn-secondary mt-2 min-h-11 px-3">{preferences.resolvedLocale === "zh-CN" ? "重试" : "Retry"}</button></div> : null}
      {!libraryMode ? <div className="settings-category-list space-y-2 border-t border-ui pt-3">
        <SettingsCategoryButton icon={Database} label={t("dataArchive")} onClick={() => onOpenCategory?.("data")} />
        <SettingsCategoryButton icon={Link2} label={preferences.resolvedLocale === "zh-CN" ? "我的分享" : "My shares"} onClick={() => onOpenCategory?.("shares")} />
        <SettingsCategoryButton icon={ShieldCheck} label={t("accountSecurity")} onClick={() => onOpenCategory?.("security")} />
        <SettingsCategoryButton icon={Sparkles} label={t("skillManagement")} onClick={() => onOpenCategory?.("skills")} />
          <SettingsCategoryButton icon={SlidersHorizontal} label={t("importFormats")} onClick={() => onOpenCategory?.("formats")} />
          <SettingsCategoryButton icon={Eraser} label={t("noiseRuleLibrary")} onClick={() => onOpenCategory?.("cleanup")} />
        {accessRole === "ADMIN" ? <div className="space-y-2 border-t border-ui pt-3" aria-labelledby="settings-administration-heading">
          <div className="px-1"><h3 id="settings-administration-heading" className="text-xs font-semibold uppercase tracking-[0.08em] text-secondary">{preferences.resolvedLocale === "zh-CN" ? "\u7ba1\u7406" : "Administration"}</h3></div>
          <SettingsCategoryButton icon={Activity} label={preferences.resolvedLocale === "zh-CN" ? "运行状态" : "Runtime status"} onClick={() => onOpenCategory?.("admin-runtime")} />
          <SettingsCategoryButton icon={LockKeyhole} label={preferences.resolvedLocale === "zh-CN" ? "用户与访问" : "Users & access"} onClick={() => onOpenCategory?.("access")} />
          <SettingsCategoryButton icon={Eraser} label={preferences.resolvedLocale === "zh-CN" ? "系统噪声规则" : "System noise rules"} onClick={() => onOpenCategory?.("admin-noise")} />
          <SettingsCategoryButton icon={SlidersHorizontal} label={preferences.resolvedLocale === "zh-CN" ? "系统导入格式" : "System import formats"} onClick={() => onOpenCategory?.("admin-formats")} />
          <SettingsCategoryButton icon={Sparkles} label={preferences.resolvedLocale === "zh-CN" ? "\u7cfb\u7edf Skill" : "System skills"} onClick={() => onOpenCategory?.("admin-skills")} />
          <SettingsCategoryButton icon={SlidersHorizontal} label={preferences.resolvedLocale === "zh-CN" ? "\u529f\u80fd\u4e0e\u9ed8\u8ba4\u503c" : "Features & defaults"} onClick={() => onOpenCategory?.("admin-features")} />
          <SettingsCategoryButton icon={Wrench} label={preferences.resolvedLocale === "zh-CN" ? "\u7cfb\u7edf" : "System"} onClick={() => onOpenCategory?.("admin-system")} />
          <SettingsCategoryButton icon={FileClock} label={preferences.resolvedLocale === "zh-CN" ? "\u5b89\u5168\u4e0e\u5ba1\u8ba1" : "Security & audit"} onClick={() => onOpenCategory?.("admin-audit")} />
        </div> : null}
      </div> : null}
    </section>
  );
}

function SettingsCategoryButton({ icon: Icon, label, ariaLabel, onClick }: { icon: typeof Database; label: string; ariaLabel?: string; onClick: () => void }) {
  return <button type="button" aria-label={ariaLabel} onClick={onClick} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-[var(--focus)]">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-secondary"><Icon className="h-4 w-4" aria-hidden="true" /></span>
    <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-primary">{label}</span></span>
    <ChevronDown className="h-4 w-4 -rotate-90 shrink-0 text-secondary" aria-hidden="true" />
  </button>;
}

function SettingGroup({ label, children, columns = 3, compact = false }: { label: string; children: React.ReactNode; columns?: 2 | 3; compact?: boolean }) {
  return <div role="group" aria-label={label}><p className={`${compact ? "mb-1" : "mb-2"} text-xs font-semibold text-secondary`}>{label}</p><div className={`grid ${columns === 2 ? "grid-cols-2" : "grid-cols-3"} rounded-lg bg-subtle p-1`}>{children}</div></div>;
}

function Segment({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`min-h-8 rounded-md px-2 text-xs ${active ? "bg-surface font-medium shadow-sm" : "text-secondary hover:text-primary"}`}>{children}</button>;
}
