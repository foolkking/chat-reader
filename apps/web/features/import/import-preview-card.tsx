import type { ImportPreviewResponse } from "../../lib/types";
import { stripLeadingTimestamp } from "../conversations/markdown-renderer";

export function ImportPreviewCard({ preview }: { preview: ImportPreviewResponse }) {
  const conversation = preview.conversation_preview ?? preview.conversation_previews?.[0] ?? null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-normal text-slate-500">Import preview</p>
          <h3 className="mt-1 text-base font-semibold text-slate-950">
            {conversation?.title ?? "Source files detected"}
          </h3>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
          {preview.status}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <PreviewStat label="Files" value={String(preview.files.length)} />
        <PreviewStat label="Messages" value={String(conversation?.message_count ?? 0)} />
        <PreviewStat label="Source" value={conversation?.source_profile ?? preview.files[0]?.source_profile ?? "unknown"} />
      </dl>

      {conversation ? (
        <p className="mt-4 text-sm leading-6 text-slate-600">
          {previewConversationText(conversation.first_user_message)}
        </p>
      ) : (
        <p className="mt-4 text-sm leading-6 text-slate-600">
          This source can be stored as a raw artifact, but it does not have a canonical conversation preview yet.
        </p>
      )}

      {preview.warnings && preview.warnings.length > 0 ? (
        <ul className="mt-4 space-y-1 text-sm text-amber-700">
          {preview.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 truncate font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function previewConversationText(text?: string | null): string {
  const cleaned = stripLeadingTimestamp(text ?? "").replace(/\s+/g, " ").trim();
  return cleaned || "Conversation preview is ready to commit.";
}
