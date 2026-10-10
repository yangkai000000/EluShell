import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
const version=JSON.parse(await readFile('package.json','utf8')).version;
const guideVersion=JSON.parse(await readFile(`docs/releases/${version}.json`,'utf8')).guideVersion || version;
const layout=JSON.parse(await readFile('artifacts/guide/guide-layout.json','utf8'));
const root=path.resolve(`artifacts/release-${version}/site`);
const server=createServer(async(req,res)=>{
  try{
    let target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!target.startsWith(root+path.sep)&&target!==root)throw Error('Invalid path');
    if((await stat(target)).isDirectory())target=path.join(target,'index.html');
    res.setHeader('Content-Type',target.endsWith('.html')?'text/html; charset=utf-8':target.endsWith('.png')?'image/png':target.endsWith('.pdf')?'application/pdf':'application/octet-stream');
    res.end(await readFile(target));
  }catch{res.statusCode=404;res.end('Missing');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:900});
    await page.goto(base);
    await expect(page.locator('footer')).toHaveText('联系开发人员反馈：杨凯 · 邮箱：2272017540@qq.com');
    await expect(page.locator('footer a')).toHaveAttribute('href','mailto:2272017540@qq.com');
    await expect(page.locator('meta[name="elushell-version"]')).toHaveAttribute('content',version);
    await expect(page.locator('#mac-update')).toContainText('Command+Q');
    await expect(page.locator('#mac-update')).toContainText('~/.EluShell');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/release-page-${width}.png`,fullPage:true});
    await page.getByRole('link',{name:'在线阅读',exact:true}).click();
    await expect(page.locator('.guide-nav a')).toHaveCount(layout.titles.length-2);
    await page.locator('.guide-nav').getByRole('link',{name:'使用设置目录',exact:true}).click();
    await expect(page.getByRole('heading',{name:'使用设置目录',exact:true})).toBeInViewport();
    await page.locator('img').evaluateAll(images=>images.forEach(i=>i.loading='eager'));
    await expect.poll(()=>page.locator('img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0))).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`test-results/guide-page-${width}.png`});
    await page.locator('.guide-nav').getByRole('link',{name:'设置证书和 KEY 存放目录',exact:true}).click();
    await expect(page.getByRole('heading',{name:'设置证书和 KEY 存放目录',exact:true})).toBeInViewport();
    await page.screenshot({path:`test-results/guide-certificate-${width}.png`});
    await page.locator('.guide-nav').getByRole('link',{name:'选择 HTTP 跳转 HTTPS',exact:true}).click();
    const redirectTopic=page.getByRole('heading',{name:'选择 HTTP 跳转 HTTPS',exact:true});
    await expect(redirectTopic).toBeInViewport();
    await expect(redirectTopic.locator('..')).toContainText('308');
    await page.screenshot({path:`test-results/guide-redirect-${width}.png`});
    await page.locator('.guide-nav').getByRole('link',{name:'拖动文件到其他目录',exact:true}).click();
    const fileTopic=page.getByRole('heading',{name:'拖动文件到其他目录',exact:true});
    await expect(fileTopic).toBeInViewport();
    await expect(fileTopic.locator('..')).toContainText('确认移动');
    await page.screenshot({path:`test-results/guide-file-move-${width}.png`});
    await page.locator('.guide-nav').getByRole('link',{name:'使用会话右键菜单',exact:true}).click();
    await expect(page.getByRole('heading',{name:'使用会话右键菜单',exact:true}).locator('..')).toContainText('连接全部');
    await page.locator('.guide-nav').getByRole('link',{name:'批量删除文件和文件夹',exact:true}).click();
    await expect(page.getByRole('heading',{name:'批量删除文件和文件夹',exact:true}).locator('..')).toContainText('确认删除');
    const download=page.waitForEvent('download');
    await page.getByRole('link',{name:'下载 Word',exact:true}).first().click();
    expect((await download).suggestedFilename()).toBe(`EluShell-Guide-${guideVersion}.docx`);
    const pdf=await page.request.get(base+`guide/${guideVersion}/EluShell-Guide-${guideVersion}.pdf`);
    expect(pdf.status()).toBe(200);expect((await pdf.body()).subarray(0,4).toString()).toBe('%PDF');
    await page.getByRole('link',{name:'← 返回下载页'}).click();
    await expect(page).toHaveURL(base);
  }
  expect(errors).toEqual([]);
  await writeFile('test-results/release-site-qa.json',JSON.stringify({result:'PASS',version,widths:[1280,390],guideTopics:layout.titles.length-2,images:layout.figures+1,wordDownload:true,pdfRead:true,errors},null,2));
  console.log('Release page and guide desktop/mobile PASS');
}catch(error){await page.screenshot({path:'test-results/site-error.png'});console.log(await page.evaluate(()=>({hash:location.hash,scrollY,target:document.querySelector(location.hash)?.getBoundingClientRect().toJSON()})));throw error;}
finally{await browser.close();await new Promise(r=>server.close(r));}
