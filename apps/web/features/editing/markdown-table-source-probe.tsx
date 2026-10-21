"use client";

import { memo, useLayoutEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { richMarkdownRemarkPlugins } from "../rich-markdown/rich-markdown-config";
import { createMarkdownTableSourceProbe, type MarkdownTableSourceAnalysis } from "./markdown-table-source-analysis";

/** No preview DOM, remote resources or state callbacks during render. */
export const MarkdownTableSourceProbe = memo(function MarkdownTableSourceProbe({ source, onResult }: {
  source: string;
  onResult: (result: MarkdownTableSourceAnalysis) => void;
}) {
  const probe = useMemo(() => createMarkdownTableSourceProbe(source), [source]);
  const plugins = useMemo(() => richMarkdownRemarkPlugins([probe.plugin]), [probe]);
  useLayoutEffect(() => { onResult(probe.result()); }, [onResult, probe]);
  return probe.limited ? null : <ReactMarkdown remarkPlugins={plugins} skipHtml>{probe.text}</ReactMarkdown>;
});
