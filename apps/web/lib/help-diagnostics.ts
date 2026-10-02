const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
const number = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const bool = (value: unknown): boolean | null => typeof value === "boolean" ? value : null;
const choice = (value: unknown, choices: readonly string[]) => typeof value === "string" && choices.includes(value) ? value : "unknown";
export const buildRevision = (value: unknown): string | null => typeof value === "string" && /^[a-f0-9]{40}$/.test(value) ? value : null;
const version = (value: unknown) => typeof value === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value) ? value : null;
const timestamp = (value: unknown): string | null => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;

export function safeHelpInfo(value: unknown) {
  const input = record(value), capabilities = record(input.capabilities), app = record(input.app);
  return { checked_at: timestamp(input.checked_at), app: { api_version: version(app.api_version), revision: buildRevision(app.revision) }, capabilities: {
    allow_share_links: bool(capabilities.allow_share_links), allow_public_share: bool(capabilities.allow_public_share), allow_share_password: bool(capabilities.allow_share_password),
    allow_user_import: bool(capabilities.allow_user_import), allow_user_skills: bool(capabilities.allow_user_skills), allow_skill_import: bool(capabilities.allow_skill_import),
    maximum_import_size_mb: number(capabilities.maximum_import_size_mb), maximum_merge_message_count: number(capabilities.maximum_merge_message_count),
  } };
}
export type HelpInfo = ReturnType<typeof safeHelpInfo>;

/** Always construct a new whitelist; never serialize API, cache, Error or browser objects. */
export function diagnosticReport(input: { connection: unknown; info: unknown; shell: unknown; preferences: unknown; leaseExpiresAt: unknown; webRevision: unknown; cached: unknown }) {
  const shell = record(input.shell), prefs = record(input.preferences), info = safeHelpInfo(input.info);
  const lease = number(input.leaseExpiresAt);
  return JSON.stringify({ schema: 1, app: "chat-reader", generated_at: new Date().toISOString(),
    web_revision: buildRevision(input.webRevision), api: info.app,
    connection: choice(input.connection, ["online", "offline", "unavailable", "checking"]),
    capabilities_source: input.cached === true ? "last_known" : "current", capabilities_checked_at: info.checked_at, capabilities: info.capabilities,
    offline: { shell: choice(shell.availability, ["ready", "unknown", "unavailable", "unsupported"]), update: choice(shell.updatePhase, ["idle", "checking", "preparing", "failed"]),
      resource_count: number(shell.resourceCount), missing_resource_count: Array.isArray(shell.missing) ? shell.missing.length : null,
      lease: lease === null ? "unavailable" : lease > Date.now() ? "valid" : "expired", lease_remaining_minutes: lease === null ? null : Math.max(0, Math.floor((lease - Date.now()) / 60_000)) },
    display: { locale: choice(prefs.resolvedLocale, ["zh-CN", "en-US"]), theme: choice(prefs.themeMode, ["light", "dark", "system"]),
      density: choice(prefs.readerDensityMode, ["compact", "comfortable", "large"]), width: choice(prefs.readerWidthMode, ["compact", "standard", "wide"]), font_size: number(prefs.readerFontSizePx) },
  }, null, 2);
}
