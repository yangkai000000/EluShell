import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';

const base = await mkdtemp(path.resolve('test-results/file-drop-'));
const remote = path.join(base, 'remote'), local = path.join(base, 'local');
for (const folder of ['target/nested', 'folder/child', 'conflict']) await mkdir(path.join(remote, folder), { recursive: true });
await mkdir(path.join(local, 'bundle/nested'), { recursive: true });
for (const name of ['a.log', 'b.log', 'keep.log']) await writeFile(path.join(remote, name), name);
await writeFile(path.join(remote, 'folder/child/data'), 'folder content');
await writeFile(path.join(remote, 'conflict/keep.log'), 'do not replace');
await writeFile(path.join(local, 'upload.txt'), 'uploaded bytes');
await writeFile(path.join(local, 'bundle/nested/data'), 'recursive bytes');
const server = await fixture(remote);
const packaged = process.argv.includes('--packaged');
const app = await electron.launch({ ...(packaged ? { executablePath: path.resolve('release/win-unpacked/EluShell.exe') } : { args: ['.'] }), env: { ...process.env, ELUSHELL_TEST_DATA: path.join(base, 'user') } });
const errors = [], checks = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.welcome-workspace').waitFor();
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  await page.locator('.session-tabs').getByRole('button', { name: '连接管理', exact: true }).click();
  await page.locator('.folder-root').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '添加 SSH 服务器' }).click();
  await page.getByLabel('连接名称', { exact: true }).fill('文件部署测试');
  await page.getByLabel('主机 / IP', { exact: true }).fill('127.0.0.1');
  await page.getByLabel('端口', { exact: true }).fill(String(server.port));
  await page.locator('input[type=password]').fill('fixture');
  await page.getByRole('button', { name: '保存并连接', exact: true }).click();
  await page.locator('.session-tab.selected').filter({ hasText: '文件部署测试' }).waitFor();
  const location = page.getByRole('textbox', { name: '远程目录' });
  await location.fill('/'); await location.press('Enter');
  const row = name => page.locator('.file-table tbody tr').filter({ has: page.getByText(name, { exact: true }) });
  const tree = directory => page.locator('.tree-row[data-drop-directory]').filter({ has: page.locator(`.tree-select[title="${directory}"]`) });
  const dialog = name => page.getByRole('dialog', { name, exact: true });
  await row('a.log').waitFor();
  await tree('/target').waitFor();
  const capture = async name => {
    if (!process.argv.includes('--guide')) return;
    const out = path.resolve('artifacts/guide/screenshots'); await mkdir(out, { recursive: true });
    await page.locator('.file-drop-dialog').evaluate(element => {
      for (const [selector, text] of [['.file-drop-path', '① 核对完整目标目录'], ['.file-drop-body ul', '② 核对全部所选项目'], ['footer', '③ 确认后开始操作，取消则不修改']]) {
        const target = element.querySelector(selector), note = document.createElement('div');
        note.className = 'guide-file-note'; note.textContent = text;
        note.style.cssText = 'font:600 13px/1.5 Microsoft YaHei;color:#925019;background:#fff8e9;padding:4px 8px;border-left:3px solid #d77e30;margin:4px 0';
        target.before(note);
      }
    });
    await page.locator('.file-drop-dialog').screenshot({ path: path.join(out, name + '.png') });
    await page.locator('.guide-file-note').evaluateAll(elements => elements.forEach(element => element.remove()));
  };
  // Real mouse dragging must retain the existing multi-selection.
  await row('a.log').click();
  await row('b.log').click({ modifiers: ['Control'] });
  await row('folder').click({ modifiers: ['Control'] });
  await row('a.log').dragTo(tree('/target'));
  await expect(dialog('确认移动')).toContainText('共 3 个文件或文件夹');
  await expect(dialog('确认移动').locator('.file-drop-path')).toHaveText('/target');
  expect(await readdir(remote)).toContain('a.log');
  await dialog('确认移动').getByRole('button', { name: '取消', exact: true }).click();
  expect(await readdir(path.join(remote, 'target'))).toEqual(['nested']);
  await row('a.log').dragTo(tree('/target'));
  await capture('59-files-move');
  await dialog('确认移动').getByRole('button', { name: '确认移动', exact: true }).click();
  await expect(dialog('确认移动')).toHaveCount(0);
  expect(await readFile(path.join(remote, 'target/a.log'), 'utf8')).toBe('a.log');
  expect(await readFile(path.join(remote, 'target/b.log'), 'utf8')).toBe('b.log');
  expect(await readFile(path.join(remote, 'target/folder/child/data'), 'utf8')).toBe('folder content');
  expect(await readdir(remote)).not.toContain('folder');
  await expect(row('a.log')).toHaveCount(0);
  await expect(tree('/folder')).toHaveCount(0);
  checks.push('real pointer drag preserves multi-selection; cancel does not move; confirm moves exact files and recursive folder; list and tree refresh');
  // Explicit conflict keeps the source and original target intact.
  await expect(row('keep.log')).toHaveAttribute('draggable', 'true');
  await row('keep.log').dragTo(tree('/conflict'));
  await dialog('确认移动').getByRole('button', { name: '确认移动', exact: true }).click();
  await expect(dialog('确认移动').getByRole('alert')).toContainText('同名');
  expect(await readFile(path.join(remote, 'keep.log'), 'utf8')).toBe('keep.log');
  expect(await readFile(path.join(remote, 'conflict/keep.log'), 'utf8')).toBe('do not replace');
  await dialog('确认移动').getByRole('button', { name: '取消', exact: true }).click();
  await row('target').dragTo(tree('/target'));
  await expect(dialog('确认移动')).toHaveCount(0);
  await row('keep.log').dragTo(tree('/'));
  await expect(dialog('确认移动')).toHaveCount(0);
  checks.push('same-name, self and same-directory move guards');
  // Native files retain native paths through confirmation (no renderer path injection).
  const cdp = await page.context().newCDPSession(page);
  const drag = async (files, target, release = true) => {
    await target.scrollIntoViewIfNeeded();
    const b = await target.boundingBox();
    const data = { items: [], files, dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', ...(release ? ['drop'] : [])])
      await cdp.send('Input.dispatchDragEvent', { type, x: b.x + b.width / 2, y: b.y + b.height / 2, data });
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, data };
  };
  const files = [path.join(local, 'upload.txt'), path.join(local, 'bundle')];
  await drag(files, tree('/target'), false);
  await expect(tree('/target')).toHaveClass(/file-drop-target/);
  await expect(tree('/target/nested')).toBeVisible(); // hovering expands a collapsed folder
  await drag(files, tree('/target/nested'));
  await expect(dialog('确认上传').locator('.file-drop-path')).toHaveText('/target/nested');
  await expect(dialog('确认上传')).toContainText('共 2 个文件或文件夹');
  await capture('60-files-upload-confirm');
  await dialog('确认上传').getByRole('button', { name: '取消', exact: true }).click();
  expect(await readdir(path.join(remote, 'target/nested'))).toEqual([]);
  await page.getByRole('button', { name: '展开 /target/nested', exact: true }).click();
  await drag(files, tree('/target/nested'));
  await dialog('确认上传').getByRole('button', { name: '确认上传', exact: true }).click();
  await expect(dialog('确认上传')).toHaveCount(0);
  await expect.poll(() => readFile(path.join(remote, 'target/nested/upload.txt'), 'utf8').catch(() => '')).toBe('uploaded bytes');
  await expect.poll(() => readFile(path.join(remote, 'target/nested/bundle/nested/data'), 'utf8').catch(() => '')).toBe('recursive bytes');
  await expect(tree('/target/nested/bundle')).toBeVisible();
  await expect(page.locator('.transfer-panel')).toBeVisible();
  await page.getByTitle('关闭传输面板').click();
  await writeFile(path.join(local, 'upload.txt'), 'replacement');
  await drag([files[0]], tree('/target/nested'));
  await dialog('确认上传').getByRole('button', { name: '确认上传', exact: true }).click();
  await expect(dialog('确认上传')).toHaveCount(0);
  await expect.poll(() => readFile(path.join(remote, 'target/nested/upload.txt'), 'utf8').catch(() => '')).toBe('replacement');
  await page.getByTitle('关闭传输面板').click();
  await drag([files[0]], page.locator('.file-table thead'));
  await expect(dialog('确认上传').locator('.file-drop-path')).toHaveText('/');
  await dialog('确认上传').getByRole('button', { name: '确认上传', exact: true }).click();
  await expect(dialog('确认上传')).toHaveCount(0);
  await expect.poll(() => readFile(path.join(remote, 'upload.txt'), 'utf8').catch(() => '')).toBe('replacement');
  await page.getByTitle('关闭传输面板').click();
  // A drop on the tree heading must not silently upload into the list's directory.
  await drag([files[0]], page.locator('.tree-heading'));
  await expect(dialog('确认上传')).toHaveCount(0);
  checks.push('native file and folder drops: target tree row highlights, hover expands, cancel, target confirmation, exact destination, overwrite, current-directory list drop, tree blank rejection');
  // A pending operation cannot migrate into a different connection.
  await drag([files[0]], tree('/target'));
  await expect(dialog('确认上传')).toBeVisible();
  await page.evaluate(async () => { const id = (await window.elu.transferList())[0].sessionId; await window.elu.disconnect(id); });
  await expect(dialog('确认上传').getByRole('button', { name: '确认上传', exact: true })).toBeDisabled();
  await dialog('确认上传').getByRole('button', { name: '取消', exact: true }).click();
  checks.push('disconnection disables pending upload');
  expect(errors).toEqual([]);
  const report = { result: 'PASS', packaged, checks, errors };
  await writeFile(path.resolve(`test-results/file-drop-${packaged ? 'packaged' : 'desktop'}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(error);
  const page = await app.firstWindow(); await page.screenshot({ path: path.resolve('test-results/file-drop-failure.png'), timeout: 5000 }).catch(() => {});
  throw error;
} finally { await app.close(); await server.close(); }
