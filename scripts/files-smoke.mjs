import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';
const out = path.resolve('test-results'),
  base = await mkdtemp(path.join(out, 'files-v3-'));
const remote = path.join(base, 'remote'),
  downloads = path.join(base, 'downloads'),
  upload = path.join(base, 'upload-folder');
await mkdir(remote);
await mkdir(downloads);
await mkdir(path.join(upload, 'nested'), { recursive: true });
await writeFile(path.join(upload, 'nested', 'upload.txt'), 'folder upload');
await writeFile(path.join(remote, 'hello.yaml'), 'server:\n  port: 8080\n');
await mkdir(path.join(remote, 'logs'));
await writeFile(path.join(remote, 'logs', 'app.log'), 'sample log');
const inputs = [],
  modes = [];
const oddDirectory = "team's work";
await mkdir(path.join(remote, oddDirectory));
const server = await fixture(remote, {
    input: (text) => inputs.push(text),
    chmod: (p, mode) => modes.push({ p, mode }),
  }),
  packaged = process.argv.includes('--packaged');
const app = await electron.launch({
  ...(packaged
    ? { executablePath: path.resolve('release/win-unpacked/EluShell.exe') }
    : { args: ['.'] }),
  env: { ...process.env, ELUSHELL_TEST_DATA: path.join(base, 'user') },
});
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.welcome-workspace').waitFor();
  await expect(page.locator('.app-header,.rail')).toHaveCount(0);
  const defaultDir = await page.evaluate(() => window.elu.downloadDirectory());
  const desktop = await app.evaluate(({ app }) => app.getPath('desktop'));
  expect(defaultDir).toBe(path.join(desktop, 'esdownload'));
  await app.evaluate(({ dialog }, downloads) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [downloads] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, downloads);
  await page.getByTitle('上传下载进度', { exact: true }).click();
  await page.getByRole('button', { name: '更改目录' }).click();
  await expect(page.locator('.download-directory')).toContainText(downloads);
  await page.getByTitle('关闭传输面板').click();
  await page
    .locator('.session-tabs')
    .getByRole('button', { name: '连接管理', exact: true })
    .click();
  await page.locator('.folder-root').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '添加 SSH 服务器' }).click();
  await page.getByLabel('连接名称', { exact: true }).fill('Files fixture');
  await page.getByLabel('主机 / IP', { exact: true }).fill('127.0.0.1');
  await page.getByLabel('端口', { exact: true }).fill(String(server.port));
  await page.locator('input[type=password]').fill('fixture');
  await page.getByRole('button', { name: '保存并连接', exact: true }).click();
  await page.locator('.session-tab.selected').filter({ hasText: 'Files fixture' }).waitFor();
  const location = page.getByRole('textbox', { name: '远程目录' });
  await location.fill('/');
  await location.press('Enter');
  await page.locator('.file-table').getByText('hello.yaml', { exact: true }).waitFor();
  await page
    .locator('.file-table')
    .getByText(oddDirectory, { exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: '执行 cd 到该目录', exact: true }).click();
  const cd = "cd -- '/team'\\''s work'";
  await expect.poll(() => inputs.join('')).toContain(cd + '\r');
  await expect
    .poll(async () => Object.values((await page.evaluate(() => window.elu.load())).history).flat())
    .toContain(cd);
  await page
    .locator('.file-table')
    .getByText('hello.yaml', { exact: true })
    .click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '执行 cd 到该目录', exact: true })).toHaveCount(
    0,
  );
  await page.keyboard.press('Escape');
  await page.locator('.file-table').getByText('hello.yaml', { exact: true }).dblclick();
  const editor = await app.waitForEvent('window');
  await editor.getByRole('dialog', { name: '内置文本编辑器' }).waitFor();
  await editor.locator('.cm-content').click();
  await editor.keyboard.press('Control+End');
  await editor.keyboard.type('# saved from editor');
  await editor.keyboard.press('Control+s');
  await expect
    .poll(() => readFile(path.join(remote, 'hello.yaml'), 'utf8'))
    .toContain('# saved from editor');
  await expect(editor.locator('.text-editor footer')).toContainText('已同步');
  await editor.screenshot({ path: path.join(out, 'editor-v3.png') });
  await editor.keyboard.type('\n# unsaved');
  await editor.getByTitle('关闭编辑器').click();
  await expect(editor.locator('.editor-confirm')).toBeVisible();
  await editor.getByRole('button', { name: '继续编辑', exact: true }).click();
  editor.on('dialog', () => {}); // Electron handles beforeunload through its native guard.
  await app.evaluate(({ app, dialog }) => {
    globalThis.quitGuardCount = 0;
    dialog.showMessageBoxSync = () => {
      globalThis.quitGuardCount++;
      return 0;
    };
    app.quit();
  });
  await expect.poll(() => app.evaluate(() => globalThis.quitGuardCount)).toBe(1);
  await expect(editor.locator('.text-editor')).toBeVisible();
  await writeFile(path.join(remote, 'hello.yaml'), 'external change');
  await editor.getByRole('button', { name: '保存到服务器 · Ctrl+S' }).click();
  await expect(editor.locator('.text-editor .editor-error')).toContainText('其他程序修改');
  expect(await readFile(path.join(remote, 'hello.yaml'), 'utf8')).toBe('external change');
  await editor.getByTitle('关闭编辑器').click();
  await editor.getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.locator('.file-table').getByText('logs', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '下载文件夹', exact: true }).click();
  await expect
    .poll(() => readFile(path.join(downloads, 'logs', 'app.log'), 'utf8').catch(() => ''))
    .toBe('sample log');
  await expect(page.locator('.transfer-panel')).toBeVisible();
  await expect(page.locator('.transfer-jobs')).toContainText('已完成');
  await page.screenshot({ path: path.join(out, 'transfers-v3.png') });
  await page.getByTitle('关闭传输面板').click();
  await app.evaluate(({ dialog }, upload) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [upload] });
  }, upload);
  await page.locator('.file-table-wrap').click({ button: 'right', position: { x: 500, y: 150 } });
  await page.getByRole('menuitem', { name: '上传文件夹到此目录…', exact: true }).click();
  await expect
    .poll(() =>
      readFile(path.join(remote, 'upload-folder', 'nested', 'upload.txt'), 'utf8').catch(() => ''),
    )
    .toBe('folder upload');
  await page
    .locator('.file-table')
    .getByText('upload-folder', { exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: '文件权限…', exact: true }).click();
  modes.length = 0;
  await page.getByLabel('八进制权限').fill('777');
  await expect(page.locator('.permission-editor input:checked')).toHaveCount(9);
  await page.getByRole('checkbox', { name: '用户组写入', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '其他用户写入', exact: true }).uncheck();
  await expect(page.getByLabel('八进制权限')).toHaveValue('755');
  await page.getByLabel('八进制权限').fill('4755');
  await page.getByRole('checkbox', { name: '所有者执行', exact: true }).uncheck();
  await expect(page.getByLabel('八进制权限')).toHaveValue('4655');
  await page.getByLabel('八进制权限').fill('000');
  await expect(page.locator('.permission-editor input:checked')).toHaveCount(0);
  await page.getByLabel('八进制权限').fill('89');
  await expect(page.getByRole('checkbox', { name: '所有者读取', exact: true })).toBeDisabled();
  await page.getByLabel('八进制权限').fill('755');
  await page.getByRole('checkbox', { name: '应用到所有子文件夹及文件' }).check();
  await page.screenshot({ path: path.join(out, 'permissions-v6.png') });
  await page.locator('.file-action-form').getByRole('button', { name: '确定' }).click();
  await expect(page.locator('.file-action-form')).toHaveCount(0);
  expect(modes.filter((m) => m.p.startsWith('/upload-folder')).map((m) => m.mode)).toEqual([
    0o755, 0o755, 0o755,
  ]);
  await page
    .locator('.file-table')
    .getByText('upload-folder', { exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: '重命名…', exact: true }).click();
  await page.locator('.file-action-form input').fill('renamed-folder');
  await page.locator('.file-action-form').getByRole('button', { name: '确定' }).click();
  await expect.poll(() => readdir(remote)).toContain('renamed-folder');
  await page.locator('.tree-select[title="/logs"]').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '下载文件夹', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: '执行 cd 到该目录', exact: true }).click();
  await expect.poll(() => inputs.join('')).toContain("cd -- '/logs'\r");
  await page
    .locator('.file-table')
    .getByText('renamed-folder', { exact: true })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除文件夹及内容…', exact: true }).click();
  await page.getByRole('dialog', { name: '确认删除', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click();
  await expect.poll(() => readdir(remote)).not.toContain('renamed-folder');
  await page.locator('.session-tab.selected').getByTitle('关闭会话').click();
  await page.screenshot({ path: path.join(out, 'workspace-v3.png') });
  expect(errors).toEqual([]);
  const report = {
    result: 'PASS',
    packaged,
    checks: [
      'compact session navigation',
      'actual desktop default download directory',
      'download directory persistence',
      'double click built-in editor',
      'Ctrl+S uploads',
      'unsaved close guard',
      'cancel application quit preserves session',
      'remote edit conflict rejection',
      'recursive folder download',
      'transfer progress',
      'recursive folder upload',
      'recursive permissions',
      'nine permission checkboxes and octal values synchronize, including special bits and invalid input',
      'folder cd in list and tree sends quoted shell command and stores history',
      'folder rename',
      'tree context menu',
      'recursive delete',
    ],
    errors,
  };
  await writeFile(
    path.join(out, packaged ? 'files-packaged.json' : 'files-desktop.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app
    .evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 1;
    })
    .catch(() => {});
  await app.close();
  await server.close();
}
