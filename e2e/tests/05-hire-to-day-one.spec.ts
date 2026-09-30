import { expect, test } from '@playwright/test';
import { PERSONA, expectToast, signIn } from './helpers';

const MAILPIT = 'http://localhost:8025/api/v1';

/** Flow 05 (core) — HR adds an employee, the invite arrives, the joiner starts onboarding. */
test.describe.serial('Flow 05 · Hire to day one', () => {
  const email = `e2e.joiner.${Date.now()}@lexisora.com`;

  test('HR adds an employee and an onboarding invite is emailed', async ({ page, request }) => {
    await signIn(page, PERSONA.hr);
    await page.goto('/employees');
    await page.getByRole('button', { name: 'Add employee' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Full name').fill('Esha Test');
    await d.getByLabel('Official email').fill(email);
    const personal = d.getByLabel(/Personal email/);
    if (await personal.count()) await personal.fill(email);
    await d.getByLabel(/Joining date/).fill(new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10));
    await d.getByRole('button', { name: /Add & send onboarding invite/ }).click();
    await expectToast(page, /Invite sent/);

    await expect
      .poll(async () => {
        const r = await request.get(`${MAILPIT}/search?query=${encodeURIComponent('to:' + email)}`);
        return ((await r.json()).messages ?? []).length;
      }, { timeout: 15_000 })
      .toBeGreaterThan(0);
  });

  test('joiner accepts the invite and lands on onboarding', async ({ page, request }) => {
    const list = await (await request.get(`${MAILPIT}/search?query=${encodeURIComponent('to:' + email)}`)).json();
    const msg = await (await request.get(`${MAILPIT}/message/${list.messages[0].ID}`)).json();
    const link = /\/accept-invite\?token=[\w-]+/.exec(msg.Text ?? msg.HTML ?? '')?.[0];
    expect(link, 'invite link in email').toBeTruthy();
    await page.goto(link!);
    await page.getByLabel('New password').fill('Welcome@2026');
    await page.getByLabel('Confirm password').fill('Welcome@2026');
    await page.getByRole('button', { name: /Set password/ }).click();
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.locator('main')).toContainText(/Offer letter/i);
  });
});
