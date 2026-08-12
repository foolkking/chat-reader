type MarkdownPosition = {
  start?: { offset?: number };
  end?: { offset?: number };
};

type MarkdownNode = {
  type?: string;
  value?: string;
  data?: Record<string, unknown>;
  position?: MarkdownPosition;
  children?: MarkdownNode[];
};

type MarkdownFile = { value?: unknown };

const DISPLAY_MATH = /^\s*\\\[\s*\r?\n?([\s\S]*?)\r?\n?\s*\\\]\s*$/;
const MATH_SIGNAL = /[\\_^=<>+*/{}]|(?:^|\s)-(?=\s|\d)/;
const CURRENCY_WORDS = /\b(?:and|or|to|usd|eur|gbp|cny|rmb|dollars?|euros?|yuan)\b/i;

/**
 * ChatGPT emits LaTeX using \(...\) and \[...\]. CommonMark consumes the
 * backslashes as punctuation escapes before remark-math can see them. This
 * remark transform uses source positions to recover only those delimiters in
 * normal Markdown text. Code and inlineCode nodes are never visited as text.
 *
 * The transform also demotes ambiguous single-dollar currency ranges created
 * by remark-math (for example "$5 and $10") back to literal text. Canonical
 * source is never rewritten.
 */
export function remarkAiMathCompatibility() {
  return (tree: MarkdownNode, file: MarkdownFile) => {
    const source = typeof file.value === "string" ? file.value : String(file.value ?? "");
    replaceDisplayMath(tree, source);
    replaceInlineParenMath(tree, source);
    demoteCurrencyMath(tree);
  };
}

function replaceDisplayMath(parent: MarkdownNode, source: string): void {
  if (!parent.children) return;
  parent.children = parent.children.map((child) => {
    if (child.type === "paragraph") {
      const raw = sourceSlice(child, source);
      const match = raw?.match(DISPLAY_MATH);
      if (match && match[1].trim()) {
        return {
          type: "math",
          value: match[1].trim(),
          data: displayMathData(match[1].trim(), "bracket"),
          position: child.position,
        };
      }
    }
    replaceDisplayMath(child, source);
    return child;
  });
}

function replaceInlineParenMath(node: MarkdownNode, source: string): void {
  if (!node.children) return;
  node.children = node.children.flatMap((child) => {
    if (child.type !== "text") {
      replaceInlineParenMath(child, source);
      return [child];
    }
    const raw = sourceSlice(child, source);
    if (!raw?.includes("\\(")) return [child];
    const replacement = splitInlineParenMath(raw);
    return replacement ?? [child];
  });
}

function splitInlineParenMath(raw: string): MarkdownNode[] | null {
  const result: MarkdownNode[] = [];
  let cursor = 0;
  let changed = false;
  while (cursor < raw.length) {
    const open = findDelimiter(raw, "\\(", cursor);
    if (open < 0) break;
    const close = findDelimiter(raw, "\\)", open + 2);
    if (close < 0) break;
    const latex = raw.slice(open + 2, close);
    if (!latex.trim()) {
      cursor = close + 2;
      continue;
    }
    appendText(result, decodeCommonMarkEscapes(raw.slice(cursor, open)));
    result.push({
      type: "inlineMath",
      value: latex.trim(),
      data: inlineMathData(latex.trim(), "paren"),
    });
    cursor = close + 2;
    changed = true;
  }
  if (!changed) return null;
  appendText(result, decodeCommonMarkEscapes(raw.slice(cursor)));
  return result;
}

function findDelimiter(source: string, delimiter: "\\(" | "\\)", from: number): number {
  let index = source.indexOf(delimiter, from);
  while (index >= 0) {
    let precedingBackslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
      precedingBackslashes += 1;
    }
    if (precedingBackslashes % 2 === 0) return index;
    index = source.indexOf(delimiter, index + 2);
  }
  return -1;
}

function demoteCurrencyMath(node: MarkdownNode): void {
  if (!node.children) return;
  node.children = node.children.map((child) => {
    if (child.type === "inlineMath" && child.data?.aiMathDelimiter !== "paren" && isCurrencyLike(child.value ?? "")) {
      return { type: "text", value: `$${child.value ?? ""}$`, position: child.position };
    }
    demoteCurrencyMath(child);
    return child;
  });
}

function isCurrencyLike(value: string): boolean {
  const normalized = value.trim();
  if (!/^\d/.test(normalized)) return false;
  if (MATH_SIGNAL.test(normalized)) return false;
  return /^\d+(?:[.,]\d+)?$/.test(normalized) || CURRENCY_WORDS.test(normalized) || /\s/.test(normalized);
}

function sourceSlice(node: MarkdownNode, source: string): string | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return typeof start === "number" && typeof end === "number" ? source.slice(start, end) : null;
}

function decodeCommonMarkEscapes(value: string): string {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1");
}

function appendText(nodes: MarkdownNode[], value: string): void {
  if (value) nodes.push({ type: "text", value });
}

function displayMathData(value: string, delimiter: string): Record<string, unknown> {
  return {
    aiMathDelimiter: delimiter,
    hName: "pre",
    hChildren: [{
      type: "element",
      tagName: "code",
      properties: { className: ["language-math", "math-display"] },
      children: [{ type: "text", value }],
    }],
  };
}

function inlineMathData(value: string, delimiter: string): Record<string, unknown> {
  return {
    aiMathDelimiter: delimiter,
    hName: "code",
    hProperties: { className: ["language-math", "math-inline"] },
    hChildren: [{ type: "text", value }],
  };
}
