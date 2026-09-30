import { expect, test } from '@playwright/test';
import { API, PASSWORD, PERSONA, WORKSPACE, sidebar, signIn } from './helpers';

test.describe('Sign in & role-based navigation', () => {
  test('wrong password shows an error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Workspace').fill(WORKSPACE);
    await page.getByLabel('Official email').fill(PERSONA.employee);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Email or password is incorrect');
  });

  test('employee sees self-service modules only', async ({ page }) => {
    await signIn(page, PERSONA.employee);
    const nav = sidebar(page);
    for (const label of ['Dashboard', 'Attendance', 'My timesheet', 'Time off', 'Task board', 'My payslips', 'Paperless onboarding']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    for (const label of ['Employees', 'Payroll run', 'Timesheet approvals', 'Roles & access', 'Leave setup']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    }
  });

  test('lead sees approvals; HR sees people & payroll; admin sees roles', async ({ page, browser }) => {
    await signIn(page, PERSONA.lead);
    await expect(sidebar(page).getByRole('link', { name: 'Timesheet approvals' })).toBeVisible();

    const hr = await browser.newPage();
    await signIn(hr, PERSONA.hr);
    for (const label of ['Employees', 'Payroll run', 'Leave setup', 'Shifts', 'Attendance policy']) {
      await expect(sidebar(hr).getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await hr.close();

    const admin = await browser.newPage();
    await signIn(admin, PERSONA.admin);
    await expect(sidebar(admin).getByRole('link', { name: 'Roles & access' })).toBeVisible();
    await admin.close();
  });

  test('mobile access is limited to CEO, Admin and HR', async ({ request }) => {
    const denied = await request.post(`${API}/auth/login`, {
      data: { workspace: WORKSPACE, email: PERSONA.employee, password: PASSWORD, client: 'mobile' },
    });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).code).toBe('MOBILE_NOT_ALLOWED');
    const allowed = await request.post(`${API}/auth/login`, {
      data: { workspace: WORKSPACE, email: PERSONA.hr, password: PASSWORD, client: 'mobile' },
    });
    expect(allowed.status()).toBe(200);
  });

  test('wireframe deep links resolve to real screens', async ({ page }) => {
    await signIn(page, PERSONA.employee);
    await page.goto('/s/attendance');
    await expect(page).toHaveURL(/\/attendance$/);
    await page.goto('/s/leave');
    await expect(page).toHaveURL(/\/leave$/);
  });
});
