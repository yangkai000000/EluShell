import { _electron as electron, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const out = path.resolve('test-results'),
  base = await mkdtemp(path.join(out, 'updates-ui-'));
const user = path.join(base, '.EluShell'),
  cache = path.join(base, 'cache');
await mkdir(cache);
const bytes = Buffer.alloc(120000, 'update fixture, never executed');
let release = '99.0.0',
  corrupt = false,
  requests = 0;
const server = createServer((req, res) => {
  requests++;
  if (req.url.split('?')[0] === '/latest.yml') {
    const sha512 = createHash('sha512')
      .update(corrupt ? 'different bytes' : bytes)
      .digest('base64');
    res.end(
      JSON.stringify({
        version: release,
        files: [{ url: 'fixture.exe', sha512, size: bytes.length }],
        path: 'fixture.exe',
        sha512,
        releaseNotes: '更新交互测试：保留本地配置。',
      }),
    );
  } else if (req.url.split('?')[0] === '/fixture.exe') {
    res.setHeader('Content-Length', bytes.length);
    res.end(bytes);
  } else {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
let app, page;
const errors = [];
const launch = async () => {
  app = await electron.launch({
    executablePath: path.resolve('release/win-unpacked/EluShell.exe'),
    env: { ...process.env, ELUSHELL_TEST_DATA: user, LOCALAPPDATA: cache },
  });
  page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.new-tab-page').waitFor();
};
const status = () => page.evaluate(() => window.elu.updateStatus());
try {
  await launch();
  expect((await status()).config.url).toBe('');
  expect(requests).toBe(0);
  await page.getByTitle('工作区设置', { exact: true }).click();
  await expect(page.getByLabel('更新服务器地址')).toHaveValue('');
  await page.getByLabel('更新服务器地址').fill(url);
  await page.getByRole('button', { name: '保存更新设置', exact: true }).click();
  await expect(page.locator('.update-settings .update-error')).toContainText('HTTP');
  await page.getByLabel('允许 HTTP 测试源', { exact: false }).check();
  await page.getByRole('button', { name: '保存更新设置', exact: true }).click();
  await expect.poll(async () => (await status()).config.url).toBe(url);
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '软件更新' })).toBeVisible();
  expect((await status()).phase).toBe('available');
  await page
    .getByRole('dialog', { name: '软件更新' })
    .getByRole('button', { name: '忽略此版本' })
    .click();
  await expect(page.getByRole('dialog', { name: '软件更新' })).toHaveCount(0);
  await app.close();
  await launch();
  await expect.poll(async () => (await status()).phase, { timeout: 15000 }).toBe('available');
  expect((await status()).prompt).toBe(false);
  expect((await status()).config.ignoredVersion).toBe(release);
  await page.evaluate(() => window.elu.checkUpdate());
  await page
    .getByRole('dialog', { name: '软件更新' })
    .getByRole('button', { name: '下载更新', exact: true })
    .click();
  await expect.poll(async () => (await status()).phase, { timeout: 30000 }).toBe('ready');
  await page.screenshot({ path: path.join(out, 'update-ready-v07.png') });
  // Exercise the handoff UI without executing the downloaded non-executable fixture.
  const readyState = await status();
  await app.evaluate(({BrowserWindow}, state) => BrowserWindow.getAllWindows()[0].webContents.send('update-event', {...state,currentVersion:'0.10.0',version:'0.10.1',phase:'installing',installStep:'preparing',prompt:true}),readyState);
  await expect(page.getByRole('progressbar',{name:'安装准备进度'})).toBeVisible();
  expect(await page.getByRole('progressbar',{name:'安装准备进度'}).getAttribute('value')).toBeNull();
  await expect(page.getByTitle('稍后处理更新')).toBeDisabled();
  await expect(page.getByRole('dialog',{name:'软件更新'}).getByRole('button',{name:'重启并安装',exact:true})).toHaveCount(0);
  await page.locator('.update-modal').screenshot({path:path.resolve('artifacts/guide/screenshots/51-update-install.png')});
  await app.evaluate(({BrowserWindow}, state) => BrowserWindow.getAllWindows()[0].webContents.send('update-event', {...state,phase:'installing',installStep:'launching'}),readyState);
  await expect(page.locator('.update-install-progress')).toContainText('正在打开安装窗口');
  await app.evaluate(({BrowserWindow}, state) => BrowserWindow.getAllWindows()[0].webContents.send('update-event',state),readyState);

  await page
    .getByRole('dialog', { name: '软件更新' })
    .getByRole('button', { name: '稍后', exact: true })
    .click();
  expect((await status()).phase).toBe('ready');
  await app.close();
  await launch();
  // Normal quit did not execute the fixture or install it.
  await expect(page.locator('.new-tab-page')).toBeVisible();
  corrupt = true;
  release = '99.0.1';
  await page.evaluate(() => window.elu.checkUpdate());
  await page.evaluate(() => window.elu.downloadUpdate());
  expect((await status()).phase).toBe('error');
  expect((await status()).error).toMatch(/checksum|sha512/i);
  const installed = await page.evaluate(() => window.elu.installUpdate().catch((e) => String(e)));
  expect(installed).toContain('请先下载');
  await page.evaluate(() => window.elu.dismissUpdate(false));
  await page.evaluate(() =>
    window.elu.configureUpdates({ url: '', allowHttp: false, autoCheck: true }),
  );
  expect((await status()).phase).toBe('disabled');
  const config = JSON.parse(await readFile(path.join(user, 'updates.json'), 'utf8'));
  expect(config.url).toBe('');
  expect(errors).toEqual([]);
  const report = {
    result: 'PASS',
    checks: [
      'blank default/no network',
      'HTTP opt-in validation',
      'UI save and manual check',
      'ignore persists on restart',
      'background check respects ignore',
      'manual check overrides ignore',
      'actual updater download and SHA512 validation',
      'visible indeterminate installation preparation and launch states',
      'installation handoff disables dismissal and repeated installation',
      'deferred installation does not run on normal quit',
      'checksum failure blocks installation',
      'clear address disables updates',
    ],
    errors,
  };
  await writeFile(path.join(out, 'updates-packaged.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  await page?.screenshot({ path: path.join(out, 'updates-failure.png') }).catch(() => {});
  throw e;
} finally {
  await app?.close().catch(() => {});
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
