import { expect, test } from '@playwright/test';
import { freshStart, id, onboardHome } from './helpers';

test('acceptance: offline guest, home plan, prefilled set, force-close, resume, finish once', async ({ page, context }) => {
  await freshStart(page);
  await context.setOffline(true); // airplane mode: nothing below needs the network
  await onboardHome(page);
  await expect(id(page, 'daily-progress')).toContainText('0 of 1 complete');
  await id(page, 'today-start').click();
  await expect(id(page, 'workout-preview')).toContainText('Goblet Squat');
  await id(page, 'preview-start').click();
  await expect(id(page, 'exercise-name')).toHaveText('Goblet Squat');
  await expect(id(page, 'exercise-position')).toHaveText('Exercise 1 of 5');
  await expect(id(page, 'set-0-reps')).toHaveValue('8');
  await expect(page.getByText('From the plan').first()).toBeVisible();
  const t0 = Date.now();
  await id(page, 'set-0-complete').click(); // one tap: prefilled set saved and rest started
  await expect(id(page, 'rest-timer')).toBeVisible();
  const tapToFeedback = Date.now() - t0;
  await expect(id(page, 'set-0-complete')).toHaveAttribute('aria-checked', 'true');
  await id(page, 'set-0-complete').click({ trial: true });
  await id(page, 'set-1-load').fill('12.5');
  await page.waitForTimeout(700); // draft written after typing pauses

  // Force-close: reload discards all in-memory state. A browser needs the network to fetch the page
  // itself (a phone app relaunches from its embedded bundle), so reconnect only for the relaunch.
  await context.setOffline(false);
  await page.reload();
  await expect(id(page, 'resume-workout').or(id(page, 'active-workout'))).toBeVisible({ timeout: 20_000 });
  await context.setOffline(true);
  if (await id(page, 'resume-workout').isVisible()) await id(page, 'resume-workout').click();
  await expect(id(page, 'set-0-complete')).toHaveAttribute('aria-checked', 'true');
  await expect(id(page, 'set-1-load')).toHaveValue('12.5');
  await expect(id(page, 'set-1-complete')).toHaveAttribute('aria-checked', 'false');
  await expect(id(page, 'rest-timer')).toBeVisible();

  // Timed exercise (plank) is exercise 5.
  await id(page, 'exercise-list').click();
  await id(page, 'goto-4').click();
  await expect(id(page, 'exercise-name')).toHaveText('Plank');
  await expect(id(page, 'set-0-dur')).toHaveValue('30');
  await id(page, 'set-0-complete').click();

  await id(page, 'finish-workout').click();
  await id(page, 'dialog-confirm').click();
  await expect(id(page, 'summary')).toBeVisible();
  await expect(page.getByLabel(/Working sets: 2/)).toBeVisible();
  await expect(page.getByLabel(/Total reps: 8/)).toBeVisible();
  await expect(page.getByLabel(/Volume: 0 kg/)).toBeVisible(); // bodyweight goblet with no load entered + plank: no external load
  await expect(id(page, 'summary-scheduled')).toContainText('Home A');
  await id(page, 'summary-close').click();
  await expect(id(page, 'daily-progress')).toContainText('1 of 1 complete');
  await expect(id(page, 'resume-workout')).toHaveCount(0);
  await id(page, 'tab-train').click();
  await expect(id(page, 'history-0')).toContainText('Home A');
  await expect(id(page, 'history-1')).toHaveCount(0);
  console.log(`set completion tap-to-feedback: ${tapToFeedback} ms (web, headless, includes UI update)`);
});

test('acceptance: PR replaced after delete, kg/lb toggle, dumbbell + bodyweight + warm-up', async ({ page }) => {
  await freshStart(page);
  await id(page, 'onb-skip-all').click();
  await id(page, 'onb-finish').click();
  const lift = async (load: string) => {
    await id(page, 'tab-train').click();
    await id(page, 'train-start-empty').click();
    await id(page, 'preview-start').click();
    await id(page, 'add-first-exercise').click();
    await id(page, 'pick-search').fill('dumbbell bench');
    await id(page, 'pick-db_bench_press').click();
    await id(page, 'set-0-load').fill(load);
    await id(page, 'set-0-reps').fill('10');
    await id(page, 'set-0-complete').click();
    await expect(id(page, 'set-0-complete')).toHaveAttribute('aria-checked', 'true');
    await expect(id(page, 'set-0-load')).not.toBeEditable(); // completed rows are read-only in the logger
    await id(page, 'add-warmup').click();
    await expect(page.getByLabel('Set 1, warm-up')).toBeVisible();
    await id(page, 'set-0-load').fill('6');
    await id(page, 'set-0-reps').fill('10');
    await id(page, 'set-0-complete').click();
    await expect(id(page, 'set-0-complete')).toHaveAttribute('aria-checked', 'true');
    await id(page, 'exercise-list').click();
    await id(page, 'list-add-exercise').click();
    await id(page, 'pick-search').fill('pull-up');
    await id(page, 'pick-pull_up').click();
    await expect(id(page, 'exercise-name')).toHaveText('Pull-Up');
    await id(page, 'set-0-reps').fill('8');
    await id(page, 'set-0-complete').click();
    await id(page, 'finish-workout').click();
    await id(page, 'dialog-confirm').click();
    await expect(id(page, 'summary')).toBeVisible();
  };
  await lift('12');
  // Two 12 kg dumbbells × 10 = 240 kg; warm-up and pull-ups excluded from volume.
  await expect(page.getByLabel(/Volume: 240 kg/)).toBeVisible();
  await expect(page.getByLabel(/Working sets: 2/)).toBeVisible();
  await expect(page.getByLabel(/Total reps: 18/)).toBeVisible();
  await id(page, 'summary-close').click();
  await lift('14');
  await expect(id(page, 'summary-prs')).toContainText('heaviest 14 kg ×2');
  await id(page, 'summary-close').click();

  await id(page, 'tab-progress').click();
  await expect(page.getByRole('button', { name: /Dumbbell Bench Press, 14 kg ×2/ })).toBeVisible();

  // Delete the record-holding workout: the earlier session becomes the record.
  await id(page, 'tab-train').click();
  await id(page, 'history-0').click();
  await id(page, 'summary-delete').click();
  await id(page, 'dialog-confirm').click();
  await id(page, 'tab-progress').click();
  await expect(page.getByRole('button', { name: /Dumbbell Bench Press, 12 kg ×2/ })).toBeVisible();

  // kg → lb → kg: display changes, stored values and totals do not.
  await id(page, 'tab-index').click();
  for (const u of ['lb', 'kg', 'lb']) {
    await id(page, 'open-settings').click();
    await id(page, `unit-weight-${u}`).click();
    await id(page, 'back').click();
  }
  await id(page, 'tab-progress').click();
  await expect(page.getByRole('button', { name: /Dumbbell Bench Press, 26\.5 lb ×2/ })).toBeVisible();
  await id(page, 'tab-index').click();
  await id(page, 'open-settings').click();
  await id(page, 'unit-weight-kg').click();
  await id(page, 'back').click();
  await id(page, 'tab-train').click();
  await id(page, 'history-0').click();
  await expect(page.getByLabel(/Volume: 240 kg/)).toBeVisible();
});
