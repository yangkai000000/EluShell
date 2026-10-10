import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
const out = path.resolve('test-results');
await mkdir(out, { recursive: true });
const packaged = process.argv.includes('--packaged');
const app = await electron.launch({
  ...(packaged
    ? { executablePath: path.resolve('release/win-unpacked/EluShell.exe') }
    : { args: ['.'] }),
  env: { ...process.env, ELUSHELL_TEST_DATA: await mkdtemp(path.join(out, 'workspace-v2-')) },
});
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.xterm').waitFor();
  await expect(page.locator('.command-sidebar')).toHaveCount(0);
  const terminal = await page.locator('.terminal-panel').boundingBox();
  if (terminal.height < 450) throw Error('Terminal default height too small');
  await page.locator('.tree-select[title="/opt/services/logs"]').click();
  await expect(page.getByRole('textbox', { name: '远程目录' })).toHaveValue('/opt/services/logs');
  await page.locator('.tree-select[title="/opt/services/logs/archive"]').click();
  await expect(page.getByRole('textbox', { name: '远程目录' })).toHaveValue(
    '/opt/services/logs/archive',
  );
  const command = page.getByRole('textbox', { name: '命令输入' });
  await command.fill('cd /var/log');
  await command.press('Enter');
  await expect(page.getByRole('textbox', { name: '远程目录' })).toHaveValue('/var/log');
  await page.locator('.terminal-mount .xterm-helper-textarea').focus();
  await page.keyboard.type('cd /opt/services');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: '远程目录' })).toHaveValue('/opt/services');
  await page.getByRole('separator', { name: '调整监控栏宽度' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.sidebar')).toHaveCSS('width', '256px');
  const grip = page.getByRole('separator', { name: '调整目录树宽度' });
  const box = await grip.boundingBox();
  await page.mouse.move(box.x + 3, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + 63, box.y + 50);
  await page.mouse.up();
  await expect(page.locator('.tree-pane')).toHaveCSS('width', '280px');
  await page.getByRole('separator', { name: '调整文件面板高度' }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.bottom-panel')).toHaveCSS('height', '266px');
  await page.getByRole('button', { name: '终端专注模式', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveCSS('width', '0px');
  await expect(page.locator('.bottom-panel')).toHaveClass(/bottom-collapsed/);
  await page.getByRole('button', { name: '终端专注模式', exact: true }).click();
  await expect(page.locator('.tree-pane')).toBeVisible();
  await page.getByRole('button', { name: '切换目录树', exact: true }).click();
  await expect(page.locator('.tree-pane')).toHaveCount(0);
  await page.getByRole('button', { name: '切换目录树', exact: true }).click();
  await page
    .locator('.session-tabs')
    .getByRole('button', { name: '连接管理', exact: true })
    .click();
  await page.getByRole('button', { name: '添加 SSH 服务器' }).click();
  await page.getByLabel('连接名称', { exact: true }).fill('Tunnel fixture');
  await page.getByLabel('主机 / IP', { exact: true }).fill('127.0.0.1');
  await page.getByRole('button', { name: '添加隧道', exact: true }).click();
  await page.getByLabel('监听端口', { exact: true }).fill('15432');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect
    .poll(async () => {
      const settings = await page.evaluate(() => window.elu.load());
      return settings.profiles[0]?.tunnels?.[0]?.bindPort;
    })
    .toBe(15432);
  await page.screenshot({ path: path.join(out, 'tunnel-settings.png') });
  await page.locator('.modal-header>button').click();
  await page.locator('.toast').waitFor({ state: 'hidden' });
  await page.screenshot({
    path: path.join(out, packaged ? 'workspace-v2-packaged.png' : 'workspace-v2.png'),
  });
  await page.reload();
  await page.locator('.xterm').waitFor();
  await expect(page.locator('.sidebar')).toHaveCSS('width', '256px');
  await expect(page.locator('.tree-pane')).toHaveCSS('width', '280px');
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.screenshot({ path: path.join(out, 'workspace-v2-compact.png') });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw Error('Horizontal overflow');
  if (errors.length) throw Error(errors.join('\n'));
  const report = {
    result: 'PASS',
    packaged,
    checks: [
      'terminal default height',
      'removed command sidebar',
      'nested tree navigation',
      'input-bar cd synchronization',
      'direct terminal cd synchronization',
      'monitor keyboard resize',
      'tree drag resize',
      'file area resize',
      'fold and restore',
      'layout persistence',
      'tunnel profile persistence',
      'compact layout',
    ],
    errors,
  };
  await writeFile(
    path.join(out, packaged ? 'workspace-v2-packaged.json' : 'workspace-v2.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app.close();
}
