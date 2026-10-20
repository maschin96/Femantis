import type { Page } from '@playwright/test';

/**
 * Clicks the centre of the free area between the floating panels, where „Alles einpassen“
 * and the camera presets frame the model (#36). The canvas centre is not that point once
 * the panels are asymmetric or the window is smaller than the app (Windows CI runners).
 */
export async function clickFreeAreaCentre(page: Page): Promise<void> {
  const canvas = page.locator('.viewport canvas');
  const box = (await canvas.boundingBox())!;
  const free = await page.locator('.viewport-shell').evaluate((shell) => {
    const style = getComputedStyle(shell);
    const px = (name: string) => parseFloat(style.getPropertyValue(name)) || 0;
    return {
      top: px('--free-top'),
      right: px('--free-right'),
      bottom: px('--free-bottom'),
      left: px('--free-left'),
    };
  });
  await canvas.click({
    position: {
      x: free.left + (box.width - free.left - free.right) / 2,
      y: free.top + (box.height - free.top - free.bottom) / 2,
    },
  });
}
