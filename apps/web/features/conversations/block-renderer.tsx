import type { RenderBlockRead } from "../../lib/types";

export function BlockRenderer({ block }: { block: RenderBlockRead }) {
  const text = block.plain_text ?? readText(block);

  if (block.block_type === "heading") {
    const level = normalizeHeadingLevel(block.data.level);
    const title = readString(block.data.title) ?? text;
    const className = "whitespace-pre-wrap font-semibold text-slate-950";

    if (level === 1) {
      return <h1 className={`${className} text-2xl`}>{title}</h1>;
    }
    if (level === 2) {
      return <h2 className={`${className} text-xl`}>{title}</h2>;
    }
    if (level === 3) {
      return <h3 className={`${className} text-lg`}>{title}</h3>;
    }
    return <h4 className={`${className} text-base`}>{title}</h4>;
  }

  if (block.block_type === "code") {
    const code = readString(block.data.code) ?? text;
    const language = readString(block.data.language);
    return (
      <figure className="overflow-hidden rounded-md border border-slate-800 bg-slate-950">
        {language ? (
          <figcaption className="border-b border-white/10 px-3 py-2 text-xs text-slate-400">
            {language}
          </figcaption>
        ) : null}
        <pre className="overflow-x-auto p-4 text-sm leading-6 text-slate-100">
          <code>{code}</code>
        </pre>
      </figure>
    );
  }

  return <p className="whitespace-pre-wrap text-sm leading-7 text-slate-800">{text}</p>;
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
