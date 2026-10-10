import { chromium, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
const out = path.resolve('test-results');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir(out, { recursive: true });
const dataDir = await mkdtemp(path.join(out, 'portable-user-'));
const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const child = spawn(
  path.resolve(`release/EluShell-${version}-windows-x64.exe`),
  [`--remote-debugging-port=${port}`, `--user-data-dir=${dataDir}`],
  { windowsHide: true, stdio: 'ignore', env: { ...process.env, ELUSHELL_TEST_DATA: dataDir } },
);
let exited = false;
child.on('exit', () => {
  exited = true;
});
let browser;
try {
  console.log('Waiting for the portable launcher to extract and start EluShell…');
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
        } catch {
          return false;
        }
      },
      { timeout: 60000, intervals: [500] },
    )
    .toBe(true);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  await page.locator('.welcome-workspace').waitFor();
  await expect(page.locator('.session-tab.selected')).toHaveText('新建标签页');
  await expect(page.locator('.welcome-workspace')).not.toContainText('演示');
  await page.getByTitle('工作区设置', { exact: true }).click();
  await expect(page.locator('.config-panel')).toContainText(dataDir);
  const info = await page.evaluate(() => window.elu.configInfo());
  expect(info.encrypted).toBe(true);
  await page.locator('.preferences-modal .modal-header > button').click();
  await page.getByTitle('连接管理', { exact: true }).click();
  await page.locator('.folder-root').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '添加 SSH 服务器' }).click();
  await page.getByRole('button', { name: '隧道 (0)', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加隧道', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(out, 'portable-workspace.png') });
  const report = {
    result: 'PASS',
    portable: true,
    checks: [
      'portable self-extraction',
      'renderer and preload startup',
      'no demo workspace',
      'configuration directory',
      'system encryption available',
      'connection and tunnel UI',
    ],
  };
  await writeFile(path.join(out, 'portable-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await page.evaluate(() => window.close()).catch(() => {});
} finally {
  await browser?.close().catch(() => {});
  if (!exited && child.pid) {
    await new Promise((resolve) => {
      const cleanup = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      cleanup.on('exit', resolve);
      cleanup.on('error', resolve);
    });
  }
}
