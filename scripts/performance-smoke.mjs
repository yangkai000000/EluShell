import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';

const base = await mkdtemp(path.resolve('test-results/performance-'));
const remote = path.join(base, 'remote');
await mkdir(remote);
await mkdir(path.join(remote, 'folder'));
const streams = new Set(),
  executions = [],
  errors = [],
  samples = [];
let producing = false,
  bytes = 0;
const chunk = 'PERFORMANCE_LOG 0123456789 abcdefghijklmnopqrstuvwxyz\r\n'.repeat(160);
const metrics =
  '\n@@HOST\nfixture\nLinux\n@@UP\n100 200\n0.1 0.2 0.3\n@@CPU\ncpu 10 0 0 90 0 0 0 0\n@@MEM\nMemTotal: 1000000 kB\nMemAvailable: 500000 kB\n';
const ssh = await fixture(remote, {
  greeting: 'PERFORMANCE_READY\r\n',
  exec: (command) => {
    executions.push(command);
    return command.includes('/proc/stat') ? metrics : '/\n';
  },
  shell: (stream) => {
    streams.add(stream);
    let blocked = false;
    stream.on('drain', () => {
      blocked = false;
    });
    const timer = setInterval(() => {
      if (producing && !blocked && !stream.destroyed) {
        bytes += chunk.length;
        blocked = !stream.write(chunk);
      }
    }, 10);
    stream.on('close', () => {
      clearInterval(timer);
      streams.delete(stream);
    });
  },
});
let app;
try {
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, ELUSHELL_TEST_DATA: path.join(base, 'user') },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  await page.locator('.new-tab-page').waitFor();
  await page.evaluate(async (port) => {
    const settings = await window.elu.load();
    const profile = {
      id: 'perf-profile',
      name: '性能测试',
      host: '127.0.0.1',
      port,
      username: 'fixture',
      group: '',
      tags: [],
      auth: 'password',
      startup: '',
      autoStartup: false,
    };
    await window.elu.saveCredential(profile, 'fixture', true);
    await window.elu.save({ ...settings, profiles: [profile], pollSeconds: 2 });
  }, ssh.port);
  await page.reload();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  async function sample(stage) {
    await cdp.send('HeapProfiler.collectGarbage');
    const metrics = await cdp.send('Performance.getMetrics');
    const heap = metrics.metrics.find((m) => m.name === 'JSHeapUsedSize').value;
    const processes = await app.evaluate(({ app }) =>
      app.getAppMetrics().map((p) => ({ type: p.type, ...p.memory })),
    );
    const value = { stage, heap, processes, sessions: await page.locator('.xterm').count(), bytes };
    samples.push(value);
    console.log(
      JSON.stringify({
        stage,
        heapMB: +(heap / 1048576).toFixed(1),
        sessions: value.sessions,
        sentMB: +(bytes / 1048576).toFixed(1),
      }),
    );
    return value;
  }
  async function connect() {
    if (!(await page.locator('.new-tab-page').isVisible()))
      await page.getByTitle('新建标签页', { exact: true }).click();
    await page.locator('.recent-connections tbody tr').filter({ hasText: '性能测试' }).dblclick();
    await expect(page.locator('.session-tab.selected')).toContainText('性能测试');
  }
  const initial = await sample('initial');
  await connect();
  await expect(page.locator('.xterm-rows')).toContainText('PERFORMANCE_READY');
  await page.getByTitle('工作区设置', { exact: true }).click();
  await page.getByRole('button', { name: '功能与性能', exact: true }).click();
  const prefs = page.getByRole('dialog', { name: '工作区设置' });
  for (const label of [
    '服务器监控',
    '远程目录树',
    '目录自动跟随终端',
    'AI 助手',
    '背景图片',
    '记录命令历史',
    '传输进度自动展开',
  ])
    await prefs.getByRole('checkbox', { name: label, exact: true }).uncheck();
  await prefs.getByLabel('终端历史行数', { exact: true }).selectOption('1000');
  await prefs.getByLabel('多会话历史缓存预算', { exact: true }).selectOption('500000');
  await expect
    .poll(async () => (await page.evaluate(() => window.elu.load())).features.ai)
    .toBe(false);
  await page.screenshot({ path: path.resolve('test-results/performance-settings.png') });
  await page.getByTitle('关闭工作区设置').click();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.locator('.directory-tree')).toHaveCount(0);
  await expect(page.getByTitle('AI 命令助手', { exact: true })).toHaveCount(0);
  await page.waitForTimeout(500);
  const afterDisable = executions.length;
  await page.waitForTimeout(2500);
  expect(executions.length).toBe(afterDisable);
  await page.getByRole('combobox', { name: '命令输入' }).fill('echo not-recorded');
  await page.getByRole('combobox', { name: '命令输入' }).press('Enter');
  expect(
    Object.values((await page.evaluate(() => window.elu.load())).history).flat(),
  ).not.toContain('echo not-recorded');
  producing = true;
  await page.waitForTimeout(3000);
  await sample('one-session-output');
  for (let i = 1; i < 10; i++) await connect();
  await expect(page.locator('.xterm')).toHaveCount(10);
  await page.waitForTimeout(6000);
  const warm = await sample('ten-sessions-warm');
  await page.waitForTimeout(6000);
  const steady = await sample('ten-sessions-steady');
  // A generous regression bound; this is a plateau check, not a portable fixed RAM promise.
  expect(steady.heap - warm.heap).toBeLessThan(25 * 1048576);
  producing = false;
  for (let i = 0; i < 10; i++)
    await page.locator('.session-tab.selected').getByTitle('关闭会话').click();
  await expect(page.locator('.xterm')).toHaveCount(0);
  await expect.poll(() => streams.size).toBe(0);
  const closed = await sample('all-closed');
  expect(closed.heap - initial.heap).toBeLessThan(25 * 1048576);
  for (let i = 0; i < 12; i++) {
    await connect();
    await page.locator('.session-tab.selected').getByTitle('关闭会话').click();
  }
  await expect.poll(() => streams.size).toBe(0);
  const cycled = await sample('after-twelve-reconnects');
  expect(cycled.heap - closed.heap).toBeLessThan(10 * 1048576);
  await page.getByTitle('工作区设置', { exact: true }).click();
  await page.getByRole('button', { name: '功能与性能', exact: true }).click();
  for (const label of ['服务器监控', '远程目录树', '目录自动跟随终端', 'AI 助手'])
    await prefs.getByRole('checkbox', { name: label, exact: true }).check();
  await page.getByTitle('关闭工作区设置').click();
  await connect();
  await expect(page.locator('.directory-tree')).toHaveCount(1);
  await expect(page.locator('.sidebar')).toHaveCount(1);
  await expect(page.getByTitle('AI 命令助手', { exact: true })).toHaveCount(1);
  await expect.poll(() => executions.length).toBeGreaterThan(afterDisable);
  expect(errors).toEqual([]);
  await writeFile(
    path.resolve('test-results/performance-memory.json'),
    JSON.stringify(
      {
        samples,
        errors,
        checks: [
          'toggles stop requests and unload UI',
          'history disabled',
          '10 active output streams plateau',
          'close frees terminals and sockets',
          '12 reconnect cycles bounded',
          'features re-enable',
        ],
      },
      null,
      2,
    ),
  );
  console.log('PASS: feature toggles and memory lifecycle');
} finally {
  producing = false;
  await app?.close();
  await ssh.close();
}
