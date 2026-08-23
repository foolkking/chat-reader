const BUILTIN_CLEANUP_RULE_LABELS: Record<string, [string, string]> = {
  "openai-private-citation-v1": ["ChatGPT 私有引用标记", "ChatGPT private citation marker"],
  "openai-private-marker-v1": ["未知私有标记（需确认）", "Unknown private marker (review)"],
  "visible-turn-citation-v1": ["导出器可见引用标记", "Visible exporter citation marker"],
  "chatgpt-exporter-footer-v1": ["ChatGPT Exporter 页脚", "ChatGPT Exporter footer"],
  "thinking-summary-v1": ["导出的思考摘要", "Exported thinking summary"],
  "manual-selection-v1": ["手动选择的内容", "Manually selected content"],
};

export function cleanupRuleLabel(name: string, detectorId: string | null, zh: boolean): string {
  const label = detectorId ? BUILTIN_CLEANUP_RULE_LABELS[detectorId] : undefined;
  return label ? label[zh ? 0 : 1] : name;
}
