import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';
const base = await mkdtemp(path.resolve('test-results/capture-'));
await mkdir(path.join(base, 'remote'));
const h = Buffer.alloc(24);
h.writeUInt32LE(0xa1b2c3d4);
h.writeUInt16LE(2, 4);
h.writeUInt16LE(4, 6);
h.writeUInt32LE(65535, 16);
h.writeUInt32LE(1, 20);
const packet = Buffer.alloc(1016);
packet.writeUInt32LE(1000, 8);
packet.writeUInt32LE(1000, 12);
const streams = new Set(),
  commands = [],
  errors = [];
let bytes = 0;
const ssh = await fixture(path.join(base, 'remote'), {
  greeting: 'CAPTURE_TERMINAL_READY\r\n',
  execStream: (command, stream) => {
    commands.push(command);
    if (command.includes('@@INTERFACES')) {
      stream.end(
        '@@SSH\n127.0.0.1 54321 127.0.0.1 22\n@@INTERFACES\n1.any (All interfaces)\n2.eth0\n',
      );
      return true;
    }
    if (!command.startsWith('exec timeout ')) return false;
    streams.add(stream);
    stream.write(h);
    let blocked = false;
    stream.on('drain', () => (blocked = false));
    const timer = setInterval(() => {
      if (!blocked && !stream.destroyed) {
        blocked = !stream.write(packet);
        bytes += packet.length;
      }
    }, 2);
    const stop = () => {
      clearInterval(timer);
      streams.delete(stream);
      if (!stream.destroyed) {
        stream.exit(0);
        stream.end();
      }
    };
    stream.on('data', stop);
    stream.on('close', () => {
      clearInterval(timer);
      streams.delete(stream);
    });
    return true;
  },
});
let app;
try {
  app = await electron.launch({
    ...(process.argv.includes('--packaged')
      ? { executablePath: path.resolve('release/win-unpacked/EluShell.exe'), args: [] }
      : { args: ['.'] }),
    env: { ...process.env, ELUSHELL_TEST_DATA: path.join(base, 'user') },
  });
  await app.evaluate(
    ({ dialog }, output) => {
      dialog.showMessageBox = async () => ({ response: 1 });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
    },
    path.join(base, 'export.pcap'),
  );
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.new-tab-page').waitFor();
  await page.evaluate(async (port) => {
    const settings = await window.elu.load();
    const p = {
      id: 'capture-fixture',
      name: '测试服务器',
      host: '127.0.0.1',
      port,
      username: 'fixture',
      group: '',
      tags: [],
      auth: 'password',
      startup: '',
      autoStartup: false,
    };
    await window.elu.saveCredential(p, 'fixture', true);
    await window.elu.save({
      ...settings,
      profiles: [p],
      features: { ...settings.features, monitoring: false, directoryFollow: false },
    });
  }, ssh.port);
  await page.reload();
  await page.locator('.recent-connections tbody tr').filter({ hasText: '测试服务器' }).dblclick();
  await expect(page.locator('.xterm-rows')).toContainText('CAPTURE_TERMINAL_READY');
  expect(commands.some((c) => c.includes('tcpdump'))).toBe(false);
  await page.getByRole('button', { name: '工具包', exact: true }).click();
  await page.getByRole('button', { name: '抓包', exact: true }).click();
  await expect(page.getByRole('region', { name: '抓包工具' })).toHaveCount(0);
  await page.getByRole('button', { name: '抓包', exact: true }).dblclick();
  await expect(page.locator('.session-tab.selected')).toContainText('测试服务器 · 抓包');
  const start = page.getByRole('button', { name: '开始抓包', exact: true });
  await expect(start).toBeEnabled();
  await page.getByRole('button', { name: '抓包', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '打开', exact: true }).click();
  await expect(page.getByTitle('关闭工具会话')).toHaveCount(1);
  await page.getByLabel('抓包端口', { exact: true }).fill('443');
  await start.click();
  await expect(page.getByRole('button', { name: '停止并保存', exact: true })).toBeEnabled();
  await expect.poll(() => streams.size).toBe(1);
  const before = bytes;
  await page
    .locator('.session-tab')
    .filter({ hasNotText: '抓包' })
    .getByRole('button')
    .first()
    .click();
  await expect(page.locator('.xterm-rows')).toContainText('CAPTURE_TERMINAL_READY');
  await expect.poll(() => bytes).toBeGreaterThan(before);
  await page
    .locator('.session-tab')
    .filter({ hasText: '测试服务器 · 抓包' })
    .getByRole('button')
    .first()
    .click();
  await page.getByTitle('关闭工具会话').click();
  await page
    .getByRole('dialog', { name: '停止抓包并关闭' })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  expect(streams.size).toBe(1);
  await page.getByTitle('关闭工具会话').click();
  await page.getByRole('button', { name: '停止并关闭', exact: true }).click();
  await expect(page.getByTitle('关闭工具会话')).toHaveCount(0);
  await expect.poll(() => streams.size).toBe(0);
  await page.getByRole('button', { name: '抓包', exact: true }).dblclick();
  await expect(page.locator('.capture-result').first()).toContainText('已完成');
  await page.getByRole('button', { name: '下载 PCAP', exact: true }).click();
  await expect
    .poll(async () => {
      try {
        return (await readFile(path.join(base, 'export.pcap'))).length;
      } catch {
        return 0;
      }
    })
    .toBeGreaterThan(24);
  const output = await readFile(path.join(base, 'export.pcap'));
  expect(output.subarray(0, 24)).toEqual(h);
  expect((output.length - 24) % packet.length).toBe(0);
  await expect(start).toBeEnabled();
  await start.click();
  await expect.poll(() => streams.size).toBe(1);
  await page.screenshot({ path: 'test-results/capture-tool.png' });
  await page.getByTitle('工作区设置', { exact: true }).click();
  await page.getByRole('button', { name: '功能与性能', exact: true }).click();
  await page.getByRole('checkbox', { name: '开发工具包', exact: true }).uncheck();
  await expect.poll(() => streams.size).toBe(0);
  await page.getByTitle('关闭工作区设置').click();
  await expect(page.getByRole('button', { name: '工具包', exact: true })).toHaveCount(0);
  await expect(page.getByTitle('关闭工具会话')).toHaveCount(0);
  expect(errors).toEqual([]);
  await writeFile(
    'test-results/capture-qa.json',
    JSON.stringify(
      {
        result: 'PASS',
        commands: commands.filter((c) => c.startsWith('exec timeout')),
        exportedBytes: output.length,
        closeStops: true,
        disableStops: true,
        lazy: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log('Capture lifecycle PASS');
} finally {
  await app?.close();
  await ssh.close();
}
