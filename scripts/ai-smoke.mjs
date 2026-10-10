import { _electron as electron, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';

const base = await mkdtemp(path.resolve('test-results/ai-'));
const root = path.join(base, 'remote');
await mkdir(root);
await writeFile(path.join(root, 'sample.txt'), 'a file to download');
const inputs = [],
  requests = [],
  requestRoutes = [],
  errors = [];
const ssh = await fixture(root, { input: (s) => inputs.push(s) });
const http = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(body);
  requestRoutes.push(req.url);
  const prompt = body.messages.at(-1).content;
  if (prompt === 'FAIL') {
    res.writeHead(401);
    res.end('invalid key');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const frame = (d) => res.write('data: ' + JSON.stringify(d) + '\n\n');
  frame({ choices: [{ delta: { reasoning_content: '先检查服务的监听端口与进程。' } }] });
  if (prompt === 'WAIT') {
    const t = setInterval(() => res.write(': heartbeat\n\n'), 100);
    res.on('close', () => clearInterval(t));
    return;
  }
  const content =
    prompt === 'MULTI'
      ? '分步检查：\n```bash\nprintf first\nprintf second\n```'
      : '使用以下命令查看所有 TCP 监听端口：\n```bash\nss -lntp\n```\n`-l` 仅显示监听中的端口；`-p` 显示进程信息。';
  for (let i = 0; i < content.length; i += 9) {
    await new Promise((r) => setTimeout(r, 35));
    if (res.destroyed) return;
    frame({ choices: [{ delta: { content: content.slice(i, i + 9) } }] });
  }
  frame({
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 310, completion_tokens: 123 },
  });
  res.end('data: [DONE]\n\n');
});
await new Promise((r) => http.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + http.address().port;
const packaged = process.argv.includes('--packaged');
let app;
const checks = [];
async function launch() {
  app = await electron.launch({
    ...(packaged
      ? { executablePath: path.resolve('release/win-unpacked/EluShell.exe') }
      : { args: ['.'] }),
    env: { ...process.env, ELUSHELL_TEST_DATA: path.join(base, 'user') },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  await page.locator('.welcome-workspace').waitFor();
  return page;
}
try {
  let page = await launch();
  await page.getByTitle('AI 命令助手', { exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: 'AI 对话' });
  await expect(sidebar.getByText('说说你想完成什么')).toBeVisible();
  await sidebar.getByTitle('AI 设置').click();
  await page.getByLabel('DeepSeek API Key', { exact: true }).fill('fixture-ai-key');
  await page.locator('.ai-settings').getByText('高级配置', { exact: true }).click();
  await page.getByLabel('AI 基础地址').fill(baseUrl);
  await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  await expect(page.locator('.ai-settings')).toContainText('已保存。');
  await expect(page.getByLabel('DeepSeek API Key', { exact: true })).toHaveAttribute(
    'placeholder',
    '••••••••',
  );
  await expect(page.getByLabel('DeepSeek API Key', { exact: true })).toHaveValue('');
  await page.locator('.preferences-modal .modal-header button').click();
  expect(await readFile(path.join(base, 'user', 'ai-settings.json'), 'utf8')).not.toContain(
    'fixture-ai-key',
  );
  checks.push('provider settings save, native encryption, no plaintext Key');
  await sidebar.getByLabel('AI 消息').fill('如何检查端口');
  await sidebar.getByRole('button', { name: '发送', exact: true }).click();
  await expect(sidebar.getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await expect(sidebar.locator('.ai-code').getByTitle('复制代码')).toBeEnabled({ timeout: 10000 });
  expect(inputs.join('')).toBe('');
  expect(requests[0]).not.toHaveProperty('tools');
  expect(requests[0].thinking).toEqual({ type: 'enabled' });
  await expect(sidebar).toContainText('输入 310 · 输出 123');
  await sidebar.getByTitle('复制代码').click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('ss -lntp');
  expect(await sidebar.getByRole('button', { name: '执行', exact: true }).count()).toBe(0);
  checks.push('streamed answer, copy and no execution controls');
  await page
    .locator('.session-tabs')
    .getByRole('button', { name: '连接管理', exact: true })
    .click();
  await page.locator('.folder-root').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '添加 SSH 服务器' }).click();
  await page.getByLabel('连接名称', { exact: true }).fill('AI test server');
  await page.getByLabel('主机 / IP', { exact: true }).fill('127.0.0.1');
  await page.getByLabel('端口', { exact: true }).fill(String(ssh.port));
  await page.locator('input[type=password]').fill('fixture');
  await page.getByRole('button', { name: '保存并连接', exact: true }).click();
  await page.locator('.session-tab.selected').filter({ hasText: 'AI test server' }).waitFor();
  const before = inputs.join('');
  expect(await sidebar.getByRole('button', { name: '填入', exact: true }).count()).toBe(0);
  await sidebar.getByLabel('AI 消息').fill('WAIT');
  await sidebar.getByRole('button', { name: '发送', exact: true }).click();
  await sidebar.getByRole('button', { name: '停止', exact: true }).click();
  await expect(sidebar).toContainText('已停止生成');
  await sidebar.getByTitle('新建 AI 对话').click();
  await sidebar.getByLabel('AI 消息').fill('FAIL');
  await sidebar.getByRole('button', { name: '发送', exact: true }).click();
  await expect(sidebar).toContainText('API Key 无效');
  await sidebar.getByTitle('历史对话').click();
  await expect(sidebar.locator('.ai-history-item')).toHaveCount(2);
  await sidebar.locator('.ai-history-item').last().getByTitle('重命名对话').click();
  await sidebar.getByLabel('对话名称').fill('端口排查记录');
  await sidebar.getByRole('button', { name: '保存', exact: true }).click();
  await sidebar.getByRole('button', { name: /端口排查记录/ }).click();
  checks.push('stop, provider error, new chat, history, rename and reopen');
  // 100 synthetic progress events stress the rendered queue; real SFTP is covered by files-smoke.
  const sessionId = await page.locator('.session-tab.selected').getAttribute('data-session-id');
  const job = (id, state = 'running') => ({
    id,
    sessionId: sessionId || 'fixture',
    direction: 'download',
    label: '长文件名_'.repeat(30) + id + '.log',
    localPath: 'C:/fixture/download',
    state,
    total: 40000000,
    done: state === 'completed' ? 40000000 : 12000000,
    filesDone: 12,
    filesTotal: 40,
    started: Date.now(),
  });
  await app.evaluate(
    ({ BrowserWindow }, j) =>
      BrowserWindow.getAllWindows()[0].webContents.send('transfer-event', j),
    job('first'),
  );
  const transfer = page.getByRole('region', { name: '上传下载进度' });
  await expect(transfer).toBeVisible();
  await expect(transfer.getByRole('button', { name: '在文件夹中显示' })).toHaveCount(0);
  await expect(transfer.locator('.transfer-details')).toContainText('11.4 MB / 38.1 MB');
  const geometry = await transfer.evaluate((el) => ({
    width: el.clientWidth,
    scroll: el.scrollWidth,
    p: getComputedStyle(el.querySelector('.transfer-progress i')).backgroundColor,
    b: getComputedStyle(el.querySelector('.transfer-progress')).backgroundColor,
  }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
  expect(geometry.p).not.toBe(geometry.b);
  await sidebar.locator('.ai-header strong').click();
  await expect(transfer).toHaveCount(0);
  await app.evaluate(
    ({ BrowserWindow }, j) =>
      BrowserWindow.getAllWindows()[0].webContents.send('transfer-event', j),
    job('first', 'completed'),
  );
  await expect(transfer).toHaveCount(0);
  await app.evaluate(
    ({ BrowserWindow }, jobs) =>
      jobs.forEach((j) => BrowserWindow.getAllWindows()[0].webContents.send('transfer-event', j)),
    Array.from({ length: 100 }, (_, i) => job('stress-' + i)),
  );
  await expect(transfer).toBeVisible();
  expect(
    await transfer
      .locator('.transfer-jobs')
      .evaluate((el) => el.scrollHeight > el.clientHeight && el.scrollWidth === el.clientWidth),
  ).toBe(true);
  await transfer.locator('.transfer-jobs').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(transfer.locator('article').last()).toBeInViewport();
  await page.screenshot({ path: path.resolve('test-results/ai-transfer-stress.png') });
  await page.keyboard.press('Escape');
  await expect(transfer).toHaveCount(0);
  checks.push(
    'new transfer auto-opens, outside click and Escape close, progress never reopens same job, contrasting colors, no horizontal overflow, 100 jobs vertically scroll',
  );
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1060, 700));
  await expect(sidebar).toBeVisible();
  expect(await page.locator('.terminal-panel').evaluate((el) => el.clientWidth)).toBeGreaterThan(
    420,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const divider = page.getByRole('separator', { name: '调整 AI 侧栏宽度' });
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(sidebar).toHaveCount(0);
  await page.getByTitle('AI 命令助手', { exact: true }).click();
  await expect(sidebar).toBeVisible();
  checks.push('1060x700 layout, sidebar keyboard resize and collapse');
  await sidebar.getByTitle('AI 设置').click();
  await page
    .locator('.ai-provider-choices')
    .getByRole('button', { name: /自定义/ })
    .click();
  await page.getByLabel('自定义 API 基础地址', { exact: true }).fill(baseUrl + '/v1');
  await page.getByLabel('自定义 API Key', { exact: true }).fill('fixture-custom-key');
  await page.getByLabel('自定义模型名称', { exact: true }).fill('custom-chat-model');
  await page.getByLabel('AI 默认供应商').selectOption('custom');
  await page.locator('.ai-settings').getByText('高级配置', { exact: true }).click();
  await page.getByLabel('自定义上下文容量').fill('32000');
  await page.getByLabel('自定义输出上限参数').selectOption('max_completion_tokens');
  await page.getByRole('button', { name: '保存 AI 配置', exact: true }).click();
  await expect(page.locator('.ai-settings')).toContainText('已保存。');
  await page.screenshot({ path: path.resolve('test-results/ai-custom-settings.png') });
  await expect(page.getByLabel('自定义 API Key', { exact: true })).toHaveAttribute(
    'placeholder',
    '••••••••',
  );
  await expect(page.getByLabel('自定义 API Key', { exact: true })).toHaveValue('');
  await page.locator('.preferences-modal .modal-header button').click();
  await sidebar.getByTitle('新建 AI 对话').click();
  await sidebar.getByLabel('AI 消息').fill('自定义接口检查端口');
  const beforeCustom = inputs.join('');
  await sidebar.getByRole('button', { name: '发送', exact: true }).click();
  await expect(sidebar.locator('.ai-code').getByTitle('复制代码')).toBeEnabled();
  expect(requestRoutes.at(-1)).toBe('/v1/chat/completions');
  expect(requests.at(-1)).toMatchObject({
    model: 'custom-chat-model',
    max_completion_tokens: 4096,
  });
  for (const field of ['thinking', 'reasoning_effort', 'max_tokens'])
    expect(requests.at(-1)).not.toHaveProperty(field);
  expect(inputs.join('')).toBe(beforeCustom);
  await expect(sidebar.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '32000');
  expect(await readFile(path.join(base, 'user', 'ai-settings.json'), 'utf8')).not.toContain(
    'fixture-custom-key',
  );
  checks.push(
    'custom provider required fields, encrypted Key, arbitrary model, streaming response, output parameter and context limit, no automatic SSH execution',
  );
  await app.close();
  page = await launch();
  await page.getByTitle('AI 命令助手', { exact: true }).click();
  await page.getByTitle('历史对话', { exact: true }).click();
  await page.getByRole('button', { name: /端口排查记录/ }).click();
  await expect(page.locator('.ai-messages')).toContainText('ss -lntp');
  expect((await page.evaluate(() => window.elu.aiState())).config.keys.deepseek).toBe(true);
  expect((await page.evaluate(() => window.elu.aiState())).config.keys.custom).toBe(true);
  expect((await page.evaluate(() => window.elu.aiState())).config.profiles.custom.model).toBe(
    'custom-chat-model',
  );
  checks.push('restart retains encrypted credentials, conversation content and history');
  await page.evaluate(async () => {
    const count = (await window.elu.aiState()).chats.length;
    for (let i = count; i < 99; i++) await window.elu.aiCreate('deepseek');
  });
  await page.getByTitle('新建 AI 对话').click();
  await page.getByTitle('历史对话', { exact: true }).click();
  await expect(page.locator('.ai-history-item')).toHaveCount(100);
  expect(
    await page
      .locator('.ai-history-list')
      .evaluate((el) => el.scrollHeight > el.clientHeight && el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.locator('.ai-history-list').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.locator('.ai-history-item').last()).toBeInViewport();
  await page.getByTitle('新建 AI 对话').click();
  await expect(page.getByRole('alert')).toContainText('最多保留 100 个对话');
  await page.getByLabel('搜索历史对话').fill('端口排查记录');
  await expect(page.locator('.ai-history-item')).toHaveCount(1);
  await page.getByRole('button', { name: /端口排查记录/ }).click();
  checks.push(
    '100 conversations vertical scroll, search and explicit capacity limit without deleting old history',
  );
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1500, 970));
  await page.screenshot({ path: path.resolve('test-results/ai-sidebar.png') });
  expect(errors).toEqual([]);
  const report = {
    result: 'PASS',
    packaged,
    checks,
    errors,
    providerLiveTest: 'Not run: no user API keys supplied; isolated HTTP SSE fixture used.',
  };
  await writeFile(
    `test-results/ai-${packaged ? 'packaged' : 'desktop'}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app?.close().catch(() => {});
  await ssh.close();
  http.closeAllConnections();
  await new Promise((r) => http.close(r));
}
