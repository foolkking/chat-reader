import { EditorView } from "@codemirror/view";

export type AttachmentDraft = { token: string; displayName: string; image: boolean };
export type AttachmentDraftState = AttachmentDraft & {
  status: "uploading" | "ready" | "error" | "removed";
  progress: number;
  itemId?: string;
  error?: string;
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

export function replacePendingMarker(view: EditorView, token: string, attachmentId: string): boolean {
  const needle = `cr-upload://${token}`;
  const index = view.state.doc.toString().indexOf(needle);
  if (index < 0) return false;
  const line = view.state.doc.lineAt(index);
  const image = line.text.trimStart().startsWith("![");
  const value = line.text
    .replace("正在上传：", image ? "" : "附件：")
    .replace("正在上传: ", image ? "" : "附件：")
    .replace("Uploading: ", image ? "" : "Attachment: ")
    .replace(needle, `cr-asset://${attachmentId}`);
  view.dispatch({ changes: { from: line.from, to: line.to, insert: value } });
  return true;
}

function escapeMarkdownLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

export function removePendingMarker(view: EditorView | null, token: string): void {
  if (!view) return;
  const index = view.state.doc.toString().indexOf(`cr-upload://${token}`);
  if (index < 0) return;
  const line = view.state.doc.lineAt(index);
  const to = line.to < view.state.doc.length ? line.to + 1 : line.to;
  view.dispatch({ changes: { from: line.from, to, insert: "" } });
}

function isClosingFence(line: string, fence: { character: string; length: number }): boolean {
  if (!line.startsWith(fence.character)) return false;
  const count = line.match(new RegExp(`^${fence.character}+`))?.[0].length ?? 0;
  return count >= fence.length && line.slice(count).trim() === "";
}
