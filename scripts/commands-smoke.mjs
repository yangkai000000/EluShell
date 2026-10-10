import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';
const out = path.resolve('test-results');
await mkdir(out, { recursive: true });
const base = await mkdtemp(path.join(out, 'commands-v6-')),
  user = path.join(base, '.EluShell');
const root = path.join(base, 'remote');
await mkdir(root);
const metrics =
  '\n@@HOST\ncommand-fixture\nLinux fixture\n@@UP\n100 200\n0.1 0.2 0.3\n@@CPU\ncpu 10 0 0 90 0 0 0 0\ncpu0 10 0 0 90 0 0 0 0\n@@MEM\nMemTotal: 1000000 kB\nMemAvailable: 500000 kB\n@@PS\nPID USER CPU RSS ARGS\n42 app 9.1 2048 java -jar app.jar\n';
const aInput = [],
  bInput = [];
const make = (input) =>
  fixture(root, {
    password: 'commands-fixture',
    input: (text) => input.push(text),
    exec: (command) => (command.includes('@@HOST') ? metrics : ''),
  });
const serverA = await make(aInput),
  serverB = await make(bInput),
  packaged = process.argv.includes('--packaged');
let app, page;
const errors = [];
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
  await page.locator('.welcome-workspace').waitFor();
};
const state = () => page.evaluate(() => window.elu.load());
const connect = async (name) => {
  await page.locator('.session-tabs').getByTitle('连接管理', { exact: true }).click();
  await page.locator('.connection-list .profile-item').filter({ hasText: name }).dblclick();
  await expect(page.getByRole('dialog', { name: '连接管理', exact: true })).toHaveCount(0);
};
const category = (name) =>
  page.locator('.command-folder-tabs').getByRole('button', { name, exact: true });
const command = (name) =>
  page.locator('.compact-commands').getByRole('button', { name, exact: true });
const context = async (node, action) => {
  await node.click({ button: 'right' });
  await page.getByRole('menuitem', { name: action, exact: true }).click();
};
const editText = async (label, text) => {
  const editor = page.getByRole('textbox', { name: label, exact: true });
  await editor.fill(text);
};
try {
  await launch();
  const profiles = await page.evaluate(
    async ([portA, portB]) => {
      const settings = await window.elu.load();
      const profiles = [portA, portB].map((port, i) => ({
        id: crypto.randomUUID(),
        name: i ? 'Server B' : 'Server A',
        host: '127.0.0.1',
        port,
        username: 'fixture',
        group: '',
        tags: ['linux'],
        auth: 'password',
        startup: '',
        autoStartup: false,
      }));
      for (const p of profiles) await window.elu.saveCredential(p, 'commands-fixture', true);
      await window.elu.save({
        ...settings,
        profiles,
        history: {
          [profiles[0].id]: Array.from({ length: 100 }, (_, i) => 'old-' + i),
          [profiles[1].id]: ['only-server-b'],
        },
      });
      return profiles;
    },
    [serverA.port, serverB.port],
  );
  await page.reload();
  await page.locator('.welcome-workspace').waitFor();
  await connect('Server A');
  await page.getByRole('button', { name: /^命令库/ }).click();
  await category('默认分类').waitFor();
  await expect(page.locator('.command-card')).toHaveCount(0);
  expect(await page.locator('.compact-command').count()).toBe(19);
  await expect(page.getByRole('region', { name: '命令编辑器', exact: true })).toBeVisible();
  const input = page.getByLabel('命令输入', { exact: true });
  await input.fill('keep-input-draft');
  await command('系统概览').click();
  await expect.poll(() => aInput.join('')).toContain('uname -a && uptime\r');
  await expect(input).toHaveValue('keep-input-draft');
  expect((await state()).history[profiles[1].id]).toEqual(['only-server-b']);
  await expect
    .poll(async () => (await state()).history[profiles[0].id][0])
    .toBe('uname -a && uptime');
  expect((await state()).history[profiles[0].id]).toHaveLength(100);
  expect((await state()).history[profiles[0].id]).not.toContain('old-99');
  await page.getByTitle('新建命令分类', { exact: true }).click();
  await page.getByLabel('命令分类名称', { exact: true }).fill('项目运维');
  await page.getByRole('button', { name: '保存分类', exact: true }).click();
  await category('项目运维').waitFor();
  await context(page.locator('.compact-commands'), '添加命令…');
  await page.getByLabel('命令名称', { exact: true }).fill('服务检查');
  await editText('快捷命令内容', 'printf LIBRARY_DIRECT');
  await page.getByRole('button', { name: '保存命令', exact: true }).click();
  await command('服务检查').waitFor();
  await command('服务检查').click();
  await expect.poll(() => aInput.join('')).toContain('printf LIBRARY_DIRECT\r');
  await expect(input).toHaveValue('keep-input-draft');
  await context(command('服务检查'), '编辑命令…');
  await page.getByLabel('命令名称', { exact: true }).fill('应用检查');
  await editText('快捷命令内容', 'printf EDITED_DIRECT');
  await page.getByRole('button', { name: '保存命令', exact: true }).click();
  await context(command('应用检查'), '复制命令');
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('printf EDITED_DIRECT');
  await context(command('应用检查'), '复制为新命令');
  await page.getByRole('button', { name: '保存命令', exact: true }).click();
  await context(command('应用检查 副本'), '删除命令…');
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(command('应用检查 副本')).toHaveCount(0);
  await command('应用检查').click({ button: 'right' });
  await page.getByLabel('移动命令到分类', { exact: true }).selectOption('commands-default');
  await expect(command('应用检查')).toHaveCount(0);
  await category('默认分类').click();
  await command('应用检查').waitFor();
  await context(command('应用检查'), '载入右侧编辑器');
  await expect(page.getByRole('textbox', { name: '命令编辑器内容', exact: true })).toContainText(
    'printf EDITED_DIRECT',
  );
  await page.getByTitle('命令编辑器设置', { exact: true }).click();
  await page.getByRole('checkbox', { name: '发送后清空', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '末尾添加回车 CR', exact: true }).uncheck();
  await page.getByLabel('命令编辑器字号', { exact: true }).selectOption('15');
  await page.getByRole('checkbox', { name: '自动换行', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await editText('命令编辑器内容', 'NO_FINAL_CR');
  const beforeNoCR = aInput.length;
  await page.getByLabel('发送编辑器命令', { exact: true }).click();
  await expect.poll(() => aInput.slice(beforeNoCR).join('')).toBe('NO_FINAL_CR');
  await expect(page.getByRole('textbox', { name: '命令编辑器内容', exact: true })).toHaveText(
    'NO_FINAL_CR',
  );
  await connect('Server B');
  await expect(command('应用检查')).toBeVisible();
  await input.fill('docker ps -a');
  await input.press('Enter');
  await expect.poll(() => bInput.join('')).toContain('docker ps -a\r');
  await input.fill('dps');
  await expect(page.getByRole('listbox', { name: '命令建议' })).toContainText('docker ps -a');
  await input.press('ArrowDown');
  await input.press('Tab');
  await expect(input).toHaveValue('docker ps -a');
  await input.fill('');
  await page.getByTitle('当前连接历史（最近 100 条）', { exact: true }).click();
  await expect(page.getByRole('listbox', { name: '命令建议' })).toContainText('only-server-b');
  await expect(page.getByRole('listbox', { name: '命令建议' })).not.toContainText('LIBRARY_DIRECT');
  await page.keyboard.press('Escape');
  await connect('Server A'); // Two sessions for profile A, one for profile B.
  await page.getByTitle('命令编辑器设置', { exact: true }).click();
  await page.getByRole('checkbox', { name: '末尾添加回车 CR', exact: true }).check();
  await page.getByRole('checkbox', { name: '发送后清空', exact: true }).check();
  await page.keyboard.press('Escape');
  await page.getByLabel('命令编辑器发送目标', { exact: true }).selectOption('all');
  await editText('命令编辑器内容', 'BROADCAST_ONE\nBROADCAST_TWO');
  const beforeA = aInput.length,
    beforeB = bInput.length;
  await page.getByRole('textbox', { name: '命令编辑器内容', exact: true }).press('Control+Enter');
  await expect
    .poll(
      () =>
        aInput
          .slice(beforeA)
          .join('')
          .match(/BROADCAST_ONE\rBROADCAST_TWO\r/g)?.length || 0,
    )
    .toBe(2);
  await expect.poll(() => bInput.slice(beforeB).join('')).toBe('BROADCAST_ONE\rBROADCAST_TWO\r');
  await expect(page.getByRole('textbox', { name: '命令编辑器内容', exact: true })).toHaveText('');
  await expect
    .poll(async () => (await state()).history[profiles[1].id][0])
    .toBe('BROADCAST_ONE\nBROADCAST_TWO');
  expect(
    (await state()).history[profiles[0].id].filter((c) => c === 'BROADCAST_ONE\nBROADCAST_TWO'),
  ).toHaveLength(1);
  await input.fill('');
  await page.getByTitle('当前连接历史（最近 100 条）', { exact: true }).click();
  await expect(page.getByRole('listbox', { name: '命令建议' })).not.toContainText('only-server-b');
  await page.screenshot({ path: path.join(out, 'command-history-v6.png') });
  await page.getByRole('button', { name: '清空本连接历史', exact: true }).click();
  await expect.poll(async () => (await state()).history[profiles[0].id].length).toBe(0);
  expect((await state()).history[profiles[1].id].length).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await context(category('项目运维'), '编辑分类…');
  await page.getByLabel('命令分类名称', { exact: true }).fill('共享运维');
  await page.getByRole('button', { name: '保存分类', exact: true }).click();
  await category('默认分类').click();
  await context(command('系统概览'), '删除命令…');
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await editText('命令编辑器内容', '# retained shared draft');
  await page.getByRole('separator', { name: '调整命令编辑器宽度' }).focus();
  await page.keyboard.press('ArrowLeft');
  expect((await state()).commandWorkspace.editorWidth).toBe(326);
  await page.setViewportSize({ width: 1100, height: 760 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await page
    .locator('.compact-command')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(Math.max(...bounds)).toBeLessThanOrEqual(30);
  await page.screenshot({ path: path.join(out, 'command-workspace-v6.png') });
  const saved = await state();
  await app.close();
  await launch();
  const reopened = await state();
  expect(reopened.commandWorkspace).toEqual(saved.commandWorkspace);
  expect(reopened.history).toEqual(saved.history);
  expect(reopened.snippets.some((c) => c.id === 'builtin:sys')).toBe(false);
  expect(reopened.snippets.every((c) => !c.serverId)).toBe(true);
  expect(reopened.commandFolders.some((f) => f.name === '共享运维')).toBe(true);
  await connect('Server B');
  await page.getByRole('button', { name: /^命令库/ }).click();
  await expect(page.getByRole('textbox', { name: '命令编辑器内容', exact: true })).toHaveText(
    '# retained shared draft',
  );
  await expect(command('应用检查')).toBeVisible();
  const onDisk = JSON.parse(await readFile(path.join(user, 'settings.json'), 'utf8'));
  expect(onDisk.commandLibraryVersion).toBe(1);
  expect(errors).toEqual([]);
  const report = {
    result: 'PASS',
    packaged,
    checks: [
      'compact name-only shared command library',
      'default built-ins and custom categories',
      'add/edit/copy/delete/move command menus',
      'category rename',
      'single-click direct terminal send preserving input draft',
      'per-connection 100-entry deduplicated histories',
      'fuzzy history matching and keyboard completion',
      'current/all-session dispatch over actual SSH',
      'multiline CR, Ctrl+Enter and clear-after-send settings',
      'same-profile multi-session history deduplication',
      'isolated history clearing',
      'persistent editor draft, font, wrap, width and target',
      'deleted built-ins stay deleted after restart',
      'shared commands across different servers and app restart',
    ],
    errors,
  };
  await writeFile(
    path.join(out, packaged ? 'commands-packaged.json' : 'commands-desktop.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  await page?.screenshot({ path: path.join(out, 'commands-failure.png') }).catch(() => {});
  throw e;
} finally {
  await app?.close().catch(() => {});
  await serverA.close();
  await serverB.close();
}
