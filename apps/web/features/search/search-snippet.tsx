import { findSearchTextMatches } from "../../lib/search-text-matches";

/** A bounded excerpt around a real occurrence, never an unrelated body prefix. */
export function SearchSnippet({ text, query }: { text: string; query: string }) {
  const terms = [query, ...[...query.matchAll(/"([^"]+)"|(\S+)/gu)].map(hit => hit[1] ?? hit[2])];
  let match;
  for (const term of terms) {
    match = findSearchTextMatches(text, term, null, null, 1, true)[0];
    if (match) break;
  }
  if (!match) return <>{text.slice(0, 240)}</>;
  return <>{match.match_start > 80 ? "…" : ""}{match.context_before}
    <mark className="rounded-sm bg-[var(--mark-bg)] text-[var(--mark-text)]">{match.quote}</mark>
    {match.context_after}{match.context_after.length >= 80 ? "…" : ""}</>;
}
