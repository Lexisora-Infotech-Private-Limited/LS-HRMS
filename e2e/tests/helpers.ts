import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const WORKSPACE = 'lexisora.hrms.app';
export const PASSWORD = 'password';
export const API = 'http://localhost:4000/api/v1';

export const PERSONA = {
  employee: 'priya.sharma@lexisora.com',
  lead: 'arjun.mehta@lexisora.com',
  manager: 'neha.kapoor@lexisora.com',
  hr: 'kavya.iyer@lexisora.com',
  admin: 'rohit.verma@lexisora.com',
  office: 'rahul.desai@lexisora.com',
} as const;

/** Sign in through the real login form. */
export async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Workspace').fill(WORKSPACE);
  await page.getByLabel('Official email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export async function signOut(page: Page) {
  await page.locator('.user-btn').click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** Expect a toast containing text. */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator('.toast').filter({ hasText: text }).first()).toBeVisible();
}

/** Bearer token for API-level steps (native client → tokens in body). */
export async function apiLogin(request: APIRequestContext, email: string): Promise<string> {
  const r = await request.post(`${API}/auth/login`, { data: { workspace: WORKSPACE, email, password: PASSWORD, client: 'tracker' } });
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()).accessToken as string;
}

export const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

export function sidebar(page: Page) {
  return page.locator('aside.sidebar');
}
