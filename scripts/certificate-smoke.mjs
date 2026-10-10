import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';
import { certificateGuideShots } from './certificate-guide-shots.mjs';

const base = await mkdtemp(path.resolve('test-results/certificate-ui-'));
const remote = path.join(base, 'remote');
await mkdir(remote);
let config = `server {
    listen 8080;
    server_name app.internal;
    location / { proxy_pass http://127.0.0.1:9000; }
}
server { listen 9090; server_name other.internal; }
`;
let execution = '',
  complete;
const server = await fixture(remote, {
  execStream(command, stream) {
    if (command.includes('readlink -f')) {
      stream.write('/etc/nginx/internal.conf\n' + Buffer.from(config).toString('base64'));
      stream.exit(0);
      stream.end();
      return true;
    }
    if (command.includes('openssl req -x509')) {
      execution = command;
      stream.write('生成证书\n检查 Nginx 配置\n');
      complete = () => {
        stream.write('证书已生成，Nginx 已重载\n');
        stream.exit(0);
        stream.end();
      };
      return true;
    }
    return false;
  },
});
const app = await electron.launch({
  ...(process.argv.includes('--packaged') ? { executablePath: path.resolve('release/win-unpacked/EluShell.exe'), args: [] } : { args: ['.'] }),
  env: { ...process.env, ELUSHELL_TEST_DATA: path.join(base, '.EluShell') },
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('.welcome-workspace').waitFor();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  await page.locator('.session-tabs').getByTitle('连接管理').click();
  await page.locator('.folder-root').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '添加 SSH 服务器' }).click();
  await page.getByLabel('连接名称', { exact: true }).fill('内网证书测试');
  await page.getByLabel('主机 / IP', { exact: true }).fill('127.0.0.1');
  await page.getByLabel('端口', { exact: true }).fill(String(server.port));
  await page.locator('input[type=password]').fill('fixture');
  await page.getByRole('button', { name: '保存并连接', exact: true }).click();
  await page.locator('.session-tab.selected').filter({ hasText: '内网证书测试' }).waitFor();
  await page.getByRole('button', { name: '工具包', exact: true }).click();
  await page.getByRole('button', { name: 'HTTPS 证书', exact: true }).dblclick();
  await expect(page.locator('.session-tab.selected')).toContainText('内网证书测试 · HTTPS 证书');
  await page.getByLabel('Nginx 配置文件', { exact: true }).fill('/etc/nginx/internal.conf');
  await page.getByRole('button', { name: '读取配置', exact: true }).click();
  await expect(page.getByLabel('选择站点')).toHaveValue('0');
  await expect(page.getByLabel('选择站点').locator('option')).toHaveCount(2);
  await page.getByLabel('证书存放目录', { exact: true }).fill('/home/EluShell/https/cert');
  await page.getByLabel('KEY 存放目录', { exact: true }).fill('/home/EluShell/https/private');
  await page.getByRole('button', { name: '预览生成结果', exact: true }).click();
  await expect(page.getByLabel('修改后 Nginx 配置')).toContainText(
    'ssl_certificate "/home/EluShell/https/cert/',
  );
  await expect(page.getByLabel('修改后 Nginx 配置')).toContainText(
    'ssl_certificate_key "/home/EluShell/https/private/',
  );
  await expect(page.getByLabel('修改后 Nginx 配置')).toContainText(
    'server { listen 9090; server_name other.internal; }',
  );
  const redirect = page.getByLabel('HTTP 自动跳转 HTTPS', { exact: true });
  await expect(redirect).not.toBeChecked();
  await redirect.check();
  await expect(page.getByLabel('修改后 Nginx 配置')).toHaveCount(0);
  await page.getByLabel('HTTPS 端口', { exact: true }).fill('8443');
  await page.getByRole('button', { name: '预览生成结果', exact: true }).click();
  await expect(page.getByLabel('修改后 Nginx 配置')).toContainText('if ($scheme = http)');
  await expect(page.getByLabel('修改后 Nginx 配置')).toContainText('return 308 https://$host:8443$request_uri;');
  await expect(page.locator('.certificate-results dl')).toContainText('自动跳转 HTTPS（308）');
  await page.getByLabel('生成后写入所选站点配置并重载 Nginx').uncheck();
  await expect(redirect).toHaveCount(0);
  await page.getByRole('button', { name: '预览生成结果', exact: true }).click();
  await expect(page.getByRole('button', { name: '仅生成证书文件', exact: true })).toBeVisible();
  await expect(page.getByLabel('修改后 Nginx 配置')).toHaveCount(0);
  await page.getByLabel('生成后写入所选站点配置并重载 Nginx').check();
  await redirect.uncheck();
  await page.getByRole('button', { name: '预览生成结果', exact: true }).click();
  await expect(page.getByLabel('修改后 Nginx 配置')).not.toContainText('return 308');
  await redirect.check();
  await page.getByLabel('有效期（天）', { exact: true }).fill('730');
  await expect(
    page.getByRole('button', { name: '生成证书并应用到 Nginx', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '预览生成结果', exact: true }).click();
  await page.screenshot({ path: 'test-results/certificate-preview.png' });
  if (process.argv.includes('--guide')) {
    await certificateGuideShots(app, page, () => complete(), (next) => {config=next;});
    expect(errors).toEqual([]);
    console.log('PASS packaged HTTPS certificate guide screenshots');
  } else {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1080, 730));
  await page
    .getByRole('button', { name: '生成证书并应用到 Nginx', exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await page.locator('.certificate-body').evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
  ).toBe(true);
  await page.getByRole('button', { name: '生成证书并应用到 Nginx', exact: true }).click();
  await expect(page.getByRole('heading', { name: '正在生成与配置…' })).toBeVisible();
  await page.locator('.session-tab.selected').getByTitle('关闭工具会话').click();
  await expect(page.locator('.toast')).toContainText('证书任务正在执行');
  expect(execution).toContain('openssl req -x509');
  expect(execution).toContain('chmod 600');
  expect(execution).toContain('/home/EluShell/https/private/');
  expect(execution).toContain('-days 730');
  complete();
  await expect(page.getByRole('heading', { name: '已完成', exact: true })).toBeVisible();
  config = `server {
    # EluShell HTTPS redirect begin
    if ($scheme = http) { return 308 https://$host:8443$request_uri; }
    # EluShell HTTPS redirect end
    listen 8080; listen 8443 ssl; location / { return 200 ok; }
  }`;
  await page.getByRole('button', { name: '读取配置', exact: true }).click();
  await expect(redirect).toBeChecked();
  await redirect.uncheck();
  await page.getByRole('button', { name: '预览生成结果', exact: true }).click();
  await expect(page.getByLabel('修改后 Nginx 配置')).not.toContainText('return 308');
  config = 'server { listen 80; server_name app.internal; return 301 https://$host$request_uri; }\nserver { listen 443 ssl; server_name app.internal; location / { return 200 ok; } }';
  await page.getByRole('button', { name: '读取配置', exact: true }).click();
  await expect(page.getByLabel('选择站点')).toHaveValue('1');
  await expect(redirect).toBeEnabled();
  await expect(page.getByLabel('HTTP 入口', {exact:true})).toHaveValue('0');
  await expect(page.locator('.certificate-existing-redirect')).toContainText('301');
  await redirect.check();
  await page.getByRole('button', { name: '预览生成结果', exact: true }).click();
  await expect(page.getByLabel('修改后 Nginx 配置')).toContainText('return 308 https://$host$request_uri;');
  await expect(page.getByLabel('修改后 Nginx 配置')).toContainText('return 301 https://$host$request_uri;');
  await expect(page.locator('.certificate-results dl')).toContainText('站点 1');
  config=await page.getByLabel('修改后 Nginx 配置').locator('code').allTextContents().then(lines=>lines.join('\n'));
  await page.getByRole('button', { name: '读取配置', exact: true }).click();
  await expect(page.getByLabel('选择站点')).toHaveValue('1');
  await expect(redirect).toBeChecked();
  await redirect.uncheck();
  await page.getByRole('button', { name: '预览生成结果', exact: true }).click();
  await expect(page.getByLabel('修改后 Nginx 配置')).not.toContainText('return 308');
  await expect(page.locator('.certificate-results dl')).toContainText('保留原有手工跳转');
  config='server { listen 80; server_name first.internal; }\nserver { listen 8080; server_name second.internal; }\nserver { listen 443 ssl; server_name app.internal; location / { return 200 ok; } }';
  await page.getByRole('button', { name: '读取配置', exact: true }).click();
  await page.getByLabel('选择站点').selectOption('2');
  await expect(page.getByLabel('HTTP 入口', {exact:true})).toHaveValue('');
  await redirect.check();
  await expect(page.getByRole('button', { name: '预览生成结果', exact: true })).toBeDisabled();
  await page.getByLabel('HTTP 入口', {exact:true}).selectOption('1');
  await expect(redirect).toBeChecked();
  await page.getByRole('button', { name: '预览生成结果', exact: true }).click();
  await expect(page.locator('.certificate-results dl')).toContainText('second.internal');
  expect(errors).toEqual([]);
  await writeFile(
    'test-results/certificate-ui.json',
    JSON.stringify(
      {
        result: 'PASS',
        selectedSiteOnly: true,
        separateDirectories: true,
        previewInvalidation: true,
        httpRedirect: true,
        reinspectionRestoresChoice: true,
        manualRedirectSiteSkipped: true,
        separateHttpEntrance: true,
        existingManualRedirectPreserved: true,
        ambiguousEntranceRequiresSelection: true,
        runningCloseGuard: true,
        narrowWindowNoHorizontalOverflow: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS HTTPS certificate tab, configuration preview, separate output directories, execution and responsive layout',
  );
  }
} finally {
  complete?.();
  await app.close();
  await server.close();
}
