import { expect, test, type Page } from '@playwright/test';

const ownerEmail = process.env.E2E_OWNER_EMAIL || 'marko@kortix.ai';
const testPassword = process.env.E2E_OWNER_PASSWORD || 'password1112';
const sandboxHealthUrl = process.env.E2E_SANDBOX_HEALTH_URL || 'http://127.0.0.1:14000/kortix/health';

async function waitForProviderStep(page: Page) {
  await expect
    .poll(async () => page.getByText(/Connect a provider/i).isVisible(), {
      timeout: 180_000,
      intervals: [1000, 2000, 3000, 5000],
    })
    .toBeTruthy();
}

async function waitForProviderOption(page: Page) {
  await expect
    .poll(async () => page.getByRole('button', { name: /OpenCode Zen|Anthropic|OpenAI/i }).count(), {
      timeout: 240_000,
      intervals: [1000, 2000, 3000, 5000],
    })
    .toBeGreaterThan(0);
}

async function waitForSandboxReady() {
  const started = Date.now();
  while (Date.now() - started < 480_000) {
    try {
      const res = await fetch(sandboxHealthUrl);
      if (res.ok) {
        const data = await res.json() as { status?: string; opencode?: boolean };
        if (data.status === 'ok' && data.opencode === true) {
          return;
        }
      }
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error(`Sandbox did not become ready at ${sandboxHealthUrl}`);
}

async function getAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const fromStorage = Object.keys(localStorage)
      .map((k) => localStorage.getItem(k))
      .filter(Boolean)
      .map((raw) => {
        try {
          const parsed = JSON.parse(raw as string);
          return parsed?.access_token || null;
        } catch {
          return null;
        }
      })
      .find(Boolean);
    if (fromStorage) return fromStorage;

    const cookie = document.cookie
      .split(';')
      .map((c) => c.trim())
      .find((c) => /^sb-.*-auth-token=/.test(c));
    if (!cookie) return null;

    const encoded = decodeURIComponent(cookie.split('=')[1] || '');
    if (!encoded.startsWith('base64-')) return null;

    try {
      const decoded = atob(encoded.slice('base64-'.length));
      const parsed = JSON.parse(decoded);
      return parsed?.access_token || null;
    } catch {
      return null;
    }
  });

  if (!token) {
    const authCookie = (await page.context().cookies()).find((cookie) => /^sb-.*-auth-token$/.test(cookie.name));
    if (authCookie) {
      const encoded = decodeURIComponent(authCookie.value || '');
      if (encoded.startsWith('base64-')) {
        try {
          const decoded = Buffer.from(encoded.slice('base64-'.length), 'base64').toString('utf8');
          const parsed = JSON.parse(decoded);
          if (parsed?.access_token) {
            return parsed.access_token as string;
          }
        } catch {
          // fall through to error below
        }
      }
    }

    throw new Error('Access token missing in browser session');
  }

  return token;
}

test.describe('Self-hosted setup + auth', () => {
  test.setTimeout(600_000);

  test.beforeAll(async () => {
    const apiBase = process.env.E2E_API_URL || 'http://localhost:13738/v1';
    const installStatus = await fetch(`${apiBase}/setup/install-status`);
    if (!installStatus.ok) {
      throw new Error(`API not reachable at ${apiBase} (status ${installStatus.status})`);
    }
  });

  test('installer-created owner can complete setup path and reach dashboard', async ({ page }) => {
    const apiBase = process.env.E2E_API_URL || 'http://localhost:13738/v1';

    const bootstrapResponse = await page.request.post(`${apiBase}/setup/bootstrap-owner`, {
      data: { email: ownerEmail, password: testPassword },
    });
    expect(bootstrapResponse.status()).toBe(200);

    await page.goto('/auth?redirect=%2Fonboarding');
    await expect(page.getByText('Click or press Enter to sign in')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Sign in to Kortix' })).toBeVisible();

    await page.locator('input[name="email"]').fill(ownerEmail);
    await page.locator('input[name="password"]').fill(testPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await waitForProviderStep(page);
    await waitForSandboxReady();
    await waitForProviderOption(page);
    await expect(page.getByText(/Choose a provider to power model access in chat/i)).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Add tool keys' })).toBeVisible();
    await expect(page.getByText(/Optional API keys for agent capabilities/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now' }).click();

    await expect(page).toHaveURL(/\/onboarding/);

    // Deterministic transition into dashboard while preserving onboarding coverage.
    await page.goto('/onboarding?skip_onboarding=1');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('button', { name: 'New session' })).toBeVisible();

    const commandPaletteHeading = page.getByRole('heading', { name: 'Command Palette' });
    if (await commandPaletteHeading.isVisible().catch(() => false)) {
      await page.keyboard.press('Control+KeyK');
      if (await commandPaletteHeading.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape');
      }
    }

    const accessToken = await getAccessToken(page);

    const sshSetupResponse = await page.request.post(`${apiBase}/platform/sandbox/ssh/setup`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const sshSetupPayload = await sshSetupResponse.json();
    expect(sshSetupResponse.status()).toBe(200);
    expect(sshSetupPayload.success).toBeTruthy();
    expect(sshSetupPayload.data?.ssh_command || '').toContain('ssh -i ~/.ssh/kortix_sandbox');
    expect(sshSetupPayload.data?.public_key || '').toContain('ssh-ed25519');

    const tunnelName = `E2E Tunnel ${Date.now()}`;
    const createTunnelResponse = await page.request.post(`${apiBase}/tunnel/connections`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        name: tunnelName,
        capabilities: ['filesystem', 'shell'],
      },
    });
    const createTunnelPayload = await createTunnelResponse.json();
    expect(createTunnelResponse.status()).toBe(201);
    expect(createTunnelPayload.tunnelId).toBeTruthy();
    expect(createTunnelPayload.setupToken).toBeTruthy();

    const tunnelId = createTunnelPayload.tunnelId as string;
    const tunnelDetailResponse = await page.request.get(`${apiBase}/tunnel/connections/${tunnelId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const tunnelDetailPayload = await tunnelDetailResponse.json();
    expect(tunnelDetailResponse.status()).toBe(200);
    expect(tunnelDetailPayload.name).toBe(tunnelName);

    const deleteTunnelResponse = await page.request.delete(`${apiBase}/tunnel/connections/${tunnelId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(deleteTunnelResponse.status()).toBe(200);

    await page.context().clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('/auth');
    await expect(page).toHaveURL(/\/auth/);
    await expect(page.getByText('Click or press Enter to sign in')).toBeVisible();
    await page.keyboard.press('Enter');

    await page.locator('input[name="email"]').fill(ownerEmail);
    await page.locator('input[name="password"]').fill(testPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/(dashboard|onboarding)/);

    await page.goto('/auth?redirect=%2Fonboarding');
    await expect(page).toHaveURL(/\/(dashboard|onboarding)/);
  });
});
