import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

/** Presentation primitives shared by message bodies and the source Table tool.
 * Editing, source coordinates and pagination belong to their respective callers. */
export function MarkdownTableScroll({ children, ...attributes }: HTMLAttributes<HTMLDivElement>) {
  return <div {...attributes} className="markdown-table max-w-full overflow-x-auto rounded-lg border border-ui bg-surface">{children}</div>;
}

export function MarkdownTableContent({ children }: { children?: ReactNode }) {
  return <table className="markdown-table-content w-max min-w-full border-collapse text-[0.875em]">{children}</table>;
}

export function MarkdownTableCell({ children, header = false, editing = false, style }: {
  children?: ReactNode;
  header?: boolean;
  editing?: boolean;
  style?: CSSProperties;
}) {
  const className = `markdown-table-cell ${editing ? "border" : "border-r"} border-ui align-top last:border-r-0 ${header ? "sticky top-0 z-[1] bg-[var(--table-header)] font-semibold" : ""}`;
  const content = <div className={`markdown-table-cell-content ${editing ? "" : "px-3 py-2.5"}`}>{children}</div>;
  return header
    ? <th scope="col" style={style} className={`${className} text-left`}>{content}</th>
    : <td style={style} className={className}>{content}</td>;
}
