"use client";

import { useEffect, useState } from "react";
import { getHealth, type HealthResponse } from "../lib/api";

type HealthState =
  | { label: "not checked"; detail: "ready placeholder" }
  | { label: "ok"; detail: string }
  | { label: "unavailable"; detail: string };

export function AppShell() {
  const [health, setHealth] = useState<HealthState>({
    label: "not checked",
    detail: "ready placeholder",
  });

  useEffect(() => {
    let active = true;

    getHealth()
      .then((result: HealthResponse) => {
        if (!active) {
          return;
        }

        setHealth({
          label: result.status,
          detail: `${result.service} / ${result.stage}`,
        });
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setHealth({
          label: "unavailable",
          detail: error instanceof Error ? error.message : "health check failed",
        });
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="min-h-screen px-6 py-10 sm:px-10">
      <section className="mx-auto flex max-w-3xl flex-col gap-8">
        <div className="space-y-3">
          <p className="text-sm font-medium uppercase tracking-normal text-slate-500">
            Stage 00: Foundation
          </p>
          <h1 className="text-4xl font-semibold tracking-normal text-slate-950">
            chat-reader
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-slate-700">
            ChatGPT export archive reader foundation
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">API health</p>
              <p className="text-xl font-semibold text-slate-950">{health.label}</p>
            </div>
            <p className="text-sm text-slate-600">{health.detail}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
