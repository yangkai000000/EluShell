import { _electron as electron, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';

const base = await mkdtemp(path.resolve('test-results/ai-readonly-'));
const remote = path.join(base, 'remote');
await mkdir(path.join(remote, 'nginx'), { recursive: true });
await writeFile(path.join(remote, 'nginx', 'itos.conf'), 'server {\n  listen 8080;\n}\n');
const inputs = [],
  requests = [],
  errors = [],
  commands = [];
const ssh = await fixture(remote, {
  greeting: 'NGINX_SELECTED ready\r\nsecond line\r\n$ ',
  input: (text) => inputs.push(text),
  exec: (command) => {
    commands.push(command);
    return command.startsWith('find ') ? '/nginx/itos.conf\n' : '';
  },
});
const http = createServer(async (req, res) => {
  let raw = '';
  for await (const b of req) raw += b;
  const body = JSON.parse(raw);
  requests.push(body);
  const last = body.messages.at(-1);
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const frame = (delta, finish = 'stop') =>
    res.write('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: finish }] }) + '\n\n');
  if (last.role === 'tool') {
    if (last.tool_call_id === 'find')
      frame(
        {
          tool_calls: [
            {
              index: 0,
              id: 'read',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"/nginx/itos.conf"}' },
            },
          ],
        },
        'tool_calls',
      );
    else
      frame({
        content:
          last.tool_call_id === 'write'
            ? '我没有直接修改文件的能力。'
            : '已读取 /nginx/itos.conf，监听端口为 8080。',
      });
  } else if (typeof last.content === 'string' && last.content.includes('尝试修改')) {
    // Deliberately malicious model output must be rejected by the main process.
    frame(
      {
        tool_calls: [
          {
            index: 0,
            id: 'write',
            type: 'function',
            function: {
              name: 'write_file',
              arguments: '{"path":"/nginx/itos.conf","content":"changed"}',
            },
          },
        ],
      },
      'tool_calls',
    );
  } else {
    frame(
      {
        tool_calls: [
          {
            index: 0,
            id: 'find',
            type: 'function',
            function: { name: 'find_paths', arguments: '{"path":"/","query":"itos.conf"}' },
          },
        ],
      },
      'tool_calls',
    );
  }
  res.end('data: [DONE]\n\n');
});
await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
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
  await page.locator('.welcome-workspace').waitFor();
  await page
    .locator('.session-tabs')
    .getByRole('button', { name: '连接管理', exact: true })
    .click();
  await page.locator('.folder-root').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '添加 SSH 服务器' }).click();
  await page.getByLabel('连接名称', { exact: true }).fill('只读测试服务器');
  await page.getByLabel('主机 / IP', { exact: true }).fill('127.0.0.1');
  await page.getByLabel('端口', { exact: true }).fill(String(ssh.port));
  await page.locator('input[type=password]').fill('fixture');
  await page.getByRole('button', { name: '保存并连接', exact: true }).click();
  await page.locator('.session-tab.selected').filter({ hasText: '只读测试服务器' }).waitFor();
  await page.getByTitle('AI 命令助手', { exact: true }).click();
  const side = page.getByRole('complementary', { name: 'AI 对话' });
  await side.getByTitle('AI 设置').click();
  await page.getByLabel('DeepSeek API Key', { exact: true }).fill('local-fixture-key');
  await page.locator('.ai-settings').getByText('高级配置', { exact: true }).click();
  await page.getByLabel('AI 基础地址').fill('http://127.0.0.1:' + http.address().port);
  await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  await expect(page.locator('.ai-settings')).toContainText('已保存。');
  await page.locator('.preferences-modal .modal-header button').click();
  await side.getByLabel('AI 消息').fill('查看 itos.conf 配置');
  const screen = page.locator('.terminal-mount:visible .xterm-screen');
  const row = page.locator('.terminal-mount:visible .xterm-rows > div').first();
  await expect(row).toContainText('NGINX_SELECTED');
  const box = await screen.boundingBox(),
    span = row.locator('span').first();
  const chars = await span.boundingBox(),
    cell = chars.width / (await span.innerText()).length;
  await page.mouse.move(box.x + 1, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + cell * 14 + 1, box.y + 8, { steps: 12 });
  await page.mouse.up();
  await page.getByRole('menuitem', { name: '发送给 AI', exact: true }).click();
  await expect(side.locator('.ai-composer')).toContainText('1行选中内容');
  await expect(side.getByLabel('AI 消息')).toHaveValue('查看 itos.conf 配置');
  const location = page.getByRole('textbox', { name: '远程目录' });
  await location.fill('/');
  await location.press('Enter');
  await page
    .locator('.file-table tbody tr')
    .filter({ hasText: 'nginx' })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: '标记给 AI', exact: true }).click();
  await expect(side.locator('.ai-composer')).toContainText('/nginx');
  await page.locator('.file-table tbody tr').filter({ hasText: 'nginx' }).dblclick();
  await page.locator('.file-table tbody tr').filter({ hasText: 'itos.conf' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '标记给 AI', exact: true }).click();
  await expect(side.locator('.ai-composer')).toContainText('/nginx/itos.conf');

  await app.evaluate(({ clipboard, nativeImage }) => {
    const image = nativeImage.createFromBitmap(Buffer.from([40, 120, 220, 255]), {
      width: 1,
      height: 1,
    });
    if (image.isEmpty()) throw Error('Fixture image is empty');
    clipboard.writeImage(image);
  });
  await side.getByLabel('AI 消息').focus();
  await page.keyboard.press('Control+v');
  expect(await side.locator('input[type=file]').count()).toBe(0);
  await expect(side.locator('.ai-composer img')).toHaveCount(1);
  await side.getByRole('button', { name: '发送', exact: true }).click();
  await expect(side.locator('.ai-assistant')).toContainText('监听端口为 8080', { timeout: 20000 });
  expect(requests[0].tools.map((t) => t.function.name)).toEqual([
    'list_directory',
    'find_paths',
    'read_file',
    'search_text',
  ]);
  expect(requests[0].messages.at(-1).content[0].text).toContain('NGINX_SELECTED');
  expect(requests[0].messages.at(-1).content[1].type).toBe('image_url');
  expect(requests[2].messages.at(-1).content).toContain('listen 8080');
  await expect(side.locator('.ai-composer .ai-attachment')).toHaveCount(0);
  await expect(side.locator('.ai-user .ai-attachment')).toHaveCount(4);
  expect(await side.getByRole('button', { name: '执行', exact: true }).count()).toBe(0);
  await side.getByLabel('AI 消息').fill('尝试修改配置');
  await side.getByRole('button', { name: '发送', exact: true }).click();
  await expect(side.locator('.ai-assistant').last()).toContainText('没有直接修改文件的能力');
  expect(await readFile(path.join(remote, 'nginx', 'itos.conf'), 'utf8')).toBe(
    'server {\n  listen 8080;\n}\n',
  );
  expect(inputs.join('')).toBe('');
  expect(commands.filter((c) => /touch|rm |chmod|tee|write_file/.test(c))).toEqual([]);
  await page.screenshot({ path: path.resolve('test-results/ai-readonly.png') });
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify(
      {
        passed: [
          'terminal reference isolated from input',
          'server file and folder references',
          'image preview and multimodal request',
          'find/read tool loop with real SFTP',
          'malicious write tool rejected',
          'remote file unchanged and no terminal input',
        ],
        screenshot: 'test-results/ai-readonly.png',
      },
      null,
      2,
    ),
  );
} finally {
  await app?.close();
  await ssh.close();
  await new Promise((resolve) => http.close(resolve));
}
