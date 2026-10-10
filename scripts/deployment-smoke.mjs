import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';
import { deploymentFixture } from './deployment-fixture.mjs';
const base = await mkdtemp(path.resolve('test-results/deployment-'));
const remote = path.join(base, 'remote'), local = path.join(base, 'order-service-release.jar'); await mkdir(remote); await writeFile(local, 'deployment package');
let script = '';
await mkdir(path.join(remote, 'tmp'));
const server = await fixture(remote, deploymentFixture(remote, async (text, stream, finish) => {
  script = text; stream.write('部署检查完成\n文件已上传到部署目录\n'); finish(0);
}));
const packaged = process.argv.includes('--packaged');
const app = await electron.launch({ ...(packaged ? { executablePath: path.resolve('release/win-unpacked/EluShell.exe') } : { args: ['.'] }), env: { ...process.env, ELUSHELL_TEST_DATA: path.join(base, '.EluShell') } });
try {
  const page = await app.firstWindow(); await page.locator('.welcome-workspace').waitFor();
  await app.evaluate(({ dialog }, local) => { dialog.showMessageBox = async () => ({ response: 1 }); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [local] }); }, local);
  await page.locator('.session-tabs').getByTitle('连接管理').click(); await page.locator('.folder-root').click({ button: 'right' }); await page.getByRole('menuitem', { name: '添加 SSH 服务器' }).click();
  await page.getByLabel('连接名称', { exact: true }).fill('部署测试服务器'); await page.getByLabel('主机 / IP', { exact: true }).fill('127.0.0.1'); await page.getByLabel('端口', { exact: true }).fill(String(server.port)); await page.locator('input[type=password]').fill('fixture'); await page.getByRole('button', { name: '保存并连接', exact: true }).click();
  await page.locator('.session-tab.selected').filter({ hasText: '部署测试服务器' }).waitFor();
  await page.getByRole('button', { name: '工具包', exact: true }).click(); await page.getByRole('button', { name: '部署', exact: true }).dblclick();
  await expect(page.locator('.session-tab.selected')).toContainText('部署测试服务器 · 部署');
  await expect(page.locator('.deployment-body button')).toHaveCount(1);
  await page.getByRole('button', { name: '新建方案', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '编辑部署方案' })).not.toContainText('绑定服务器'); await expect(page.getByRole('dialog', { name: '编辑部署方案' })).not.toContainText('127.0.0.1');
  await page.getByLabel('方案名称', { exact: true }).fill('订单发布'); await page.getByRole('button', { name: '选择文件', exact: true }).click();
  await expect(page.getByLabel('本地文件或目录', { exact: true })).toHaveValue(local);
  await page.getByLabel('部署命令', { exact: true }).fill('ls -lh "$ELUSHELL_UPLOAD_PATH"\nprintf "部署完成\\n"');
  await expect(page.locator('.deployment-command-editor .cm-lineNumbers')).toContainText('2');
  await page.getByRole('button', { name: '保存方案', exact: true }).click();
  await expect(page.locator('.deployment-row')).toHaveCount(1); await expect(page.getByRole('dialog', { name: '编辑部署方案' })).toHaveCount(0);
  const buttons = await page.locator('.deployment-row button').allTextContents(); expect(buttons.slice(-2)).toEqual(['执行', '编辑']);
  await page.locator('.deployment-row').getByRole('button', { name: '执行', exact: true }).click();
  await expect(page.locator('.deployment-output header')).toContainText('已完成');
  expect(await readFile(path.join(remote, 'home/EluShell/order-service-release.jar'), 'utf8')).toBe('deployment package');
  expect(script).toContain('export ELUSHELL_UPLOAD_PATH=');
  await page.locator('.deployment-row').getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByLabel('本地文件或目录', { exact: true })).toHaveValue(local); await expect(page.getByLabel('部署命令', { exact: true })).toContainText('ELUSHELL_UPLOAD_PATH');
  await page.getByTitle('关闭部署方案编辑').click();
  // Build a dense list with long paths. Only summaries are visible and actions stay on screen.
  const settings = await page.evaluate(() => window.elu.load());
  const plans = JSON.parse(await readFile(path.join(base, '.EluShell/deployments.json'), 'utf8'));
  expect(plans[0].profileId).toBeUndefined();
  await page.getByRole('button', { name: '新建方案', exact: true }).click(); await page.getByLabel('方案名称', { exact: true }).fill('长路径方案'); await page.getByLabel('本地文件或目录', { exact: true }).fill('C:\\' + 'very-long-folder\\'.repeat(20) + 'package.jar'); await page.getByLabel('部署命令', { exact: true }).fill('echo second'); await page.getByRole('button', { name: '保存方案', exact: true }).click();
  await expect(page.locator('.deployment-row')).toHaveCount(2);
  const fits = await page.locator('.deployment-list').evaluate(el => el.scrollWidth <= el.clientWidth + 1); expect(fits).toBe(true);
  if (await page.locator('.transfer-panel').isVisible()) await page.getByTitle('关闭传输面板').click();
  await page.screenshot({ path: 'test-results/deployment-list.png' });
  await page.locator('.deployment-row').filter({ hasText: '订单发布' }).getByRole('button', { name: '编辑', exact: true }).click(); await page.screenshot({ path: 'test-results/deployment-edit.png' });
  await page.getByTitle('关闭部署方案编辑').click();
  const binding = await page.evaluate(async () => (await window.elu.transferList()).find(t => t.direction === 'upload').sessionId);
  await page.evaluate(async ({ binding, template }) => {
    for(let n=0;n<100;n++) await window.elu.deploymentSave(binding, {...template,id:crypto.randomUUID(),name:'部署方案 '+n,localPath:'C:\\releases\\very-long-folder\\'+('package-'.repeat(50)) + n + '.jar'});
  }, { binding, template: plans[0] });
  await expect(page.locator('.deployment-row')).toHaveCount(102); // Shared plan events refresh open pages without reopening.
  await page.locator('.session-tab.selected').getByTitle('关闭工具会话').click();
  await page.getByRole('button',{name:'部署',exact:true}).dblclick();
  await expect(page.locator('.deployment-row')).toHaveCount(102);
  await page.locator('.deployment-row').last().scrollIntoViewIfNeeded();
  await expect(page.locator('.deployment-row').last().getByRole('button',{name:'编辑',exact:true})).toBeInViewport();
  expect(await page.locator('.deployment-body').evaluate(el=>el.scrollHeight>el.clientHeight && el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await writeFile('test-results/deployment-ui.json' , JSON.stringify({ result: 'PASS', packaged, emptyNewOnly: true, compactRows: true, stressPlans: 102, actionsRight: true, editShowsFullValues: true, sameSessionBinding: true, sharedPlans: true, noServerInEditor: true, livePlanRefresh: true, uploadBeforeCommand: true, persisted: true }, null, 2));
  console.log('PASS deployment list, editor, binding, persistence and execution');
} finally { await app.close(); await server.close(); }
