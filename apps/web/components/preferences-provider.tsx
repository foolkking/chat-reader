"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getPreferences, updatePreferences } from "../lib/api";
import { resolveLocale, translate, type ResolvedLocale, type TranslationKey } from "../lib/i18n";
import type {
  ConversationSortMode,
  LocaleMode,
  ProjectSortMode,
  ReaderDensityMode,
  ReaderWidthMode,
  SectionTocMode,
  SortDirection,
  ThemeMode,
  UserPreferenceRead,
  UserPreferenceUpdate,
} from "../lib/types";

type PreferencesContextValue = {
  themeMode: ThemeMode;
  localeMode: LocaleMode;
  readerWidthMode: ReaderWidthMode;
  readerDensityMode: ReaderDensityMode;
  readerFontSizePx: number;
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
  setReaderDensityMode: (mode: ReaderDensityMode) => Promise<void>;
  setReaderFontSizePx: (size: number) => Promise<void>;
  setSectionTocMode: (mode: SectionTocMode) => Promise<void>;
  setConversationSort: (mode: ConversationSortMode, direction: SortDirection) => Promise<void>;
  setProjectSort: (mode: ProjectSortMode, direction: SortDirection) => Promise<void>;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);
const PREFERENCES_STORAGE_KEY = "chat-reader:user-preferences";
const READER_LAYOUT_WILL_CHANGE_EVENT = "chat-reader:reader-layout-will-change";
const READER_LAYOUT_DID_CHANGE_EVENT = "chat-reader:reader-layout-did-change";

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
  const [readerDensityMode, setReaderDensityModeState] = useState<ReaderDensityMode>(initialPreferences.reader_density_mode ?? "comfortable");
  const [readerFontSizePx, setReaderFontSizePxState] = useState(initialPreferences.reader_font_size_px ?? 17);
  const [sectionTocMode, setSectionTocModeState] = useState<SectionTocMode>(initialPreferences.section_toc_mode ?? "visible");
  const [conversationSortMode, setConversationSortMode] = useState<ConversationSortMode>(initialPreferences.conversation_sort_mode ?? "recent_read");
  const [conversationSortDirection, setConversationSortDirection] = useState<SortDirection>(initialPreferences.conversation_sort_direction ?? "desc");
  const [projectSortMode, setProjectSortMode] = useState<ProjectSortMode>(initialPreferences.project_sort_mode ?? "recent_read");
  const [projectSortDirection, setProjectSortDirection] = useState<SortDirection>(initialPreferences.project_sort_direction ?? "desc");
  const preferencesRef = useRef<UserPreferenceRead>(initialPreferences);
  const preferenceMutationSequenceRef = useRef(0);
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

  const applyPreferences = useCallback((fresh: UserPreferenceRead) => {
      preferencesRef.current = fresh;
      setThemeModeState(fresh.theme_mode);
      setLocaleModeState(fresh.locale_mode);
      setReaderWidthModeState(fresh.reader_width_mode ?? "standard");
      setReaderDensityModeState(fresh.reader_density_mode ?? "comfortable");
      setReaderFontSizePxState(fresh.reader_font_size_px ?? 17);
      setSectionTocModeState(fresh.section_toc_mode ?? "visible");
      setConversationSortMode(fresh.conversation_sort_mode ?? "recent_read");
      setConversationSortDirection(fresh.conversation_sort_direction ?? "desc");
      setProjectSortMode(fresh.project_sort_mode ?? "recent_read");
      setProjectSortDirection(fresh.project_sort_direction ?? "desc");
      writeCachedPreferences(fresh);
  }, []);

  useEffect(() => {
    const cached = readCachedPreferences();
    if (cached) applyPreferences(cached);
    void getPreferences().then(async (fresh) => {
      if (cached && timestamp(cached.updated_at) > timestamp(fresh.updated_at)) {
        try {
          applyPreferences(await updatePreferences(preferenceUpdate(cached)));
        } catch {
          applyPreferences(cached);
        }
        return;
      }
      applyPreferences(fresh);
    }).catch(() => undefined);
  }, [applyPreferences]);

  useEffect(() => {
    const syncCachedPreferences = () => {
      const cached = readCachedPreferences();
      if (!cached) return;
      void getPreferences().then(async (fresh) => {
        if (timestamp(cached.updated_at) <= timestamp(fresh.updated_at)) {
          applyPreferences(fresh);
          return;
        }
        applyPreferences(await updatePreferences(preferenceUpdate(cached)));
      }).catch(() => undefined);
    };
    window.addEventListener("online", syncCachedPreferences);
    return () => window.removeEventListener("online", syncCachedPreferences);
  }, [applyPreferences]);

  const applyLocalUpdate = useCallback((input: UserPreferenceUpdate) => {
    const next: UserPreferenceRead = {
      ...preferencesRef.current,
      ...input,
      updated_at: new Date().toISOString(),
    };
    applyPreferences(next);
    return next;
  }, [applyPreferences]);

  const syncPreferenceUpdate = useCallback(async (input: UserPreferenceUpdate) => {
    const sequence = preferenceMutationSequenceRef.current + 1;
    preferenceMutationSequenceRef.current = sequence;
    applyLocalUpdate(input);
    try {
      const fresh = await updatePreferences(input);
      if (preferenceMutationSequenceRef.current === sequence) applyPreferences(fresh);
    } catch {
      // Local preferences remain authoritative until connectivity returns.
    }
  }, [applyLocalUpdate, applyPreferences]);

  const syncReaderLayoutPreference = useCallback((input: UserPreferenceUpdate) => {
    const transitionId = `${Date.now()}:${Math.random()}`;
    window.dispatchEvent(new CustomEvent(READER_LAYOUT_WILL_CHANGE_EVENT, { detail: transitionId }));
    const update = syncPreferenceUpdate(input);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent(READER_LAYOUT_DID_CHANGE_EVENT, { detail: transitionId }));
      });
    });
    return update;
  }, [syncPreferenceUpdate]);

  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    await syncPreferenceUpdate({ theme_mode: mode });
  }, [syncPreferenceUpdate]);
  const setLocaleMode = useCallback(async (mode: LocaleMode) => {
    await syncPreferenceUpdate({ locale_mode: mode });
  }, [syncPreferenceUpdate]);
  const setReaderWidthMode = useCallback(async (mode: ReaderWidthMode) => {
    await syncReaderLayoutPreference({ reader_width_mode: mode });
  }, [syncReaderLayoutPreference]);
  const setReaderDensityMode = useCallback(async (mode: ReaderDensityMode) => {
    await syncReaderLayoutPreference({ reader_density_mode: mode });
  }, [syncReaderLayoutPreference]);
  const setReaderFontSizePx = useCallback(async (size: number) => {
    await syncReaderLayoutPreference({ reader_font_size_px: Math.max(15, Math.min(22, Math.round(size))) });
  }, [syncReaderLayoutPreference]);
  const setSectionTocMode = useCallback(async (mode: SectionTocMode) => {
    await syncPreferenceUpdate({ section_toc_mode: mode });
  }, [syncPreferenceUpdate]);
  const setConversationSort = useCallback(async (mode: ConversationSortMode, direction: SortDirection) => {
    await syncPreferenceUpdate({ conversation_sort_mode: mode, conversation_sort_direction: direction });
  }, [syncPreferenceUpdate]);
  const setProjectSort = useCallback(async (mode: ProjectSortMode, direction: SortDirection) => {
    await syncPreferenceUpdate({ project_sort_mode: mode, project_sort_direction: direction });
  }, [syncPreferenceUpdate]);

  const value = useMemo<PreferencesContextValue>(() => ({
    themeMode,
    localeMode,
    readerWidthMode,
    readerDensityMode,
    readerFontSizePx,
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
    setReaderDensityMode,
    setReaderFontSizePx,
    setSectionTocMode,
    setConversationSort,
    setProjectSort,
    t: (key, values) => translate(resolvedLocale, key, values),
  }), [conversationSortDirection, conversationSortMode, localeMode, projectSortDirection, projectSortMode, readerDensityMode, readerFontSizePx, readerWidthMode, resolvedLocale, resolvedTheme, sectionTocMode, setConversationSort, setLocaleMode, setProjectSort, setReaderDensityMode, setReaderFontSizePx, setReaderWidthMode, setSectionTocMode, setThemeMode, themeMode]);

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

function readCachedPreferences(): UserPreferenceRead | null {
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    return raw ? JSON.parse(raw) as UserPreferenceRead : null;
  } catch {
    return null;
  }
}

function writeCachedPreferences(preferences: UserPreferenceRead): void {
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences still remain available for the current session.
  }
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function preferenceUpdate(preferences: UserPreferenceRead): UserPreferenceUpdate {
  return {
    theme_mode: preferences.theme_mode,
    locale_mode: preferences.locale_mode,
    reader_width_mode: preferences.reader_width_mode,
    reader_density_mode: preferences.reader_density_mode ?? "comfortable",
    reader_font_size_px: preferences.reader_font_size_px ?? 17,
    section_toc_mode: preferences.section_toc_mode,
    conversation_sort_mode: preferences.conversation_sort_mode,
    conversation_sort_direction: preferences.conversation_sort_direction,
    project_sort_mode: preferences.project_sort_mode,
    project_sort_direction: preferences.project_sort_direction,
  };
}
