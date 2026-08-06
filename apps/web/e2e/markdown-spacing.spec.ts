import { expect, test } from "@playwright/test";

const densityValues = {
  compact: ["1.5", "0.125em", "0.25em", "0.75em", "0.125em", "0", "0.375em", "1.25em"],
  comfortable: ["1.625", "0.25em", "0.5em", "1em", "0.25em", "0", "0.5em", "1.75em"],
  large: ["1.8", "0.75em", "1em", "1.5em", "0.5em", "0.25em", "1em", "2.25em"],
} as const;

test("Markdown spacing presets produce one equal normal and virtual block gap", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const fixture = document.createElement("section");
    fixture.id = "markdown-spacing-fixture";
    fixture.className = "reader-frame";
    fixture.innerHTML = `
      <div class="reader-content-inner" style="font-size: 20px">
        <div class="reader-message"><div class="reader-block-flow" data-flow="normal">
          <div class="reader-block-slot"><div class="reader-markdown-block" style="height: 10px"></div></div>
          <div class="reader-block-slot" style="margin-block-start: var(--reader-block-gap)"><div class="reader-markdown-block" style="height: 10px"></div></div>
        </div></div>
        <div data-flow="virtual">
          <div class="w-full" style="padding-block-end: var(--reader-block-gap)">
            <div class="reader-markdown-block" style="height: 10px"></div>
          </div>
          <div class="w-full">
            <div class="reader-markdown-block" style="height: 10px"></div>
          </div>
        </div>
        <div class="reader-prose" data-flow="paragraph" style="display: flow-root">
          <p style="height: 10px"></p><p style="height: 10px"></p>
        </div>
        <div class="reader-prose" data-flow="heading-before" style="display: flow-root">
          <p style="height: 10px"></p><h2 style="height: 10px"></h2>
        </div>
        <div class="reader-prose" data-flow="heading-after" style="display: flow-root">
          <h2 style="height: 10px"></h2><p style="height: 10px"></p>
        </div>
        <div class="reader-prose" data-flow="list" style="display: flow-root">
          <ul><li style="height: 10px"></li><li style="height: 10px"></li></ul>
        </div>
        <div class="reader-prose" data-flow="rich" style="display: flow-root">
          <p style="height: 10px"></p><blockquote style="height: 10px"></blockquote>
        </div>
        <div class="reader-prose" data-flow="divider" style="display: flow-root">
          <p style="height: 10px"></p><hr />
        </div>
        <div class="reader-message"><div class="reader-block-flow" data-flow="rich-render-block">
          <div class="reader-block-slot"><div class="reader-markdown-block" data-block-type="paragraph" style="height: 10px"></div></div>
          <div class="reader-block-slot" style="margin-block-start: var(--reader-rich-block-gap)"><div class="reader-markdown-block" data-block-type="code" style="height: 10px"></div></div>
        </div></div>
        <div class="reader-message"><div class="reader-block-flow" data-flow="divider-render-block">
          <div class="reader-block-slot"><div class="reader-markdown-block" data-block-type="paragraph" style="height: 10px"></div></div>
          <div class="reader-block-slot" style="margin-block-start: var(--reader-divider-gap)"><div class="reader-markdown-block" data-block-type="thematic_break" style="height: 10px"></div></div>
        </div></div>
      </div>`;
    document.body.append(fixture);
  });

  for (const [density, expectedValues] of Object.entries(densityValues)) {
    const result = await page.locator("#markdown-spacing-fixture").evaluate((fixture, selectedDensity) => {
      const frame = fixture as HTMLElement;
      frame.dataset.readerDensity = selectedDensity;
      const style = getComputedStyle(frame);
      const values = [
        style.getPropertyValue("--reader-line-height").trim(),
        style.getPropertyValue("--reader-paragraph-gap").trim(),
        style.getPropertyValue("--reader-block-gap").trim(),
        style.getPropertyValue("--reader-heading-before").trim(),
        style.getPropertyValue("--reader-heading-after").trim(),
        style.getPropertyValue("--reader-list-item-gap").trim(),
        style.getPropertyValue("--reader-rich-block-gap").trim(),
        style.getPropertyValue("--reader-divider-gap").trim(),
      ];
      const normalBlocks = frame.querySelectorAll<HTMLElement>('[data-flow="normal"] .reader-markdown-block');
      const virtualBlocks = frame.querySelectorAll<HTMLElement>('[data-flow="virtual"] .reader-markdown-block');
      const gap = (blocks: NodeListOf<HTMLElement>) => blocks[1].getBoundingClientRect().top - blocks[0].getBoundingClientRect().bottom;
      const flowGap = (name: string, selector: string) => gap(
        frame.querySelector<HTMLElement>(`[data-flow="${name}"]`)!.querySelectorAll<HTMLElement>(selector),
      );
      const firstVirtualRow = frame.querySelector<HTMLElement>('[data-flow="virtual"] > div');
      const readerContent = frame.querySelector<HTMLElement>(".reader-content-inner")!;
      const message = frame.querySelector<HTMLElement>(".reader-message")!;
      return {
        values,
        lineHeight: Number.parseFloat(getComputedStyle(readerContent).lineHeight),
        normalGap: gap(normalBlocks),
        virtualGap: gap(virtualBlocks),
        firstVirtualPadding: Number.parseFloat(getComputedStyle(firstVirtualRow!).paddingBottom),
        paragraphGap: flowGap("paragraph", ":scope > p"),
        headingBefore: flowGap("heading-before", ":scope > *"),
        headingAfter: flowGap("heading-after", ":scope > *"),
        listItemGap: flowGap("list", "li"),
        richBlockGap: flowGap("rich", ":scope > *"),
        dividerGap: flowGap("divider", ":scope > *"),
        richRenderBlockGap: flowGap("rich-render-block", ":scope > *"),
        dividerRenderBlockGap: flowGap("divider-render-block", ":scope > *"),
        messageGap: Number.parseFloat(getComputedStyle(message).marginBottom),
      };
    }, density);

    expect(result.values).toEqual(expectedValues);
    expect(result.normalGap).toBeCloseTo(result.virtualGap, 4);
    expect(result.normalGap).toBeCloseTo(result.firstVirtualPadding, 4);
    expect(result.lineHeight).toBeCloseTo(Number.parseFloat(expectedValues[0]) * 20, 4);
    expect(result.paragraphGap).toBeCloseTo(Number.parseFloat(expectedValues[1]) * 20, 4);
    expect(result.normalGap).toBeCloseTo(Number.parseFloat(expectedValues[2]) * 20, 4);
    expect(result.headingBefore).toBeCloseTo(Number.parseFloat(expectedValues[3]) * 20, 4);
    expect(result.headingAfter).toBeCloseTo(Number.parseFloat(expectedValues[4]) * 20, 4);
    expect(result.listItemGap).toBeCloseTo(Number.parseFloat(expectedValues[5]) * 20, 4);
    expect(result.richBlockGap).toBeCloseTo(Number.parseFloat(expectedValues[6]) * 20, 4);
    expect(result.dividerGap).toBeCloseTo(Number.parseFloat(expectedValues[7]) * 20, 4);
    expect(result.richRenderBlockGap).toBeCloseTo(result.richBlockGap, 4);
    expect(result.dividerRenderBlockGap).toBeCloseTo(result.dividerGap, 4);
    expect(result.messageGap).toBe(32);
  }
});
