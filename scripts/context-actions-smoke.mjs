import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';
const base = await mkdtemp(path.resolve('test-results/context-actions-'));
const remote = path.join(base, 'remote'),
  modes = [];
await mkdir(path.join(remote, 'folder'), { recursive: true });
for (const file of ['one.log', 'two.log', 'keep.log', 'folder/child'])
  await writeFile(path.join(remote, file), file);
const upload = path.join(base, 'upload.jar');
await writeFile(upload, Buffer.alloc(1024 * 1024, 65));
let releaseWrite,
  holdWrite = false;
const gate = new Promise((resolve) => {
  releaseWrite = resolve;
});
const server = await fixture(remote, {
  password: 'fixture',
  chmod: (p, mode) => modes.push({ p, mode }),
  sftpRequest: async (kind, p) => {
    if (kind === 'WRITE' && holdWrite) await gate;
    if (kind === 'REMOVE' && p === '/keep.log')
      throw Object.assign(Error('Permission denied'), { code: 'EACCES' });
  },
});
const packaged = process.argv.includes('--packaged');
const app = await electron.launch({
  ...(packaged
    ? { executablePath: path.resolve('release/win-unpacked/EluShell.exe') }
    : { args: ['.'] }),
  env: { ...process.env, ELUSHELL_TEST_DATA: path.join(base, 'user') },
});
const checks = [],
  errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.welcome-workspace').waitFor();
  await app.evaluate(({ dialog }) => {
    globalThis.nativeDialogs = 0;
    dialog.showMessageBox = async () => {
      globalThis.nativeDialogs++;
      return { response: 1, checkboxChecked: false };
    };
  });
  const create = async (name) => {
    await page
      .locator('.session-tabs')
      .getByRole('button', { name: '连接管理', exact: true })
      .click();
    await page.locator('.folder-root').click({ button: 'right' });
    await page.getByRole('menuitem', { name: '添加 SSH 服务器' }).click();
    await page.getByLabel('连接名称', { exact: true }).fill(name);
    await page.getByLabel('主机 / IP', { exact: true }).fill('127.0.0.1');
    await page.getByLabel('端口', { exact: true }).fill(String(server.port));
    await page.locator('input[type=password]').fill('fixture');
    await page.getByRole('button', { name: '保存并连接', exact: true }).click();
    await expect(page.locator('.session-tab.selected')).toContainText(name);
    await page.evaluate(async () => {
      for (const p of (await window.elu.load()).profiles)
        await window.elu.saveCredential(p, 'fixture', true);
    });
  };
  await create('测试 A');
  const nativeAtStart = await app.evaluate(() => globalThis.nativeDialogs);
  const location = page.getByRole('textbox', { name: '远程目录' });
  await location.fill('/');
  await location.press('Enter');
  const row = (name) =>
    page.locator('.file-table tbody tr').filter({ has: page.getByText(name, { exact: true }) });
  const multi = async (names) => {
    await row(names[0]).click();
    for (const name of names.slice(1)) await row(name).click({ modifiers: ['Control'] });
    await row(names[0]).click({ button: 'right' });
  };
  const shot = async (name, locator, notes) => {
    if (!process.argv.includes('--guide')) return;
    await locator.evaluate((el, notes) => {
      for (const [selector, text] of notes) {
        const at = el.querySelector(selector);
        const note = document.createElement('p');
        note.className = 'qa-note';
        note.textContent = text;
        note.style.cssText =
          'margin:5px 0;padding:5px 8px;font:600 12px/1.5 Microsoft YaHei;color:#98531e;background:#fff6e5;border-left:3px solid #ce8b30';
        at.before(note);
      }
    }, notes);
    await page.screenshot({ clip: await locator.boundingBox(), path: path.resolve('artifacts/guide/screenshots', name + '.png') });
    await locator.locator('.qa-note').evaluateAll((notes) => notes.forEach((n) => n.remove()));
  };
  await multi(['one.log', 'folder']);
  await page.getByRole('menuitem', { name: '批量修改权限…' }).click();
  const form = page.getByRole('dialog', { name: '文件操作', exact: true });
  await expect(form).toContainText('/one.log');
  await expect(form).toContainText('/folder');
  await form.getByLabel('八进制权限').fill('750');
  await expect(form.getByRole('checkbox', { name: '应用到所有子文件夹及文件' })).not.toBeChecked();
  await shot('62-files-batch-permissions', form, [
    ['.file-operation-paths', '① 全部所选路径'],
    ['.permission-editor', '② 勾选权限，与八进制数值同步'],
    ['footer', '③ 不勾选递归时仅修改所选项目本身'],
  ]);
  await form.getByRole('button', { name: '确定', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(modes.map((m) => m.p).sort()).toEqual(['/folder', '/one.log']);
  await multi(['one.log', 'folder']);
  await page.getByRole('menuitem', { name: '批量修改权限…' }).click();
  await form.getByLabel('八进制权限').fill('755');
  await form.getByRole('checkbox', { name: '应用到所有子文件夹及文件' }).check();
  modes.length = 0;
  await form.getByRole('button', { name: '确定', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(modes.map((m) => m.p).sort()).toEqual(['/folder', '/folder/child', '/one.log']);
  checks.push(
    'multi-selection permission editing, exact mode, recursive opt-in and preserved descendants by default',
  );
  await multi(['one.log', 'folder']);
  await page.getByRole('menuitem', { name: /批量删除/ }).click();
  const del = page.getByRole('dialog', { name: '确认删除', exact: true });
  await expect(del).toContainText('已选择 2 个');
  await shot('61-files-batch-delete', del, [
    ['.file-operation-paths', '① 核对服务器与全部选中项目'],
    ['footer', '② 确认后删除；取消或 Esc 不会修改文件'],
  ]);
  await page.keyboard.press('Escape');
  await expect(del).toHaveCount(0);
  expect(await readdir(remote)).toContain('one.log');
  await multi(['one.log', 'folder']);
  await page.getByRole('menuitem', { name: /批量删除/ }).click();
  await expect(del.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(del).toHaveCount(0);
  expect(await readdir(remote)).toContain('folder');
  await multi(['one.log', 'folder', 'keep.log']);
  await page.getByRole('menuitem', { name: /批量删除/ }).click();
  await del.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(del.getByRole('alert')).toContainText('2 项成功，1 项失败');
  expect(await readdir(remote)).toEqual(['keep.log', 'two.log']);
  await del.getByRole('button', { name: '关闭', exact: true }).click();
  await row('two.log').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除…', exact: true }).click();
  await del.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(del).toHaveCount(0);
  expect(await readdir(remote)).toEqual(['keep.log']);
  expect(await app.evaluate(() => globalThis.nativeDialogs)).toBe(nativeAtStart);
  checks.push(
    'themed single/batch delete, cancel/Escape/default focus do not delete, partial failures retain failed source and report details; no native deletion dialog',
  );
  holdWrite = true;
  const cdp = await page.context().newCDPSession(page),
    b = await page.locator('.file-table-wrap').boundingBox();
  for (const type of ['dragEnter', 'dragOver', 'drop'])
    await cdp.send('Input.dispatchDragEvent', {
      type,
      x: b.x + b.width / 2,
      y: b.y + b.height - 12,
      data: { items: [], files: [upload], dragOperationsMask: 1 },
    });
  await page
    .getByRole('dialog', { name: '确认上传' })
    .getByRole('button', { name: '确认上传' })
    .click();
  await expect(page.getByRole('dialog', { name: '确认上传' })).toHaveCount(0);
  await expect(page.locator('.transfer-panel')).toBeVisible();
  await expect(page.locator('.transfer-jobs')).toContainText('传输中');
  await page.getByTitle('关闭传输面板').click();
  await row('keep.log').click();
  releaseWrite();
  holdWrite = false;
  await expect
    .poll(
      async () =>
        await readFile(path.join(remote, 'upload.jar'))
          .then((b) => b.length)
          .catch(() => 0),
    )
    .toBe(1024 * 1024);
  await expect(row('upload.jar')).toBeVisible();
  checks.push(
    'upload modal closes immediately while SFTP upload is still blocked; transfer panel remains in charge and file list usable',
  );
  await create('测试 B');
  await create('测试 C');
  const tab = (name) => page.locator('.session-tab').filter({ hasText: name });
  const menu = async (name, action) => {
    await tab(name).click({ button: 'right' });
    await page.getByRole('menuitem', { name: action, exact: true }).click();
  };
  await menu('测试 A', '断开连接');
  await expect(tab('测试 A').locator('.offline')).toHaveCount(1);
  await expect(tab('测试 C')).toHaveClass(/selected/);
  const aIndex = await tab('测试 A').evaluate((el) => [...el.parentElement.children].indexOf(el));
  await menu('测试 A', '连接');
  await expect(tab('测试 A').locator('.offline')).toHaveCount(0);
  expect(await tab('测试 A').evaluate((el) => [...el.parentElement.children].indexOf(el))).toBe(
    aIndex,
  );
  await expect(tab('测试 C')).toHaveClass(/selected/);
  await menu('测试 B', '断开全部');
  await expect(page.locator('.session-tab .offline')).toHaveCount(3);
  await menu('测试 B', '连接全部');
  await expect(page.locator('.session-tab .offline')).toHaveCount(0);
  await expect(page.locator('.session-tab')).toHaveCount(3);
  checks.push(
    'disconnect keeps tabs, reconnect reuses tab positions without duplicate tabs or switching active session; connect/disconnect all',
  );
  await page.evaluate(async () => {
    const p = (await window.elu.load()).profiles.find((p) => p.name === '测试 B');
    await window.elu.saveCredential(p, '', false);
  });
  await menu('测试 B', '断开连接');
  await menu('测试 B', '连接全部');
  const auth = page.getByRole('dialog', { name: '连接会话', exact: true });
  await auth.getByRole('button', { name: '跳过', exact: true }).click();
  await expect(tab('测试 B').locator('.offline')).toHaveCount(1);
  await menu('测试 B', '连接');
  await auth.getByLabel('连接密码').fill('fixture');
  await auth.getByRole('button', { name: '连接', exact: true }).click();
  await expect(tab('测试 B').locator('.offline')).toHaveCount(0);
  await page.evaluate(async () => {
    const p = (await window.elu.load()).profiles.find((p) => p.name === '测试 B');
    await window.elu.saveCredential(p, 'fixture', true);
  });
  checks.push(
    'missing credentials prompt can skip without losing the tab and reconnect with an ephemeral password',
  );
  // A running deployment protects its owner during a batch close.
  const aId = await tab('测试 A').getAttribute('data-tab-id');
  await app.evaluate(
    ({ BrowserWindow }, id) =>
      BrowserWindow.getAllWindows()[0].webContents.send('deployment-event', {
        id: 'guard-fixture',
        sessionId: id,
        state: 'executing',
      }),
    aId,
  );
  await menu('测试 B', '关闭左侧');
  await expect(tab('测试 A')).toHaveCount(1);
  await app.evaluate(
    ({ BrowserWindow }, id) =>
      BrowserWindow.getAllWindows()[0].webContents.send('deployment-event', {
        id: 'guard-fixture',
        sessionId: id,
        state: 'completed',
      }),
    aId,
  );
  await menu('测试 B', '关闭左侧');
  await expect(tab('测试 A')).toHaveCount(0);
  await page.getByTitle('新建标签页', { exact: true }).click();
  await menu('测试 C', '关闭右侧');
  await expect(page.locator('.session-tab')).toHaveCount(2);
  await tab('测试 B').click({ button: 'right' });
  await shot('63-session-context', page.locator('.session-context'), [
    ['button', '① 仅连接当前打开且断开的会话'],
    ['hr', '② 按右击标签的位置关闭；运行中的任务会保留'],
  ]);
  await page.getByRole('menuitem', { name: '关闭其他', exact: true }).click();
  await expect(page.locator('.session-tab')).toHaveCount(1);
  await expect(tab('测试 B')).toHaveCount(1);
  await tab('测试 B').click();
  await page.getByRole('button', { name: '工具包', exact: true }).click();
  await page.locator('.toolbox').getByRole('button', { name: '部署', exact: true }).dblclick();
  const tool = page.locator('.session-tab').filter({ hasText: '测试 B · 部署' });
  await page.getByTitle('新建标签页', { exact: true }).click();
  await tool.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '关闭其他', exact: true }).click();
  await expect(page.locator('.session-tab')).toHaveCount(2);
  await tool.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '断开连接', exact: true }).click();
  await expect(page.locator('.session-tab .offline')).toHaveCount(1);
  await tool.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '连接', exact: true }).click();
  await expect(page.locator('.session-tab .offline')).toHaveCount(0);
  await expect(tool).toHaveClass(/selected/);
  await expect(page.locator('.session-tab')).toHaveCount(2);
  await tool.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '关闭当前', exact: true }).click();
  await expect(page.locator('.session-tab')).toHaveCount(1);
  await expect(tab('测试 B').locator('.offline')).toHaveCount(0);
  checks.push(
    'tool context actions operate on their owner, reconnect rebinds the tool without duplicate tabs, close others retains owner, closing tool alone preserves SSH',
  );
  await menu('测试 B', '关闭全部');
  await expect(page.locator('.welcome-workspace')).toBeVisible();
  await expect(page.locator('.session-tab')).toHaveCount(1);
  checks.push(
    'close left/right/others/all use context target, retain running deployment, and leave one new tab after closing all',
  );
  expect(errors).toEqual([]);
  await writeFile(
    'test-results/context-actions-' + (packaged ? 'packaged' : 'desktop') + '.json',
    JSON.stringify({ result: 'PASS', packaged, checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ result: 'PASS', packaged, checks }, null, 2));
} catch (e) {
  const page = await app.firstWindow();
  await page.screenshot({ path: 'test-results/context-actions-error.png' });
  throw e;
} finally {
  releaseWrite();
  await app.close();
  await server.close();
}
