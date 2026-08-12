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
const BARE_BRACKET_DISPLAY = /^[\t ]*\/?\[[\t ]*\r?\n([\s\S]*?)^[\t ]*\]\/?[\t ]*$/gm;
const BARE_BRACKET_DISPLAY_EXACT = /^[\t ]*\/?\[[\t ]*\r?\n([\s\S]*?)^[\t ]*\]\/?[\t ]*$/m;
const LATEX_COMMAND = /\\(?:alpha|approx|begin|beta|boxed|cap|cases|cdot|cdots|chi|cup|delta|dfrac|div|dots|epsilon|equiv|eta|exists|forall|frac|gamma|geq?|in|infty|int|iota|kappa|lambda|langle|ldots|left|leq?|lim|ln|log|longrightarrow|mathbb|mathbf|mathcal|mathit|mathrm|mathsf|mathtt|matrix|max|min|mp|mu|nabla|neq|notin|nu|omega|overline|partial|phi|pi|pm|pmatrix|prod|propto|psi|quad|qquad|rangle|rho|right|rightarrow|sigma|sim|sin|sqrt|subset|subseteq|sum|supset|supseteq|tan|tau|text|theta|times|to|upsilon|varphi|varepsilon|varrho|varsigma|vartheta|vec|xrightarrow|xi|zeta)(?=[^A-Za-z]|$)/;
const LATEX_EXPLICIT_SPACING = /\\[ ,;:!]/;
const MATH_SIGNAL = /[\\_^=<>+*/{}]|(?:^|\s)-(?=\s|\d)/;
const CURRENCY_WORDS = /\b(?:and|or|to|usd|eur|gbp|cny|rmb|dollars?|euros?|yuan)\b/i;
const BARE_MATH_CHARACTERS = /^[A-Za-z0-9\\{}()[\]^_+\-*/=<>.,|!:'\s]+$/;
const BARE_MATH_WORDS = new Set(["cos", "det", "exp", "gcd", "lim", "ln", "log", "max", "min", "mod", "sin", "tan"]);
const DISPLAY_LABEL_TOKEN = /^[A-Z][A-Za-z0-9]*(?:[-/][A-Za-z0-9]+)*$/;

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
    replaceBareBracketDisplayMath(tree, source);
    replaceDisplayMath(tree, source);
    replaceInlineParenMath(tree, source);
    replaceBareInlineParenMath(tree, source);
    demoteCurrencyMath(tree);
  };
}

export function isChatGptBareBracketMath(source: string): boolean {
  const match = source.match(BARE_BRACKET_DISPLAY_EXACT);
  return Boolean(match?.[1].trim() && isLikelyMathExpression(normalizeChatGptMathBody(match[1]), "display"));
}

export function extractChatGptBareBracketMath(source: string): string[] {
  return Array.from(source.matchAll(BARE_BRACKET_DISPLAY))
    .map((match) => normalizeChatGptMathBody(match[1]))
    .filter((value) => value && isLikelyMathExpression(value, "display"));
}

export function normalizeChatGptMathBody(source: string): string {
  // ChatGPT's rendered-Markdown clipboard path can serialize a mathematical
  // equality as a Setext underline and the following expression as a heading.
  // Recover that presentation artifact only after a bounded display-math
  // candidate has been established; ordinary Markdown headings are untouched.
  const normalized = source
    .replace(/^[\t ]*={3,}[\t ]*$(?:\r?\n[\t ]*)+(?:#[\t ]*)?/gm, "=\n")
    .trim();
  return normalizeStandaloneDisplayLabel(normalized) ?? normalized;
}

function normalizeStandaloneDisplayLabel(source: string): string | null {
  if (source.length > 80 || source.includes("\n")) return null;
  const parts = source.split(/\s*([>+])\s*/);
  if (!parts.length || parts.length > 7 || parts.some((part, index) => (
    index % 2 === 0 ? !DISPLAY_LABEL_TOKEN.test(part) : part !== ">" && part !== "+"
  ))) return null;
  return parts.map((part, index) => (index % 2 === 0 ? `\\text{${part}}` : ` ${part} `)).join("");
}

/**
 * Some ChatGPT clipboard/export paths have already consumed only the outer
 * `\\[` / `\\]` escapes before Chat Reader receives the canonical source,
 * leaving standalone `[` and `]` lines around otherwise intact LaTeX. In
 * CommonMark that body may become several paragraphs or even Setext headings,
 * so a paragraph-only transform cannot recover it.
 *
 * This remains an AST/source-position compatibility rule rather than a source
 * rewrite: only a standalone multiline bracket pair whose body contains a
 * known LaTeX command is eligible, and any code/HTML node intersecting the
 * source range rejects the candidate. Stored Markdown is untouched.
 */
function replaceBareBracketDisplayMath(parent: MarkdownNode, source: string): void {
  if (!parent.children?.length) return;

  const candidates = Array.from(source.matchAll(BARE_BRACKET_DISPLAY))
    .map((match) => ({
      start: match.index ?? -1,
      end: (match.index ?? -1) + match[0].length,
      value: normalizeChatGptMathBody(match[1]),
    }))
    .filter((candidate) => candidate.start >= 0 && candidate.value && isLikelyMathExpression(candidate.value, "display"));

  if (candidates.length) {
    const next: MarkdownNode[] = [];
    let childIndex = 0;
    for (const candidate of candidates) {
      while (childIndex < parent.children.length && nodeEnd(parent.children[childIndex]) <= candidate.start) {
        next.push(parent.children[childIndex]);
        childIndex += 1;
      }
      const rangeStart = childIndex;
      while (childIndex < parent.children.length && nodeStart(parent.children[childIndex]) < candidate.end) childIndex += 1;
      const covered = parent.children.slice(rangeStart, childIndex);
      if (!covered.length || covered.some(isUnsafeBareBracketNode)
        || nodeStart(covered[0]) > candidate.start || nodeEnd(covered[covered.length - 1]) < candidate.end) {
        next.push(...covered);
        continue;
      }
      next.push({
        type: "math",
        value: candidate.value,
        data: displayMathData(candidate.value, "bare-bracket"),
        position: { start: covered[0].position?.start, end: covered[covered.length - 1].position?.end },
      });
    }
    next.push(...parent.children.slice(childIndex));
    parent.children = next;
  }

  parent.children.forEach((child) => replaceBareBracketDisplayMath(child, source));
}

function isUnsafeBareBracketNode(node: MarkdownNode): boolean {
  return node.type === "code" || node.type === "html" || node.type === "inlineCode";
}

function nodeStart(node: MarkdownNode): number {
  return node.position?.start?.offset ?? Number.POSITIVE_INFINITY;
}

function nodeEnd(node: MarkdownNode): number {
  return node.position?.end?.offset ?? Number.NEGATIVE_INFINITY;
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

/**
 * ChatGPT's rendered-text clipboard can consume only the backslashes around
 * inline math, leaving `(n^6)` or `(1/3)` in otherwise normal prose. Recover
 * those compact expressions at the text-node level. The bounded grammar is
 * intentionally conservative: prose words, dates, versions and code nodes do
 * not qualify, and canonical source remains unchanged.
 */
function replaceBareInlineParenMath(node: MarkdownNode, source: string): void {
  if (!node.children) return;
  node.children = node.children.flatMap((child) => {
    if (child.type !== "text") {
      replaceBareInlineParenMath(child, source);
      return [child];
    }
    const raw = sourceSlice(child, source);
    if (!raw?.includes("(")) return [child];
    return splitBareInlineParenMath(raw) ?? [child];
  });
}

function splitBareInlineParenMath(raw: string): MarkdownNode[] | null {
  const result: MarkdownNode[] = [];
  let cursor = 0;
  let searchFrom = 0;
  let changed = false;
  while (searchFrom < raw.length) {
    const open = raw.indexOf("(", searchFrom);
    if (open < 0) break;
    if (open > 0 && raw[open - 1] === "\\") {
      searchFrom = open + 1;
      continue;
    }
    const close = raw.indexOf(")", open + 1);
    if (close < 0) break;
    const value = raw.slice(open + 1, close).trim();
    if (!isLikelyMathExpression(value, "inline")) {
      searchFrom = close + 1;
      continue;
    }
    appendText(result, decodeCommonMarkEscapes(raw.slice(cursor, open)));
    result.push({
      type: "inlineMath",
      value,
      data: inlineMathData(value, "bare-paren"),
    });
    cursor = close + 1;
    searchFrom = cursor;
    changed = true;
  }
  if (!changed) return null;
  appendText(result, decodeCommonMarkEscapes(raw.slice(cursor)));
  return result;
}

function isLikelyMathExpression(value: string, mode: "inline" | "display"): boolean {
  const normalized = value.trim();
  if (!normalized || (mode === "inline" && normalized.length > 160)) return false;
  if (LATEX_COMMAND.test(normalized)) return true;
  if (mode === "display" && LATEX_EXPLICIT_SPACING.test(normalized)) return true;
  if (!BARE_MATH_CHARACTERS.test(normalized)) return false;
  if (mode === "inline" && /^[a-z]$/.test(normalized)) return true;
  if (mode === "display" && /^[A-Za-z]{1,3}\d*$/.test(normalized)) return true;
  if (!MATH_SIGNAL.test(normalized)) return false;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized) || /^\d+(?:\.\d+){2,}$/.test(normalized)) return false;
  if (/[A-Z]\d/.test(normalized)) return false;
  const words = normalized.match(/[A-Za-z]+/g) ?? [];
  if (words.some((word) => word.length > 1
    && !(mode === "display" && /^[a-z]{2}$/.test(word))
    && !BARE_MATH_WORDS.has(word.toLowerCase()))) return false;
  return true;
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
