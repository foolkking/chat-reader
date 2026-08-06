import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("attachment SVG preview path does not inline or independently open SVG documents", () => {
  const sourcePath = resolve(process.cwd(), "features/attachments/attachment-block.tsx");
  const source = readFileSync(sourcePath, "utf8");

  expect(source).not.toContain("dangerouslySetInnerHTML");
  expect(source).not.toMatch(/<object\b/i);
  expect(source).not.toMatch(/<embed\b/i);
  expect(source).not.toContain("window.open(");
  expect(source).not.toMatch(/target=["']_blank["']/i);
});
