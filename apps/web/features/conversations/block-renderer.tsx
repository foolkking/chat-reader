import type { RenderBlockRead } from "../../lib/types";
import { MarkdownRenderer, ThinkingDisclosure, stripLeadingTimestamp } from "./markdown-renderer";

const THINKING_LABEL = "\u601d\u8003\u8fc7\u7a0b";

export function BlockRenderer({ block, isAssistant = true }: { block: RenderBlockRead; isAssistant?: boolean }) {
  const text = stripLeadingTimestamp(block.plain_text ?? readText(block));

  if (!text.trim()) {
    return null;
  }

  if (block.collapsed_by_default && block.block_type !== "heading" && block.block_type !== "code") {
    return <ThinkingDisclosure label={THINKING_LABEL} text={text} />;
  }

  if (block.block_type === "heading") {
    const level = normalizeHeadingLevel(block.data.level);
    const title = stripLeadingTimestamp(readString(block.data.title) ?? text);
    const baseClass = "whitespace-pre-wrap break-words font-semibold tracking-normal text-primary";

    if (level === 1) {
      return <h1 className={`${baseClass} border-b border-ui pb-2 text-2xl leading-9`}>{title}</h1>;
    }
    if (level === 2) {
      return <h2 className={`${baseClass} text-xl leading-8`}>{title}</h2>;
    }
    if (level === 3) {
      return <h3 className={`${baseClass} text-lg leading-7`}>{title}</h3>;
    }
    return <h4 className={`${baseClass} text-base leading-7`}>{title}</h4>;
  }

  if (block.block_type === "code") {
    const code = readString(block.data.code) ?? text;
    const language = readString(block.data.language);
    return <MarkdownRenderer text={`\`\`\`${language ?? ""}\n${code}\n\`\`\``} isAssistant={false} />;
  }

  return <MarkdownRenderer text={text} isAssistant={isAssistant} />;
}

function normalizeHeadingLevel(value: unknown): 1 | 2 | 3 | 4 {
  const level = typeof value === "number" ? value : Number(value);
  if (level === 1 || level === 2 || level === 3 || level === 4) {
    return level;
  }
  return 3;
}

function readText(block: RenderBlockRead): string {
  return readString(block.data.text) ?? readString(block.data.title) ?? readString(block.data.code) ?? "";
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
