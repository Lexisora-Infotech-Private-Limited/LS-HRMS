import { expect, test } from '@playwright/test';
import { PERSONA, signIn } from './helpers';

/** Flow 06 (core) — project delivery board; Flow 03 tail — payroll run & payslips. */
test.describe('Projects, board, payroll & payslips', () => {
  test('lead sees projects with KPIs and opens the Atlas board', async ({ page }) => {
    await signIn(page, PERSONA.lead);
    await page.goto('/projects');
    await expect(page.locator('main')).toContainText('Atlas CRM');
    await expect(page.locator('main')).toContainText('Nimbus Retail');
    await page.goto('/board');
    for (const col of ['Open', 'WIP', 'Dev Completed', 'QA']) await expect(page.locator('main')).toContainText(col);
  });

  test('HR sees the payroll run with KPIs', async ({ page }) => {
    await signIn(page, PERSONA.hr);
    await page.goto('/payroll');
    await expect(page.locator('main')).toContainText(/Gross/);
    await expect(page.locator('main')).toContainText('Priya Sharma');
  });

  test('employee downloads a published payslip', async ({ page }) => {
    await signIn(page, PERSONA.employee);
    await page.goto('/payslips');
    await expect(page.locator('main')).toContainText('Aug 2026');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download' }).first().click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  });
});
