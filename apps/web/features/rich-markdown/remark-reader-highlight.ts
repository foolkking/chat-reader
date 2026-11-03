type MarkdownNode = {
  type?: string;
  value?: string;
  children?: MarkdownNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
    hChildren?: MarkdownNode[];
  };
};

/** Obsidian's ==highlight== syntax, limited to ordinary Markdown text nodes. */
export function remarkReaderHighlight() {
  return (tree: MarkdownNode) => {
    const visit = (parent: MarkdownNode) => {
      if (!parent.children) return;
      const next: MarkdownNode[] = [];
      for (const child of parent.children) {
        if (child.type === "text" && typeof child.value === "string") {
          next.push(...splitHighlights(child));
        } else {
          visit(child);
          next.push(child);
        }
      }
      parent.children = next;
    };
    visit(tree);
  };
}

function splitHighlights(original: MarkdownNode): MarkdownNode[] {
  const value = original.value ?? "";
  const nodes: MarkdownNode[] = [];
  let cursor = 0;
  let search = 0;
  while (search < value.length) {
    const open = findUnescapedMarker(value, search);
    if (open < 0) break;
    const close = findUnescapedMarker(value, open + 2);
    if (close < 0) break;
    const content = value.slice(open + 2, close);
    if (!content.trim() || /[=\r\n]/.test(content) || /^\s|\s$/.test(content)) {
      search = open + 2;
      continue;
    }
    if (open > cursor) nodes.push({ type: "text", value: value.slice(cursor, open) });
    nodes.push({
      type: "readerHighlight",
      children: [{ type: "text", value: content }],
      data: { hName: "mark" },
    });
    cursor = close + 2;
    search = cursor;
  }
  if (cursor === 0) return [original];
  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes;
}

function findUnescapedMarker(value: string, from: number): number {
  let index = value.indexOf("==", from);
  while (index >= 0) {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) slashes += 1;
    if (slashes % 2 === 0 && value[index + 2] !== "=" && value[index - 1] !== "=") return index;
    index = value.indexOf("==", index + 2);
  }
  return -1;
}
