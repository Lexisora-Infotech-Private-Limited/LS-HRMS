import { expect, test } from '@playwright/test';
import { PERSONA, expectToast, signIn } from './helpers';

/** Flow 01 — Employee daily start: sign in, dashboard, punch in, task, timesheet. */
test.describe.serial('Flow 01 · Employee daily start', () => {
  test('dashboard greets the employee with their day', async ({ page }) => {
    await signIn(page, PERSONA.employee);
    await expect(page.locator('main')).toContainText('Priya');
    await expect(page.locator('main')).toContainText(/Leave balance/i);
  });

  test('remote employee punches in and out on the web', async ({ page }) => {
    await signIn(page, PERSONA.employee);
    const header = page.locator('header.topbar');
    await header.getByRole('button', { name: 'Punch in' }).click();
    await expectToast(page, /Punched in/);
    await expect(header.getByRole('button', { name: 'Punch out' })).toBeVisible();

    await page.goto('/attendance');
    await expect(page.locator('main')).toContainText('This month');
    await expect(page.locator('main')).toContainText(/Punched in/i);

    await header.getByRole('button', { name: 'Punch out' }).click();
    await expect(header.getByRole('button', { name: 'Punch in' })).toBeVisible();
  });

  test('office employee cannot web punch', async ({ page }) => {
    await signIn(page, PERSONA.office);
    await page.locator('header.topbar').getByRole('button', { name: 'Punch in' }).click();
    await expectToast(page, /biometric/i);
  });

  test('task board shows the Atlas CRM cards', async ({ page }) => {
    await signIn(page, PERSONA.employee);
    await page.goto('/board');
    await expect(page.locator('main')).toContainText('AT-101');
    await expect(page.locator('main')).toContainText('Invoice PDF export');
  });

  test('timesheet shows tracked hours per task', async ({ page }) => {
    await signIn(page, PERSONA.employee);
    await page.goto('/timesheet');
    await expect(page.locator('main')).toContainText('My timesheet');
    await expect(page.getByRole('button', { name: 'Log outside-hours task' })).toBeVisible();
  });
});
