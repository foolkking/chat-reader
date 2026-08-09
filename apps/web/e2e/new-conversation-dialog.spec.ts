import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("new conversation dialog is a compact two-message composer", () => {
  const source = readFileSync(resolve(process.cwd(), "features/conversations/new-conversation-dialog.tsx"), "utf8");
  expect(source).toContain('data-testid="new-conversation-dialog"');
  expect(source).toContain("lg:grid-cols-2");
  expect(source).toContain('role="User"');
  expect(source).toContain('role="Assistant"');
  expect(source).toContain("requestSubmit()");
  expect(source).toContain('setUserText("")');
  expect(source).toContain('setAssistantText("")');
});
