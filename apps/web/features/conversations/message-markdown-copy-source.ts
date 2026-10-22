import type { MessageMarkdownCopyPlan } from "../../lib/api";

type Node = {
  type?: string; url?: string; identifier?: string; alt?: string; value?: string; title?: string | null;
  children?: Node[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
};
type Edit = { start: number; end: number; attachmentId: string | null; label: string; title?: string | null };
const IMAGE_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp",
  "image/x-icon", "image/vnd.microsoft.icon", "image/svg+xml",
]);
const assetUri = /^cr-asset:\/\/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})(?:[?#].*)?$/i;
const escapeLabel = (text: string) => text.replace(/\\/g, "\\\\").replace(/[[\]|]/g, "\\$&").replace(/[\r\n]/g, " ");

/** Source-position edits leave all unrelated Markdown, whitespace and code intact.
 * The installed ReactMarkdown parser owns syntax; this is only an AST consumer. */
export function createMessageCopyProbe(plan: MessageMarkdownCopyPlan) {
  if (plan.markdown.length > 4 * 1024 * 1024 || new TextEncoder().encode(plan.markdown).length > 4 * 1024 * 1024) {
    throw new Error("COPY_TOO_LARGE");
  }
  const attachments = new Map(plan.attachments.map(item => [item.id.toLowerCase(), item]));
  let edits: Edit[] | null = null;
  return {
    plugin: () => (tree: Node) => {
      const nodes: Node[] = [], pending = [tree], definitions = new Map<string, Node>();
      while (pending.length) {
        const node = pending.pop()!;
        if (nodes.length >= 100_000) throw new Error("COPY_TOO_LARGE");
        nodes.push(node);
        if (node.type === "definition" && node.identifier) definitions.set(node.identifier.toUpperCase(), node);
        // Code/HTML/math are literal, never a reason to publish an attachment.
        if (!["code", "inlineCode", "html", "math", "inlineMath"].includes(node.type ?? "")) {
          const children = node.children ?? [];
          if (nodes.length + pending.length + children.length > 100_000) throw new Error("COPY_TOO_LARGE");
          for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
        }
      }
      const output: Edit[] = [];
      let coveredEnd = -1;
      const edit = (node: Node, url: string, label: string, title?: string | null) => {
        const match = assetUri.exec(url);
        if (!match) return false;
        const start = node.position?.start?.offset, end = node.position?.end?.offset;
        if (start === undefined || end === undefined || start < 0 || end > plan.markdown.length || start >= end) {
          throw new Error("COPY_SOURCE_UNAVAILABLE");
        }
        if (start < coveredEnd) return true;
        const id = match[1].toLowerCase(), attachment = attachments.get(id);
        if (!attachment && (node.type === "image" || node.type === "imageReference")) throw new Error("COPY_IMAGE_UNAVAILABLE");
        if (attachment?.mime_type?.startsWith("image/") && !IMAGE_TYPES.has(attachment.mime_type)) throw new Error("COPY_IMAGE_UNSUPPORTED");
        const image = attachment && IMAGE_TYPES.has(attachment.mime_type ?? "");
        if (image && (!attachment.available || !attachment.source_sha256)) throw new Error("COPY_IMAGE_UNAVAILABLE");
        output.push({ start, end, attachmentId: image ? id : null, label, title });
        coveredEnd = end;
        return true;
      };
      for (const node of nodes) {
        if (node.type === "image" || node.type === "link") {
          edit(node, node.url ?? "", node.alt ?? text(node), node.title);
        } else if (node.type === "imageReference" || node.type === "linkReference") {
          const definition = definitions.get((node.identifier ?? "").toUpperCase());
          if (definition) edit(node, definition.url ?? "", node.alt ?? text(node), definition.title);
        } else if (node.type === "definition" && assetUri.test(node.url ?? "")) {
          const start = node.position?.start?.offset, end = node.position?.end?.offset;
          if (start !== undefined && end !== undefined) output.push({ start, end, attachmentId: null, label: "" });
        }
      }
      edits = output.sort((a, b) => a.start - b.start);
      tree.children = []; // No preview, KaTeX or attachment DOM is ever mounted.
    },
    result() {
      if (edits === null) throw new Error("COPY_SOURCE_UNAVAILABLE");
      const saved = edits;
      const imageIds = Array.from(new Set(saved.flatMap(edit => edit.attachmentId ? [edit.attachmentId] : [])));
      if (imageIds.length > 100) throw new Error("COPY_TOO_MANY_IMAGES");
      return {
        imageIds,
        omittedFiles: saved.filter(edit => !edit.attachmentId && edit.label).length,
        render(urls: Record<string, string>, origin: string) {
          const parts: string[] = [];
          let cursor = 0;
          for (const change of saved) {
            if (change.start < cursor) throw new Error("COPY_SOURCE_UNAVAILABLE");
            parts.push(plan.markdown.slice(cursor, change.start));
            if (change.attachmentId) {
              const path = urls[change.attachmentId];
              if (!path || !/^\/api\/public-images\/[A-Za-z0-9_-]{43}$/.test(path)) throw new Error("COPY_IMAGE_UNAVAILABLE");
              const title = change.title == null ? "" : ` "${change.title.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ")}"`;
              parts.push(`![${escapeLabel(change.label)}](${new URL(path, origin).href}${title})`);
            }
            cursor = change.end;
          }
          parts.push(plan.markdown.slice(cursor));
          return parts.join("");
        },
      };
    },
  };
}

function text(node: Node): string {
  return node.value ?? node.children?.map(text).join("") ?? "";
}
