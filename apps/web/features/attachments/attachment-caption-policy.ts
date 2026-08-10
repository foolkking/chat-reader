export function normalizeVisibleCaption(caption: string | undefined, displayName: string): string | undefined {
  const trimmed = caption?.trim();
  if (!trimmed) return undefined;
  const legacyLabel = trimmed.replace(/^(?:Attachment|附件)\s*[:：]\s*/i, "").trim();
  return legacyLabel.localeCompare(displayName.trim(), undefined, { sensitivity: "accent" }) === 0 ? undefined : trimmed;
}
