"use client";
import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePreferences } from "./preferences-provider";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), { ssr: false });
export function SupportMarkdown({ text }: { text: string }) {
  // Preview never fetches user-provided images or conversation attachments.
  return <div className="reader-prose max-w-none break-words text-sm text-primary [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_a]:text-accent"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span>[{alt || "image"}]</span>, a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{text}</ReactMarkdown></div>;
}
export function SupportMessageContent({ text }: { text: string }) {
  const { resolvedLocale } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const marker = "\n\n---\n\n```json\n", start = text.lastIndexOf(marker);
  let report: string | null = null;
  if (start >= 0 && text.endsWith("\n```")) {
    const candidate = text.slice(start + marker.length, -4);
    try { const value = JSON.parse(candidate); if (value?.schema === 1 && value?.app === "chat-reader") report = candidate; } catch { /* Ordinary Markdown remains ordinary content. */ }
  }
  return <><SupportMarkdown text={report ? text.slice(0, start) : text} />{report ? <details><summary className="min-h-11 cursor-pointer py-3 text-xs text-secondary">{zh ? "查看附加诊断" : "View attached diagnostics"}</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-ui p-3 text-xs">{report}</pre></details> : null}</>;
}
export function SupportMarkdownEditor({ value, onChange, disabled }: { value: string; onChange: (text: string) => void; disabled: boolean }) {
  const { resolvedLocale, resolvedTheme } = usePreferences(), zh = resolvedLocale === "zh-CN";
  const [preview, setPreview] = useState(false), view = useRef<EditorView | null>(null);
  const extensions = useMemo(() => [markdown(), EditorView.lineWrapping, EditorView.contentAttributes.of({ "aria-label": zh ? "请求内容" : "Request body" }), EditorView.theme({ "&": { backgroundColor: "var(--surface)", color: "var(--text)", fontSize: "14px" }, ".cm-content": { minHeight: "180px", fontFamily: "inherit" }, ".cm-scroller": { overflowX: "hidden" }, ".cm-gutters": { display: "none" }, ".cm-cursor": { borderLeftColor: "var(--text)" } }, { dark: resolvedTheme === "dark" })], [zh, resolvedTheme]);
  return <div className="overflow-hidden rounded-lg border border-ui bg-surface">
    <div className="flex flex-wrap items-center justify-between border-b border-ui px-2">
      <div className="flex" role="group" aria-label={zh ? "编辑方式" : "Editor mode"}>{[false, true].map(mode => <button type="button" key={String(mode)} aria-pressed={preview === mode} onClick={() => setPreview(mode)} className={`min-h-11 px-3 text-sm ${preview === mode ? "font-semibold text-accent" : "text-secondary"}`}>{mode ? (zh ? "预览" : "Preview") : (zh ? "编写" : "Write")}</button>)}</div>
      {!preview ? <div className="flex"><button type="button" disabled={disabled} className="btn-ghost min-h-11 px-3 text-xs" onClick={() => { if (view.current) { undo(view.current); view.current.focus(); } }}>{zh ? "撤销" : "Undo"}</button><button type="button" disabled={disabled} className="btn-ghost min-h-11 px-3 text-xs" onClick={() => { if (view.current) { redo(view.current); view.current.focus(); } }}>{zh ? "重做" : "Redo"}</button></div> : null}
    </div>
    <div hidden={preview}><CodeMirror value={value} onChange={onChange} editable={!disabled} extensions={extensions} theme="none" basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false }} onCreateEditor={editor => { view.current = editor; }} /></div>
    {preview ? <div className="min-h-44 p-3"><SupportMarkdown text={value || (zh ? "暂无内容" : "Nothing to preview")} /></div> : null}
  </div>;
}
