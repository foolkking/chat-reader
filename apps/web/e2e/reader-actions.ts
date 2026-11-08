import { expect, type Page } from "@playwright/test";

/** Exercise the real responsive toolbar; never force-click a hidden action. */
export async function openReaderAction(page: Page, id: string) {
  const action = page.locator(`[data-reader-header-action="${id}"]`).filter({ visible: true });
  if (!await action.count()) {
    const more = page.locator("[data-reader-more-actions=true], [data-reader-mobile-more-actions=true]").filter({ visible: true });
    await expect(more).toHaveCount(1);
    await more.click();
  }
  await expect(action).toHaveCount(1);
  await action.click();
}
