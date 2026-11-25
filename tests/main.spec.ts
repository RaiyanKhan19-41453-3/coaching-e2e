import { test, expect } from '@playwright/test';
import { MAIN_WEB, MAIN_API, mainAdminToken, api } from '../helpers';

test('platform UI: sign in, receive a live notification and upload a material', async ({ page }) => {
  const token = await mainAdminToken();

  await page.goto(MAIN_WEB);
  await page.getByLabel('Email').fill('admin@star.local');
  await page.getByLabel('Password').fill('Password123!');
  await page.getByLabel('Tenant slug').fill('star-coaching');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Live notifications' })).toBeVisible();

  await api(MAIN_API, '/api/communication/announcements', token, {
    title: 'E2E exam schedule', body: 'Finals next week', targetAudienceJson: '{"roles":["Admin"]}',
    priority: 1, isPinned: false,
  });
  await expect(page.getByText('E2E exam schedule')).toBeVisible({ timeout: 20_000 });

  const fileName = `e2e-${Date.now()}.txt`;
  await page.locator('input[type=file]').setInputFiles({
    name: fileName, mimeType: 'text/plain', buffer: Buffer.from('e2e upload content'),
  });
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText(fileName)).toBeVisible({ timeout: 20_000 });
});
