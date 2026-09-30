import { expect, test } from '@playwright/test';
import { PERSONA, expectToast, signIn } from './helpers';

function nextWeekday(offsetDays: number) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Flow 04 — Time off: check balance, apply, manager approves. */
test.describe.serial('Flow 04 · Time off', () => {
  const day = nextWeekday(21);

  test('employee sees balances and applies for casual leave', async ({ page }) => {
    await signIn(page, PERSONA.employee);
    await page.goto('/leave');
    for (const t of ['Earned leave', 'Casual leave', 'Sick leave']) await expect(page.locator('main')).toContainText(t);
    await page.getByRole('button', { name: 'Apply time off' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Leave type').selectOption({ label: 'Casual leave' });
    await dialog.getByLabel('From').fill(day);
    await dialog.getByLabel('To').fill(day);
    await dialog.getByLabel('Reason').fill('Family function');
    await dialog.getByRole('button', { name: 'Submit request' }).click();
    await expectToast(page, /Request sent to/);
  });

  test('reporting manager approves the request', async ({ page }) => {
    await signIn(page, PERSONA.manager);
    await page.goto('/leave');
    await page.getByRole('tab', { name: /Team requests/ }).click();
    const row = page.locator('main').locator('tr', { hasText: 'Priya Sharma' }).filter({ hasText: 'Family function' }).first();
    await row.getByRole('button', { name: 'Approve' }).click();
    const confirm = page.getByRole('dialog');
    if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: /Approve/ }).click();
    await expectToast(page, /approved/i);
  });
});
