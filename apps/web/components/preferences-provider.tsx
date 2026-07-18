"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getPreferences, updatePreferences } from "../lib/api";
import { resolveLocale, translate, type ResolvedLocale, type TranslationKey } from "../lib/i18n";
import type { LocaleMode, ReaderWidthMode, ThemeMode, UserPreferenceRead } from "../lib/types";

type PreferencesContextValue = {
  themeMode: ThemeMode;
  localeMode: LocaleMode;
  readerWidthMode: ReaderWidthMode;
  resolvedTheme: "light" | "dark";
  resolvedLocale: ResolvedLocale;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  setLocaleMode: (mode: LocaleMode) => Promise<void>;
  setReaderWidthMode: (mode: ReaderWidthMode) => Promise<void>;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({
  children,
  initialPreferences,
  initialLocale,
}: {
  children: React.ReactNode;
  initialPreferences: UserPreferenceRead;
  initialLocale: ResolvedLocale;
}) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(initialPreferences.theme_mode);
  const [localeMode, setLocaleModeState] = useState<LocaleMode>(initialPreferences.locale_mode);
  const [readerWidthMode, setReaderWidthModeState] = useState<ReaderWidthMode>(initialPreferences.reader_width_mode ?? "standard");
  const [systemDark, setSystemDark] = useState(false);
  const resolvedTheme = themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode;
  const resolvedLocale = localeMode === "auto" ? initialLocale : resolveLocale(localeMode);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.lang = resolvedLocale;
    document.documentElement.style.colorScheme = resolvedTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolvedTheme === "dark" ? "#202120" : "#f7f7f5");
  }, [resolvedLocale, resolvedTheme]);

  useEffect(() => {
    void getPreferences().then((fresh) => {
      setThemeModeState(fresh.theme_mode);
      setLocaleModeState(fresh.locale_mode);
      setReaderWidthModeState(fresh.reader_width_mode ?? "standard");
    }).catch(() => undefined);
  }, []);

  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    setThemeModeState(mode);
    await updatePreferences({ theme_mode: mode });
  }, []);
  const setLocaleMode = useCallback(async (mode: LocaleMode) => {
    setLocaleModeState(mode);
    await updatePreferences({ locale_mode: mode });
  }, []);
  const setReaderWidthMode = useCallback(async (mode: ReaderWidthMode) => {
    setReaderWidthModeState(mode);
    await updatePreferences({ reader_width_mode: mode });
  }, []);

  const value = useMemo<PreferencesContextValue>(() => ({
    themeMode,
    localeMode,
    readerWidthMode,
    resolvedTheme,
    resolvedLocale,
    setThemeMode,
    setLocaleMode,
    setReaderWidthMode,
    t: (key, values) => translate(resolvedLocale, key, values),
  }), [localeMode, readerWidthMode, resolvedLocale, resolvedTheme, setLocaleMode, setReaderWidthMode, setThemeMode, themeMode]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used within PreferencesProvider");
  return value;
}

export function useTranslations() {
  return usePreferences().t;
}
