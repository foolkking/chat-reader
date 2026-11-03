type CalloutNode = {
  type?: string;
  value?: string;
  children?: CalloutNode[];
  position?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

/** Project the wrapper, not the body: links, math, tasks and offsets survive. */
export function remarkReaderCallouts() {
  return (tree: CalloutNode, file?: { value?: unknown }) => {
    const source = typeof file?.value === "string" ? file.value : "";
    const visit = (node: CalloutNode) => {
      const paragraph = node.type === "blockquote" ? node.children?.[0] : undefined;
      const first = paragraph?.type === "paragraph" ? paragraph.children?.[0] : undefined;
      const marker = first?.type === "text" ? /^\[!([A-Za-z][A-Za-z0-9-]*)\]([+-]?)[ \t]*/.exec(first.value ?? "") : null;
      if (paragraph && first && marker) {
        const type = normalizeCalloutType(marker[1] ?? "note");
        const initialText = (first.value ?? "").slice(marker[0].length);
        const trimmedFirst: CalloutNode = { ...first, value: initialText };
        if (first.position) {
          trimmedFirst.position = {
            ...first.position,
            start: {
              ...first.position.start,
              column: first.position.start.column + marker[0].length,
              ...(first.position.start.offset === undefined ? {} : { offset: first.position.start.offset + marker[0].length }),
            },
          };
        }
        const inline = [trimmedFirst, ...(paragraph.children ?? []).slice(1)];
        const title: CalloutNode[] = [];
        let body: CalloutNode[] = [];
        let titlePosition = paragraph.position;
        for (let index = 0; index < inline.length; index += 1) {
          const child = inline[index]!;
          if (child.type === "break") {
            body = inline.slice(index + 1);
            break;
          }
          const newline = child.type === "text" ? (child.value ?? "").search(/\r?\n/) : -1;
          if (newline >= 0) {
            const newlineLength = child.value?.slice(newline).startsWith("\r\n") ? 2 : 1;
            const split = splitTextNode(child, newline, newlineLength, source);
            title.push(split.title);
            titlePosition = nodePosition(title, paragraph.position);
            body = [split.body, ...inline.slice(index + 1)];
            break;
          }
          if (child.value !== "" || child.type !== "text") title.push(child);
        }
        titlePosition = nodePosition(title, paragraph.position);
        const folded = marker[2] === "+" || marker[2] === "-";
        const titleNode: CalloutNode = {
          type: "paragraph",
          children: title.length ? title : [{ type: "text", value: calloutLabel(type) }],
          data: {
            hName: folded ? "summary" : "p",
            hProperties: folded ? {} : { dataReaderCalloutTitle: "true" },
          },
          position: titlePosition,
        };
        node.type = "readerCallout";
        node.data = {
          ...node.data,
          hName: folded ? "details" : "div",
          hProperties: {
            ...node.data?.hProperties,
            dataReaderCallout: type,
            ...(marker[2] === "+" ? { open: true } : {}),
          },
        };
        node.children = [
          titleNode,
          ...(body.length ? [{ ...paragraph, children: body, position: nodePosition(body, undefined) }] : []),
          ...(node.children ?? []).slice(1),
        ];
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

function splitTextNode(
  child: CalloutNode,
  index: number,
  newlineLength: number,
  source: string,
): { title: CalloutNode; body: CalloutNode } {
  const start = child.position?.start;
  const end = child.position?.end;
  const before = child.value?.slice(0, index) ?? "";
  const after = child.value?.slice(index + newlineLength) ?? "";
  // mdast values omit quote/list prefixes and decode entities. Never derive
  // raw offsets by adding the rendered string length or borrowing a sibling's
  // position. Use the actual source line, or leave the range unspecified.
  const rawNewline = start?.offset === undefined ? -1 : source.indexOf("\n", start.offset);
  const validNewline = rawNewline >= 0 && end?.offset !== undefined && rawNewline < end.offset;
  const titleEndOffset = validNewline ? rawNewline - (source[rawNewline - 1] === "\r" ? 1 : 0) : -1;
  const titleEnd = start?.offset !== undefined && titleEndOffset >= start.offset ? {
    line: start.line, column: start.column + titleEndOffset - start.offset, offset: titleEndOffset,
  } : undefined;
  const rawLineStart = rawNewline + 1;
  const nextNewline = source.indexOf("\n", rawLineStart);
  const rawLine = validNewline ? source.slice(rawLineStart, nextNewline < 0 ? source.length : nextNewline).replace(/\r$/, "") : "";
  const firstBodyLine = after.split(/\r?\n/, 1)[0] ?? "";
  const bodyIndex = firstBodyLine ? rawLine.indexOf(firstBodyLine) : -1;
  const bodyStart = validNewline && start && bodyIndex >= 0 && /^[\t >]*$/.test(rawLine.slice(0, bodyIndex)) ? {
    line: start.line + 1, column: bodyIndex + 1, offset: rawLineStart + bodyIndex,
  } : undefined;
  return {
    title: {
      ...child,
      value: before,
      position: start && titleEnd ? { start, end: titleEnd } : undefined,
    },
    body: {
      ...child,
      value: after,
      position: bodyStart && end ? { start: bodyStart, end } : undefined,
    },
  };
}

function nodePosition(children: CalloutNode[], fallback: CalloutNode["position"]): CalloutNode["position"] {
  const start = children[0]?.position?.start;
  const end = children[children.length - 1]?.position?.end;
  return start && end ? { start, end } : fallback;
}

function normalizeCalloutType(value: string): string {
  const type = value.toLowerCase();
  const aliases: Record<string, string> = {
    attention: "warning", check: "success", cite: "quote", done: "success",
    error: "danger", faq: "question", fail: "failure", hint: "tip", help: "question",
    missing: "failure", summary: "abstract", tldr: "abstract",
  };
  const normalized = aliases[type] ?? type;
  return [
    "abstract", "bug", "caution", "danger", "example", "failure", "important",
    "info", "note", "question", "quote", "success", "tip", "todo", "warning",
  ].includes(normalized) ? normalized : "note";
}

function calloutLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
