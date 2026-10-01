"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { liveQuery } from "dexie";
import { usePathname } from "next/navigation";
import { offlineDb } from "../lib/offline-db";
import { effectivePreferences, flushPreferenceSync, initializePreferenceState, queuePreferenceChanges, readPreferenceState, resolvePreferenceConflict, type PreferenceSyncState } from "../lib/preference-sync";
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
  PreferenceField,
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
  readerDefaultFocus: boolean;
  annotationDefaultPosition: "floating" | "docked";
  preferenceSync: PreferenceSyncState | null;
  preferenceStorageError: boolean;
  retryPreferenceSync: () => Promise<void>;
  persistPreferenceDraft: () => Promise<void>;
  resolvePreference: (field: PreferenceField, choice: "local" | "server", revision: number, sequence: number) => Promise<void>;
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
  setReaderDefaultFocus: (value: boolean) => Promise<void>;
  setAnnotationDefaultPosition: (value: "floating" | "docked") => Promise<void>;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);
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
  const [readerDefaultFocus, setReaderDefaultFocusState] = useState(initialPreferences.reader_default_focus ?? false);
  const [annotationDefaultPosition, setAnnotationDefaultPositionState] = useState(initialPreferences.annotation_default_position ?? "floating");
  const [preferenceSync, setPreferenceSync] = useState<PreferenceSyncState | null>(null);
  const [preferenceStorageError, setPreferenceStorageError] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);
  const unpersisted = useRef<UserPreferenceUpdate>({});
  const pathname = usePathname() ?? "/";
  const privatePage = !/^\/(?:share|login|register|verify-email|reset-password|password-reset|account-upgrade)(?:\/|$)/.test(pathname);
  const preferencesRef = useRef<UserPreferenceRead>(initialPreferences);
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
      fresh = { ...fresh, ...unpersisted.current };
      const previous = preferencesRef.current;
      const changedLayout = previous.reader_width_mode !== fresh.reader_width_mode || previous.reader_density_mode !== fresh.reader_density_mode || previous.reader_font_size_px !== fresh.reader_font_size_px;
      const transitionId = crypto.randomUUID();
      if (changedLayout) window.dispatchEvent(new CustomEvent(READER_LAYOUT_WILL_CHANGE_EVENT, { detail: transitionId }));
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
      setReaderDefaultFocusState(fresh.reader_default_focus ?? false);
      setAnnotationDefaultPositionState(fresh.annotation_default_position ?? "floating");
      if (changedLayout) window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(READER_LAYOUT_DID_CHANGE_EVENT, { detail: transitionId }))));
  }, []);

  useEffect(() => {
    if (!privatePage) return;
    let active = true;
    const db = offlineDb;
    const subscription = liveQuery(() => readPreferenceState(db)).subscribe({ next: (state) => {
      if (!active || !state) return;
      setPreferenceSync(state); applyPreferences(effectivePreferences(state));
    }, error: () => { if (active) setPreferenceStorageError(true); } });
    void initializePreferenceState(initialPreferences).then(async () => {
      if (active) { setPreferenceStorageError(false); await flushPreferenceSync({ refresh: true }); }
    }).catch(() => { if (active) setPreferenceStorageError(true); });
    return () => { active = false; subscription.unsubscribe(); };
  }, [applyPreferences, initialPreferences, privatePage, bootAttempt]);

  useEffect(() => {
    if (!privatePage) return;
    const refresh = () => { if (document.visibilityState === "visible") void flushPreferenceSync({ refresh: true }).catch(() => setPreferenceStorageError(true)); };
    window.addEventListener("online", refresh); window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [privatePage]);

  useEffect(() => {
    if (!privatePage || !preferenceSync || preferenceSync.attempts >= 5 || preferenceSync.error === "AUTH" || preferenceSync.error === "INVALID") return;
    if (!preferenceSync.error && !preferenceSync.flight && !Object.keys(preferenceSync.changes).some((key) => !preferenceSync.conflicts[key as PreferenceField])) return;
    const timer = setTimeout(() => { void flushPreferenceSync({ refresh: Boolean(preferenceSync.error && !preferenceSync.flight) }).catch(() => setPreferenceStorageError(true)); }, preferenceSync.attempts ? Math.max(0, (preferenceSync.retryAfter ?? 0) - Date.now()) : 200);
    return () => clearTimeout(timer);
  }, [preferenceSync, privatePage]);

  const applyLocalUpdate = useCallback((input: UserPreferenceUpdate) => {
    const next: UserPreferenceRead = {
      ...preferencesRef.current,
      ...input,
    };
    applyPreferences(next);
    return next;
  }, [applyPreferences]);

  const syncPreferenceUpdate = useCallback(async (input: UserPreferenceUpdate) => {
    Object.assign(unpersisted.current, input);
    applyLocalUpdate(input);
    try {
      await queuePreferenceChanges(input);
      for (const key of Object.keys(input) as PreferenceField[]) if (unpersisted.current[key] === input[key]) delete unpersisted.current[key];
      setPreferenceStorageError(false);
    } catch {
      setPreferenceStorageError(true);
    }
  }, [applyLocalUpdate]);

  const retryPreferenceSync = useCallback(async () => {
    try {
      await initializePreferenceState(initialPreferences);
      if (Object.keys(unpersisted.current).length) await syncPreferenceUpdate({ ...unpersisted.current });
      await flushPreferenceSync({ refresh: true, retry: true });
      setBootAttempt((value) => value + 1);
    } catch { setPreferenceStorageError(true); }
  }, [initialPreferences, syncPreferenceUpdate]);
  const persistPreferenceDraft = useCallback(async () => {
    if (!Object.keys(unpersisted.current).length) return;
    await initializePreferenceState(initialPreferences);
    await syncPreferenceUpdate({ ...unpersisted.current });
    if (Object.keys(unpersisted.current).length) throw new Error(resolvedLocale === "zh-CN" ? "本机偏好尚未保存，请先重试偏好保存，再退出。" : "Local preferences are not saved. Retry saving them before signing out.");
  }, [initialPreferences, resolvedLocale, syncPreferenceUpdate]);
  useEffect(() => {
    if (!preferenceStorageError || !Object.keys(unpersisted.current).length) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [preferenceStorageError]);

  const syncReaderLayoutPreference = useCallback((input: UserPreferenceUpdate) => {
    return syncPreferenceUpdate(input);
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
  const setReaderDefaultFocus = useCallback((value: boolean) => syncPreferenceUpdate({ reader_default_focus: value }), [syncPreferenceUpdate]);
  const setAnnotationDefaultPosition = useCallback((value: "floating" | "docked") => syncPreferenceUpdate({ annotation_default_position: value }), [syncPreferenceUpdate]);

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
    readerDefaultFocus, annotationDefaultPosition, preferenceSync, preferenceStorageError, retryPreferenceSync, persistPreferenceDraft,
    resolvePreference: resolvePreferenceConflict, setReaderDefaultFocus, setAnnotationDefaultPosition,
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
  }), [conversationSortDirection, conversationSortMode, localeMode, projectSortDirection, projectSortMode, readerDensityMode, readerFontSizePx, readerWidthMode, resolvedLocale, resolvedTheme, sectionTocMode, setConversationSort, setLocaleMode, setProjectSort, setReaderDensityMode, setReaderFontSizePx, setReaderWidthMode, setSectionTocMode, setThemeMode, themeMode, readerDefaultFocus, annotationDefaultPosition, preferenceSync, preferenceStorageError, retryPreferenceSync, persistPreferenceDraft, setReaderDefaultFocus, setAnnotationDefaultPosition]);

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
