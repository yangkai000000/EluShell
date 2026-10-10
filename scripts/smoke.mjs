import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ssh2 from 'ssh2';
const { Server, utils } = ssh2;
const out = path.resolve('test-results');
await mkdir(out, { recursive: true });
const packaged = process.argv.includes('--packaged');
const portable = process.argv.includes('--portable');
const testData = await mkdtemp(path.join(out, 'smoke-user-'));
const received = [];
const clients = new Set();
const server = new Server(
  { hostKeys: [utils.generateKeyPairSync('ed25519').private] },
  (client) => {
    clients.add(client);
    client.on('close', () => clients.delete(client));
    client.on('error', () => {});
    client.on('authentication', (ctx) =>
      ctx.method === 'password' && ctx.password === 'fixture-password'
        ? ctx.accept()
        : ctx.reject(),
    );
    client.on('ready', () =>
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (a) => a?.());
        session.on('shell', (accept) => {
          const stream = accept();
          stream.write('EluShell local SSH fixture\r\n$ ');
          stream.on('data', (data) => {
            received.push(data.toString());
            stream.write(data);
          });
        });
        session.on('exec', (accept) => {
          const stream = accept();
          stream.end(
            '\n@@HOST\nfixture-host\nLinux test\n@@CPU\ncpu 10 0 0 90 0 0 0 0\ncpu0 10 0 0 90 0 0 0 0\n@@MEM\nMemTotal: 1000 kB\nMemAvailable: 500 kB\n',
          );
        });
        session.on('sftp', (_accept, reject) => reject());
      }),
    );
  },
);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const app = await electron.launch({
  ...(packaged
    ? {
        executablePath: path.resolve(
          portable ? 'release/EluShell-0.1.0-windows-x64.exe' : 'release/win-unpacked/EluShell.exe',
        ),
      }
    : { args: ['.'] }),
  env: { ...process.env, ELUSHELL_TEST_DATA: testData },
});
try {
  const page = await app.firstWindow();
  await page.waitForSelector('.terminal-mount .xterm');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: '内存 详情', exact: false }).click();
  await page.getByText('可用内存', { exact: true }).waitFor();
  await page.locator('.modal-header > button').click();
  for (const [label, title] of [
    ['CPU 使用率', 'CPU 与系统负载'],
    ['网络流量', '网络与路由'],
    ['磁盘与 I/O', '磁盘与 I/O'],
    ['活跃进程', '进程管理'],
  ]) {
    await page
      .locator('.sidebar')
      .getByRole('button', { name: new RegExp(label) })
      .first()
      .click();
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    await page.locator('.modal-header > button').click();
  }
  await page
    .locator('.bottom-tabs')
    .getByRole('button', { name: /命令库/ })
    .click();
  await page.locator('.command-card>button').first().click();
  const input = page.getByRole('textbox', { name: '命令输入' });
  if (!(await input.inputValue())) throw Error('Quick command did not fill input');
  await input.fill('pwd');
  await input.press('Enter');
  await page.getByRole('button', { name: '执行历史', exact: true }).click();
  await page.locator('.history-list code').filter({ hasText: 'pwd' }).waitFor();
  await page
    .getByRole('button', { name: '命令库', exact: false })
    .filter({ has: page.locator('small') })
    .click();
  await page.getByRole('button', { name: '保存快捷命令', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('测试命令');
  await page.getByLabel('命令', { exact: true }).fill('echo smoke');
  await page.getByRole('button', { name: '保存命令', exact: true }).click();
  await page.locator('.command-card').filter({ hasText: '测试命令' }).waitFor();
  await page
    .locator('.session-tabs')
    .getByRole('button', { name: '连接管理', exact: true })
    .click();
  await page.getByRole('button', { name: '添加 SSH 服务器' }).click();
  await page.getByLabel('连接名称', { exact: true }).fill('测试服务器');
  await page.getByLabel('主机 / IP', { exact: true }).fill('127.0.0.1');
  await page.getByLabel('端口', { exact: true }).fill(String(server.address().port));
  await page.locator('input[type=password]').fill('fixture-password');
  await page.getByLabel('登录默认命令', { exact: true }).fill('echo login-ready');
  await page.getByRole('checkbox', { name: '连接成功后自动执行以上命令' }).check();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.profile-item').filter({ hasText: '测试服务器' }).waitFor();
  // The test fixture owns this temporary server key; production still prompts the user.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.getByRole('button', { name: '保存并连接', exact: true }).click();
  await expect.poll(() => received.join('')).toContain('echo login-ready');
  await page.locator('.session-tab.selected').filter({ hasText: '测试服务器' }).waitFor();
  await input.fill('echo ui-fixture');
  await input.press('Enter');
  await expect.poll(() => received.join('')).toContain('echo ui-fixture');
  await page.locator('.session-tab.selected').getByRole('button', { name: '关闭会话' }).click();
  await page.getByRole('button', { name: '文件管理', exact: true }).click();
  await page.locator('.toast').waitFor({ state: 'hidden' });
  await page.screenshot({
    path: path.join(out, packaged ? 'packaged-workspace.png' : 'workspace.png'),
  });
  await expect
    .poll(async () => {
      const settings = await page.evaluate(() => window.elu.load());
      return settings.profiles.some((p) => p.name === '测试服务器');
    })
    .toBe(true);
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.screenshot({
    path: path.join(out, packaged ? 'packaged-compact.png' : 'compact.png'),
  });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))
    throw Error('Compact layout overflows');
  if (errors.length) throw Error(errors.join('\n'));
  const report = {
    result: 'PASS',
    packaged,
    portable,
    checks: [
      'desktop boot',
      'memory detail',
      'CPU, network, disk and process details',
      'quick command',
      'terminal history',
      'custom snippet',
      'profile persistence',
      'real SSH through desktop IPC',
      'automatic login command',
      'session close',
      'compact viewport',
      'screenshot',
    ],
    errors,
  };
  await writeFile(
    path.join(
      out,
      portable ? 'portable-smoke.json' : packaged ? 'packaged-smoke.json' : 'desktop-smoke.json',
    ),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app.close();
  for (const client of clients) client.end();
  await new Promise((resolve) => server.close(resolve));
}
