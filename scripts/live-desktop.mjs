import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
console.log('Ready for credentials on stdin; no credential persistence.');
if (process.stdin.isTTY) process.stdin.setRawMode(true);
const input = await new Promise((resolve) =>
  process.stdin.once('data', (d) => resolve(JSON.parse(d.toString()))),
);
const known = JSON.parse(await readFile('test-results/live-readonly.json', 'utf8'));
const userData = await mkdtemp(path.resolve('test-results/live-ui-'));
const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, ELUSHELL_TEST_DATA: userData },
});
try {
  await app.evaluate(({ dialog }, fingerprint) => {
    dialog.showMessageBox = async (_window, options) => ({
      response: options.detail?.includes(fingerprint) ? 1 : 0,
      checkboxChecked: false,
    });
  }, known.fingerprint);
  const page = await app.firstWindow();
  await page.locator('.terminal-mount .xterm').waitFor();
  await page
    .locator('.session-tabs')
    .getByRole('button', { name: '连接管理', exact: true })
    .click();
  await page.getByRole('button', { name: '添加 SSH 服务器' }).click();
  await page.getByLabel('连接名称', { exact: true }).fill('服务器只读验收');
  await page.getByLabel('主机 / IP', { exact: true }).fill(input.host);
  await page.getByLabel('用户名', { exact: true }).fill(input.username);
  await page.locator('input[type=password]').fill(input.password);
  input.password = '';
  await page.getByRole('button', { name: '保存并连接', exact: true }).click();
  await page
    .locator('.session-tab.selected')
    .filter({ hasText: '服务器只读验收' })
    .waitFor({ timeout: 30000 });
  await expect(page.locator('.core-mini i')).toHaveCount(16, { timeout: 30000 });
  await expect
    .poll(() => page.locator('.file-table tbody tr').count(), { timeout: 30000 })
    .toBeGreaterThan(0);
  await expect(page.locator('.sidebar .metric').filter({ hasText: '网络流量' })).toContainText(
    'eth0',
  );
  await page.getByRole('button', { name: /内存 详情/ }).click();
  await page.getByText('可用内存', { exact: true }).waitFor();
  await page.locator('.modal-header > button').click();
  const folder = page.getByRole('textbox', { name: '远程目录' });
  const original = await folder.inputValue();
  const command = page.getByRole('textbox', { name: '命令输入' });
  await command.fill('cd /tmp');
  await command.press('Enter');
  await expect(folder).toHaveValue('/tmp', { timeout: 15000 });
  const terminal = page.locator('.terminal-mount:visible .xterm-helper-textarea');
  await terminal.focus();
  await page.keyboard.type('cd /');
  await page.keyboard.press('Enter');
  await expect(folder).toHaveValue('/', { timeout: 15000 });
  await command.fill('cd /__elushell_missing_test_directory__');
  await command.press('Enter');
  await page.waitForTimeout(1500);
  await expect(folder).toHaveValue('/');
  await command.fill("cd -- '" + original.replace(/'/g, "'\\''") + "'");
  await command.press('Enter');
  await expect(folder).toHaveValue(original, { timeout: 15000 });
  await page.locator('.toast').waitFor({ state: 'hidden' });
  await page.screenshot({ path: 'test-results/live-workspace-v2.png' });
  await writeFile(
    'test-results/live-desktop-v2.json',
    JSON.stringify(
      {
        result: 'PASS',
        checks: [
          'real SSH via desktop',
          '16 CPU cores rendered',
          'default route eth0',
          'real SFTP directory rendered',
          'memory detail',
          'real cd sync from command bar',
          'real cd sync from terminal',
          'failed cd preserves file directory',
          'original working directory restored',
        ],
        host: input.host,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: real SSH, 16 CPU cores, eth0, SFTP and memory detail verified in Electron UI.',
  );
} finally {
  input.password = '';
  await app.close();
  process.stdin.destroy();
}
