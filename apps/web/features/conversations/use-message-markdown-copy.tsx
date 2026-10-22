"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, LoaderCircle, X } from "lucide-react";
import { ApiRequestError, getMessageMarkdownCopyPlan, publishMessageCopyImages, uploadMessageCopyPreview } from "../../lib/api";
import { AUTH_GENERATION_CHANGED_EVENT, authenticationGeneration } from "../../lib/offline-access";
import { useClipboardCopy } from "../../components/use-clipboard-copy";
import { analyseMessageCopy, rasterizeCopySvg } from "./message-markdown-copy-prepare";

type Result = { scope: string; phase: "preparing" | "ready" | "error"; markdown?: string; error?: string; images?: number; omitted?: number };

export function useMessageMarkdownCopy(messageId: string, versionId: string | undefined, enabled: boolean, zh: boolean) {
  const [generation, setGeneration] = useState(authenticationGeneration);
  const scope = `${messageId}:${versionId}:${enabled}:${generation}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const alive = useRef(false), active = useRef<AbortController | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const shown = result?.scope === scope ? result : null;
  const clipboard = useClipboardCopy(shown?.markdown ?? "");
  useEffect(() => {
    alive.current = true;
    const retire = () => {
      active.current?.abort(); active.current = null;
      setResult(null); setAutomaticCopy(null); setGeneration(authenticationGeneration());
    };
    window.addEventListener(AUTH_GENERATION_CHANGED_EVENT, retire);
    return () => {
      alive.current = false; active.current?.abort(); active.current = null;
      window.removeEventListener(AUTH_GENERATION_CHANGED_EVENT, retire);
    };
  }, []);
  useEffect(() => {
    active.current?.abort(); active.current = null;
  }, [scope]);

  async function prepare() {
    if (!enabled || !versionId || active.current || generation !== authenticationGeneration()) return;
    const controller = new AbortController(), requestGeneration = authenticationGeneration();
    active.current = controller;
    const isCurrent = () => alive.current && !controller.signal.aborted && currentScope.current === scope && requestGeneration === authenticationGeneration();
    setResult({ scope, phase: "preparing" });
    try {
      const plan = await getMessageMarkdownCopyPlan(messageId, controller.signal);
      if (!isCurrent()) return;
      if (plan.version_id !== versionId) throw new Error("COPY_VERSION_CHANGED");
      const source = await analyseMessageCopy(plan);
      if (!isCurrent()) return;
      for (const id of source.imageIds) {
        const attachment = plan.attachments.find(item => item.id === id)!;
        if (attachment.mime_type !== "image/svg+xml") continue;
        const png = await rasterizeCopySvg(attachment.content_url, controller.signal);
        if (!isCurrent()) return;
        await uploadMessageCopyPreview(id, attachment.source_sha256!, png, controller.signal);
        if (!isCurrent()) return;
      }
      const { urls } = await publishMessageCopyImages(messageId, versionId, source.imageIds, controller.signal);
      if (!isCurrent()) return;
      const markdown = source.render(urls, window.location.origin);
      setAutomaticCopy({ scope, markdown, success: null });
      setResult({ scope, phase: "ready", markdown, images: source.imageIds.length, omitted: source.omittedFiles });
      // This write is fenced immediately before access to the device clipboard.
      try {
        await navigator.clipboard.writeText(markdown);
        if (isCurrent()) setAutomaticCopy({ scope, markdown, success: true });
      } catch {
        if (isCurrent()) setAutomaticCopy({ scope, markdown, success: false });
      }
    } catch (error) {
      if (isCurrent()) setResult({ scope, phase: "error", error: copyError(error, zh) });
    } finally {
      if (active.current === controller) active.current = null;
    }
  }
  const [automaticCopy, setAutomaticCopy] = useState<{ scope: string; markdown: string; success: boolean | null } | null>(null);
  const automatic = automaticCopy?.scope === scope && automaticCopy.markdown === shown?.markdown ? automaticCopy : null;
  const copied = shown?.phase === "ready" && (automatic ? automatic.success === true : clipboard.state === "copied");
  const manual = shown?.phase === "ready" && !copied && (automatic ? automatic.success === false : clipboard.state === "failed");
  const manualRef = clipboard.manualRef;
  useEffect(() => {
    if (manual) { manualRef.current?.focus({ preventScroll: true }); manualRef.current?.select(); }
  }, [manual, manualRef]);
  return {
    shown, copied, manual, manualRef, enabled: enabled && Boolean(versionId),
    busy: shown?.phase === "preparing" || shown?.phase === "ready" && (automatic ? automatic.success === null : clipboard.state === "copying"),
    run: () => {
      if (generation !== authenticationGeneration()) return;
      if (shown?.phase !== "ready") return prepare();
      // A new attempt owns feedback: an earlier successful automatic copy
      // must not mask a denied retry or a newly prepared identical source.
      setAutomaticCopy(null);
      return clipboard.copy();
    },
    dismiss: () => { active.current?.abort(); active.current = null; setResult(null); },
  };
}

type Controller = ReturnType<typeof useMessageMarkdownCopy>;

export function MessageMarkdownCopyButton({ controller, zh, onActivate }: { controller: Controller; zh: boolean; onActivate?: () => void }) {
  const title = zh ? "复制整条 Markdown（图片公开至文件删除，忽略其他附件）" : "Copy full Markdown (images public until deleted; other files omitted)";
  return <button type="button" disabled={!controller.enabled || controller.busy} onClick={() => { onActivate?.(); void controller.run(); }}
    aria-label={zh ? "复制消息为 Markdown" : "Copy message as Markdown"} title={title}
    aria-busy={controller.busy} data-testid="message-markdown-copy"
    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:opacity-40">
    {controller.busy ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : controller.copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
  </button>;
}

export function MessageMarkdownCopyFeedback({ controller, zh }: { controller: Controller; zh: boolean }) {
  const result = controller.shown;
  if (!result) return null;
  return <div className="mb-3 border-y border-ui py-2 text-sm text-secondary" data-markdown-copy-ignore="true">
    <div className="flex items-start gap-2">
      <p className="min-w-0 flex-1 py-2" role={result.phase === "error" ? "alert" : "status"}>
        {result.phase === "preparing" ? (zh ? "正在准备完整 Markdown 与图片外链…" : "Preparing full Markdown and image links…")
          : result.phase === "error" ? result.error
            : controller.manual ? (zh ? "剪贴板不可用，请从下方选择并复制。" : "Clipboard unavailable. Select and copy below.")
              : controller.copied ? (zh ? "Markdown 已复制。" : "Markdown copied.") : (zh ? "Markdown 已准备好。" : "Markdown ready.")}
        {result.phase === "ready" && Boolean(result.images) ? (zh ? " 图片链接无需登录，文件删除前一直有效。" : " Image links are public until the files are deleted.") : ""}
        {result.phase === "ready" && Boolean(result.omitted) ? (zh ? " 已忽略其他类型附件。" : " Other file attachments omitted.") : ""}
      </p>
      <button type="button" onClick={controller.dismiss} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-subtle" aria-label={zh ? "关闭复制提示" : "Dismiss copy notice"}><X className="h-4 w-4" aria-hidden /></button>
    </div>
    {controller.manual ? <label className="block">
      <span className="sr-only">{zh ? "可手动复制的完整 Markdown" : "Full Markdown for manual copy"}</span>
      <textarea ref={controller.manualRef} value={result.markdown} readOnly onFocus={event => event.currentTarget.select()}
        className="h-32 w-full rounded-md border border-ui bg-surface p-3 font-mono text-base text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] sm:text-sm" />
    </label> : null}
  </div>;
}

function copyError(error: unknown, zh: boolean): string {
  if (error instanceof ApiRequestError && error.status === 409 || error instanceof Error && error.message === "COPY_VERSION_CHANGED") {
    return zh ? "消息已更新，请刷新后重新复制。" : "The message changed. Refresh before copying.";
  }
  if (error instanceof Error && error.message === "COPY_SVG_UNSAFE") {
    return zh ? "SVG 无法在安全限制内转换，未复制。请简化图片后重试。" : "SVG could not be converted safely. Simplify it and retry; nothing was copied.";
  }
  if (error instanceof Error && error.message === "COPY_IMAGE_UNSUPPORTED") {
    return zh ? "该图片格式暂不支持笔记外链，未复制。请先转换为 PNG 或 JPEG。" : "This image format is not supported for note links. Convert it to PNG or JPEG; nothing was copied.";
  }
  if (error instanceof ApiRequestError && [401, 403, 404, 423].includes(error.status) || error instanceof Error && error.message === "COPY_IMAGE_UNAVAILABLE") {
    return zh ? "图片或消息已不可访问，请登录并刷新后重试。" : "The image or message is unavailable. Sign in and refresh before retrying.";
  }
  if (error instanceof ApiRequestError && error.status === 413 || error instanceof Error && /COPY_TOO_/.test(error.message)) {
    return zh ? "内容超出安全复制限制，请使用导出。" : "Content exceeds the safe copy limit. Use export instead.";
  }
  return zh ? "未能完成复制，请重试。已生成的图片外链仍可能有效，删除文件可使其失效。" : "Copy could not finish. Retry; any image links already created may remain public until the files are deleted.";
}
