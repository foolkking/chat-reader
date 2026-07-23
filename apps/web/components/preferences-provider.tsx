"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getPreferences, updatePreferences } from "../lib/api";
import { resolveLocale, translate, type ResolvedLocale, type TranslationKey } from "../lib/i18n";
import type {
  ConversationSortMode,
  LocaleMode,
  ProjectSortMode,
  ReaderWidthMode,
  SectionTocMode,
  SortDirection,
  ThemeMode,
  UserPreferenceRead,
} from "../lib/types";

type PreferencesContextValue = {
  themeMode: ThemeMode;
  localeMode: LocaleMode;
  readerWidthMode: ReaderWidthMode;
  sectionTocMode: SectionTocMode;
  conversationSortMode: ConversationSortMode;
  conversationSortDirection: SortDirection;
  projectSortMode: ProjectSortMode;
  projectSortDirection: SortDirection;
  resolvedTheme: "light" | "dark";
  resolvedLocale: ResolvedLocale;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  setLocaleMode: (mode: LocaleMode) => Promise<void>;
  setReaderWidthMode: (mode: ReaderWidthMode) => Promise<void>;
  setSectionTocMode: (mode: SectionTocMode) => Promise<void>;
  setConversationSort: (mode: ConversationSortMode, direction: SortDirection) => Promise<void>;
  setProjectSort: (mode: ProjectSortMode, direction: SortDirection) => Promise<void>;
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
  const [sectionTocMode, setSectionTocModeState] = useState<SectionTocMode>(initialPreferences.section_toc_mode ?? "visible");
  const [conversationSortMode, setConversationSortMode] = useState<ConversationSortMode>(initialPreferences.conversation_sort_mode ?? "recent_read");
  const [conversationSortDirection, setConversationSortDirection] = useState<SortDirection>(initialPreferences.conversation_sort_direction ?? "desc");
  const [projectSortMode, setProjectSortMode] = useState<ProjectSortMode>(initialPreferences.project_sort_mode ?? "recent_read");
  const [projectSortDirection, setProjectSortDirection] = useState<SortDirection>(initialPreferences.project_sort_direction ?? "desc");
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
      setSectionTocModeState(fresh.section_toc_mode ?? "visible");
      setConversationSortMode(fresh.conversation_sort_mode ?? "recent_read");
      setConversationSortDirection(fresh.conversation_sort_direction ?? "desc");
      setProjectSortMode(fresh.project_sort_mode ?? "recent_read");
      setProjectSortDirection(fresh.project_sort_direction ?? "desc");
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
  const setSectionTocMode = useCallback(async (mode: SectionTocMode) => {
    setSectionTocModeState(mode);
    await updatePreferences({ section_toc_mode: mode });
  }, []);
  const setConversationSort = useCallback(async (mode: ConversationSortMode, direction: SortDirection) => {
    setConversationSortMode(mode);
    setConversationSortDirection(direction);
    await updatePreferences({ conversation_sort_mode: mode, conversation_sort_direction: direction });
  }, []);
  const setProjectSort = useCallback(async (mode: ProjectSortMode, direction: SortDirection) => {
    setProjectSortMode(mode);
    setProjectSortDirection(direction);
    await updatePreferences({ project_sort_mode: mode, project_sort_direction: direction });
  }, []);

  const value = useMemo<PreferencesContextValue>(() => ({
    themeMode,
    localeMode,
    readerWidthMode,
    sectionTocMode,
    conversationSortMode,
    conversationSortDirection,
    projectSortMode,
    projectSortDirection,
    resolvedTheme,
    resolvedLocale,
    setThemeMode,
    setLocaleMode,
    setReaderWidthMode,
    setSectionTocMode,
    setConversationSort,
    setProjectSort,
    t: (key, values) => translate(resolvedLocale, key, values),
  }), [conversationSortDirection, conversationSortMode, localeMode, projectSortDirection, projectSortMode, readerWidthMode, resolvedLocale, resolvedTheme, sectionTocMode, setConversationSort, setLocaleMode, setProjectSort, setReaderWidthMode, setSectionTocMode, setThemeMode, themeMode]);

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
