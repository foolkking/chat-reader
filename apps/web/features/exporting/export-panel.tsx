"use client";

import { useState } from "react";
import { getConversationExportUrl } from "../../lib/api";

export function ExportPanel({
  conversationId,
  selectedMessageIds,
}: {
  conversationId: string;
  selectedMessageIds: string[];
}) {
  const [format, setFormat] = useState<"markdown" | "canonical_json">("markdown");
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeToc, setIncludeToc] = useState(true);
  const [includeVersions, setIncludeVersions] = useState(false);
  const [useSelection, setUseSelection] = useState(false);
  const href = getConversationExportUrl(conversationId, {
    format,
    includeMetadata,
    includeToc,
    includeVersions,
    messageIds: useSelection ? selectedMessageIds : [],
  });

  return (
    <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-[#111827]">Export</h2>
      <div className="mt-3 grid gap-3 text-sm text-[#374151]">
        <label>
          Format
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value as "markdown" | "canonical_json")}
            className="mt-1 block w-full rounded-xl border border-[#d1d5db] px-3 py-2 text-sm outline-none focus:border-[#111827] focus:ring-2 focus:ring-[#111827]/10"
          >
            <option value="markdown">Markdown</option>
            <option value="canonical_json">Canonical JSON</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeMetadata}
            onChange={(event) => setIncludeMetadata(event.target.checked)}
          />
          Include metadata
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={includeToc} onChange={(event) => setIncludeToc(event.target.checked)} />
          Include TOC
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeVersions}
            onChange={(event) => setIncludeVersions(event.target.checked)}
          />
          Include version history
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={useSelection}
            disabled={selectedMessageIds.length === 0}
            onChange={(event) => setUseSelection(event.target.checked)}
          />
          Export selected messages ({selectedMessageIds.length})
        </label>
        <a
          href={href}
          className="rounded-xl bg-[#111827] px-3 py-2 text-center text-sm font-medium text-white hover:bg-black"
        >
          Download
        </a>
      </div>
    </section>
  );
}
