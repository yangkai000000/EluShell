import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
const user = await mkdtemp(path.resolve('test-results/settings-081-'));
const app = await electron.launch({ executablePath: path.resolve('release/win-unpacked/EluShell.exe'), env: { ...process.env, ELUSHELL_TEST_DATA: user } });
const page = await app.firstWindow(), errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.locator('.welcome-workspace').waitFor();
  for (const size of [[1320,940], [1060,700]]) {
    await app.evaluate(({ BrowserWindow }, [w,h]) => BrowserWindow.getAllWindows()[0].setSize(w,h), size);
    await page.getByTitle('工作区设置', { exact:true }).click();
    const nav = page.getByRole('navigation', { name:'设置目录' });
    await expect(nav.getByRole('button').first()).toHaveText('基础配置');
    for (const [id,label] of [['basic','基础配置'],['appearance','字体与背景'],['storage','本地目录与共享'],['ai','AI 配置'],['updates','更新配置']]) {
      await nav.getByRole('button', { name:label, exact:true }).click();
      await expect(nav.getByRole('button', { name:label, exact:true })).toHaveAttribute('aria-current','location');
      const distance = await page.locator(`#preferences-${id}`).evaluate(node => node.getBoundingClientRect().top-node.parentElement.getBoundingClientRect().top);
      expect(Math.abs(distance)).toBeLessThan(2);
      expect(await page.locator('.preferences-content').evaluate(node=>node.scrollWidth <= node.clientWidth)).toBe(true);
    }
    await nav.getByRole('button',{name:'AI 配置',exact:true}).click();
    await page.getByLabel('DeepSeek API Key',{exact:true}).fill('local-settings-fixture-key');
    await nav.getByRole('button',{name:'基础配置',exact:true}).click();
    await page.locator('#preferences-basic select').selectOption('10');
    await nav.getByRole('button',{name:'AI 配置',exact:true}).click();
    await expect(page.getByLabel('DeepSeek API Key',{exact:true})).toHaveValue('local-settings-fixture-key');
    await page.getByRole('button',{name:'保存 AI 配置',exact:true}).click();
    await expect(page.locator('.ai-settings')).toContainText('已保存。');
    await page.mouse.move(5,5);
    await page.waitForTimeout(250);
    const styles = await page.locator('.settings-save').evaluateAll(nodes=>nodes.map(node=>{
      const s=getComputedStyle(node);return [s.backgroundColor,s.color,s.height,s.padding,s.borderRadius,s.fontWeight];
    }));
    expect(styles).toHaveLength(2); expect(styles[0]).toEqual(styles[1]);
    await nav.getByRole('button',{name:'更新配置',exact:true}).click();
    await page.getByRole('button',{name:'保存更新设置',exact:true}).click();
    await page.getByTitle('关闭工作区设置').click();
    await page.getByTitle('工作区设置',{exact:true}).click();
    await expect(page.locator('#preferences-basic select')).toHaveValue('10');
    await nav.getByRole('button',{name:'AI 配置',exact:true}).click();
    await expect(page.getByLabel('DeepSeek API Key',{exact:true})).toHaveValue('');
    await page.getByTitle('关闭工作区设置').click();
  }
  await page.getByTitle('AI 命令助手',{exact:true}).click();
  await page.getByRole('complementary',{name:'AI 对话'}).getByTitle('AI 设置').click();
  await expect(page.locator('.preferences-nav [data-section="ai"]')).toHaveAttribute('aria-current','location');
  expect(errors).toEqual([]);
  await writeFile('test-results/settings-081.json',JSON.stringify({result:'PASS',sizes:[[1320,940],[1060,700]],navigation:true,draftPreserved:true,persistence:true,matchingSaveButtons:true,aiDeepLink:true,errors},null,2));
  console.log('Settings navigation, persistence and layout PASS');
} catch(error) { await page.screenshot({path:'test-results/settings-error.png'}); throw error; }
finally { await app.close(); }
