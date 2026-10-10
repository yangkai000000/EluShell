import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';
const out = path.resolve('test-results');
const base = await mkdtemp(path.join(out, 'newtab-v6-')),
  user = path.join(base, '.EluShell'),
  root = path.join(base, 'remote');
await mkdir(root);
let connections = 0;
const server = await fixture(root, {
  password: 'newtab-fixture',
  input: () => {},
  authenticated: () => connections++,
});
const packaged = process.argv.includes('--packaged'),
  errors = [];
let app, page;
const launch = async () => {
  app = await electron.launch({
    ...(packaged
      ? { executablePath: path.resolve('release/win-unpacked/EluShell.exe') }
      : { args: ['.'] }),
    env: { ...process.env, ELUSHELL_TEST_DATA: user },
  });
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.new-tab-page').waitFor();
};
const state = () => page.evaluate(() => window.elu.load());
const recent = (name) =>
  page
    .locator('.recent-connections tbody tr')
    .filter({ has: page.getByText(name, { exact: true }) });
try {
  await launch();
  await expect(page.locator('.session-tab.selected')).toHaveText('新建标签页');
  const profiles = await page.evaluate(async (port) => {
    const s = await window.elu.load();
    const profiles = ['最近服务器 A', '最近服务器 B', '未保存密码'].map((name, i) => ({
      id: 'recent-' + i,
      name,
      host: '127.0.0.1',
      port,
      username: 'fixture',
      folderId: 'dev',
      group: '开发环境',
      tags: [],
      auth: 'password',
      startup: '',
      autoStartup: false,
    }));
    for (const p of profiles.slice(0, 2))
      await window.elu.saveCredential(p, 'newtab-fixture', true);
    await window.elu.save({ ...s, profiles, folders: [{ id: 'dev', name: '开发环境' }] });
    return profiles;
  }, server.port);
  await page.reload();
  await recent(profiles[0].name).waitFor();
  await recent(profiles[0].name).click();
  await expect(page.locator('.session-tab.selected')).toHaveText('新建标签页');
  await recent(profiles[0].name).dblclick();
  await expect(page.locator('.session-tab.selected')).toContainText(profiles[0].name);
  await expect(page.locator('.session-tab')).toHaveCount(1);
  await expect
    .poll(async () => (await state()).recentConnections.map((r) => r.profileId))
    .toEqual([profiles[0].id]);
  await page.locator('.xterm').waitFor();
  await page.evaluate(() => {
    window.originalTerminal = document.querySelector('.xterm');
  });
  await page.getByTitle('新建标签页', { exact: true }).click();
  await expect(page.locator('.new-tab-page')).toBeVisible();
  await expect(page.locator('.recent-connections tbody tr')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: '连接管理', exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() => window.originalTerminal === document.querySelector('.xterm')),
  ).toBe(true);
  await page
    .locator('.session-tab')
    .filter({ hasText: profiles[0].name })
    .locator('button')
    .first()
    .click();
  expect(
    await page.evaluate(() => window.originalTerminal === document.querySelector('.xterm')),
  ).toBe(true);
  await expect(page.locator('.xterm')).toBeVisible();
  await page
    .locator('.session-tab')
    .filter({ hasText: '新建标签页' })
    .locator('button')
    .first()
    .click();
  await recent(profiles[0].name).dblclick();
  await expect(page.locator('.session-tab')).toHaveCount(2);
  await expect(page.locator('.xterm')).toHaveCount(2);
  expect((await state()).recentConnections).toHaveLength(1);
  await page.getByTitle('新建标签页', { exact: true }).click();
  await page.locator('.session-tabs').getByTitle('连接管理', { exact: true }).click();
  await page
    .locator('.connection-list .profile-item')
    .filter({ hasText: profiles[1].name })
    .dblclick();
  await expect(page.locator('.session-tab.selected')).toContainText(profiles[1].name);
  await expect
    .poll(async () => (await state()).recentConnections.map((r) => r.profileId))
    .toEqual([profiles[1].id, profiles[0].id]);
  await app.close();
  await launch();
  await expect(page.locator('.recent-connections tbody tr').first()).toContainText(
    profiles[1].name,
  );
  await expect(recent(profiles[0].name)).toContainText('开发环境');
  await page.getByLabel('筛选最近连接').fill('服务器 A');
  await expect(page.locator('.recent-connections tbody tr')).toHaveCount(1);
  await page.getByLabel('筛选最近连接').fill('');
  await page.screenshot({ path: path.join(out, 'new-tab-v6.png') });
  await recent(profiles[1].name).dblclick();
  await expect(page.locator('.session-tab.selected')).toContainText(profiles[1].name);
  await page.locator('.session-tab.selected').getByTitle('关闭会话').click();
  await expect(page.locator('.session-tab.selected')).toHaveText('新建标签页');
  await page.getByRole('button', { name: '清空最近记录', exact: true }).click();
  await expect.poll(async () => (await state()).recentConnections).toEqual([]);
  expect((await state()).profiles).toHaveLength(3);
  await recent('未保存密码').dblclick();
  await expect(page.getByRole('dialog', { name: '连接管理', exact: true })).toBeVisible();
  await expect(page.getByLabel('连接名称', { exact: true })).toHaveValue('未保存密码');
  expect(errors).toEqual([]);
  const report = {
    result: 'PASS',
    packaged,
    checks: [
      'startup new tab',
      'single click selects and double click connects',
      'plus creates a new tab without opening connection manager',
      'switching new tabs preserves live terminal DOM and connections',
      'new connection replaces the originating new tab',
      'deduplicated most-recent-first list persists across restart',
      'search and folder path',
      'last tab close opens a fresh new tab',
      'clear recent keeps saved profiles',
      'unsaved password opens connection form',
    ],
    errors,
  };
  await writeFile(
    path.join(out, packaged ? 'newtab-packaged.json' : 'newtab-desktop.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  await page?.screenshot({ path: path.join(out, 'newtab-failure.png') }).catch(() => {});
  throw e;
} finally {
  await app?.close().catch(() => {});
  await server.close();
}
