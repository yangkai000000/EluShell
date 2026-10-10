import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';
const base = await mkdtemp(path.resolve('test-results/diagnostic-smoke-'));
const remote = path.join(base, 'remote');
await mkdir(remote);
const local = path.join(base, 'diagnostic-upload.jar');
const exported = path.join(base, 'export.jsonl');
await writeFile(local, Buffer.alloc(256 * 1024, 'PRIVATE_FILE_CONTENT'));
let deny = false;
const server = await fixture(remote, { sftpRequest(name) {
  if (deny && name === 'OPEN') throw Object.assign(Error('Permission denied'), { code: 'EACCES' });
} });
const app = await electron.launch({ args: [path.resolve('release/macos/app.asar')],
  env: { ...process.env, ELUSHELL_TEST_DATA: path.join(base, 'user') } });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ dialog, shell }, { local, exported }) => {
    dialog.showMessageBox = async () => ({ response: 1 });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [local] });
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: exported });
    shell.showItemInFolder = () => {};
  }, { local, exported });
  await page.locator('.welcome-workspace').waitFor();
  const id = await page.evaluate(async port => {
    const settings = await window.elu.load();
    const profile = { id: crypto.randomUUID(), name: 'Diagnostic fixture', host: '127.0.0.1', port,
      username: 'root', auth: 'password', group: '', tags: [], startup: '', autoStartup: false };
    return window.elu.connect(profile, 'PRIVATE_PASSWORD');
  }, server.port);
  await page.evaluate(id => window.elu.upload(id, '/'), id);
  expect(await readFile(path.join(remote, path.basename(local)))).toEqual(await readFile(local));
  deny = true;
  const error = await page.evaluate(id => window.elu.upload(id, '/').catch(e => String(e)), id);
  expect(error).toContain('Permission denied');
  const panel = page.getByRole('region', { name: '上传下载进度' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Permission denied');
  await page.getByRole('button', { name: '导出诊断日志', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('已导出');
  const text = await readFile(exported, 'utf8');
  const entries = text.trim().split('\n').map(line => JSON.parse(line));
  expect(entries[0].version).toBe('0.9.1');
  expect(entries.some(e => e.event === 'upload.context' && e.loginUsername === 'root')).toBe(true);
  expect(entries.some(e => e.event === 'sftp.error' && e.operation === 'open' && e.errorCode === 3)).toBe(true);
  expect(entries.some(e => e.event === 'upload.file-failed' && e.acknowledgedBytes === 0)).toBe(true);
  expect(text).not.toContain('PRIVATE_PASSWORD');
  expect(text).not.toContain('PRIVATE_FILE_CONTENT');
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/diagnostic-export-ui.png' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1060, 700));
  await expect(page.getByRole('button', { name: '导出诊断日志', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/diagnostic-export-ui-small.png' });
  await writeFile('test-results/diagnostic-smoke.json', JSON.stringify({
    result: 'PASS', version: '0.9.1', base,
    checks: ['Mac payload on Windows Electron', 'successful SFTP upload retains bytes',
      'remote OPEN denied reproduces Permission denied', 'UI export emits valid JSONL',
      'login identity and exact failed SFTP operation', 'zero acknowledged bytes distinguished from buffering',
      'credentials and payload excluded', 'export visible at minimum window size'],
    macOSRuntime: 'NOT RUN', errors,
  }, null, 2));
  console.log('Mac payload diagnostic UI/export PASS');
} finally { await app.close(); await server.close(); }
