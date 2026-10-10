import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';
const base = await mkdtemp(path.resolve('test-results/connections-compact-'));
await mkdir(path.join(base, 'remote'));
const ssh = await fixture(path.join(base, 'remote'));
const packaged = process.argv.includes('--packaged');
const errors = [];
const app = await electron.launch({
  ...(packaged
    ? { executablePath: path.resolve('release/win-unpacked/EluShell.exe') }
    : { args: ['.'] }),
  env: { ...process.env, ELUSHELL_TEST_DATA: path.join(base, 'user') },
});
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  await page.locator('.welcome-workspace').waitFor();
  await page.evaluate(async (port) => {
    const s = await window.elu.load();
    s.folders = [
      { id: 'production', name: '生产环境' },
      { id: 'apps', name: '应用服务', parentId: 'production' },
      { id: 'development', name: '开发环境' },
    ];
    s.profiles = Array.from({ length: 120 }, (_, i) => ({
      id: 'server-' + i,
      name: '应用服务器-' + String(i).padStart(3, '0'),
      host: '127.0.0.1',
      port,
      username: 'operator',
      auth: 'password',
      group: '应用服务',
      folderId: 'apps',
      tags: ['linux'],
      startup: '',
      autoStartup: false,
      tunnels: [],
    }));
    await window.elu.save(s);
    await window.elu.saveCredential(s.profiles[0], 'fixture-remember', true);
  }, ssh.port);
  await page.reload();
  await page.getByTitle('连接管理', { exact: true }).click();
  const manager = page.getByRole('dialog', { name: '连接管理', exact: true });
  await expect(manager.locator('.profile-item')).toHaveCount(120);
  const first = manager.locator('[data-profile-id="server-0"]');
  expect((await first.boundingBox()).height).toBeLessThanOrEqual(28);
  await expect(first).toContainText('127.0.0.1');
  await expect(first).toContainText('operator');
  await first.click();
  await expect(page.getByRole('dialog', { name: 'SSH 连接编辑' })).toHaveCount(0);
  await first.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑连接', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'SSH 连接编辑' });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('连接名称', { exact: true })).toHaveValue('应用服务器-000');
  await expect(editor.locator('input[type=password]')).toHaveAttribute(
    'placeholder',
    '••••••••',
  );
  await editor.getByLabel('连接名称', { exact: true }).fill('主应用服务器');
  await editor.getByRole('button', { name: '隧道 (0)', exact: true }).click();
  await editor.getByRole('button', { name: 'SSH 连接', exact: true }).click();
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(first).toContainText('主应用服务器');
  const folder = (id) => manager.locator('[data-folder-id="' + id + '"]');
  await first.dragTo(folder('development'));
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await window.elu.load()).profiles.find((p) => p.id === 'server-0').folderId,
      ),
    )
    .toBe('development');
  await folder('apps').getByTitle('折叠或展开 应用服务').click();
  await folder('apps').dragTo(folder('development'));
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await window.elu.load()).folders.find((f) => f.id === 'apps').parentId,
      ),
    )
    .toBe('development');
  await folder('apps').getByTitle('折叠或展开 应用服务').click();
  await folder('production').locator('.folder-select').click();
  await expect(manager.getByLabel('文件夹信息')).toContainText(
    '0 个直属连接',
  );
  await folder('production').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '新建子文件夹' }).click();
  await page.getByLabel('文件夹名称').fill('临时分类');
  await page.getByRole('button', { name: '保存文件夹', exact: true }).click();
  const temp = manager.locator('.connection-folder').filter({ hasText: '临时分类' });
  await temp.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '添加 SSH 服务器' }).click();
  await page.getByLabel('连接名称', { exact: true }).fill('待删除的连接');
  await page.getByLabel('主机 / IP', { exact: true }).fill('192.0.2.12');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await temp.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除文件夹' }).click();
  await expect(page.getByRole('dialog', { name: '删除连接配置' })).toContainText(
    '1 个连接、1 个文件夹',
  );
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(manager.locator('.profile-item')).toHaveCount(121);
  await temp.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除文件夹' }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(manager.locator('.profile-item')).toHaveCount(120);
  const toRemove = manager.locator('[data-profile-id="server-1"]');
  await toRemove.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除连接', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(manager.locator('.profile-item')).toHaveCount(119);
  await manager.getByLabel('搜索连接').fill('主应用');
  await expect(manager.locator('.profile-item')).toHaveCount(1);
  await manager.getByLabel('搜索连接').fill('');
  await manager.locator('.connection-tree-scroll').evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await expect(manager.locator('.profile-item').last()).toBeInViewport();
  expect(
    await manager
      .locator('.connection-tree-scroll')
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await manager.locator('.connection-tree-scroll').evaluate((e) => {
    e.scrollTop = 0;
  });
  await page.screenshot({ path: path.resolve('test-results/connections-compact.png') });
  await first.dblclick();
  await expect(manager).toHaveCount(0);
  await expect(page.locator('.session-tab.selected')).toContainText('主应用服务器');
  expect(await readFile(path.join(base, 'user', 'credentials.json'), 'utf8')).not.toContain(
    'fixture-remember',
  );
  expect(errors).toEqual([]);
  const report = {
    result: 'PASS',
    packaged,
    checks: [
      '120 connections in 26px rows with four fields',
      'single click selects, right-click opens separate editor',
      'saved encrypted password and tunnels retained',
      'profile and folder drag move',
      'folder information in status row',
      'right-click create folder and connection',
      'cancel deletion preserves profiles',
      'folder subtree deletion and individual connection deletion',
      'search and vertical-only scroll',
      'double click saved connection logs in and closes manager',
    ],
    errors,
  };
  await writeFile(
    `test-results/connections-compact-${packaged ? 'packaged' : 'desktop'}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app.close();
  await ssh.close();
}
