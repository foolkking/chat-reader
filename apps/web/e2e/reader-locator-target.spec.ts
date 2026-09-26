import { expect, test } from "@playwright/test";
import type { AnnotationRead, MessageListItem, RenderBlockRead, TocItem } from "../lib/types";
import {
  annotationNavigationTarget,
  attachmentNavigationTarget,
  sourceEditorNavigationTarget,
  tocNavigationTarget,
} from "../features/conversations/reader-locator-target";
import { resolveSourcePosition, sourceOffsetForBlock } from "../features/editing/message-source-position";

const source = "# 标题 😀\n\n- **Alpha** item\n\n```bash\nprintf 'ok'\n```\n";
const blocks: RenderBlockRead[] = [
  { id: "heading-id", block_index: 0, block_type: "heading", plain_text: "标题 😀", data: { text: "标题 😀" } },
  { id: "paragraph-id", block_index: 1, block_type: "paragraph", plain_text: "Alpha item", data: { text: "Alpha item" } },
  { id: "code-id", block_index: 2, block_type: "code", plain_text: "printf 'ok'", data: { code: "printf 'ok'" } },
];

test("source offsets map through Markdown syntax to canonical block offsets", () => {
  const heading = resolveSourcePosition(source, blocks, codePointOffset(source, source.indexOf("😀")));
  const paragraph = resolveSourcePosition(source, blocks, codePointOffset(source, source.indexOf("item")));
  const code = resolveSourcePosition(source, blocks, codePointOffset(source, source.indexOf("printf") + 3));

  expect(heading).toMatchObject({ blockIndex: 0, renderBlockId: "heading-id", canonicalOffset: 3 });
  expect(paragraph).toMatchObject({ blockIndex: 1, renderBlockId: "paragraph-id", canonicalOffset: 6 });
  expect(code).toMatchObject({ blockIndex: 2, renderBlockId: "code-id", canonicalOffset: 3 });

  const reverse = sourceOffsetForBlock(source, blocks, "block-message-2", 3);
  expect(Array.from(source)[reverse]).toBe("n");
});

test("source editor locator sends block-local canonical offsets", () => {
  const message = {
    id: "message-id",
    current_version: { id: "version-id" },
    render_blocks: blocks,
  } as unknown as MessageListItem;
  const target = sourceEditorNavigationTarget(
    message,
    source,
    codePointOffset(source, source.indexOf("printf") + 3),
  );
  expect(target).toMatchObject({
    messageId: "message-id",
    messageVersionId: "version-id",
    renderBlockId: "code-id",
    blockIndex: 2,
    canonicalStart: 3,
    characterOffset: 3,
    source: "source-editor",
  });
});

test("source editor locator supports canonical text stored in block data", () => {
  const message = {
    id: "message-id",
    current_version: { id: "version-id" },
    render_blocks: [
      { id: "data-only", block_index: 0, block_type: "paragraph", data: { text: "Data only text" } },
    ],
  } as unknown as MessageListItem;
  const target = sourceEditorNavigationTarget(message, "Data only text", 5);
  expect(target).toMatchObject({
    renderBlockId: "data-only",
    canonicalStart: 5,
    canonicalEnd: 6,
  });
});

test("TOC, attachment and annotation factories share the locator target contract", () => {
  const toc = tocNavigationTarget({
    id: "toc-id",
    heading_index: 0,
    level: 2,
    text: "Section",
    slug: "section",
    message_id: "message-id",
    message_version_id: "version-id",
    render_block_id: "heading-id",
    message_order_key: "1",
    block_index: 0,
  } satisfies TocItem);
  expect(toc).toMatchObject({ renderBlockId: "heading-id", preferTocPipeline: true, source: "section-toc" });

  const attachment = attachmentNavigationTarget({ id: "attachment-id" }, {
    message_id: "message-id",
    message_version_id: "version-id",
    is_current_version: true,
    occurrence_key: "occurrence-id",
    placement: "inline",
    block_index: 2,
    render_block_id: "code-id",
    start_offset: 3,
    end_offset: 4,
  });
  expect(attachment).toMatchObject({ attachmentId: "attachment-id", occurrenceKey: "occurrence-id", source: "attachment" });

  const annotation = annotationNavigationTarget({
    id: "annotation-id",
    conversation_id: "conversation-id",
    message_id: "message-id",
    message_version_id: "version-id",
    annotation_type: "highlight",
    color: "yellow",
    start_block_index: 1,
    start_offset: 2,
    end_block_index: 1,
    end_offset: 5,
    quote: "pha",
    prefix: "Al",
    suffix: " item",
    comment_markdown: "",
    anchor_status: "valid",
    revision: 1,
    is_deleted: false,
    conflict_of_id: null,
    metadata: {},
    created_at: "2026-09-26T00:00:00Z",
    updated_at: "2026-09-26T00:00:00Z",
  } satisfies AnnotationRead);
  expect(annotation).toMatchObject({ annotationId: "annotation-id", blockIndex: 1, source: "annotation" });
});

function codePointOffset(value: string, codeUnitOffset: number): number {
  return Array.from(value.slice(0, codeUnitOffset)).length;
}
