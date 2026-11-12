import { Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownLanguage } from "@codemirror/lang-markdown";

export type AttachmentDraft = { token: string; displayName: string; image: boolean };
export type AttachmentDraftState = AttachmentDraft & {
  status: "uploading" | "canonicalizing" | "ready" | "error" | "removed";
  progress: number;
  itemId?: string;
  error?: string;
  recoveryAction?: "replace_source";
};

export type TransientUploadReference = {
  lineNumber: number;
  token: string;
  from: number;
  to: number;
  labelFrom: number | null;
  labelTo: number | null;
  image: boolean;
  nodeFrom: number;
  nodeTo: number;
};

export type PendingMarkerReplacement = "replaced" | "missing" | "duplicate";
export type PendingMarkerRemoval = "removed" | "missing" | "duplicate";
export type AttachmentReferenceTarget = { identifier: string; from: number; to: number; original: string };
export type SourceAttachmentInsertion = {
  referenceUri: string; displayName: string; image: boolean; placement: "inline" | "after_message";
  replace?: AttachmentReferenceTarget & { scope: "one" | "all"; remove?: boolean };
};
export type MarkdownAttachmentReference = {
  lineNumber: number;
  identifier: string;
  from: number;
  to: number;
  labelFrom: number | null;
  labelTo: number | null;
  image: boolean;
  nodeFrom: number;
  nodeTo: number;
};
export type AttachmentDraftCallbacks = {
  onProgress: (token: string, progress: number) => void;
  onComplete: (token: string, item: { id: string; attachmentId?: string }) => void;
  onError: (token: string, message: string, recoveryAction?: "replace_source") => void;
};

export function sourceAttachmentDropExtension(
  handlers: {
    onFiles: (files: File[], position: number, originalCodePosition?: number) => void;
    onAttachment?: (attachment: { attachmentId: string; displayName: string; mimeType: string }, position: number, originalCodePosition?: number) => void;
  },
) {
  const hasFiles = (event: DragEvent | ClipboardEvent) => {
    if ("dataTransfer" in event) return Boolean(event.dataTransfer?.files?.length);
    return Boolean(event.clipboardData?.files?.length);
  };
  return EditorView.domEventHandlers({
    dragover(event, view) {
      const custom = event.dataTransfer?.getData("application/x-chat-reader-attachment");
      if (!hasFiles(event) && !custom) return false;
      event.preventDefault();
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (position !== null) {
        view.dispatch({ selection: { anchor: resolveAttachmentDropPosition(view.state.doc.toString(), position).position } });
        view.dom.classList.add("cr-attachment-dragover");
      }
      return true;
    },
    dragleave(_event, view) {
      view.dom.classList.remove("cr-attachment-dragover");
      return false;
    },
    drop(event, view) {
      const customRaw = event.dataTransfer?.getData("application/x-chat-reader-attachment");
      if (!hasFiles(event) && !customRaw) return false;
      event.preventDefault();
      view.dom.classList.remove("cr-attachment-dragover");
      const original = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
      const resolved = resolveAttachmentDropPosition(view.state.doc.toString(), original);
      if (customRaw && handlers.onAttachment) {
        try {
          const attachment = JSON.parse(customRaw) as { attachmentId?: string; displayName?: string; mimeType?: string };
          if (attachment.attachmentId && attachment.displayName && attachment.mimeType) {
            handlers.onAttachment({ attachmentId: attachment.attachmentId, displayName: attachment.displayName, mimeType: attachment.mimeType }, resolved.position, resolved.adjustedFromCode ? original : undefined);
            return true;
          }
        } catch {
          return false;
        }
      }
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) handlers.onFiles(files, resolved.position, resolved.adjustedFromCode ? original : undefined);
      return true;
    },
    paste(event, view) {
      if (!hasFiles(event)) return false;
      event.preventDefault();
      const files = Array.from(event.clipboardData?.files ?? []);
      const original = view.state.selection.main.head;
      const resolved = resolveAttachmentDropPosition(view.state.doc.toString(), original);
      if (files.length) handlers.onFiles(files, resolved.position, resolved.adjustedFromCode ? original : undefined);
      return true;
    },
  });
}

export function resolveAttachmentDropPosition(text: string, position: number): { position: number; adjustedFromCode: boolean } {
  const bounded = Math.max(0, Math.min(position, text.length));
  const lineStart = text.lastIndexOf("\n", bounded - 1) + 1;
  const lineEndIndex = text.indexOf("\n", bounded);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  const line = text.slice(lineStart, lineEnd);
  const link = /!?\[[^\]]*\]\([^)]*\)/g;
  let linkPosition: number | null = null;
  let match: RegExpExecArray | null;
  while ((match = link.exec(line))) {
    const from = lineStart + match.index;
    const to = from + match[0].length;
    if (bounded > from && bounded < to) linkPosition = to;
  }

  const lines = text.split("\n");
  let offset = 0;
  let fence: { character: string; length: number } | null = null;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const current = lines[lineIndex];
    const trimmed = current.trim();
    const opening = /^(?:`{3,}|~{3,})/.exec(trimmed);
    if (!fence && opening?.[0]) {
      fence = { character: opening[0][0], length: opening[0].length };
    } else if (fence && isClosingFence(trimmed, fence)) {
      fence = null;
    }
    const currentEnd = offset + current.length;
    if (bounded >= offset && bounded <= currentEnd && fence) {
      let scanOffset = offset + current.length + (offset + current.length < text.length ? 1 : 0);
      for (let index = lineIndex + 1; index < lines.length; index += 1) {
        const candidate = lines[index].trim();
        if (isClosingFence(candidate, fence)) return { position: scanOffset + lines[index].length, adjustedFromCode: true };
        scanOffset += lines[index].length + 1;
      }
      return { position: text.length, adjustedFromCode: true };
    }
    offset = currentEnd + 1;
  }
  if (linkPosition !== null) return { position: linkPosition, adjustedFromCode: false };
  return { position: bounded, adjustedFromCode: false };
}

export function insertPendingMarkers(view: EditorView, drafts: AttachmentDraft[], position: number, uploadingLabel = "Uploading"): void {
  const value = drafts.map((draft) => `${draft.image ? "!" : ""}[${escapeMarkdownLabel(`${uploadingLabel}: ${draft.displayName}`)}](cr-upload://${draft.token})`).join("\n\n");
  const line = view.state.doc.lineAt(position);
  const before = position > line.from && view.state.doc.sliceString(position - 1, position) !== "\n" ? "\n\n" : "";
  const after = position < line.to && view.state.doc.sliceString(position, position + 1) !== "\n" ? "\n\n" : "";
  const insert = `${before}${value}${after}`;
  const anchor = position + insert.length;
  view.dispatch({ changes: { from: position, insert }, selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
}

export function replacePendingMarker(view: EditorView, token: string, attachmentId: string): PendingMarkerReplacement {
  const source = view.state.doc.toString();
  const references = findTransientUploadReferences(source).filter((reference) => reference.token === token);
  if (!references.length) return "missing";
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  const destinations = new Set<number>();
  for (const reference of references) {
  if (!destinations.has(reference.from)) {
    changes.push({ from: reference.from, to: reference.to, insert: `cr-asset://${attachmentId}` });
    destinations.add(reference.from);
  }
  for (const [label, replacement] of [
    ["正在上传：", reference.image ? "" : "附件："],
    ["正在上传: ", reference.image ? "" : "附件："],
    ["Uploading: ", reference.image ? "" : "Attachment: "],
  ] as const) {
    if (reference.labelFrom !== null && reference.labelTo !== null
      && source.slice(reference.labelFrom, reference.labelTo).startsWith(label)) {
      changes.push({ from: reference.labelFrom, to: reference.labelFrom + label.length, insert: replacement });
      break;
    }
  }
  }
  view.dispatch({
    changes: changes.sort((left, right) => left.from - right.from),
    annotations: Transaction.addToHistory.of(false),
  });
  return "replaced";
}

export function findTransientUploadReferences(source: string): TransientUploadReference[] {
  return findMarkdownAttachmentReferences(source, "cr-upload").map((reference) => ({
    lineNumber: reference.lineNumber,
    token: reference.identifier,
    from: reference.from,
    to: reference.to,
    labelFrom: reference.labelFrom,
    labelTo: reference.labelTo,
    image: reference.image,
    nodeFrom: reference.nodeFrom,
    nodeTo: reference.nodeTo,
  }));
}

let cachedReferenceSource: string | null = null;
const cachedReferences = new Map<string, MarkdownAttachmentReference[]>();
export function findMarkdownAttachmentReferences(source: string, scheme: "cr-upload" | "cr-asset"): MarkdownAttachmentReference[] {
  // Most editor documents have no attachment URIs. Cursor motion must not
  // parse a large formula/table document solely to decide picker affordances.
  if (!source.toLowerCase().includes(`${scheme}://`)) return [];
  if (cachedReferenceSource !== source) {
    cachedReferenceSource = source;
    cachedReferences.clear();
  }
  const cached = cachedReferences.get(scheme);
  if (cached) return cached;
  const references: MarkdownAttachmentReference[] = [];
  const newlines = Array.from(source.matchAll(/\n/g), match => match.index);
  const lineAt = (position: number) => {
    let low = 0, high = newlines.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (newlines[middle] < position) low = middle + 1; else high = middle;
    }
    return low + 1;
  };
  const tree = markdownLanguage.parser.parse(source);
  // Lezer ends generic HTML blocks at blank lines; GFM keeps these raw-text
  // tags literal until their closing tag. Start only at a parsed HTML block,
  // never at an example inside a code node.
  const literals: Array<{ from: number; to: number }> = [];
  tree.iterate({ enter(node) {
    if (node.name !== "HTMLBlock") return;
    const tag = /^<(textarea|script|style|pre)(?:\s|>)/i.exec(source.slice(node.from, node.to))?.[1];
    if (!tag) return;
    const ending = new RegExp(`</${tag}\\s*>`, "ig");
    ending.lastIndex = node.to;
    const close = ending.exec(source);
    literals.push({ from: node.from, to: close ? close.index + close[0].length : source.length });
  } });
  const literal = (position: number) => literals.some(range => position >= range.from && position < range.to);
  const key = (label: string) => label.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, "$1").trim().replace(/\s+/g, " ").toLowerCase();
  const definitions = new Map<string, { from: number; to: number }>();
  tree.iterate({ enter(node) {
    if (node.name !== "LinkReference") return;
    if (literal(node.from)) return;
    const label = node.node.getChild("LinkLabel");
    const url = node.node.getChild("URL");
    if (label && url) {
      const id = key(source.slice(label.from + 1, label.to - 1));
      if (!definitions.has(id)) definitions.set(id, { from: url.from, to: url.to });
    }
  } });
  tree.iterate({ enter(node) {
    if (node.name !== "Link" && node.name !== "Image") return;
    if (literal(node.from)) return;
    const marks = node.node.getChildren("LinkMark");
    const labelFrom = marks[0]?.to ?? null;
    const labelTo = marks[1]?.from ?? null;
    const reference = node.node.getChild("LinkLabel");
    const lookup = reference ? source.slice(reference.from + 1, reference.to - 1) : "";
    const url = node.node.getChild("URL")
      ?? definitions.get(key(lookup || (labelFrom !== null && labelTo !== null ? source.slice(labelFrom, labelTo) : "")));
    if (!url) return;
    const from = source[url.from] === "<" ? url.from + 1 : url.from;
    const to = source[url.to - 1] === ">" ? url.to - 1 : url.to;
    const destination = source.slice(from, to);
    if (!destination.toLowerCase().startsWith(`${scheme}://`)) return;
    references.push({
      identifier: destination.slice(scheme.length + 3), from, to, labelFrom, labelTo,
      image: node.name === "Image", nodeFrom: node.from, nodeTo: node.to,
      lineNumber: lineAt(node.from),
    });
  } });
  cachedReferences.set(scheme, references);
  return references;
}

export function hasTransientUploadReference(source: string): boolean {
  return findTransientUploadReferences(source).length > 0;
}

function escapeMarkdownLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

export function removePendingMarker(view: EditorView | null, token: string, attachmentId?: string): PendingMarkerRemoval {
  if (!view) return "missing";
  const source = view.state.doc.toString();
  const transient = findTransientUploadReferences(source).filter((reference) => reference.token === token);
  const canonical = transient.length || !attachmentId
    ? []
    : findMarkdownAttachmentReferences(source, "cr-asset").filter((reference) => reference.identifier === attachmentId);
  const references = transient.length ? transient : canonical;
  if (!references.length) return "missing";
  const cursor = view.state.selection.main.head;
  const reference = references.reduce((nearest, ref) =>
    Math.abs(ref.nodeFrom - cursor) < Math.abs(nearest.nodeFrom - cursor) ? ref : nearest);
  view.dispatch({
    changes: { from: reference.nodeFrom, to: reference.nodeTo, insert: "" },
    annotations: Transaction.userEvent.of("delete"),
  });
  return "removed";
}

export function changeAttachmentReference(
  view: EditorView, target: AttachmentReferenceTarget, uri: string, scope: "one" | "all", remove = false,
): boolean {
  const source = view.state.doc.toString();
  if (source.slice(target.from, target.to) !== target.original) return false;
  const refs = findMarkdownAttachmentReferences(source, "cr-asset");
  const selected = refs.find(ref => ref.nodeFrom === target.from && ref.nodeTo === target.to && ref.identifier === target.identifier);
  if (!selected || (!remove && !/^cr-asset:\/\/[a-f0-9-]{36}$/i.test(uri))) return false;
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  const seen = new Set<number>();
  for (const ref of scope === "all" && !remove ? refs.filter(ref => ref.identifier === target.identifier) : [selected]) {
    if (remove) changes.push({ from: ref.nodeFrom, to: ref.nodeTo, insert: "" });
    else if (scope === "one" && (ref.from < ref.nodeFrom || ref.to > ref.nodeTo)) {
      // Editing a shared definition would replace other occurrences too.
      // Convert only this use to an ordinary inline Markdown destination.
      if (ref.labelFrom === null || ref.labelTo === null) return false;
      changes.push({ from: ref.nodeFrom, to: ref.nodeTo,
        insert: `${ref.image ? "!" : ""}[${source.slice(ref.labelFrom, ref.labelTo)}](${uri})` });
    } else if (!seen.has(ref.from)) {
      changes.push({ from: ref.from, to: ref.to, insert: uri });
      seen.add(ref.from);
    }
  }
  view.dispatch({ changes: changes.sort((a, b) => a.from - b.from), annotations: Transaction.userEvent.of("input") });
  return true;
}

function isClosingFence(line: string, fence: { character: string; length: number }): boolean {
  if (!line.startsWith(fence.character)) return false;
  const count = line.match(new RegExp(`^${fence.character}+`))?.[0].length ?? 0;
  return count >= fence.length && line.slice(count).trim() === "";
}
