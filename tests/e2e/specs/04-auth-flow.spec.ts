import { test, expect } from '@playwright/test';
import { ownerEmail, ownerPassword, getAccessToken, apiBase } from '../helpers/auth';

test.describe('04 — Authentication flow', () => {
  test.setTimeout(120_000);

  test('owner can authenticate via Supabase API', async () => {
    const token = await getAccessToken();
    expect(token).toBeTruthy();
    expect(token).toMatch(/^eyJ/); // JWT
  });

  test('authenticated user can access setup-wizard-step', async () => {
    const token = await getAccessToken();
    const res = await fetch(`${apiBase}/setup/setup-wizard-step`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  test('authenticated user can access platform init status', async () => {
    const token = await getAccessToken();
    const res = await fetch(`${apiBase}/platform/init/local/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string };
    expect(data.status).toBe('ready');
  });

  test('browser login flow reaches wizard', async ({ page }) => {
    // Clear any existing session
    await page.context().clearCookies();

    await page.goto('/auth');
    await page.waitForTimeout(2_000);

    // Click through lock screen — the overlay div intercepts pointer events,
    // so we click the page body which triggers the overlay's click handler.
    const lockScreen = page.getByText('Click or press Enter to sign in');
    if (await lockScreen.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await page.locator('div.fixed.inset-0.cursor-pointer').first().click({ force: true });
      await page.waitForTimeout(1_500);
    }

    // May already be authenticated from a prior session, or show login form
    const signInHeading = page.getByRole('heading', { name: 'Sign in to Kortix' });
    const wizardHeading = page.getByRole('heading', { name: /Connect a provider/i });

    // Wait for either the login form or the wizard
    await expect(signInHeading.or(wizardHeading)).toBeVisible({ timeout: 15_000 });

    // If login form is showing, fill and submit
    if (await signInHeading.isVisible().catch(() => false)) {
      await page.locator('input[name="email"]').fill(ownerEmail);
      await page.locator('input[name="password"]').fill(ownerPassword);
      await page.getByRole('button', { name: 'Sign in' }).click();
    }

    // Should reach the setup wizard (Connect a provider) or dashboard
    await expect(
      wizardHeading.or(page.getByRole('button', { name: /New session/i })),
    ).toBeVisible({ timeout: 30_000 });
  });
});
