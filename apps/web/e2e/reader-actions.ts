import { expect, type Page } from "@playwright/test";

/** Exercise the real responsive toolbar; never force-click a hidden action. */
export async function openReaderAction(page: Page, id: string) {
  let action = page.locator(`[data-reader-header-action="${id}"]`).filter({ visible: true });
  if (!await action.count()) {
    const more = page.locator("[data-reader-more-actions=true], [data-reader-mobile-more-actions=true]").filter({ visible: true });
    await expect(more).toHaveCount(1);
    await more.click();
  }
  // Wide layouts keep focus/together shortcuts in the toolbar and overflow.
  // If the menu is open, exercise that explicit entry rather than arbitrarily
  // picking the first of two matching controls or force-clicking a hidden one.
  const menuAction = page.locator(`[data-reader-header-menu] [data-reader-header-action="${id}"]`).filter({ visible: true });
  if (await menuAction.count()) action = menuAction;
  await expect(action).toHaveCount(1);
  await action.click();
}
