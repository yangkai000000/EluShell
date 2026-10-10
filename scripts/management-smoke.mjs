import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';
const out = path.resolve('test-results');
await mkdir(out, { recursive: true });
const base = await mkdtemp(path.join(out, 'management-v4-')),
  root = path.join(base, 'remote'),
  user = path.join(base, '.EluShell');
await mkdir(root);
await mkdir(path.join(root, 'logs'));
await writeFile(path.join(root, 'hello.txt'), 'fixture');
const processes = new Map([
  [
    42,
    {
      pid: 42,
      user: 'app',
      cpu: 9.1,
      memory: 4120166,
      state: 'S',
      name: 'java',
      start: '12345',
      executable: '/usr/bin/java',
      cwd: '/srv/services/orders',
      argv: [
        'java',
        '-jar',
        '-javaagent:/opt/agent.jar',
        '-Djava.library.path=/env/lib',
        'app.jar',
      ],
      command: 'java -jar app.jar',
    },
  ],
  [
    7,
    {
      pid: 7,
      user: 'root',
      cpu: 80,
      memory: 100,
      state: 'R',
      name: 'sshd',
      start: '67890',
      executable: '/usr/sbin/sshd',
      cwd: '/',
      argv: ['sshd'],
      command: 'sshd: fixture',
    },
  ],
]);
let authentications = 0,
  terminations = 0;
const metrics =
  '\n@@HOST\nfixture-host\nLinux fixture\n@@UP\n100 200\n0.1 0.2 0.3\n@@CPU\ncpu 10 0 0 90 0 0 0 0\ncpu0 10 0 0 90 0 0 0 0\n@@MEM\nMemTotal: 1000000 kB\nMemAvailable: 500000 kB\n@@PS\nPID USER CPU RSS ARGS\n42 app 9.1 2048 java -jar app.jar\n7 root 80 100 sshd\n';
const server = await fixture(root, {
  password: 'fixture-persist-secret',
  authenticated: () => authentications++,
  exec: (command) => {
    if (command.includes('@@HOST')) return metrics;
    if (command.includes('ps -eo pid=,user=,pcpu='))
      return [...processes.values()]
        .map((p) =>
          [
            p.pid,
            p.user,
            p.cpu,
            p.memory,
            p.state,
            p.name,
            p.start,
            p.executable,
            p.cwd,
            Buffer.from(p.argv.join('\0') + '\0').toString('hex'),
            p.command,
          ].join('\t'),
        )
        .join('\n');
    const pid = Number(command.match(/\/proc\/(\d+)\/stat/)?.[1]),
      p = processes.get(pid);
    if (command.includes('kill -TERM')) {
      if (p) {
        processes.delete(pid);
        terminations++;
        return '\nELUSHELL_TERMINATED';
      }
      return 'process gone';
    }
    if (p) return p.start + '\t' + p.name;
    return '';
  },
});
const packaged = process.argv.includes('--packaged');
let app;
const launch = async () => {
  app = await electron.launch({
    ...(packaged
      ? { executablePath: path.resolve('release/win-unpacked/EluShell.exe') }
      : { args: ['.'] }),
    env: { ...process.env, ELUSHELL_TEST_DATA: user },
  });
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  return app.firstWindow();
};
try {
  let page = await launch();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.welcome-workspace').waitFor();
  await expect(page.locator('.session-tab')).toHaveCount(1);
  await expect(page.locator('.session-tab.selected')).toHaveText('新建标签页');
  expect(await page.locator('body').innerText()).not.toContain('演示');
  await page.screenshot({ path: path.join(out, 'welcome-v4.png') });
  await page.getByTitle('连接管理', { exact: true }).click();
  await page.getByTitle('新建文件夹', { exact: true }).click();
  await page.getByLabel('文件夹名称').fill('公司环境');
  await page.getByRole('button', { name: '保存文件夹', exact: true }).click();
  await page.locator('.folder-select').filter({ hasText: '公司环境' }).waitFor();
  await page.getByTitle('新建文件夹', { exact: true }).click();
  await page.getByLabel('文件夹名称').fill('生产');
  await page.getByRole('button', { name: '保存文件夹', exact: true }).click();
  await page.locator('.folder-select').filter({ hasText: '生产' }).waitFor();
  await page.locator('.connection-folder.selected').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '添加 SSH 服务器' }).click();
  await page.getByLabel('连接名称', { exact: true }).fill('Managed server');
  await page.getByLabel('主机 / IP', { exact: true }).fill('127.0.0.1');
  await page.getByLabel('端口', { exact: true }).fill(String(server.port));
  await page.getByLabel('用户名', { exact: true }).fill('fixture');
  await page.locator('input[type=password]').fill('fixture-persist-secret');
  await expect(page.getByRole('checkbox', { name: '加密保存密码 / 口令' })).toBeChecked();
  await page.getByRole('button', { name: '隧道 (0)', exact: true }).click();
  await page.getByRole('button', { name: '添加隧道', exact: true }).click();
  await expect(page.getByLabel('监听端口', { exact: true })).toHaveValue('13306');
  await page.getByRole('checkbox', { name: '启用规则 1' }).uncheck();
  await page.screenshot({ path: path.join(out, 'connections-v4.png') });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.connection-list-status')).toContainText('已保存');
  let stored = JSON.parse(await readFile(path.join(user, 'settings.json'), 'utf8'));
  expect(stored.folders).toHaveLength(2);
  expect(stored.folders[1].parentId).toBe(stored.folders[0].id);
  expect(stored.profiles[0].folderId).toBe(stored.folders[1].id);
  expect(stored.profiles[0].tunnels).toHaveLength(1);
  expect(await readFile(path.join(user, 'credentials.json'), 'utf8')).not.toContain(
    'fixture-persist-secret',
  );
  await app.close();
  page = await launch();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.welcome-workspace').waitFor();
  await page.locator('.session-tabs').getByTitle('连接管理', { exact: true }).click();
  await page
    .locator('.connection-list .profile-item')
    .filter({ hasText: 'Managed server' })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: '编辑连接', exact: true }).click();
  await expect(page.locator('input[type=password]')).toHaveAttribute(
    'placeholder',
    '••••••••',
  );
  await expect(page.locator('input[type=password]')).toHaveValue('');
  await page.getByRole('button', { name: '保存并连接', exact: true }).click();
  await page.locator('.xterm').waitFor();
  expect(authentications).toBe(1);
  await page.getByRole('button', { name: /活跃进程/ }).click();
  await page.getByRole('dialog', { name: '进程管理' }).waitFor();
  await expect(page.locator('.process-table tbody tr')).toHaveCount(2);
  const appRow = page.locator('.process-table tbody tr').filter({ hasText: 'app.jar' });
  await expect(appRow.locator('td').nth(2)).toHaveText('3.9 GB');
  await expect(appRow.locator('td').nth(7)).toHaveText('/srv/services/orders/app.jar');
  await expect(
    page
      .locator('.process-table tbody tr')
      .filter({ hasText: 'sshd: fixture' })
      .locator('td')
      .nth(2),
  ).toHaveText('100.0 KB');
  await appRow.locator('td').nth(7).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '复制位置', exact: true }).click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('/srv/services/orders/app.jar');
  await appRow.click();
  await expect(page.locator('.process-selection')).toContainText('/usr/bin/java');

  await page
    .locator('.process-modal')
    .getByRole('columnheader', { name: 'PID' })
    .getByRole('button')
    .click();
  await expect(page.locator('.process-table tbody tr').first().locator('td').first()).toHaveText(
    '7',
  );
  await page
    .locator('.process-modal')
    .getByRole('columnheader', { name: 'PID' })
    .getByRole('button')
    .click();
  await expect(page.locator('.process-table tbody tr').first().locator('td').first()).toHaveText(
    '42',
  );
  for (const label of ['用户', '内存', 'CPU', '状态', '名称', '命令行', '位置']) {
    const h = page
      .locator('.process-modal')
      .getByRole('columnheader', { name: label, exact: true });
    await h.getByRole('button').click();
    await expect(h).toHaveAttribute('aria-sort', 'ascending');
    await h.getByRole('button').click();
    await expect(h).toHaveAttribute('aria-sort', 'descending');
  }
  await page
    .locator('.process-table tbody tr')
    .filter({ hasText: 'app.jar' })
    .locator('td')
    .nth(6)
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: '复制命令行', exact: true }).click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('java -jar app.jar');
  await page.screenshot({ path: path.join(out, 'processes-v041.png') });
  await page
    .locator('.process-table tbody tr')
    .filter({ hasText: 'app.jar' })
    .locator('td')
    .first()
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: '终止进程（SIGTERM）…', exact: true }).click();
  await expect(page.locator('.process-table tbody tr')).toHaveCount(1);
  expect(terminations).toBe(1);
  await page.getByTitle('关闭进程管理').click();
  await page.getByRole('button', { name: '内存 详情', exact: false }).click();
  await page.getByText('可用内存', { exact: true }).waitFor();
  await page.locator('.modal-header > button').click();
  const input = page.getByLabel('命令输入', { exact: true });
  await input.fill('pwd');
  await input.press('Enter');
  await page.getByRole('button', { name: '执行历史', exact: true }).click();
  await expect(page.locator('.history-list')).toContainText('pwd');
  await page.getByRole('button', { name: '文件管理', exact: true }).click();
  const monitor = page.getByRole('separator', { name: '调整监控栏宽度' });
  await monitor.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.sidebar')).toHaveCSS('width', '256px');
  await page.getByTitle('面板布局', { exact: true }).click();
  await page.getByRole('button', { name: '终端专注模式', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveCSS('width', '0px');
  await page.getByTitle('面板布局', { exact: true }).click();
  await page.getByRole('button', { name: '终端专注模式', exact: true }).click();
  await page.getByTitle('工作区设置', { exact: true }).click();
  await expect(page.locator('.config-panel')).toContainText(user);
  await page.getByRole('button', { name: '导出连接配置', exact: true }).click();
  await page.getByRole('checkbox', { name: '包含已保存的连接密码' }).uncheck();
  await page.getByRole('button', { name: '确认导出', exact: true }).click();
  const exportPath = (await page.locator('.config-panel [role=status]').innerText()).replace(/^已导出：/, '');
  expect(JSON.parse(await readFile(exportPath, 'utf8')).profiles[0].name).toBe('Managed server');
  expect(await readFile(exportPath, 'utf8')).not.toContain('fixture-persist-secret');
  await page.locator('.small-modal .modal-header > button').click();
  await page.setViewportSize({ width: 1100, height: 760 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw Error('Window overflow');
  await page.screenshot({ path: path.join(out, 'workspace-v4.png') });
  await page.locator('.session-tab.selected').getByTitle('关闭会话').click();
  await page.locator('.welcome-workspace').waitFor();
  expect(errors).toEqual([]);
  const report = {
    result: 'PASS',
    packaged,
    checks: [
      'no demo or automatic connection',
      'nested folders',
      'connection folder assignment',
      'dedicated tunnel tab',
      'encrypted password file',
      'password reconnect after application restart',
      'full process table',
      'actual service JAR location and copy',
      'automatic GB and KB memory units',
      'every column ascending and descending',
      'copy process command',
      'confirmed SIGTERM through SSH',
      'metrics and command history regression',
      'resizable collapsible workspace',
      'configuration directory and password-free export',
      'compact viewport',
    ],
    errors,
  };
  await writeFile(
    path.join(out, packaged ? 'management-packaged.json' : 'management-desktop.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app?.close().catch(() => {});
  await server.close();
}
