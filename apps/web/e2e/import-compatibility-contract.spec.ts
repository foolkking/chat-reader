import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("JSON context recognizes single-role Markdown without accepting arbitrary Markdown", () => {
  const route = source("../api/app/api/routes/imports.py");
  const detector = source("../api/app/services/import_pipeline/source_detector.py");
  const parser = source("../api/app/services/import_pipeline/exporter_markdown_parser.py");
  const canonical = source("../api/app/services/import_pipeline/canonical_draft.py");

  expect(route).toContain("detect_source_profile(filename, content, expected_messages)");
  expect(detector).toContain("has_exporter_markdown_structure(text, expected_messages)");
  expect(parser).toContain("A single-role export requires the paired");
  expect(parser).toContain("expected = [message for message in expected_messages or [] if not message.is_empty]");
  expect(canonical).toContain('PARSER_VERSION = "chat-reader-import-v5"');
  expect(canonical).toContain('MARKDOWN_PARSER_VERSION = "markdown-parser-v5"');
});

test("import preview exposes bounded alignment diagnostics and localizes structured errors", () => {
  const schema = source("../api/app/schemas/import_schema.py");
  const preview = source("features/import/import-preview-card.tsx");
  const api = source("lib/api.ts");

  expect(schema).toContain("class ImportAlignmentIssue");
  expect(schema).toContain("ignored_json_empty_count");
  expect(schema).toContain("ignored_markdown_empty_count");
  expect(preview).toContain('data-testid="import-empty-message-summary"');
  expect(preview).toContain('data-testid="import-alignment-issues"');
  expect(api).toContain('typeof detail.code === "string"');
  expect(api).toContain("localizedImportError(detail.code)");
  expect(api).toContain("JSON 与 Markdown 存在多个同等可靠的配对结果");
});
