import { ApiRequestError, getPreferences, syncPreferenceFields } from "./api";
import { assertOfflineAccess, captureOfflineAccess } from "./offline-access";
import { getActiveOfflineStorageContext, offlineDb } from "./offline-db";
import type { PreferenceField, PreferenceSyncRequest, UserPreferenceRead, UserPreferenceUpdate } from "./types";

export const PREFERENCE_STATE_KEY = "account-preferences:v1";
export const PREFERENCE_SYNC_EVENT = "chat-reader:preference-sync";
export const LEGACY_PREFERENCE_OWNER = "chat-reader:legacy-preferences-owner-v1";
export const PREFERENCE_FIELDS: PreferenceField[] = ["theme_mode", "locale_mode", "reader_width_mode", "reader_density_mode", "reader_font_size_px", "section_toc_mode", "conversation_sort_mode", "conversation_sort_direction", "project_sort_mode", "project_sort_direction", "reader_default_focus", "annotation_default_position"];
type Value = NonNullable<UserPreferenceUpdate[PreferenceField]>;
type Change = { value: Value; baseRevision: number; sequence: number };
type Flight = { request: PreferenceSyncRequest; sequences: Partial<Record<PreferenceField, number>> };
export type PreferenceSyncState = {
  version: 1; server: UserPreferenceRead; changes: Partial<Record<PreferenceField, Change>>;
  conflicts: Partial<Record<PreferenceField, true>>; flight?: Flight; sequence: number;
  attempts: number; retryAfter?: number; confirmed?: boolean; error?: "NETWORK" | "AUTH" | "INVALID";
};
const fieldRevision = (snapshot: UserPreferenceRead, key: PreferenceField) => snapshot.field_revisions?.[key] ?? 1;
const notify = () => window.dispatchEvent(new Event(PREFERENCE_SYNC_EVENT));
const valuesOf = (changes: PreferenceSyncState["changes"]): UserPreferenceUpdate => Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, value!.value]));
export function effectivePreferences(state: PreferenceSyncState): UserPreferenceRead { return { ...state.server, ...valuesOf(state.changes) }; }
export function preferencePendingCount(state?: PreferenceSyncState): number { return state ? Object.keys(state.changes).length : 0; }

export async function readPreferenceState(db = offlineDb): Promise<PreferenceSyncState | undefined> {
  return (await db.settings.get(PREFERENCE_STATE_KEY))?.value as PreferenceSyncState | undefined;
}
const write = (state: PreferenceSyncState, db = offlineDb) => db.settings.put({ key: PREFERENCE_STATE_KEY, value: state });

export async function initializePreferenceState(initial: UserPreferenceRead): Promise<PreferenceSyncState> {
  const db = offlineDb, access = captureOfflineAccess(), userId = getActiveOfflineStorageContext().userId;
  const state = await db.transaction("rw", db.settings, async () => {
    const existing = await readPreferenceState(db);
    if (existing) return existing;
    const result: PreferenceSyncState = { version: 1, server: { ...initial, reader_default_focus: initial.reader_default_focus ?? false, annotation_default_position: initial.annotation_default_position ?? "floating" }, changes: {}, conflicts: {}, sequence: 0, attempts: 0 };
    // The auth boundary binds legacy device settings to their previous verified
    // account before switching namespaces. Unknown ownership is never guessed.
    try {
      if (userId && localStorage.getItem(LEGACY_PREFERENCE_OWNER) === userId && localStorage.getItem(`${LEGACY_PREFERENCE_OWNER}:migrated`) !== userId) {
        const cached = JSON.parse(localStorage.getItem("chat-reader:user-preferences") || "{}");
        cached.reader_default_focus = (localStorage.getItem("chat-reader:reader-default-focus") ?? localStorage.getItem("chat-reader:reader-focus-mode")) === "true";
        cached.annotation_default_position = localStorage.getItem("chat-reader:annotation-workspace-mode") === "docked" ? "docked" : "floating";
        for (const key of PREFERENCE_FIELDS) if (validValue(key, cached[key]) && cached[key] !== result.server[key]) {
          result.changes[key] = { value: cached[key], baseRevision: fieldRevision(result.server, key), sequence: ++result.sequence };
        }
      }
    } catch { /* Missing or invalid legacy storage cannot affect another account. */ }
    await write(result, db); return result;
  });
  assertOfflineAccess(access);
  try {
    if (userId && localStorage.getItem(LEGACY_PREFERENCE_OWNER) === userId) localStorage.setItem(`${LEGACY_PREFERENCE_OWNER}:migrated`, userId);
  } catch { /* The stored state also prevents remigration during this account session. */ }
  return state;
}

function validValue(key: PreferenceField, value: unknown): value is Value {
  if (key === "reader_default_focus") return typeof value === "boolean";
  if (key === "reader_font_size_px") return typeof value === "number" && Number.isInteger(value) && value >= 15 && value <= 22;
  const allowed: Partial<Record<PreferenceField, string[]>> = {
    theme_mode: ["light", "dark", "system"], locale_mode: ["auto", "zh-CN", "en-US"], reader_width_mode: ["compact", "standard", "wide"],
    reader_density_mode: ["compact", "comfortable", "large"], section_toc_mode: ["visible", "rail"], annotation_default_position: ["floating", "docked"],
    conversation_sort_mode: ["recent_read", "updated", "created", "imported", "title", "message_count", "custom"], project_sort_mode: ["recent_read", "updated", "created", "title", "conversation_count", "custom"],
    conversation_sort_direction: ["asc", "desc"], project_sort_direction: ["asc", "desc"],
  };
  return typeof value === "string" && Boolean(allowed[key]?.includes(value));
}

export async function queuePreferenceChanges(input: UserPreferenceUpdate): Promise<void> {
  const db = offlineDb;
  await db.transaction("rw", db.settings, async () => {
    const state = await readPreferenceState(db);
    if (!state) throw new Error("Preferences are still loading.");
    for (const key of PREFERENCE_FIELDS) {
      const value = input[key]; if (value === undefined) continue;
      if (!validValue(key, value)) throw new Error("Invalid preference value.");
      if (value === state.server[key] && !state.flight?.sequences[key]) { delete state.changes[key]; delete state.conflicts[key]; }
      else state.changes[key] = { value, baseRevision: state.changes[key]?.baseRevision ?? fieldRevision(state.server, key), sequence: ++state.sequence };
    }
    state.attempts = 0; delete state.error; await write(state, db);
  });
  notify();
}

function mergeServer(state: PreferenceSyncState, fresh: UserPreferenceRead): void {
  const server = { ...state.server, field_revisions: { ...state.server.field_revisions } };
  for (const key of PREFERENCE_FIELDS) {
    if (!validValue(key, fresh[key]) || fieldRevision(fresh, key) < fieldRevision(server, key)) continue;
    Object.assign(server, { [key]: fresh[key] });
    server.field_revisions[key] = fieldRevision(fresh, key);
  }
  server.updated_at = fresh.updated_at; state.server = server; state.confirmed = true;
}

const running = new WeakMap<typeof offlineDb, Promise<void>>();
export function flushPreferenceSync(options: { refresh?: boolean; retry?: boolean } = {}): Promise<void> {
  if (!navigator.onLine) return Promise.resolve();
  const db = offlineDb, access = captureOfflineAccess();
  const previous = running.get(db); if (previous) return previous;
  const run = async () => {
    assertOfflineAccess(access);
    let state = await readPreferenceState(db); if (!state) return;
    if (options.retry) await db.transaction("rw", db.settings, async () => {
      state = (await readPreferenceState(db))!; state.attempts = 0; delete state.error; delete state.retryAfter; await write(state, db);
    });
    if (state.attempts >= 5 || state.error === "AUTH" || state.error === "INVALID") return;
    if (state.error && (state.retryAfter ?? 0) > Date.now()) return;
    try {
      if (options.refresh && !state.flight) {
        const fresh = await getPreferences(AbortSignal.timeout(10_000)); assertOfflineAccess(access);
        await db.transaction("rw", db.settings, async () => { const current = (await readPreferenceState(db))!; mergeServer(current, fresh); if (!Object.keys(current.changes).length) { delete current.error; delete current.retryAfter; current.attempts = 0; } await write(current, db); });
      }
      // A maximum of 12 fields per request; later edits get a separate durable
      // operation after this response has been acknowledged.
      const flight = await db.transaction("rw", db.settings, async () => {
        const current = (await readPreferenceState(db))!;
        if (current.flight) return current.flight;
        const keys = PREFERENCE_FIELDS.filter((key) => current.changes[key] && !current.conflicts[key]);
        if (!keys.length) return undefined;
        const request: PreferenceSyncRequest = { operation_id: crypto.randomUUID(), changes: {}, base_revisions: {} }, sequences: Flight["sequences"] = {};
        for (const key of keys) { const change = current.changes[key]!; Object.assign(request.changes, { [key]: change.value }); request.base_revisions[key] = change.baseRevision; sequences[key] = change.sequence; }
        current.flight = { request, sequences }; await write(current, db); return current.flight;
      });
      if (!flight) return;
      const response = await syncPreferenceFields(flight.request, AbortSignal.timeout(10_000)); assertOfflineAccess(access);
      const returned = [...response.applied, ...response.conflicts], expected = Object.keys(flight.request.changes);
      if (response.operation_id !== flight.request.operation_id || new Set(returned).size !== expected.length || returned.length !== expected.length || returned.some((key) => !expected.includes(key))
        || PREFERENCE_FIELDS.some((key) => !validValue(key, response.preferences[key]) || !Number.isInteger(response.preferences.field_revisions?.[key]) || response.preferences.field_revisions![key] < 1)) throw new Error("Invalid preference sync receipt.");
      await db.transaction("rw", db.settings, async () => {
        const current = (await readPreferenceState(db))!;
        if (current.flight?.request.operation_id !== flight.request.operation_id) throw new Error("Preference operation changed.");
        mergeServer(current, response.preferences);
        for (const key of returned) {
          const pending = current.changes[key]; if (!pending) continue;
          if (response.conflicts.includes(key)) { current.conflicts[key] = true; continue; }
          if (pending.sequence === flight.sequences[key]) { delete current.changes[key]; delete current.conflicts[key]; }
          else pending.baseRevision = fieldRevision(response.preferences, key);
        }
        delete current.flight; delete current.error; delete current.retryAfter; current.attempts = 0; await write(current, db);
      });
    } catch (error) {
      assertOfflineAccess(access);
      await db.transaction("rw", db.settings, async () => {
        state = (await readPreferenceState(db))!;
        state.attempts += 1;
        state.retryAfter = Date.now() + Math.min(30_000, 1000 * 2 ** state.attempts);
        state.error = error instanceof ApiRequestError && [401, 403].includes(error.status) ? "AUTH" : error instanceof ApiRequestError && [400, 409, 422].includes(error.status) ? "INVALID" : "NETWORK";
        await write(state, db);
      });
    }
  };
  const promise = (async () => { if (navigator.locks) await navigator.locks.request(`chat-reader:sync:${db.name}`, run); else await run(); })().finally(() => { running.delete(db); });
  running.set(db, promise); return promise;
}

export async function resolvePreferenceConflict(key: PreferenceField, choice: "local" | "server", expectedRevision: number, expectedSequence: number): Promise<void> {
  const db = offlineDb;
  await db.transaction("rw", db.settings, async () => {
    const current = await readPreferenceState(db), change = current?.changes[key];
    if (!current || !change || current.flight || fieldRevision(current.server, key) !== expectedRevision || change.sequence !== expectedSequence) throw new Error("Preferences changed. Review the values again.");
    if (choice === "server") delete current.changes[key];
    else { change.baseRevision = expectedRevision; change.sequence = ++current.sequence; }
    delete current.conflicts[key]; delete current.error; current.attempts = 0;
    await write(current, db);
  });
  notify();
}
