import { readFileSync } from 'fs';
import { expect, test } from '@playwright/test';
import { freshStart, id } from './helpers';

test.beforeEach(async ({ page }) => {
  await freshStart(page);
  await id(page, 'onb-skip-all').click();
  await id(page, 'onb-finish').click();
  await expect(id(page, 'today-screen')).toBeVisible();
});

test('acceptance: two 250 mL entries, undo one → exactly 250 mL', async ({ page }) => {
  await id(page, 'water-add-250').click();
  await id(page, 'water-add-250').click();
  await id(page, 'toast-action').click(); // undo the second
  await id(page, 'tab-recovery').click();
  await expect(id(page, 'water-total')).toHaveText('250 mL');
});

test('acceptance: sleep 23:30 → 07:00 with 30 min awake is 7 h on the wake day', async ({ page }) => {
  // Log the night that ended yesterday morning, so a 07:00 wake-up is in the past at any time of day the suite runs.
  await page.getByTestId('today-screen').getByTestId('date-prev').click();
  await id(page, 'sleep-log').click();
  await id(page, 'sleep-bed').fill('23:30');
  await id(page, 'sleep-wake').fill('07:00');
  await expect(id(page, 'sleep-result')).toContainText('Time in bed');
  await id(page, 'sleep-awake').fill('30');
  await expect(id(page, 'sleep-result')).toContainText('7 h');
  await expect(id(page, 'sleep-result')).toContainText('Time asleep');
  await id(page, 'sleep-save').click();
  await expect(page.getByText('7 h · asleep')).toBeVisible();
  await id(page, 'tab-recovery').click();
  await expect(id(page, 'sleep-chart')).toContainText('over the 1 of 7 nights with a log');
});

test('acceptance: plan tomorrow counts zero, log with changed portion, recipe edit keeps history', async ({ page }) => {
  await id(page, 'tab-nutrition').click();
  // Recipe: 300 g of a 200 kcal / 100 g food, 2 servings → 300 kcal per serving.
  await id(page, 'open-recipes').click();
  await id(page, 'recipe-new').click();
  await id(page, 'recipe-name').fill('Rice bowl');
  await id(page, 'recipe-yield').fill('2');
  await id(page, 'recipe-add-ingredient').click();
  await id(page, 'ingredient-search').fill('White rice');
  await page.getByText('White rice, cooked').click();
  await id(page, 'portion-qty').fill('300');
  await id(page, 'portion-confirm').click();
  await id(page, 'recipe-save').click();
  await expect(page.getByText('195 kcal').first()).toBeVisible(); // 300 g × 130 kcal/100 g ÷ 2
  await id(page, 'back').click();
  await id(page, 'back').click();
  // Plan it for tomorrow.
  await page.getByTestId('nutrition-screen').getByRole('radio', { name: 'Meal plan' }).click();
  await id(page, 'plan-add-1').click();
  await page.getByRole('radio', { name: 'Recipes' }).click();
  await id(page, 'food-0').click();
  await id(page, 'portion-confirm').click();
  await id(page, 'back').click();
  await page.getByRole('radio', { name: 'Diary' }).click();
  await page.getByTestId('nutrition-screen').getByTestId('date-next').click();
  await expect(id(page, 'nutrition-totals')).toContainText('0 entries');
  // Log it with 1.5 servings.
  await id(page, 'log-planned-0').click();
  await id(page, 'portion-qty').fill('1.5');
  await id(page, 'portion-confirm').click();
  await expect(id(page, 'nutrition-totals')).toContainText('293 kcal'); // 1.5 × 195
  // Edit the recipe; the logged entry keeps its values.
  await id(page, 'open-recipes').click();
  await page.getByTestId('recipes').getByText('Rice bowl').click();
  await id(page, 'recipe-yield').fill('1');
  await id(page, 'recipe-save').click();
  await id(page, 'back').click();
  await id(page, 'back').click();
  await expect(id(page, 'nutrition-totals')).toContainText('293 kcal');
});

test('barcode: unknown code leads to manual entry; invalid code is explained', async ({ page }) => {
  await id(page, 'tab-nutrition').click();
  await id(page, 'add-Breakfast').click();
  await id(page, 'scan-barcode').click();
  await id(page, 'scan-typed').fill('12345678');
  await id(page, 'scan-lookup').click();
  await expect(id(page, 'scan-problem')).toContainText('not a valid');
  await id(page, 'scan-typed').fill('3017620422003');
  await id(page, 'scan-lookup').click();
  await expect(id(page, 'scan-problem')).toBeVisible();
  await id(page, 'scan-manual').click();
  await expect(id(page, 'food-form')).toBeVisible();
  await expect(page.getByLabel('Barcode (optional)')).toHaveValue('3017620422003');
});

test('export includes hidden tracker data', async ({ page }) => {
  await id(page, 'water-add-500').click();
  await id(page, 'open-settings').click();
  await id(page, 'set-trk-water').click();
  await id(page, 'settings-privacy').click();
  const download = page.waitForEvent('download');
  await id(page, 'export-json').click();
  const file = await (await download).path();
  const json = JSON.parse(readFileSync(file, 'utf8'));
  expect(json.format).toBe('kinset-export');
  expect(json.tables.water_logs).toHaveLength(1);
  expect(json.tables.water_logs[0].amount_ml).toBe(500);
});

test('dark mode and large text render the main tabs', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addStyleTag({ content: 'html { font-size: 150% !important; }' });
  for (const tab of ['index', 'train', 'nutrition', 'recovery', 'progress']) {
    await id(page, `tab-${tab}`).click();
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
});
