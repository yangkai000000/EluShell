import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';
const base = await mkdtemp(path.resolve('test-results/editors-'));
const roots = ['server-a', 'server-b'].map(name => path.join(base, name));
for (let i = 0; i < roots.length; i++) {
  await mkdir(roots[i]);
  await writeFile(path.join(roots[i], 'env_app.sh'), `# 应用配置 ${i + 1}\nexport APP_PORT=${8080 + i}\nexport APP_NAME="orders-${i + 1}"\nexport APP_LOG=$HOME/logs/app.log\n`);
  await writeFile(path.join(roots[i], 'application.log'), '2026-09-15 14:00:00.123 INFO 服务已启动\n2026-09-15 14:00:03.456 WARN 请求耗时过长\n2026-09-15 14:00:04.789 ERROR 连接失败\nCaused by: java.lang.IllegalStateException\n');
}
const servers = await Promise.all(roots.map(root => fixture(root)));
const packaged = process.argv.includes('--packaged');
const mac = process.argv.includes('--mac-payload'), saveKey = mac ? 'Meta+s' : 'Control+s', endKey = mac ? 'Meta+ArrowDown' : 'Control+End';
const app = await electron.launch({ ...(packaged ? { executablePath: path.resolve('release/win-unpacked/EluShell.exe') } : { args: mac ? [path.resolve('release/macos/app.asar')] : ['.'] }), env: { ...process.env, ELUSHELL_TEST_DATA: path.join(base, '.EluShell') } });
const errors = [];
app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
try {
  const page = await app.firstWindow();
  await page.locator('.welcome-workspace').waitFor();
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  for (let i = 0; i < servers.length; i++) {
    await page.locator('.session-tabs').getByTitle('连接管理', { exact: true }).click();
    await page.locator('.folder-root').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '添加 SSH 服务器' }).click();
    await page.getByLabel('连接名称', { exact: true }).fill(`订单服务器 ${i + 1}`);
    await page.getByLabel('主机 / IP', { exact: true }).fill('127.0.0.1');
    await page.getByLabel('端口', { exact: true }).fill(String(servers[i].port));
    await page.locator('input[type=password]').fill('fixture');
    await page.getByRole('button', { name: '保存并连接', exact: true }).click();
    await page.locator('.session-tab.selected').filter({ hasText: `订单服务器 ${i + 1}` }).waitFor();
  }
  const open = async (index, file) => {
    await page.bringToFront();
    await page.locator('.session-tab').filter({ hasText: `订单服务器 ${index + 1}` }).locator('button').first().click();
    const input = page.getByRole('textbox', { name: '远程目录' });
    await input.fill('/'); await input.press('Enter');
    const ready = app.waitForEvent('window');
    await page.locator('.file-table').getByText(file, { exact: true }).dblclick();
    const editor = await ready;
    await editor.locator('.cm-content').waitFor();
    if (mac) { await editor.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' })); await editor.reload(); }
    await editor.locator('.cm-content').waitFor();
    return editor;
  };
  const first = await open(0, 'env_app.sh'), second = await open(1, 'env_app.sh');
  await expect(first).toHaveTitle('订单服务器 1 · env_app.sh · EluShell');
  await expect(second).toHaveTitle('订单服务器 2 · env_app.sh · EluShell');
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(w => !w.getParentWindow()))).toBe(true);
  for (const [editor, marker] of [[first, '# changed A'], [second, '# changed B']]) {
    await editor.bringToFront(); await editor.locator('.cm-content').click();
    await editor.keyboard.press(endKey); await editor.keyboard.type(marker);
    await expect(editor.locator('.text-editor footer')).toContainText('未保存');
  }
  await first.bringToFront(); await first.locator('.cm-content').click(); await first.keyboard.press(saveKey);
  await expect.poll(() => readFile(path.join(roots[0], 'env_app.sh'), 'utf8')).toContain('# changed A');
  expect(await readFile(path.join(roots[1], 'env_app.sh'), 'utf8')).not.toContain('# changed B');
  await expect(second.locator('.text-editor footer')).toContainText('未保存');
  await second.bringToFront(); await second.locator('.cm-content').click(); await second.keyboard.press(saveKey);
  await expect.poll(() => readFile(path.join(roots[1], 'env_app.sh'), 'utf8')).toContain('# changed B');
  expect(await readFile(path.join(roots[0], 'env_app.sh'), 'utf8')).not.toContain('# changed B');
  const colors = await first.locator('.cm-content span').evaluateAll(spans => [...new Set(spans.map(e => getComputedStyle(e).color))]);
  expect(colors.length).toBeGreaterThanOrEqual(4);
  // Opening the same file twice focuses the existing window without losing edits.
  await page.bringToFront(); await page.locator('.file-table').getByText('env_app.sh', { exact: true }).dblclick();
  expect(app.windows()).toHaveLength(3);
  const log = await open(0, 'application.log');
  const logColors = await log.locator('.cm-content span').evaluateAll(spans => Object.fromEntries(spans.filter(e => ['INFO','WARN','ERROR'].includes(e.textContent)).map(e => [e.textContent, getComputedStyle(e).color])));
  expect(new Set(Object.values(logColors)).size).toBe(3);
  await log.screenshot({ path: path.resolve('test-results/editor-logs.png') });
  await log.getByTitle('关闭编辑器').click();
  await page.bringToFront(); await page.getByTitle('工作区设置', { exact: true }).click();
  await page.getByLabel('会话名称显示').selectOption('ip');
  await expect(page.locator('.session-tab').filter({ hasText: '127.0.0.1' })).toHaveCount(2);
  await expect(first).toHaveTitle('127.0.0.1 · env_app.sh · EluShell');
  await expect(second).toHaveTitle('127.0.0.1 · env_app.sh · EluShell');
  expect((await page.evaluate(() => window.elu.load())).sessionNameMode).toBe('ip');
  await page.getByTitle('关闭工作区设置').click();
  await first.screenshot({ path: path.resolve('test-results/editor-shell.png') });
  // Editor renderer cannot act on another window's document or access workspace secrets.
  const denied = await first.evaluate(() => window.elu.load().then(() => false, () => true));
  expect(denied).toBe(true);
  await second.bringToFront(); await second.locator('.cm-content').click(); await second.keyboard.press(endKey); await second.keyboard.type('\n# keep this');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow().close());
  await expect(second.locator('.editor-confirm')).toBeVisible();
  await second.getByRole('button', { name: '继续编辑' }).click();
  await app.evaluate(({ app, dialog }) => { globalThis.guardCount = 0; dialog.showMessageBoxSync = () => { globalThis.guardCount++; return 0; }; app.quit(); });
  await expect.poll(() => app.evaluate(() => globalThis.guardCount)).toBe(1);
  await expect(second.locator('.cm-content')).toContainText('# keep this');
  await writeFile(path.join(roots[1], 'env_app.sh'), 'external edit\n');
  await second.getByRole('button', { name: mac ? '保存到服务器 · ⌘+S' : '保存到服务器 · Ctrl+S', exact: true }).click();
  await expect(second.locator('.editor-error')).toContainText('其他程序修改');
  expect(await readFile(path.join(roots[1], 'env_app.sh'), 'utf8')).toBe('external edit\n');
  await second.getByTitle('关闭编辑器').click(); await second.getByRole('button', { name: '放弃修改' }).click();
  // Closing the terminal tab retains only the editor's SSH session until its window closes.
  await page.bringToFront(); await page.locator('.session-tab').first().getByTitle('关闭会话', { exact: true }).click();
  await first.bringToFront(); await first.locator('.cm-content').click(); await first.keyboard.press(endKey); await first.keyboard.type('\n# after tab closed'); await first.keyboard.press(saveKey);
  await expect.poll(() => readFile(path.join(roots[0], 'env_app.sh'), 'utf8')).toContain('# after tab closed');
  await first.getByTitle('关闭编辑器').click();
  expect(errors).toEqual([]);
  const report = { result: 'PASS', packaged, macPayload: mac, macRuntime: false, sameNameServers: 2, shortcutsSaveOnlyFocusedFile: true, independentWindows: true, syntaxColors: colors, logColors, titlePreferencePersisted: true, closeAndQuitGuard: true, conflictProtection: true, editorRetainsSSH: true, rendererIsolation: true, errors };
  await writeFile(mac ? 'test-results/editors-mac-payload.json' : 'test-results/editors.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {});
  await app.close(); await Promise.all(servers.map(s => s.close()));
}
