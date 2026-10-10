import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';

const out = path.resolve('test-results');
await mkdir(out, { recursive: true });
const base = await mkdtemp(path.join(out, 'appearance-v5-'));
const root = path.join(base, 'remote'),
  user = path.join(base, '.EluShell');
await mkdir(root);
await writeFile(path.join(root, 'hello.txt'), 'appearance integration');
let connections = 0;
const metrics =
  '\n@@HOST\nfixture-host\nLinux fixture\n@@UP\n100 200\n0.1 0.2 0.3\n@@CPU\ncpu 10 0 0 90 0 0 0 0\ncpu0 10 0 0 90 0 0 0 0\n@@MEM\nMemTotal: 1000000 kB\nMemAvailable: 500000 kB\n@@PS\nPID USER CPU RSS ARGS\n42 app 9.1 2048 java -jar app.jar\n';
const server = await fixture(root, {
  password: 'appearance-fixture',
  authenticated: () => connections++,
  exec: (command) => (command.includes('@@HOST') ? metrics : ''),
});
const packaged = process.argv.includes('--packaged');
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
  await page.evaluate(() => {
    globalThis.saveFailures = [];
    new MutationObserver(() => {
      const message = document.querySelector('.toast')?.textContent || '';
      if (message.includes('保存失败') && !globalThis.saveFailures.includes(message))
        globalThis.saveFailures.push(message);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
};
const state = () => page.evaluate(() => window.elu.load());
const folder = (name) =>
  page
    .locator('.connection-folder')
    .filter({ has: page.locator('.folder-select', { hasText: name }) });
const rootFolder = () => page.locator('.folder-root');
const manager = () => page.locator('.session-tabs').getByTitle('连接管理', { exact: true }).click();
const context = async (node, action) => {
  await node.click({ button: 'right' });
  await page.getByRole('menuitem', { name: action, exact: true }).click();
};
const drag = async (source, target) => {
  await source.scrollIntoViewIfNeeded();
  const a = await source.boundingBox(),
    b = await target.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.move(b.x + b.width / 2 + 1, b.y + b.height / 2);
  await page.mouse.up();
};
const addFolder = async (parent, name) => {
  await context(parent, '新建子文件夹');
  await page.getByLabel('文件夹名称', { exact: true }).fill(name);
  await page.getByRole('button', { name: '保存文件夹', exact: true }).click();
  await folder(name).waitFor();
};
try {
  await launch();
  await manager();
  await expect(page.locator('.new-profile')).toHaveCount(0);
  await expect(page.getByText('删除空文件夹', { exact: true })).toHaveCount(0);
  await addFolder(rootFolder(), '生产环境');
  await addFolder(folder('生产环境'), '应用服务');
  await addFolder(rootFolder(), '测试环境');
  // Editing is separate; close the form before selecting a folder in the compact list.
  await page.getByTitle('新建文件夹', { exact: true }).click();
  await page.getByTitle('关闭连接编辑').click();
  await folder('生产环境').locator('.folder-select').click();
  await expect(page.getByLabel('文件夹名称', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('文件夹信息')).toContainText('生产环境');
  await context(folder('测试环境'), '重命名文件夹');
  await page.getByLabel('文件夹名称', { exact: true }).fill('开发环境');
  await page.getByRole('button', { name: '保存文件夹', exact: true }).click();
  await folder('开发环境').waitFor();
  await context(folder('应用服务'), '添加 SSH 服务器');
  await page.getByLabel('连接名称', { exact: true }).fill('Workspace integration');
  await page.getByLabel('主机 / IP', { exact: true }).fill('127.0.0.1');
  await page.getByLabel('端口', { exact: true }).fill(String(server.port));
  await page.getByLabel('用户名', { exact: true }).fill('fixture');
  await page.locator('input[type=password]').fill('appearance-fixture');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.connection-list-status')).toContainText('已保存');
  let saved = await state();
  const profileId = saved.profiles[0].id;
  const ids = Object.fromEntries(saved.folders.map((f) => [f.name, f.id]));
  expect(saved.profiles[0].folderId).toBe(ids['应用服务']);
  await drag(folder('生产环境'), folder('开发环境'));
  await expect
    .poll(async () => (await state()).folders.find((f) => f.id === ids['生产环境']).parentId)
    .toBe(ids['开发环境']);
  // Descendant drop is refused without changing the tree.
  await drag(folder('开发环境'), folder('应用服务'));
  expect((await state()).folders.find((f) => f.id === ids['开发环境']).parentId).toBeUndefined();
  await drag(page.locator('.connection-list .profile-item'), folder('开发环境'));
  await expect.poll(async () => (await state()).profiles[0].folderId).toBe(ids['开发环境']);
  await drag(folder('生产环境'), rootFolder());
  await expect
    .poll(async () => (await state()).folders.find((f) => f.id === ids['生产环境']).parentId)
    .toBeUndefined();
  await drag(page.locator('.connection-list .profile-item'), rootFolder());
  await expect.poll(async () => (await state()).profiles[0].folderId).toBeUndefined();
  await drag(page.locator('.connection-list .profile-item'), folder('应用服务'));
  await expect.poll(async () => (await state()).profiles[0].folderId).toBe(ids['应用服务']);
  await folder('生产环境').locator('.folder-select').click();
  expect(await page.evaluate(() => globalThis.saveFailures)).toEqual([]);
  await page.screenshot({ path: path.join(out, 'folders-v5.png') });
  await page.locator('.connection-list .profile-item').dblclick();
  await expect(page.getByRole('dialog', { name: '连接管理', exact: true })).toHaveCount(0);
  await expect(page.locator('.session-tab')).toHaveCount(1);
  expect(connections).toBe(1);
  const bounds = await page.evaluate(() => {
    const b = (s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, height: r.height };
    };
    return { sidebar: b('.sidebar'), terminal: b('.terminal-panel'), tabs: b('.session-tabs') };
  });
  expect(bounds.sidebar.y).toBe(0);
  expect(bounds.tabs.y).toBe(0);
  expect(bounds.terminal.x - bounds.sidebar.right).toBeLessThanOrEqual(5);
  expect(bounds.terminal.y).toBe(bounds.tabs.bottom);
  await expect(page.locator('.workspace-heading,.terminal-toolbar')).toHaveCount(0);
  const input = page.getByLabel('命令输入', { exact: true });
  await input.fill('search-marker first search-marker second');
  await input.press('Enter');
  await expect(page.locator('.terminal-mount')).toContainText('search-marker');
  const beforeSearch = await page.locator('.terminal-area').boundingBox();
  await page.keyboard.press('Control+Shift+f');
  await page.getByLabel('终端搜索', { exact: true }).fill('search-marker');
  const selection = () =>
    page
      .locator('.xterm-selection div')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('style')));
  await expect.poll(async () => (await selection()).length).toBeGreaterThan(0);
  const firstSelection = await selection();
  await page.getByLabel('终端搜索', { exact: true }).press('Enter');
  await expect.poll(selection).not.toEqual(firstSelection);
  await page.getByLabel('终端搜索', { exact: true }).press('Shift+Enter');
  await expect.poll(selection).toEqual(firstSelection);
  expect((await page.locator('.terminal-area').boundingBox()).height).toBe(beforeSearch.height);
  const floatBox = await page.locator('.terminal-search').boundingBox();
  expect(floatBox.y).toBeGreaterThan(bounds.terminal.y);
  expect(floatBox.x + floatBox.width).toBeLessThan(bounds.terminal.right);
  await page.getByLabel('终端搜索', { exact: true }).press('Escape');
  await expect(page.getByLabel('终端搜索', { exact: true })).toHaveCount(0);
  await page.getByTitle('工作区设置', { exact: true }).click();
  await page.getByLabel('界面字体', { exact: true }).fill('Microsoft YaHei');
  await page.getByLabel('界面字号', { exact: true }).selectOption('14');
  await page.getByLabel('终端字体', { exact: true }).fill('Consolas');
  await page.getByLabel('终端字号', { exact: true }).selectOption('18');
  await page.getByLabel('工作区背景颜色色号', { exact: true }).fill('#cedce8');
  await page.getByLabel('终端背景颜色色号', { exact: true }).fill('#172e40');
  await expect(page.locator('.terminal-panel')).toHaveCSS('background-color', 'rgb(23, 46, 64)');
  await expect(page.locator('.xterm-rows')).toHaveCSS('font-size', '18px');
  await expect(page.locator('.xterm-rows')).toHaveCSS('font-family', 'Consolas');
  await expect(page.locator('.sidebar-title')).toHaveCSS('font-size', '14px');
  await page.getByLabel('工作区背景包含终端').check();
  await expect(page.locator('.terminal-panel')).toHaveCSS('background-color', 'rgb(206, 220, 232)');
  await page.getByLabel('工作区背景包含终端').uncheck();
  await expect(page.locator('.terminal-panel')).toHaveCSS('background-color', 'rgb(23, 46, 64)');
  const source = path.join(base, 'wallpaper.png');
  await writeFile(
    source,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  await app.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
  }, source);
  await page
    .getByRole('group', { name: '工作区背景类型', exact: true })
    .getByRole('button', { name: '本地图片' })
    .click();
  await page.getByLabel('选择工作区背景图片', { exact: true }).click();
  await expect(page.locator('.background-filename')).toHaveText('wallpaper.png');
  await expect(page.locator('.app')).toHaveCSS('background-image', /data:image\/png;base64/);
  await page.getByLabel('工作区背景包含终端').check();
  await expect(page.locator('.terminal-panel')).toHaveCSS(
    'background-image',
    /data:image\/png;base64/,
  );
  await unlink(source); // Managed copy must survive source removal.
  saved = await state();
  expect(saved.appearance.workspace.image).toMatch(/^[a-f0-9]{64}\.png$/);
  expect(
    (await readFile(path.join(user, 'backgrounds', saved.appearance.workspace.image))).length,
  ).toBeGreaterThan(30);
  const rejection = await page.evaluate(async () => {
    try {
      await window.elu.backgroundImage('../credentials.json');
      return false;
    } catch {
      return true;
    }
  });
  expect(rejection).toBe(true);
  await page.screenshot({ path: path.join(out, 'appearance-settings-v5.png') });
  await page.locator('.preferences-modal .modal-header > button').click();
  await expect(page.locator('.terminal-mount')).toContainText('search-marker');
  expect(connections).toBe(1);
  expect(await page.evaluate(() => globalThis.saveFailures)).toEqual([]);
  await app.close();
  await launch();
  expect((await state()).appearance).toEqual(saved.appearance);
  expect((await state()).profiles[0].id).toBe(profileId);
  await expect(page.locator('.app')).toHaveCSS('background-image', /data:image\/png;base64/);
  await manager();
  await folder('应用服务').locator('.folder-select').click();
  await page.locator('.connection-list .profile-item').dblclick();
  await expect(page.locator('.session-tab')).toHaveCount(1);
  await expect(page.locator('.terminal-panel')).toHaveCSS(
    'background-image',
    /data:image\/png;base64/,
  );
  await page.getByTitle('工作区设置', { exact: true }).click();
  await page.getByRole('button', { name: '恢复默认外观' }).click();
  await page.locator('.preferences-modal .modal-header > button').click();
  await page.setViewportSize({ width: 1100, height: 760 });
  for (let i = 1; i < 8; i++) {
    await manager();
    await page.locator('.connection-list .profile-item').dblclick();
    await expect(page.locator('.session-tab')).toHaveCount(i + 1);
  }
  const rows = await page
    .locator('.session-tab')
    .evaluateAll((els) => [...new Set(els.map((e) => e.getBoundingClientRect().y))]);
  expect(rows.length).toBeGreaterThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByTitle('工作区设置', { exact: true })).toBeInViewport();
  await page.screenshot({ path: path.join(out, 'wrapped-sessions-v5.png') });
  // Missing credentials must keep the editor open instead of silently closing.
  await manager();
  const p = (await state()).profiles[0];
  await page.evaluate((p) => window.elu.saveCredential(p, '', false), p);
  await page.locator('.connection-list .profile-item').dblclick();
  await expect(page.getByRole('dialog', { name: '连接管理', exact: true })).toBeVisible();
  await expect(page.locator('.editor-error')).toContainText('尚未保存密码');
  expect(await page.evaluate(() => globalThis.saveFailures)).toEqual([]);
  expect(errors).toEqual([]);
  const report = {
    result: 'PASS',
    packaged,
    connections,
    checks: [
      'folder selection and contents',
      'folder context creation and rename',
      'subtree and connection drag with root moves',
      'cyclic drag rejected',
      'double-click saved login and missing credential fallback',
      'compact terminal layout',
      'floating search next/previous and Escape',
      'live font family and size without reconnect',
      'color and independent/shared image backgrounds',
      'managed wallpaper survives source deletion and app restart',
      'background path traversal rejected',
      'session tabs wrap and retain controls',
    ],
    errors,
  };
  await writeFile(
    path.join(out, packaged ? 'appearance-packaged.json' : 'appearance-desktop.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  await page?.screenshot({ path: path.join(out, 'appearance-failure.png') }).catch(() => {});
  throw e;
} finally {
  await app?.close().catch(() => {});
  await server.close();
}
