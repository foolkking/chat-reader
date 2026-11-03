type HtmlNode = {
  type?: string;
  value?: string;
  position?: { start?: unknown; end?: unknown };
  children?: HtmlNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
    hChildren?: SafeHtmlNode[];
  };
};

type ParsedElement = {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: SafeHtmlNode[];
};
type SafeHtmlNode = ParsedElement | { type: "text"; value: string };

const ALLOWED_TAGS = new Set([
  "a", "audio", "b", "blockquote", "br", "code", "del", "details", "div", "dl", "dd", "dt", "em", "figcaption",
  "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "ol", "p", "q", "s",
  "samp", "section", "small", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot",
  "th", "thead", "tr", "tt", "u", "ul", "var", "video",
]);
const VOID_TAGS = new Set(["br", "hr", "img"]);
const MAX_HTML_LENGTH = 50_000;
const MAX_HTML_NODES = 1_500;
const MAX_HTML_DEPTH = 24;
const MAX_LAYOUT_LENGTH = 640;

/** Only a small, inert HTML subset is projected into the rendered Markdown tree. */
export function remarkSafeHtml() {
  return (tree: HtmlNode) => {
    const visit = (parent: HtmlNode) => {
      const children = parent.children;
      if (!children) return;
      const mergedChildren = mergeFragmentedHtmlChildren(children);
      parent.children = mergedChildren;
      for (const node of mergedChildren) {
        if (node.type !== "html") {
          visit(node);
          continue;
        }
        const parsed = typeof node.value === "string" && !containsMarkdownCodeSyntax(node.value)
          ? parseHtmlFragment(node.value)
          : null;
        if (!parsed) {
          // Unsupported or malformed HTML remains visible and inert.
          const phrasing = ["paragraph", "heading", "tableCell", "link", "emphasis", "strong", "delete"].includes(parent.type ?? "");
          node.type = phrasing ? "text" : "code";
          continue;
        }
        const root: ParsedElement = parsed.length === 1 && parsed[0]?.type === "element"
          ? parsed[0]
          : { type: "element", tagName: "div", properties: { dataReaderHtmlFragment: "true" }, children: parsed };
        node.type = "safeHtml";
        node.value = undefined;
        node.children = [];
        node.data = {
          hName: root.tagName,
          hProperties: root.properties,
          hChildren: root.children,
        };
      }
    };
    visit(tree);
  };
}

function mergeFragmentedHtmlChildren(children: HtmlNode[]): HtmlNode[] {
  const merged: HtmlNode[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];
    if (node?.type !== "html" || typeof node.value !== "string") {
      merged.push(node);
      continue;
    }
    let value = node.value;
    let endNode = node;
    let next = index + 1;
    while (next < children.length) {
      const candidate = children[next];
      if (candidate?.type === "html" && typeof candidate.value === "string") {
        value += `\n${candidate.value}`;
        endNode = candidate;
        next += 1;
        continue;
      }
      if (candidate?.type === "text" && typeof candidate.value === "string" && !candidate.value.trim()) {
        value += candidate.value;
        endNode = candidate;
        next += 1;
        continue;
      }
      break;
    }
    // A flow HTML node can contain Markdown-looking prose that the Markdown
    // parser intentionally kept as a literal/code fallback. Do not join such
    // fragments into one safe HTML tree, or a backtick pair inside the
    // fallback would silently become ordinary HTML text and lose its source
    // range semantics.
    if (next > index + 1 && !containsMarkdownCodeSyntax(value)) {
      merged.push({
        ...node,
        value,
        position: node.position && endNode.position
          ? { start: node.position.start, end: endNode.position.end }
          : node.position,
      });
      index = next - 1;
    } else {
      merged.push(node);
    }
  }
  return merged;
}

function containsMarkdownCodeSyntax(value: string): boolean {
  return /(^|\n)\s*(?:`{3,}|~{3,})|`[^`\r\n]+`/.test(value);
}

function parseHtmlFragment(source: string): SafeHtmlNode[] | null {
  if (!source.trim() || source.length > MAX_HTML_LENGTH) return null;
  const roots: SafeHtmlNode[] = [];
  const stack: ParsedElement[] = [];
  let cursor = 0;
  let nodeCount = 0;

  while (cursor < source.length) {
    if (source[cursor] !== "<") {
      const next = source.indexOf("<", cursor);
      const end = next < 0 ? source.length : next;
      const value = decodeHtmlEntities(source.slice(cursor, end));
      if (value) {
        appendNode(stack, roots, { type: "text", value });
        nodeCount += 1;
      }
      cursor = end;
      if (nodeCount > MAX_HTML_NODES) return null;
      continue;
    }

    if (source.startsWith("<!--", cursor)) return null;
    const end = findTagEnd(source, cursor + 1);
    if (end < 0) return null;
    const token = source.slice(cursor + 1, end).trim();
    cursor = end + 1;
    if (!token) return null;

    const closing = token.startsWith("/");
    const selfClosing = token.endsWith("/");
    const content = token.slice(closing ? 1 : 0, selfClosing ? -1 : undefined).trim();
    const nameMatch = /^([A-Za-z][A-Za-z0-9-]*)/.exec(content);
    if (!nameMatch) return null;
    const tagName = normalizeTag(nameMatch[1] ?? "");
    if (!ALLOWED_TAGS.has(tagName)) return null;
    const rest = content.slice(nameMatch[0].length);

    if (closing) {
      if (rest.trim() || VOID_TAGS.has(tagName)) return null;
      const current = stack.pop();
      if (!current || current.tagName !== tagName) return null;
      continue;
    }

    const parsedAttributes = parseAttributes(rest);
    if (!parsedAttributes) return null;
    const properties = safeProperties(tagName, parsedAttributes);
    const element: ParsedElement = { type: "element", tagName, properties, children: [] };
    appendNode(stack, roots, element);
    nodeCount += 1;
    if (nodeCount > MAX_HTML_NODES) return null;

    if (VOID_TAGS.has(tagName)) {
      if (!selfClosing && tagName !== "br" && tagName !== "hr" && tagName !== "img") return null;
      continue;
    }
    if (selfClosing) return null;
    if (stack.length >= MAX_HTML_DEPTH) return null;
    stack.push(element);
  }

  return stack.length === 0 && roots.length > 0 ? roots : null;
}

function appendNode(stack: ParsedElement[], roots: SafeHtmlNode[], node: SafeHtmlNode): void {
  if (stack.length) stack[stack.length - 1]?.children.push(node);
  else roots.push(node);
}

function findTagEnd(source: string, start: number): number {
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") quote = character;
    else if (character === ">") return index;
  }
  return -1;
}

function parseAttributes(source: string): Map<string, string> | null {
  const attributes = new Map<string, string>();
  let cursor = 0;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (cursor >= source.length) break;
    const nameMatch = /^[A-Za-z_:][A-Za-z0-9:_.-]*/.exec(source.slice(cursor));
    if (!nameMatch) return null;
    const name = (nameMatch[0] ?? "").toLowerCase();
    cursor += nameMatch[0].length;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    let value = "";
    if (source[cursor] === "=") {
      cursor += 1;
      while (/\s/.test(source[cursor] ?? "")) cursor += 1;
      const quote = source[cursor] === "\"" || source[cursor] === "'" ? source[cursor++] : "";
      const start = cursor;
      if (quote) {
        while (cursor < source.length && source[cursor] !== quote) cursor += 1;
        if (cursor >= source.length) return null;
        value = source.slice(start, cursor);
        cursor += 1;
      } else {
        while (cursor < source.length && !/\s/.test(source[cursor] ?? "")) cursor += 1;
        value = source.slice(start, cursor);
      }
    }
    if (attributes.has(name)) return null;
    attributes.set(name, decodeHtmlEntities(value));
  }
  return attributes;
}

function safeProperties(tagName: string, attributes: Map<string, string>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const layout = new Map<string, string>();
  for (const [name, value] of attributes) {
    if (name === "style") {
      parseSafeStyle(value, tagName, layout);
      continue;
    }
    if (name.startsWith("on") || name === "srcset" || name === "srcdoc" || name === "class" || name === "id") continue;
    if (name === "href" && tagName === "a") {
      const href = safeLink(value);
      if (href) properties.href = href;
      continue;
    }
    if (name === "src" && ["audio", "img", "video"].includes(tagName)) {
      const src = safeLocalSource(value);
      if (src) properties.src = src;
      continue;
    }
    if (name === "alt" && tagName === "img") properties.alt = value.slice(0, 500);
    else if (name === "controls" && ["audio", "video"].includes(tagName)) properties.controls = true;
    else if (name === "preload" && ["audio", "video"].includes(tagName) && ["none", "metadata"].includes(value.toLowerCase())) {
      properties.preload = value.toLowerCase();
    } else if (name === "playsinline" && tagName === "video") properties.playsInline = true;
    else if ((name === "width" || name === "height") && ["img", "video"].includes(tagName)) {
      const size = boundedInteger(value, 4096);
      if (size) properties[name] = size;
    } else if (name === "open" && tagName === "details") properties.open = true;
    else if (name === "start" && tagName === "ol") {
      const start = boundedInteger(value, 10_000);
      if (start) properties.start = start;
    } else if (name === "colspan" && ["td", "th"].includes(tagName)) {
      const span = boundedInteger(value, 100);
      if (span) properties.colSpan = span;
    } else if (name === "rowspan" && ["td", "th"].includes(tagName)) {
      const span = boundedInteger(value, 100);
      if (span) properties.rowSpan = span;
    } else if (name === "align" && ["td", "th"].includes(tagName) && ["left", "center", "right"].includes(value.toLowerCase())) {
      properties.align = value.toLowerCase();
    } else if (name === "title") properties.title = value.slice(0, 500);
  }
  if (layout.size) {
    for (const key of [
      "dataReaderDisplay", "dataReaderGap", "dataReaderAlign", "dataReaderJustify",
      "dataReaderMargin", "dataReaderRadius", "dataReaderFlex", "dataReaderWidth",
      "dataReaderMaxWidth",
    ]) {
      const value = layout.get(key);
      if (value) properties[key] = value;
    }
  }
  return properties;
}

function parseSafeStyle(style: string, tagName: string, output: Map<string, string>): void {
  for (const declaration of style.split(";").slice(0, 24)) {
    const separator = declaration.indexOf(":");
    if (separator < 1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim().toLowerCase();
    if (!value || /url\s*\(|expression|@import|[<>\\]/i.test(value)) continue;
    if (property === "display" && ["flex", "grid"].includes(value)) output.set("dataReaderDisplay", value);
    else if (["gap", "row-gap", "column-gap"].includes(property) && tagName !== "img") {
      const size = safeDimension(value, 64);
      if (size) output.set("dataReaderGap", size);
    } else if (property === "align-items" && ["flex-start", "center", "flex-end", "stretch"].includes(value)) {
      output.set("dataReaderAlign", value);
    } else if (property === "justify-content" && ["flex-start", "center", "flex-end", "space-between", "space-around"].includes(value)) {
      output.set("dataReaderJustify", value);
    } else if (property === "flex" && ["none", "1", "1 1 auto", "0 0 auto"].includes(value)) {
      output.set("dataReaderFlex", value);
    } else if (property === "margin" || property === "margin-block") {
      const values = value.split(/\s+/);
      const block = safeDimension(values[0] ?? "", 64);
      if (block) output.set("dataReaderMargin", block);
    } else if (property === "margin-top" || property === "margin-bottom") {
      const size = safeDimension(value, 64);
      if (size) output.set("dataReaderMargin", size);
    } else if (property === "border-radius") {
      const size = safeDimension(value, 24);
      if (size) output.set("dataReaderRadius", size);
    } else if (property === "width" && tagName === "img") {
      const size = safeDimension(value, MAX_LAYOUT_LENGTH);
      if (size) output.set("dataReaderWidth", size);
    } else if (property === "max-width") {
      const size = safeDimension(value, MAX_LAYOUT_LENGTH);
      if (size) output.set("dataReaderMaxWidth", size);
    }
  }
}

function safeLink(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.includes("\\")) return null;
  if (/^cr-asset:\/\/[0-9a-f-]{16,}$/i.test(trimmed)) return trimmed;
  if (/^(?:https?:|mailto:|#)/i.test(trimmed)) return trimmed;
  // Unknown schemes, including inert archive placeholders, must not be
  // turned into same-origin-looking paths by the relative-link fallback.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/i.test(trimmed)) return null;
  if (/^\/(?!\/)/.test(trimmed)) {
    const path = trimmed.split(/[?#]/, 1)[0] ?? "";
    return path.split("/").some((segment) => segment === "..") || hasUnsafeLocalPathEncoding(path)
      ? null
      : trimmed;
  }
  if (/^(?:javascript|data|vbscript):/i.test(trimmed) || trimmed.startsWith("//")) return null;
  if (!/^[A-Za-z0-9._~!$&'()*+,;=:@%/-]+(?:[?#][A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?$/.test(trimmed)) return null;
  const path = trimmed.split(/[?#]/, 1)[0] ?? "";
  if (path.split("/").some((segment) => segment === "..") || hasUnsafeLocalPathEncoding(path)) return null;
  return `/${trimmed.replace(/^\.?\//, "")}`;
}

function safeLocalSource(value: string): string | null {
  const trimmed = value.trim();
  if (/^cr-asset:\/\/[0-9a-f-]{16,}$/i.test(trimmed)) return trimmed;
  if (/^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*$/.test(trimmed)
    && !hasUnsafeLocalPathEncoding(trimmed)
    && !trimmed.split(/[/?#]/).includes("..")) return trimmed;
  if (/^(?:https?:|data:|javascript:|vbscript:|\/\/)/i.test(trimmed) || trimmed.includes("\\")) return null;
  return safeLink(trimmed);
}

function hasUnsafeLocalPathEncoding(value: string): boolean {
  return /%(?:25|2e|2f|5c)/i.test(value);
}

function safeDimension(value: string, max: number): string | null {
  if (!/^(?:\d+(?:\.\d+)?)(?:px|rem|em)$/.test(value)) return null;
  const amount = Number.parseFloat(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= max ? value : null;
}

function boundedInteger(value: string, max: number): number | null {
  if (!/^\d{1,5}$/.test(value)) return null;
  const number = Number(value);
  return number >= 1 && number <= max ? number : null;
}

function normalizeTag(value: string): string {
  const tag = value.toLowerCase();
  if (tag === "b") return "strong";
  if (tag === "i") return "em";
  if (tag === "s" || tag === "strike") return "del";
  return tag;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#(?:x[0-9a-f]{1,6}|[0-9]{1,7})|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    const normalized = code.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return "\"";
    if (normalized === "apos") return "'";
    if (normalized === "nbsp") return "\u00a0";
    const numeric = normalized.startsWith("#x") ? Number.parseInt(normalized.slice(2), 16) : Number.parseInt(normalized.slice(1), 10);
    if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 0x10ffff || numeric >= 0xd800 && numeric <= 0xdfff) return entity;
    try { return String.fromCodePoint(numeric); } catch { return entity; }
  });
}
