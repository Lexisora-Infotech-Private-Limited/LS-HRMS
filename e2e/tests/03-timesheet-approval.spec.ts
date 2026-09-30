import { expect, test } from '@playwright/test';
import { PERSONA, expectToast, signIn } from './helpers';

/** Flow 03 — Timesheet approval: PL (level 1) then RM (level 2), feeding payroll. */
test.describe.serial('Flow 03 · Two-level timesheet approval', () => {
  test('project lead approves level 1', async ({ page }) => {
    await signIn(page, PERSONA.lead);
    await page.goto('/approvals');
    await page.getByRole('button', { name: /Level 1/ }).click();
    await page.locator('main').getByText('Priya Sharma').first().click();
    await expect(page.locator('main')).toContainText(/Screenshots/i);
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expectToast(page, /Priya Sharma/);
  });

  test('reporting manager approves level 2', async ({ page }) => {
    await signIn(page, PERSONA.manager);
    await page.goto('/approvals');
    await page.getByRole('button', { name: /Level 2/ }).click();
    await page.locator('main').getByText('Priya Sharma').first().click();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expectToast(page, /Priya Sharma/);
  });

  test('employee gets an approval alert', async ({ page }) => {
    await signIn(page, PERSONA.employee);
    await page.goto('/alerts');
    await expect(page.locator('main')).toContainText(/approved/i);
  });
});
