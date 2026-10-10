import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';

const base = await mkdtemp(path.resolve('test-results/terminal-files-'));
const remote = path.join(base, 'remote'), local = path.join(base, 'local');
await mkdir(path.join(remote, 'bundle'), { recursive: true });
await mkdir(path.join(local, 'bundle', 'nested'), { recursive: true });
await writeFile(path.join(remote, 'small.txt'), 'old');
await writeFile(path.join(remote, 'large.txt'), 'x'.repeat(2048));
await writeFile(path.join(remote, 'bundle', 'keep.txt'), 'keep me');
await writeFile(path.join(local, 'small.txt'), 'replaced by external drop');
await writeFile(path.join(local, 'bundle', 'nested', '中文.txt'), 'recursive upload');
const inputs = [], errors = [];
const server = await fixture(remote, { greeting: 'COPY_TARGET ready\r\nSecond line\r\n$ ', input: text => inputs.push(text) });
const packaged = process.argv.includes('--packaged');
const macShortcuts = process.argv.includes('--mac-shortcuts');
const macPayload = process.argv.includes('--mac-payload');
const app = await electron.launch({
  ...(packaged ? { executablePath: path.resolve('release/win-unpacked/EluShell.exe') } : { args: macPayload ? [path.resolve('release/macos/app.asar')] : ['.'] }),
  env: { ...process.env, ELUSHELL_TEST_DATA: path.join(base, 'user') },
});
try {
  const page = await app.firstWindow();
  if (macShortcuts) {
    // Exercise the renderer's Mac keyboard branch on Windows, not a Mac runtime.
    await page.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
    await page.reload();
  }
  page.on('pageerror', e => errors.push(e.message));
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  await page.locator('.welcome-workspace').waitFor();
  await page.locator('.session-tabs').getByRole('button', { name: '连接管理', exact: true }).click();
  await page.locator('.folder-root').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '添加 SSH 服务器' }).click();
  await page.getByLabel('连接名称', { exact: true }).fill('Terminal and files');
  await page.getByLabel('主机 / IP', { exact: true }).fill('127.0.0.1');
  await page.getByLabel('端口', { exact: true }).fill(String(server.port));
  await page.locator('input[type=password]').fill('fixture');
  await page.getByRole('button', { name: '保存并连接', exact: true }).click();
  await page.locator('.session-tab.selected').filter({ hasText: 'Terminal and files' }).waitFor();
  const location = page.getByRole('textbox', { name: '远程目录' });
  await location.fill('/'); await location.press('Enter');
  await page.locator('.file-table').getByText('small.txt', { exact: true }).waitFor();
  await expect(page.locator('.file-table thead')).toContainText('用户 / 用户组');
  await expect(page.locator('.file-table tbody tr').first()).toContainText('1000 / 1000');
  await expect(page.locator('.file-table tbody td:last-child button')).toHaveCount(0);
  await page.locator('.file-table th').getByRole('button', { name: '大小', exact: true }).click();
  const sizes = () => page.locator('.file-table tbody tr').evaluateAll(rows => rows.map(row => row.cells[0].innerText));
  await expect.poll(sizes).toEqual(['bundle', 'small.txt', 'large.txt']);
  await page.locator('.file-table th').getByRole('button', { name: '大小', exact: true }).click();
  await expect.poll(sizes).toEqual(['large.txt', 'small.txt', 'bundle']);
  for (const label of ['修改时间', '权限', '用户 / 用户组', '名称']) {
    await page.locator('.file-table th').getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('.file-table th').filter({ hasText: label })).toHaveAttribute('aria-sort', 'ascending');
  }
  const screen = page.locator('.terminal-mount:visible .xterm-screen');
  await screen.waitFor();
  const box = await screen.boundingBox();
  const row = page.locator('.terminal-mount:visible .xterm-rows > div').first();
  await expect(row).toContainText('COPY_TARGET');
  const char = await row.locator('span').first().boundingBox();
  const cell = char.width / (await row.locator('span').first().innerText()).length;
  const select = async () => {
    // Reset click count between independent drags so fast automation is not a triple-click.
    await page.mouse.click(box.x + 160, box.y + 45);
    await page.mouse.move(box.x + 1, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + cell * 11 + 1, box.y + 8, { steps: 12 });
    await page.mouse.up();
    await page.getByRole('menu', { name: '选中文字操作' }).waitFor();
  };
  await select();
  const popup = await page.getByRole('menu', { name: '选中文字操作' }).boundingBox();
  expect(popup.y).toBeGreaterThan(box.y + 8);
  await page.mouse.move(box.x + cell * 3, box.y + 8, { steps: 10 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(await page.getByRole('menu', { name: '选中文字操作' }).boundingBox()).toEqual(popup);
  await page.getByRole('menuitem', { name: '复制', exact: true }).click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('COPY_TARGET');
  await select();
  await page.getByRole('menuitem', { name: '搜索', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '终端搜索' })).toHaveValue('COPY_TARGET');
  await page.getByRole('textbox', { name: '终端搜索' }).press('Escape');
  await app.evaluate(({ clipboard }) => clipboard.writeText('PASTED_WITHOUT_ENTER'));
  await screen.click({ button: 'right', position: { x: 180, y: 70 } });
  await page.getByRole('menuitem', { name: '粘贴' }).click();
  await expect.poll(() => inputs.join('')).toContain('PASTED_WITHOUT_ENTER');
  expect(inputs.join('')).not.toContain('PASTED_WITHOUT_ENTER\r');
  await page.keyboard.press('Control+c');
  await expect.poll(() => inputs.join('')).toContain('\x03');
  await page.keyboard.press(macShortcuts ? 'Meta+f' : 'Control+Shift+f');
  await expect(page.getByRole('textbox', { name: '终端搜索' })).toBeVisible();
  await page.getByRole('textbox', { name: '终端搜索' }).press('Escape');
  await screen.click({ button: 'right', position: { x: 180, y: 70 } });
  await page.getByRole('menuitem', { name: '清空缓存', exact: true }).click();
  await expect(row).not.toContainText('COPY_TARGET');
  expect(inputs.join('')).not.toContain('elushell;');
  const tableRow = name => page.locator('.file-table tbody tr').filter({ has: page.getByText(name, { exact: true }) });
  const selectedNames = () => page.locator('.file-table tbody tr[aria-selected=true]').evaluateAll(rows => rows.map(row => row.cells[0].innerText));
  const multiKey = macShortcuts ? 'Meta' : 'Control';
  await tableRow('small.txt').click();
  await tableRow('large.txt').click({ modifiers: [multiKey] });
  expect(await selectedNames()).toEqual(['large.txt', 'small.txt']);
  await tableRow('small.txt').click({ modifiers: [multiKey] });
  expect(await selectedNames()).toEqual(['large.txt']);
  await tableRow('small.txt').click({ modifiers: [multiKey] });
  await tableRow('large.txt').click({ button: 'right' });
  expect(await selectedNames()).toEqual(['large.txt', 'small.txt']);
  const downloads = path.join(base, 'downloads'); await mkdir(downloads);
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, downloads);
  await page.evaluate(() => window.elu.chooseDownloadDirectory());
  await page.getByRole('menuitem', { name: '批量下载（2 项）', exact: true }).click();
  await expect.poll(() => readFile(path.join(downloads, 'small.txt'), 'utf8').catch(() => '')).toBe('old');
  await expect.poll(() => readFile(path.join(downloads, 'large.txt'), 'utf8').catch(() => '')).toBe('x'.repeat(2048));
  expect(await readdir(downloads)).toEqual(['large.txt', 'small.txt']);
  await page.keyboard.press('Escape');
  await tableRow('bundle').click();
  expect(await location.inputValue()).toBe('/');
  await tableRow('small.txt').click({ modifiers: ['Shift'] });
  expect(await selectedNames()).toEqual(['bundle', 'large.txt', 'small.txt']);
  await page.locator('.file-table th').getByRole('button', { name: '大小', exact: true }).click();
  await tableRow('large.txt').click({ modifiers: ['Shift'] });
  expect(await selectedNames()).toEqual(['bundle', 'small.txt', 'large.txt']);
  await tableRow('small.txt').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '批量下载（3 项）', exact: true }).click();
  await expect.poll(() => readFile(path.join(downloads, 'bundle', 'keep.txt'), 'utf8').catch(() => '')).toBe('keep me');
  await expect.poll(() => readFile(path.join(downloads, 'small.txt (1)'), 'utf8').catch(() => '')).toBe('old');
  await page.keyboard.press('Escape');
  await page.getByLabel('筛选文件').fill('small');
  expect(await selectedNames()).toEqual([]);
  await page.getByLabel('筛选文件').fill('');
  await tableRow('bundle').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '批量下载（3 项）', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await tableRow('bundle').dblclick();
  await expect(location).toHaveValue('/bundle');
  expect(await selectedNames()).toEqual([]);
  await location.fill('/'); await location.press('Enter');
  await tableRow('small.txt').waitFor();
  const cdp = await page.context().newCDPSession(page);
  const drop = async (files, target) => {
    const b = await target.boundingBox();
    const data = { items: [], files, dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver']) await cdp.send('Input.dispatchDragEvent', { type, x: b.x + b.width / 2, y: b.y + b.height / 2, data });
    await expect(page.locator('.file-content')).toHaveClass(/external-drop/);
    await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: b.x + b.width / 2, y: b.y + b.height / 2, data });
    await page.getByRole('dialog', { name: '确认上传', exact: true }).getByRole('button', { name: '确认上传', exact: true }).click();
  };
  await drop([path.join(local, 'small.txt'), path.join(local, 'bundle')], page.locator('.file-table thead'));
  await expect.poll(() => readFile(path.join(remote, 'small.txt'), 'utf8')).toBe('replaced by external drop');
  await expect.poll(() => readFile(path.join(remote, 'bundle', 'nested', '中文.txt'), 'utf8').catch(() => '')).toBe('recursive upload');
  expect(await readFile(path.join(remote, 'bundle', 'keep.txt'), 'utf8')).toBe('keep me');
  await drop([path.join(local, 'small.txt')], page.locator('.file-table tbody tr').filter({ hasText: 'bundle' }));
  await expect.poll(() => readFile(path.join(remote, 'bundle', 'small.txt'), 'utf8').catch(() => '')).toBe('replaced by external drop');
  await expect(page.locator('.file-content')).not.toHaveClass(/external-drop/);
  expect(errors).toEqual([]);
  await page.screenshot({ path: path.resolve('test-results/terminal-files.png') });
  const report = { result: 'PASS', packaged, checks: ['five sortable columns', 'owner and group display', 'no row download button', 'selection copy popup below pointer', 'selection searches terminal', 'clipboard paste without execution', 'Ctrl+C still interrupts', 'Ctrl+Shift+F finds', 'clear terminal buffer', 'no injected probe command', 'native external file and directory drop', 'same-name replacement and directory merge', 'drop into folder row'], errors };
  if (macShortcuts) {
    report.checks = report.checks.map(check => check === 'Ctrl+Shift+F finds' ? 'Command+F finds (Mac renderer branch on Windows)' : check);
    report.checks.push('No macOS runtime validation; renderer platform simulated');
    await app.evaluate(({ shell }) => { shell.openExternal = async url => { globalThis.updateGuideUrl = url; }; });
    await page.getByTitle('工作区设置', { exact: true }).click();
    await page.getByRole('button', { name: '更新配置', exact: true }).click();
    await expect(page.locator('.update-settings')).toContainText('Command+Q');
    await expect(page.getByLabel('更新服务器地址', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '查看官网下载与 Mac 更新步骤', exact: true }).click();
    expect(await app.evaluate(() => globalThis.updateGuideUrl)).toBe('http://47.105.176.1:8800/elushell-updates/#mac-update');
    await page.screenshot({ path: 'test-results/mac-update-guide.png' });
    report.checks.push('Mac manual-update guidance and fixed official-site link');
  }
  if (macPayload) report.checks.push('Executed release/macos/app.asar with Windows Electron; JavaScript SSH/SFTP fallback');
  report.checks.push('selection popup remains fixed while moving across selected text', 'Ctrl or Command toggle, Shift range after sorting, selected right-click preservation', 'batch downloads exact bytes for both selected files', 'single click selects directory, double click opens, navigation and filtering clear selection');
  await writeFile(path.resolve(`test-results/terminal-files-${macPayload ? 'mac-payload' : macShortcuts ? 'mac-shortcuts' : packaged ? 'packaged' : 'desktop'}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify(await (await app.firstWindow()).evaluate(() => window.elu.transferList()).catch(() => [])));
  throw error;
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {});
  await app.close(); await server.close();
}
