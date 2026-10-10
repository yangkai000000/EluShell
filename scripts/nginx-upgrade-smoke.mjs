// UI/IPC fixture only. Real Linux process switching is verified separately.
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, cp, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';

const base = await mkdtemp(path.resolve('test-results/nginx-ui-'));
const remote = path.join(base, 'remote');
await mkdir(path.join(remote, 'tmp/elushell-nginx.TEST1234'), { recursive: true });
const resources = path.resolve('dist-electron/nginx-bundles');
const packaged = process.argv.includes('--packaged');
let previous = false;
if (!packaged) {
try { await access(resources); previous = true; await cp(resources, path.join(base, 'resources-backup'), { recursive: true }); } catch {}
const bytes = Buffer.from('UI fixture, not a runnable Nginx package');
const manifests = ['x86_64', 'aarch64'].map(arch => ({ arch, version: '1.30.5', minGlibc: '2.28', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, prefix: '/usr/local/nginx', config: 'conf/nginx.conf', pid: 'logs/nginx.pid' }));
await mkdir(resources, { recursive: true });
await writeFile(path.join(resources, 'manifest.json'), JSON.stringify(manifests));
for (const m of manifests) { await mkdir(path.join(resources, m.arch), { recursive: true }); await writeFile(path.join(resources, m.arch, 'nginx'), bytes); }
}
const fields = obj => Object.entries(obj).map(([k, v]) => `${k}\t${Buffer.from(v).toString('base64')}\n`).join('');
let complete;
const server = await fixture(remote, { execStream(command, stream) {
  const done = text => { stream.write(text); stream.exit(0); stream.end(); };
  if (command.includes('field arch')) { done(fields({ binary: '/usr/local/nginx/sbin/nginx', config: '/usr/local/nginx/conf/nginx.conf', prefix: '/usr/local/nginx', arch: 'aarch64', glibc: 'glibc 2.28', version: 'nginx version: nginx/1.19.9\nconfigure arguments:', writable: 'yes', system: 'PRETTY_NAME="Kylin Linux Advanced Server V10"', binaryHash: 'a'.repeat(64), dump: '# configuration file /usr/local/nginx/conf/nginx.conf:\nevents {}\nhttp { server { listen 8800; } }' })); return true; }
  if (command.includes('field cgroup')) { done(fields({ pid: '32147', start: '12345', commandHash: 'b'.repeat(64), command: 'nginx: master process ./nginx', cwd: '/usr/local/nginx/sbin', cgroup: '0::/user.slice/session-1.scope', masters: '1', health: '200' })); return true; }
  if (command.includes('mktemp -d')) { done('/tmp/elushell-nginx.TEST1234\n'); return true; }
  if (command.includes('stage 5')) { stream.write('ELUSHELL_STAGE:40:正在平滑切换新版\n'); complete = () => done('ELUSHELL_STAGE:100:升级完成，SSL 模块已启用\n'); return true; }
  if (command.includes('/candidate') || command.includes('rmdir --')) { done('检查通过\n'); return true; }
  return false;
} });
let app;
try {
  app = await electron.launch({ ...(packaged ? {executablePath: path.resolve('release/win-unpacked/EluShell.exe')} : {}), args: packaged ? [] : ['.'], env: { ...process.env, ELUSHELL_TEST_DATA: path.join(base, '.EluShell') } });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.locator('.welcome-workspace').waitFor();
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  await page.locator('.session-tabs').getByTitle('连接管理').click();
  await page.locator('.folder-root').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '添加 SSH 服务器' }).click();
  await page.getByLabel('连接名称', { exact: true }).fill('麒麟 V10 运维测试');
  await page.getByLabel('主机 / IP', { exact: true }).fill('127.0.0.1');
  await page.getByLabel('端口', { exact: true }).fill(String(server.port));
  await page.locator('input[type=password]').fill('fixture');
  await page.getByRole('button', { name: '保存并连接', exact: true }).click();
  await page.locator('.session-tab.selected').filter({ hasText: '麒麟 V10 运维测试' }).waitFor();
  await page.getByRole('button', { name: '工具包', exact: true }).click();
  await page.getByRole('button', { name: 'Nginx 升级', exact: true }).dblclick();
  await expect(page.locator('.session-tab.selected')).toContainText('Nginx 升级');
  const tool = page.getByRole('region', { name: 'Nginx 离线升级' });
  await tool.getByLabel('本机健康检查地址').fill('http://127.0.0.1:8800/');
  await tool.getByRole('button', { name: '检测兼容性' }).click();
  await expect(tool.getByRole('heading', { name: '可以准备升级' })).toBeVisible();
  await expect(tool.getByText('aarch64 · 内置包可用', { exact: true })).toBeVisible();
  await expect(tool.getByRole('button', { name: '备份并升级' })).toBeDisabled();
  await tool.getByLabel('本机健康检查地址').fill('http://127.0.0.1:8800/status');
  await expect(tool.getByRole('button', { name: '备份并升级' })).toHaveCount(0);
  await tool.getByRole('button', { name: '检测兼容性' }).click();
  await expect(tool.getByRole('heading', { name: '可以准备升级' })).toBeVisible();
  await page.screenshot({ path: 'test-results/nginx-upgrade-preview.png' });
  if (process.argv.includes('--guide')) {
    const { nginxGuideShots } = await import('./nginx-guide-shots.mjs');
    await nginxGuideShots(app, page, tool);
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1080, 730));
  await tool.getByLabel('已核对目标服务器和健康检查地址，同意执行升级').check();
  await tool.getByRole('button', { name: '备份并升级' }).click();
  await expect(tool.getByRole('heading', { name: '正在平滑切换新版' })).toBeVisible();
  await page.locator('.session-tab.selected').getByTitle('关闭工具会话').click();
  await expect(page.locator('.toast')).toContainText('Nginx 升级正在执行');
  expect(await tool.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  complete();
  await expect(tool.getByRole('heading', { name: '升级完成', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/nginx-upgrade-completed.png' });
  await tool.getByRole('button', { name: '继续配置 HTTPS 证书' }).click();
  await expect(page.locator('.session-tab.selected')).toContainText('HTTPS 证书');
  expect(errors).toEqual([]);
  await writeFile('test-results/nginx-upgrade-ui.json', JSON.stringify({ result: 'PASS', fixtureOnly: true, arm64Selection: true, previewInvalidation: true, explicitExecution: true, closeGuard: true, noHorizontalOverflow: true, certificateEntry: true, errors }, null, 2));
  console.log('PASS Nginx upgrade UI/IPC, architecture, confirmation, progress, close guard, narrow viewport and HTTPS entry');
} finally {
  complete?.();
  if (app) await app.close();
  await server.close();
  // Exact workspace path; restore real resources if present, otherwise remove fixture only.
  if (!packaged) {
    if (!resources.startsWith(path.resolve('dist-electron') + path.sep)) throw Error('Unsafe fixture resource path');
    await rm(resources, { recursive: true, force: true });
    if (previous) await cp(path.join(base, 'resources-backup'), resources, { recursive: true });
  }
}
