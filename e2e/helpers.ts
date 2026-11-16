import { expect, type Page } from '@playwright/test';

/** Screens below the top of a stack stay mounted (hidden), so match only the visible element. */
export const id = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });

/** Fresh install: clear storage so each test starts as a first-run guest. */
export async function freshStart(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    const dbs = (await indexedDB.databases?.()) ?? [];
    for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name);
    const root = await navigator.storage?.getDirectory?.();
    if (root) for await (const [name] of (root as unknown as { entries(): AsyncIterable<[string]> }).entries()) await root.removeEntry(name, { recursive: true }).catch(() => undefined);
  });
  await page.goto('/');
  await expect(id(page, 'onboarding')).toBeVisible({ timeout: 20_000 });
}

/** Onboarding with the home dumbbell plan on every weekday so a workout is scheduled today. */
export async function onboardHome(page: Page) {
  await id(page, 'opt-general').click();
  await id(page, 'onb-next').click();
  await id(page, 'opt-home_dumbbell').click();
  await id(page, 'onb-next').click();
  await expect(id(page, 'plan-suggested')).toContainText('Home Dumbbell');
  for (const d of [0, 1, 2, 3, 4, 5, 6]) {
    const chip = id(page, `weekday-${d}`);
    if ((await chip.getAttribute('aria-checked')) !== 'true') await chip.click();
  }
  await id(page, 'onb-next').click();
  await id(page, 'onb-finish').click();
  await expect(id(page, 'today-screen')).toBeVisible();
}
