import type { ResolvedLocale } from "./types";

export function formatActivityTime(value: string | null | undefined, locale: ResolvedLocale, now = new Date()): string {
  if (!value) return locale === "zh-CN" ? "尚未阅读" : "Not read yet";
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

export function fullActivityTime(value: string | null | undefined, locale: ResolvedLocale): string {
  if (!value) return locale === "zh-CN" ? "尚未阅读" : "Not read yet";
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "medium" }).format(new Date(value));
}

function isSameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}
