import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';

const out = path.resolve('test-results');
await mkdir(out, { recursive: true });
const base = await mkdtemp(path.join(out, 'stress-v061-')),
  user = path.join(base, '.EluShell'),
  root = path.join(base, 'remote');
await mkdir(root);
for (let batch = 0; batch < 10; batch++)
  await Promise.all(
    Array.from({ length: 100 }, (_, j) => {
      const i = batch * 100 + j;
      return i < 100
        ? mkdir(path.join(root, 'folder-' + String(i).padStart(4, '0')))
        : writeFile(
            path.join(root, 'file-' + String(i).padStart(4, '0') + '.txt'),
            'stress fixture',
          );
    }),
  );
const metrics =
  '\n@@HOST\nstress-fixture\nLinux fixture\n@@UP\n100 200\n0.1 0.2 0.3\n@@CPU\ncpu 10 0 0 90 0 0 0 0\n' +
  Array.from({ length: 128 }, (_, i) => `cpu${i} 10 0 0 90 0 0 0 0`).join('\n') +
  '\n@@MEM\nMemTotal: 1000000 kB\nMemAvailable: 500000 kB\n@@PS\nPID USER CPU RSS ARGS\n42 app 9.1 2048 java -jar app.jar\n';
const processes = Array.from({ length: 1000 }, (_, i) =>
  [
    i + 100,
    'fixture',
    i % 100,
    (i + 1) * 1024,
    'S',
    'java',
    i + 12345,
    '/usr/bin/java',
    '/srv/app-' + i,
    Buffer.from('java\0-jar\0service.jar\0').toString('hex'),
    `java -jar service-${i}.jar`,
  ].join('\t'),
).join('\n');
const inputs = [];
const server = await fixture(root, {
  password: 'stress-fixture',
  input: (text) => inputs.push(text),
  exec: (command) =>
    command.includes('@@HOST')
      ? metrics
      : command.includes('ps -eo pid=,user=,pcpu=')
        ? processes
        : '',
});
const packaged = process.argv.includes('--packaged');
const app = await electron.launch({
  ...(packaged
    ? { executablePath: path.resolve('release/win-unpacked/EluShell.exe') }
    : { args: ['.'] }),
  env: { ...process.env, ELUSHELL_TEST_DATA: user },
});
const page = await app.firstWindow(),
  errors = [],
  checks = [],
  timings = {};
page.on('pageerror', (e) => errors.push(e.message));
const state = () => page.evaluate(() => window.elu.load());
const box = (selector) => page.locator(selector).first().boundingBox();
const measure = (selector) =>
  page
    .locator(selector)
    .evaluate((e) => ({
      x: e.scrollLeft,
      y: e.scrollTop,
      maxX: e.scrollWidth - e.clientWidth,
      maxY: e.scrollHeight - e.clientHeight,
      width: e.clientWidth,
      height: e.clientHeight,
    }));
const noPageOverflow = async () =>
  expect(
    await page.evaluate(() => ({
      x: document.documentElement.scrollWidth > innerWidth,
      y: document.documentElement.scrollHeight > innerHeight,
    })),
  ).toEqual({ x: false, y: false });
const wheel = async (selector, dx, dy) => {
  const b = await box(selector);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(dx, dy);
};
const dragBar = async (selector, axis = 'y') => {
  await page.locator(selector).evaluate((e, axis) => {
    if (axis === 'y') e.scrollTop = 0;
    else e.scrollLeft = 0;
  }, axis);
  const b = await box(selector);
  await page.mouse.move(
    axis === 'y' ? b.x + b.width - 5 : b.x + 7,
    axis === 'y' ? b.y + 7 : b.y + b.height - 4,
  );
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 6, b.y + b.height - 6, { steps: 14 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const m = await measure(selector);
      return axis === 'y' ? m.y / m.maxY : m.x / m.maxX;
    })
    .toBeGreaterThan(0.9);
};
const resize = async (name, dx, dy) => {
  const b = await page.getByRole('separator', { name, exact: true }).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 10 });
  await page.mouse.up();
};
try {
  await page.locator('.new-tab-page').waitFor();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.evaluate(async (port) => {
    const settings = await window.elu.load();
    const profiles = Array.from({ length: 1000 }, (_, i) => ({
      id: 'stress-' + i,
      name: '服务器-' + String(i).padStart(4, '0'),
      host: '127.0.0.1',
      port,
      username: 'fixture',
      group: '',
      tags: [],
      auth: 'password',
      startup: '',
      autoStartup: false,
    }));
    for (const p of [profiles[0], profiles[99], profiles[100]])
      await window.elu.saveCredential(p, 'stress-fixture', true);
    await window.elu.save({
      ...settings,
      profiles,
      recentConnections: profiles
        .slice(0, 100)
        .map((p, i) => ({ profileId: p.id, at: Date.now() - i * 1000 })),
      commandLibraryVersion: 1,
      commandFolders: [
        { id: 'commands-default', name: '默认分类' },
        ...Array.from({ length: 999 }, (_, i) => ({
          id: 'category-' + i,
          name:
            '分类-' +
            String(i).padStart(4, '0') +
            (i % 25 === 0 ? '-很长的分类名称'.repeat(7) : ''),
        })),
      ],
      snippets: Array.from({ length: 1000 }, (_, i) => ({
        id: 'command-' + i,
        name: '命令-' + String(i).padStart(4, '0') + (i % 17 === 0 ? '-' + '长'.repeat(80) : ''),
        command: 'printf STRESS_' + i,
        folderId: 'commands-default',
        tags: [],
        appendNewline: true,
      })),
      history: {
        'stress-99': Array.from(
          { length: 100 },
          (_, i) =>
            'history-' + String(i).padStart(3, '0') + (i === 98 ? '-' + 'x'.repeat(7900) : ''),
        ),
      },
      commandWorkspace: { ...settings.commandWorkspace, draft: 'x'.repeat(8000), wordWrap: false },
    });
  }, server.port);
  const started = performance.now();
  await page.reload();
  await expect(page.locator('.recent-connections tbody tr')).toHaveCount(100);
  timings.load100RecentAnd1000Commands = Math.round(performance.now() - started);
  await expect(page.locator('.new-tab-page > header')).toHaveCount(0);
  expect((await box('.recent-toolbar')).y).toBeLessThan(110);
  await expect(page.locator('.recent-count')).toHaveText('100 条');
  expect((await measure('.recent-scroll')).maxY).toBeGreaterThan(1000);
  const headerY = (await box('.recent-connections th')).y;
  await wheel('.recent-scroll', 0, 440);
  await expect.poll(async () => (await measure('.recent-scroll')).y).toBeGreaterThan(100);
  expect(Math.abs((await box('.recent-connections th')).y - headerY)).toBeLessThan(2);
  await dragBar('.recent-scroll');
  await page.locator('.recent-connections tbody tr').last().focus();
  await page.keyboard.press('Home');
  await expect.poll(async () => (await measure('.recent-scroll')).y).toBeLessThan(5);
  await page.keyboard.press('End');
  await expect(page.locator('.recent-connections tbody tr').last()).toBeFocused();
  await page.getByLabel('筛选最近连接').fill('0099');
  await expect(page.locator('.recent-connections tbody tr')).toHaveCount(1);
  expect((await measure('.recent-scroll')).y).toBe(0);
  await page.getByLabel('筛选最近连接').fill('missing-server');
  await expect(page.locator('.recent-scroll')).toContainText('没有匹配');
  await page.getByLabel('筛选最近连接').fill('');
  await noPageOverflow();
  await page.screenshot({ path: path.join(out, 'stress-recent-100.png') });
  await page.locator('.recent-connections tbody tr').last().dblclick();
  await expect(page.locator('.session-tab.selected')).toContainText('0099');
  checks.push(
    '100 recent connections: fixed top layout, all rows accessible, sticky header, wheel, dragged scrollbar, Home/End, search and empty results',
  );

  await page.getByRole('button', { name: /^命令库/ }).click();
  await expect(page.locator('.compact-command')).toHaveCount(1000);
  await expect(page.locator('.command-folder-tabs button')).toHaveCount(1000);
  expect((await measure('.compact-commands')).maxX).toBe(0);
  expect((await measure('.compact-commands')).maxY).toBeGreaterThan(1000);
  await wheel('.compact-commands', 0, 500);
  await expect.poll(async () => (await measure('.compact-commands')).y).toBeGreaterThan(200);
  await dragBar('.compact-commands');
  await expect(page.locator('.compact-command').last()).toBeInViewport();
  await page.locator('.compact-command').last().click({ button: 'right' });
  const menu = await box('.command-context');
  expect(menu.y + menu.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
  await page.getByRole('menuitem', { name: '复制命令', exact: true }).click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('printf STRESS_999');
  await page.locator('.compact-command').last().click();
  await expect.poll(() => inputs.join('')).toContain('printf STRESS_999\r');
  expect(inputs.filter(text => text.includes('printf STRESS_'))).toHaveLength(1);
  const filterStart = performance.now();
  await page.getByLabel('搜索共享命令').fill('命令-0999');
  await expect(page.locator('.compact-command')).toHaveCount(1);
  timings.filter1000Commands = Math.round(performance.now() - filterStart);
  expect((await measure('.compact-commands')).y).toBe(0);
  await page.getByLabel('搜索共享命令').fill('zzzzzz');
  await expect(page.locator('.command-empty')).toContainText('没有匹配');
  await page.getByLabel('搜索共享命令').fill('');
  await wheel('.command-folder-tabs', 0, 700);
  await expect.poll(async () => (await measure('.command-folder-tabs')).x).toBeGreaterThan(200);
  await dragBar('.command-folder-tabs', 'x');
  await page.locator('.command-folder-tabs button').last().click();
  await expect(page.locator('.compact-command')).toHaveCount(0);
  await page.locator('.command-folder-tabs button').first().click();
  await expect(page.locator('.compact-command')).toHaveCount(1000);
  checks.push(
    '1000 commands and 1000 categories: independent vertical/horizontal wheel and scrollbar drag, last-item send and context copy, long names, search reset and empty category',
  );

  const editorScroll = '.command-editor-pane .cm-scroller';
  expect((await measure(editorScroll)).maxX).toBeGreaterThan(10000);
  await page.getByRole('textbox', { name: '命令编辑器内容', exact: true }).press('Control+End');
  await expect.poll(async () => (await measure(editorScroll)).x).toBeGreaterThan(1000);
  await page.getByRole('textbox', { name: '命令编辑器内容', exact: true }).press('z');
  expect((await state()).commandWorkspace.draft.length).toBe(8000);
  await page
    .getByRole('textbox', { name: '命令编辑器内容', exact: true })
    .fill(Array.from({ length: 400 }, (_, i) => '# line ' + i).join('\n'));
  expect((await measure(editorScroll)).maxY).toBeGreaterThan(1000);
  await wheel(editorScroll, 0, 400);
  await expect.poll(async () => (await measure(editorScroll)).y).toBeGreaterThan(100);
  await resize('调整文件面板高度', 0, 500);
  expect((await box('.compact-commands')).height).toBeGreaterThanOrEqual(26);
  await resize('调整命令编辑器宽度', -700, 0);
  await noPageOverflow();
  await page.setViewportSize({ width: 1060, height: 700 });
  await resize('调整监控栏宽度', 600, 0);
  await noPageOverflow();
  const searchBox = await box('.command-library-search'),
    libraryBox = await box('.command-library-pane');
  expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(libraryBox.x + libraryBox.width);
  await page.getByTitle('收起命令编辑器', { exact: true }).click();
  await expect(page.locator('.command-editor-pane')).toHaveCount(0);
  await page.getByTitle('展开命令编辑器', { exact: true }).click();
  await expect(page.locator('.command-editor-pane')).toBeVisible();
  await resize('调整监控栏宽度', -240, 0);
  await resize('调整文件面板高度', 0, -170);
  await page.screenshot({ path: path.join(out, 'stress-commands-1000.png') });
  checks.push(
    '8000-character and 400-line editor scroll, over-limit input rejected, smallest file pane, maximum editor/overview widths, 1060x700 window, editor collapse/restore',
  );

  const input = page.getByLabel('命令输入', { exact: true });
  await page.getByTitle('当前连接历史（最近 100 条）', { exact: true }).click();
  await expect(page.locator('.command-suggestions').getByRole('option')).toHaveCount(100);
  await wheel('.command-suggestions [role=listbox]', 0, 10000);
  await expect
    .poll(async () => (await measure('.command-suggestions [role=listbox]')).y)
    .toBeGreaterThan(500);
  await input.focus();
  await input.press('ArrowUp');
  await input.press('ArrowUp');
  await expect(page.locator('.command-suggestions').getByRole('option').last()).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await input.press('Tab');
  await expect(input).toHaveValue(/^history-/);
  await input.fill('');
  checks.push('100-entry history scroll and keyboard wrap to last result with a long command');

  await page.getByRole('button', { name: /^文件管理/ }).click();
  await page.getByRole('textbox', { name: '远程目录', exact: true }).fill('/');
  await page.getByRole('textbox', { name: '远程目录', exact: true }).press('Enter');
  await expect(page.locator('.file-table tbody tr')).toHaveCount(1000);
  await wheel('.file-table-wrap', 0, 100000);
  await expect.poll(async () => (await measure('.file-table-wrap')).y).toBeGreaterThan(1000);
  await expect(page.locator('.file-table tbody tr').last()).toBeInViewport();
  await page.getByPlaceholder('筛选文件').fill('0999');
  await expect(page.locator('.file-table tbody tr')).toHaveCount(1);
  await noPageOverflow();
  await page.getByRole('button', { name: /活跃进程/ }).click();
  await expect(page.locator('.process-table tbody tr')).toHaveCount(1000);
  await wheel('.process-table-wrap', 0, 100000);
  await expect.poll(async () => (await measure('.process-table-wrap')).y).toBeGreaterThan(1000);
  await page.getByRole('columnheader', { name: 'PID', exact: true }).getByRole('button').click();
  await page.locator('.process-table tbody tr').first().scrollIntoViewIfNeeded();
  await page.getByPlaceholder('筛选 PID、用户、名称或命令行').fill('service-999.jar');
  await expect(page.locator('.process-table tbody tr')).toHaveCount(1);
  await page.screenshot({ path: path.join(out, 'stress-processes-1000.png') });
  await page.locator('.process-modal .modal-header > button').click();
  checks.push(
    '1000 SFTP items and 1000 processes: scroll to last row, filter, sort and retain controls',
  );

  await page.locator('.session-tabs').getByTitle('连接管理', { exact: true }).click();
  await expect(page.locator('.connection-list .profile-item')).toHaveCount(1000);
  await wheel('.connection-list', 0, 100000);
  await expect.poll(async () => (await measure('.connection-list')).y).toBeGreaterThan(1000);
  await page.getByPlaceholder('搜索连接').fill('服务器-0100');
  await expect(page.locator('.connection-list .profile-item')).toHaveCount(1);
  await page.locator('.connection-list .profile-item').dblclick();
  await expect(page.locator('.session-tab.selected')).toContainText('0100');
  await expect.poll(async () => (await state()).recentConnections[0].profileId).toBe('stress-100');
  expect((await state()).recentConnections).toHaveLength(100);
  expect((await state()).recentConnections.some((r) => r.profileId === 'stress-98')).toBe(false);
  for (let i = 0; i < 28; i++) await page.getByTitle('新建标签页', { exact: true }).click();
  expect((await box('.session-tabs')).height).toBeGreaterThan(35);
  await expect(page.getByTitle('工作区设置', { exact: true })).toBeInViewport();
  await expect(page.getByTitle('上传下载进度', { exact: true })).toBeInViewport();
  await noPageOverflow();
  checks.push(
    '1000 saved connections: scroll, filter, connect and evict oldest recent at 100; 30 tabs wrap with controls reachable',
  );
  expect(errors).toEqual([]);
  const report = {
    result: 'PASS',
    packaged,
    sizes: {
      recent: 100,
      savedConnections: 1000,
      commands: 1000,
      categories: 1000,
      history: 100,
      editorCharacters: 8000,
      editorLines: 400,
      files: 1000,
      processes: 1000,
      tabs: 30,
      logicalCores: 128,
    },
    timingsMs: timings,
    checks,
    errors,
  };
  await writeFile(
    path.join(out, packaged ? 'stress-packaged.json' : 'stress-desktop.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  await page.screenshot({ path: path.join(out, 'stress-failure.png') }).catch(() => {});
  throw e;
} finally {
  await app.close();
  await server.close();
}
