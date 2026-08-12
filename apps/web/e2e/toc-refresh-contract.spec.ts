import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");

test("reader TOC refresh exposes selectable targets, scopes, worker polling, and exact cache invalidation", async () => {
  const reader = fs.readFileSync(path.join(root, "features/toc/toc-refresh-dialog.tsx"), "utf8");
  const conversation = fs.readFileSync(path.join(root, "features/conversations/conversation-reader.tsx"), "utf8");
  const toc = fs.readFileSync(path.join(root, "features/toc/conversation-toc.tsx"), "utf8");
  const index = fs.readFileSync(path.join(root, "features/toc/conversation-index.tsx"), "utf8");
  const api = fs.readFileSync(path.join(root, "lib/api.ts"), "utf8");

  expect(reader).toContain("refreshDialogueIndex: dialogue");
  expect(reader).toContain("refreshSectionToc: sections");
  expect(reader).toContain("const [dialogue, setDialogue] = useState(true)");
  expect(reader).toContain("const [sections, setSections] = useState(true)");
  expect(reader).toContain('useState<TocRefreshInput["sectionScope"]>("current_conversation")');
  expect(reader).toContain('setScope("all_conversations")');
  expect(reader).toContain("!dialogue && !sections");
  expect(reader).toContain("data-dialog-backdrop");
  expect(reader).toContain("useDialogFocus");
  expect(conversation).toContain('id: "refresh-toc"');
  expect(conversation).toContain('getTask(active.job_id)');
  expect(conversation).toContain('queryKey: ["conversation-index"]');
  expect(conversation).toContain('queryKey: ["toc"]');
  expect(toc).toContain("[effectiveMessageId]: matching");
  expect(toc).not.toContain("if (matching.length) setCachedItems");
  expect(index).toContain("indexQuery.dataUpdatedAt");
  expect(api).toContain('`/api/conversations/${conversationId}/toc/refresh`');
});
