"use client";

import Link from "next/link";
import { BookOpenText } from "lucide-react";
import { usePreferences } from "../../components/preferences-provider";

export function AuthPageShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { resolvedLocale } = usePreferences();
  const homeLabel = resolvedLocale === "zh-CN" ? "Chat Reader 首页" : "Chat Reader home";

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-page px-4 py-8 sm:px-6">
      <section className="w-full max-w-[25rem]" aria-labelledby="auth-page-title">
        <Link href="/login" aria-label={homeLabel} className="mx-auto flex w-fit items-center gap-2.5 rounded-md text-primary">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-xs font-bold text-white" aria-hidden="true">CR</span>
          <span className="text-sm font-semibold">Chat Reader</span>
        </Link>
        <div className="mt-6 rounded-xl border border-ui bg-surface px-5 py-6 shadow-sm sm:px-7 sm:py-7">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-accent" aria-hidden="true">
              <BookOpenText className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h1 id="auth-page-title" className="text-xl font-semibold leading-tight text-primary">{title}</h1>
              <p className="mt-1.5 text-sm leading-5 text-secondary">{description}</p>
            </div>
          </div>
          <div className="mt-6">{children}</div>
        </div>
        {footer ? <div className="mt-4 text-center text-sm text-secondary">{footer}</div> : null}
      </section>
    </main>
  );
}
