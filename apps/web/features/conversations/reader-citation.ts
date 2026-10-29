export type ReaderCitationIdentity = {
  conversationId: string;
  messageId: string;
  conversationTitle: string;
  ordinal: number | string;
  origin: string;
};

const CITATION_IGNORE_SELECTOR = [
  "[data-markdown-copy-ignore='true']",
  "[data-message-meta]",
  "button",
  "input",
  "select",
  "textarea",
  "script",
  "style",
  "[aria-hidden='true']",
].join(", ");

export function selectedMessageText(body: HTMLElement, selection: Selection | null): string | null {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!containsNode(body, range.startContainer) || !containsNode(body, range.endContainer)) return null;

  const fragment = range.cloneContents();
  const container = document.createElement("div");
  container.append(fragment);
  container.querySelectorAll(CITATION_IGNORE_SELECTOR).forEach((element) => element.remove());
  container.querySelectorAll("img").forEach((image) => {
    image.replaceWith(document.createTextNode(image.getAttribute("alt") ?? ""));
  });
  container.querySelectorAll("br").forEach((lineBreak) => lineBreak.replaceWith(document.createTextNode("\n")));
  container.querySelectorAll("tr").forEach((row) => {
    const cells = Array.from(row.querySelectorAll(":scope > th, :scope > td"))
      .map((cell) => cell.textContent?.trim() ?? "");
    row.replaceChildren(document.createTextNode(cells.join(" | ")));
  });
  container.querySelectorAll("p, div, li, blockquote, pre, h1, h2, h3, h4, h5, h6, tr").forEach((element) => {
    element.append(document.createTextNode("\n"));
  });
  const text = (container.textContent ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

export function buildReaderCitationMarkdown(text: string, identity: ReaderCitationIdentity): string | null {
  const quote = text.trim();
  if (!quote) return null;
  const url = new URL(`/conversations/${encodeURIComponent(identity.conversationId)}`, identity.origin);
  url.searchParams.set("messageId", identity.messageId);
  const title = escapeMarkdownLabel(identity.conversationTitle.trim() || "Conversation");
  const quotedText = quote.split(/\r?\n/).map((line) => line ? `> ${line}` : ">").join("\n");
  return `${quotedText}\n>\n> — [${title} · #${identity.ordinal}](${url.toString()})`;
}

function containsNode(root: HTMLElement, node: Node): boolean {
  return node === root || root.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode);
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}
