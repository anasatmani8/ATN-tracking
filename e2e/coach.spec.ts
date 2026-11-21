import { expect, test } from '@playwright/test';
import { freshStart, id } from './helpers';

test('coach insights: evidence, review, explicit apply, undo — no account or AI needed', async ({ page }) => {
  await freshStart(page);
  for (let i = 0; i < 3; i++) await id(page, 'onb-next').click();
  await id(page, 'try-demo').click();
  await expect(id(page, 'today-screen')).toBeVisible({ timeout: 30_000 });
  const card = id(page, 'today-insight');
  await expect(card).toContainText('Ready to progress');
  await expect(card).toContainText('with reps to spare');
  const title = (await card.textContent()) ?? '';
  await id(page, 'today-insight-review').click();
  const proposal = id(page, 'today-proposal');
  await expect(proposal).toContainText('Needs your OK');
  await expect(proposal).toContainText('Load next time');
  // Nothing has changed until Apply is tapped: dismissing the sheet keeps it pending.
  await id(page, 'sheet-close').click();
  await expect(id(page, 'today-insight')).toHaveText(title);
  await id(page, 'today-insight-review').click();
  await id(page, 'today-proposal-apply').click();
  await expect(id(page, 'toast')).toContainText('Change applied');
  await expect(id(page, 'today-insight')).not.toHaveText(title);

  // The change log on the Coach screen keeps it, with undo.
  await id(page, 'open-coach').click();
  await expect(id(page, 'coach-screen')).toContainText('Chatting with the coach needs the app');
  const ready = page.getByTestId('coach-screen').getByText(/^Ready to progress/);
  await expect(ready.first()).toBeVisible();
  await id(page, 'coach-changes').click();
  await expect(id(page, 'log-propose_set_next_load')).toContainText('Applied');
  await id(page, 'log-propose_set_next_load-undo').click();
  await expect(id(page, 'toast')).toContainText('Change undone');
  await expect(id(page, 'log-propose_set_next_load')).toContainText('Undone');
  await id(page, 'sheet-close').click();
  // Undone: the same suggestion is back on Today.
  await id(page, 'back').click();
  await expect(id(page, 'today-insight')).toHaveText(title);
});
