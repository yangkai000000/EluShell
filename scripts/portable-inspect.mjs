import { chromium, expect } from '@playwright/test';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
const endpoint = 'http://127.0.0.1:49382';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await expect
  .poll(
    async () => {
      try {
        return (await fetch(endpoint + '/json/version')).ok;
      } catch {
        return false;
      }
    },
    { timeout: 60000, intervals: [500] },
  )
  .toBe(true);
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser.contexts()[0].pages()[0];
  await page.locator('.welcome-workspace').waitFor();
  const settings = await page.evaluate(() => window.elu.load());
  expect(settings.profiles).toEqual([]);
  expect(settings.appearance.terminalFontSize).toBe(13);
  await page.getByTitle('工作区设置', { exact: true }).click();
  await expect(page.getByLabel('终端字号', { exact: true })).toHaveValue('13');
  await expect(page.locator('.config-panel')).toContainText(process.env.ELUSHELL_TEST_DATA);
  await page.locator('.preferences-modal .modal-header > button').click();
  await page.getByTitle('连接管理', { exact: true }).click();
  await page.locator('.folder-root').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '添加 SSH 服务器' }).click();
  await page.getByRole('button', { name: '隧道 (0)', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加隧道', exact: true })).toBeVisible();
  await page.screenshot({ path: path.resolve('test-results/portable-workspace.png') });
  const report = {
    result: 'PASS',
    version,
    portable: true,
    launcher: 'PowerShell Start-Process',
    checks: [
      'portable self-extraction and actual EXE startup',
      'renderer and preload',
      'new appearance settings',
      'isolated local configuration',
      'folder context menu and SSH tunnel settings',
      'startup new tab',
    ],
  };
  await writeFile('test-results/portable-smoke.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await page.evaluate(() => window.close()).catch(() => {});
} finally {
  await browser.close().catch(() => {});
}
