import type { ResolvedLocale } from "./types";

export function sortTimeLabel(mode: string, locale: ResolvedLocale, importedFallback = false): string {
  const labels: Record<string, [string, string]> = {
    content_updated: importedFallback ? ["内容更新（回退到导入时间）", "Content updated (import time fallback)"] : ["内容更新", "Content updated"],
    imported: ["导入", "Imported"], created: ["创建", "Created"], updated: ["资料修改", "Metadata modified"], recent_read: ["最近阅读", "Last read"],
  };
  return labels[mode]?.[locale === "zh-CN" ? 0 : 1] ?? "";
}

export function formatActivityTime(value: string | null | undefined, locale: ResolvedLocale, now = new Date(), mode = "recent_read"): string {
  if (!value) return missingActivityTime(locale, mode);
  const date = new Date(value);
  const diff = Math.max(0, now.getTime() - date.getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return locale === "zh-CN" ? "刚刚" : "Just now";
  if (isSameDay(date, now)) {
    if (minutes < 60) return locale === "zh-CN" ? `${minutes} 分钟前` : `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return locale === "zh-CN" ? `${hours} 小时前` : `${hours} hr ago`;
  }
  if (diff < 7 * 86_400_000) {
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
  }
  if (date.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
  }
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export function fullActivityTime(value: string | null | undefined, locale: ResolvedLocale, mode = "recent_read"): string {
  if (!value) return missingActivityTime(locale, mode);
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "medium" }).format(new Date(value));
}

function missingActivityTime(locale: ResolvedLocale, mode: string): string {
  if (mode === "recent_read") return locale === "zh-CN" ? "尚未阅读" : "Not read yet";
  return locale === "zh-CN" ? "未记录" : "Not recorded";
}

function isSameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}
