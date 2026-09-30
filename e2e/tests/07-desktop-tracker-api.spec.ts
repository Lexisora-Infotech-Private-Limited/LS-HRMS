import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { API, PASSWORD, PERSONA, WORKSPACE, apiLogin, bearer } from './helpers';

/**
 * Flow 02 — Desktop tracker day, driven through the tracker's HTTP contract exactly as the
 * Electron app does: sign in → pair (6-digit code approved in the portal) → policy/tasks →
 * punch in → sync activity → screenshot → today → punch out.
 */
test.describe.serial('Flow 02 · Desktop tracker day (API contract)', () => {
  let pairingToken = '';
  let code = '';
  let deviceToken = '';

  test('sign in and request pairing', async ({ request }) => {
    const r = await request.post(`${API}/tracker/auth/login`, { data: { workspace: WORKSPACE, email: PERSONA.employee, password: PASSWORD } });
    expect(r.status(), await r.text()).toBe(200);
    const body = await r.json();
    pairingToken = body.pairingToken;
    expect(body.mode).toBe('PUNCH');

    const s = await request.post(`${API}/tracker/pair/start`, {
      headers: bearer(pairingToken),
      data: { hostname: 'E2E-LAPTOP', os: 'Windows 11', appVersion: '1.4.2' },
    });
    expect(s.status(), await s.text()).toBeLessThan(300);
    code = (await s.json()).code;
    expect(code).toMatch(/^\d{6}$/);
  });

  test('employee approves the code in the portal; device gets a token', async ({ request }) => {
    const web = await apiLogin(request, PERSONA.employee);
    const a = await request.post(`${API}/devices/approve`, { headers: bearer(web), data: { code } });
    expect(a.status(), await a.text()).toBeLessThan(300);
    const st = await request.get(`${API}/tracker/pair/status`, { headers: bearer(pairingToken) });
    const status = await st.json();
    expect(status.status).toBe('APPROVED');
    deviceToken = status.deviceToken;
    expect(deviceToken).toBeTruthy();
  });

  test('policy and tasks follow HR rules', async ({ request }) => {
    const p = await (await request.get(`${API}/tracker/policy`, { headers: bearer(deviceToken) })).json();
    expect(p.idleThresholdMin).toBeGreaterThan(0);
    expect(p.screenshotIntervalMin).toBeGreaterThan(0);
    const tasks = await (await request.get(`${API}/tracker/tasks`, { headers: bearer(deviceToken) })).json();
    expect(Array.isArray(tasks)).toBe(true);
  });

  test('punch in, sync work, upload a screenshot, punch out', async ({ request }) => {
    const tasks = await (await request.get(`${API}/tracker/tasks`, { headers: bearer(deviceToken) })).json();
    const taskId = tasks[0]?.id ?? null;
    const pin = await request.post(`${API}/tracker/punch`, { headers: bearer(deviceToken), data: { direction: 'IN', clientId: randomUUID(), at: new Date().toISOString() } });
    expect(pin.status(), await pin.text()).toBeLessThan(300);

    const end = new Date();
    const start = new Date(end.getTime() - 20 * 60_000);
    const batch = {
      deviceTime: end.toISOString(),
      events: [{ clientId: randomUUID(), type: 'TASK_SWITCH', at: start.toISOString(), taskId }],
      segments: [{ clientId: randomUUID(), kind: 'WORK', taskId, startedAt: start.toISOString(), endedAt: end.toISOString(), keyboardEvents: 900, mouseEvents: 400 }],
    };
    const sync = await request.post(`${API}/tracker/sync`, { headers: bearer(deviceToken), data: batch });
    expect(sync.status(), await sync.text()).toBeLessThan(300);
    const again = await request.post(`${API}/tracker/sync`, { headers: bearer(deviceToken), data: batch });
    expect((await again.json()).duplicates).toBeGreaterThan(0); // idempotent replay

    // 1×1 PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const shot = await request.post(`${API}/tracker/screenshots`, {
      headers: bearer(deviceToken),
      multipart: {
        file: { name: 'shot.png', mimeType: 'image/png', buffer: png },
        meta: JSON.stringify({ clientId: randomUUID(), capturedAt: end.toISOString(), taskId, monitorCount: 1, blurred: false }),
      },
    });
    expect(shot.status(), await shot.text()).toBeLessThan(300);

    const today = await (await request.get(`${API}/tracker/today`, { headers: bearer(deviceToken) })).json();
    expect(today.workedSeconds).toBeGreaterThan(0);

    const pout = await request.post(`${API}/tracker/punch`, { headers: bearer(deviceToken), data: { direction: 'OUT', clientId: randomUUID(), at: new Date().toISOString() } });
    expect(pout.status(), await pout.text()).toBeLessThan(300);
  });
});
