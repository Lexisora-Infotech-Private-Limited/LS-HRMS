import { expect, test, type Page } from '@playwright/test';
import { PERSONA, signIn } from './helpers';

/**
 * Safety net across the whole portal: for each role, open every screen in that role's sidebar and
 * fail on uncaught page errors, API error banners or a leftover "being built" placeholder.
 */
async function visitAll(page: Page, email: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, email);
  const links = await page.locator('aside.sidebar a.nav-link').evaluateAll((as) =>
    as.map((a) => ({ href: (a as HTMLAnchorElement).getAttribute('href') ?? '', label: (a.textContent ?? '').trim() })),
  );
  expect(links.length).toBeGreaterThan(5);
  const problems: string[] = [];
  for (const { href, label } of links) {
    errors.length = 0;
    await page.goto(href);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const main = page.locator('main');
    await expect(main, `${label} renders`).toBeVisible();
    const text = (await main.innerText()).slice(0, 4000);
    if (/is being built/i.test(text)) problems.push(`${label} (${href}): placeholder`);
    if (/Something went wrong|You don't have access to this screen/i.test(text)) problems.push(`${label} (${href}): error/no-access shown`);
    if (await page.locator('[role="alert"].note').count()) problems.push(`${label} (${href}): error banner`);
    if (errors.length) problems.push(`${label} (${href}): page error — ${errors[0]}`);
  }
  expect(problems, problems.join('\n')).toEqual([]);
}

test.describe('Every screen renders for each role', () => {
  test.setTimeout(240_000);
  test('admin / CEO', async ({ page }) => visitAll(page, PERSONA.admin));
  test('HR', async ({ page }) => visitAll(page, PERSONA.hr));
  test('reporting manager', async ({ page }) => visitAll(page, PERSONA.manager));
  test('project lead', async ({ page }) => visitAll(page, PERSONA.lead));
  test('employee', async ({ page }) => visitAll(page, PERSONA.employee));
});
