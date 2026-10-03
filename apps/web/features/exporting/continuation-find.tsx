"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

type HighlightWindow = Window & { Highlight?: new (...ranges: Range[]) => unknown };
type HighlightCss = typeof CSS & { highlights?: { set: (name: string, value: unknown) => void; delete: (name: string) => void } };

function findRanges(root: HTMLElement, query: string): Range[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest('script, style, button, [aria-hidden="true"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: { node: Node; start: number; end: number }[] = [];
  const chunks: string[] = [];
  let length = 0, node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent ?? "";
    if (!text) continue;
    nodes.push({ node, start: length, end: length + text.length }); chunks.push(text); length += text.length;
  }
  const text = chunks.join("");
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const result: Range[] = [];
  let startNode = 0, endNode = 0;
  for (const match of text.matchAll(expression)) {
    if (result.length === 501) break;
    const start = match.index, end = start + match[0].length;
    while (nodes[startNode]?.end <= start) startNode++;
    while (nodes[endNode]?.end < end) endNode++;
    if (!nodes[startNode] || !nodes[endNode]) break;
    const range = document.createRange();
    range.setStart(nodes[startNode].node, start - nodes[startNode].start);
    range.setEnd(nodes[endNode].node, end - nodes[endNode].start);
    result.push(range);
  }
  return result;
}

export function ContinuationFind({ children, zh, contentKey }: { children: ReactNode; zh: boolean; contentKey: string }) {
  const content = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [ranges, setRanges] = useState<Range[]>([]);
  const [index, setIndex] = useState(0);
  const name = `continuation-find-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  useEffect(() => {
    const root = content.current;
    if (!root) return;
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { setRanges(open && query.trim() ? findRanges(root, query.trim()) : []); setIndex(0); }, 120);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [open, query, contentKey]);
  useEffect(() => {
    const registry = (CSS as HighlightCss).highlights;
    const Highlight = (window as HighlightWindow).Highlight;
    if (registry && Highlight) registry.set(name, new Highlight(...ranges.slice(0, 500)));
    return () => { registry?.delete(name); };
  }, [ranges, name]);
  useEffect(() => {
    const range = ranges[index];
    if (!range?.startContainer.isConnected) return;
    let parent = range.startContainer.parentElement;
    while (parent && parent !== content.current) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      parent = parent.parentElement;
    }
    const registry = (CSS as HighlightCss).highlights;
    const Highlight = (window as HighlightWindow).Highlight;
    if (registry && Highlight) registry.set(`${name}-active`, new Highlight(range));
    const root = content.current?.closest<HTMLElement>("[data-continuation-scroll]");
    if (root) root.scrollTop += range.getBoundingClientRect().top - root.getBoundingClientRect().top - 150;
    return () => { registry?.delete(`${name}-active`); };
  }, [ranges, index, name]);
  const next = (step: number) => setIndex(value => (value + step + Math.min(ranges.length, 500)) % Math.max(1, Math.min(ranges.length, 500)));
  return <div className="min-w-0" onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") { event.preventDefault(); setOpen(true); requestAnimationFrame(() => input.current?.focus()); }
  }}>
    <style>{`::highlight(${name}) { background-color: color-mix(in srgb, var(--accent) 25%, transparent); }
      ::highlight(${name}-active) { background-color: var(--accent); color: var(--surface); }`}</style>
    <div className="sticky top-12 z-[9] mb-4 bg-page py-1">
      {open ? <div className="flex flex-wrap items-center gap-1 rounded-md border border-ui bg-surface px-2">
        <input ref={input} autoFocus type="search" aria-label={zh ? "查找文件内容" : "Find in file"} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); next(event.shiftKey ? -1 : 1); }
          if (event.key === "Escape") { event.stopPropagation(); setOpen(false); setQuery(""); }
        }} className="min-h-11 min-w-0 flex-1 bg-transparent px-1 text-base outline-none focus:ring-2 focus:ring-[var(--focus)]" />
        <span role="status" className="text-xs text-secondary">{query.trim() ? ranges.length ? `${index + 1}/${Math.min(500, ranges.length)}${ranges.length > 500 ? "+" : ""}` : (zh ? "无匹配" : "No matches") : ""}</span>
        <button disabled={!ranges.length} className="flex h-11 w-9 items-center justify-center rounded-md hover:bg-subtle disabled:opacity-40" aria-label={zh ? "上一个匹配" : "Previous match"} onClick={() => next(-1)}><ChevronUp className="h-4 w-4" /></button>
        <button disabled={!ranges.length} className="flex h-11 w-9 items-center justify-center rounded-md hover:bg-subtle disabled:opacity-40" aria-label={zh ? "下一个匹配" : "Next match"} onClick={() => next(1)}><ChevronDown className="h-4 w-4" /></button>
        <button className="flex h-11 w-9 items-center justify-center rounded-md hover:bg-subtle" aria-label={zh ? "关闭查找" : "Close find"} onClick={() => { setOpen(false); setQuery(""); }}><X className="h-4 w-4" /></button>
      </div> : <button className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-secondary hover:bg-subtle" onClick={() => setOpen(true)}><Search className="h-4 w-4" />{zh ? "查找" : "Find"}</button>}
    </div>
    <div ref={content}>{children}</div>
  </div>;
}
