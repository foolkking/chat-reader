import { Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export type AttachmentDraft = { token: string; displayName: string; image: boolean };
export type AttachmentDraftState = AttachmentDraft & {
  status: "uploading" | "canonicalizing" | "ready" | "error" | "removed";
  progress: number;
  itemId?: string;
  error?: string;
};

export type TransientUploadReference = {
  lineNumber: number;
  token: string;
  from: number;
  to: number;
  labelFrom: number | null;
  labelTo: number | null;
  image: boolean;
};

export type PendingMarkerReplacement = "replaced" | "missing" | "duplicate";
export type PendingMarkerRemoval = "removed" | "missing" | "duplicate";
type MarkdownAttachmentReference = {
  lineNumber: number;
  identifier: string;
  from: number;
  to: number;
  labelFrom: number | null;
  labelTo: number | null;
  image: boolean;
};
export type AttachmentDraftCallbacks = {
  onProgress: (token: string, progress: number) => void;
  onComplete: (token: string, item: { id: string; attachmentId?: string }) => void;
  onError: (token: string, message: string) => void;
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
  if (references.length > 1) return "duplicate";
  const reference = references[0];
  const changes = [{ from: reference.from, to: reference.to, insert: `cr-asset://${attachmentId}` }];
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
  }));
}

function findMarkdownAttachmentReferences(source: string, scheme: "cr-upload" | "cr-asset"): MarkdownAttachmentReference[] {
  const references: MarkdownAttachmentReference[] = [];
  const lines = source.split("\n");
  let fence: { character: "`" | "~"; length: number } | null = null;
  let sourceOffset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const fenceRun = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (fenceRun?.[0] === fence.character && fenceRun.length >= fence.length
        && line.slice(line.indexOf(fenceRun) + fenceRun.length).trim() === "") {
        fence = null;
      }
      sourceOffset += rawLine.length + (index < lines.length - 1 ? 1 : 0);
      continue;
    }
    if (fenceRun) {
      fence = { character: fenceRun[0] as "`" | "~", length: fenceRun.length };
      sourceOffset += rawLine.length + (index < lines.length - 1 ? 1 : 0);
      continue;
    }
    if (/^(?: {4}|\t)/.test(line)) {
      sourceOffset += rawLine.length + (index < lines.length - 1 ? 1 : 0);
      continue;
    }

    const visible = maskInlineCodeSpans(line);
    const destination = scheme === "cr-upload"
      ? /\]\(\s*cr-upload:\/\/([^\s)<>'"]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gi
      : /\]\(\s*cr-asset:\/\/([^\s)<>'"]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gi;
    for (const match of visible.matchAll(destination)) {
      const identifier = match[1];
      if (!identifier || match.index === undefined) continue;
      const uri = `${scheme}://${identifier}`;
      const uriOffset = match[0].toLowerCase().indexOf(uri.toLowerCase());
      if (uriOffset < 0) continue;
      const labelTo = match.index;
      const openingBracket = visible.lastIndexOf("[", labelTo);
      references.push({
        lineNumber: index + 1,
        identifier,
        from: sourceOffset + match.index + uriOffset,
        to: sourceOffset + match.index + uriOffset + uri.length,
        labelFrom: openingBracket >= 0 ? sourceOffset + openingBracket + 1 : null,
        labelTo: openingBracket >= 0 ? sourceOffset + labelTo : null,
        image: openingBracket > 0 && visible[openingBracket - 1] === "!",
      });
    }
    sourceOffset += rawLine.length + (index < lines.length - 1 ? 1 : 0);
  }

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
  if (references.length > 1) return "duplicate";
  const line = view.state.doc.lineAt(references[0].from);
  const to = line.to < view.state.doc.length ? line.to + 1 : line.to;
  view.dispatch({
    changes: { from: line.from, to, insert: "" },
    annotations: Transaction.addToHistory.of(false),
  });
  return "removed";
}

function isClosingFence(line: string, fence: { character: string; length: number }): boolean {
  if (!line.startsWith(fence.character)) return false;
  const count = line.match(new RegExp(`^${fence.character}+`))?.[0].length ?? 0;
  return count >= fence.length && line.slice(count).trim() === "";
}

function maskInlineCodeSpans(line: string): string {
  const masked = [...line];
  let cursor = 0;
  while (cursor < line.length) {
    if (line[cursor] !== "`") {
      cursor += 1;
      continue;
    }
    let runLength = 1;
    while (line[cursor + runLength] === "`") runLength += 1;
    const delimiter = "`".repeat(runLength);
    const closing = line.indexOf(delimiter, cursor + runLength);
    if (closing < 0) {
      cursor += runLength;
      continue;
    }
    for (let index = cursor; index < closing + runLength; index += 1) masked[index] = " ";
    cursor = closing + runLength;
  }
  return masked.join("");
}
