import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export async function certificateGuideShots(app, page, complete, setConfig) {
  const out = path.resolve('artifacts/guide/screenshots');
  await mkdir(out, { recursive: true });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 1200));
  const manifest = [];
  const version = JSON.parse(await readFile('package.json','utf8')).version;
  async function capture(name, start, end, labels) {
    await start.evaluate(e=>e.scrollIntoView({block:'start'}));
    const a = await start.boundingBox(), b = await end.boundingBox();
    const container = await page.locator('.certificate-form').boundingBox();
    const box = { x: container.x, y: a.y - 8, width: container.width, height: b.y + b.height - a.y + 16 };
    const targets = [];
    for (const [locator, text, x, y, anchor] of labels) {
      const r = await locator.boundingBox();
      targets.push({ text, x: box.x + box.width * x, y: box.y + box.height * y, tx: r.x + r.width * (anchor?.x ?? .75), ty: r.y + r.height * (anchor?.y ?? .5) });
    }
    await page.evaluate(({ targets }) => {
      const root = document.createElement('div'); root.id = 'guide-annotations';
      root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
      const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
      svg.style.cssText = 'position:absolute;width:100%;height:100%'; root.append(svg);
      for (const t of targets) {
        const line = document.createElementNS(ns, 'line');
        for (const [k,v] of Object.entries({x1:t.x+8,y1:t.y+15,x2:t.tx,y2:t.ty,stroke:'#dd6915','stroke-width':2})) line.setAttribute(k,v);
        svg.append(line);
        const tag = document.createElement('div'); tag.textContent=t.text;
        tag.style.cssText=`position:absolute;left:${t.x}px;top:${t.y}px;font:600 18px/1.35 'Microsoft YaHei';padding:4px 8px;color:#163951;background:#fff9ed;border:1px solid #dd6915;border-radius:3px`; root.append(tag);
      }
      document.body.append(root);
    }, {targets});
    await page.screenshot({path:path.join(out,name+'.png'),clip:box});
    await page.evaluate(()=>document.getElementById('guide-annotations').remove());
    manifest.push({name,labels:labels.map(x=>x[1]),source:`Windows ${version} packaged application; loopback SSH fixture`});
  }
  const label = (name) => page.getByLabel(name).first();
  await capture('52-certificate-site',label('Nginx 配置文件').locator('..'),page.locator('.certificate-fields'),[
    [label('Nginx 配置文件'),'① 指定服务器上的配置文件',.46,.04],
    [label('选择站点'),'② 选择要启用 HTTPS 的站点',.45,.42],
    [label('证书适用的 IP / 域名'),'③ 填写实际访问地址',.57,.73],
  ]);
  await capture('53-certificate-directories',label('证书存放目录').locator('..'),page.getByRole('button',{name:'预览生成结果',exact:true}),[
    [label('证书存放目录'),'① 证书目录',.67,.035],
    [label('KEY 存放目录'),'② KEY 可放在不同目录',.53,.18],
    [label('Nginx 主配置文件'),'③ 主配置需包含所选站点',.46,.66],
  ]);
  await page.getByRole('button',{name:'预览生成结果',exact:true}).click();
  const results = page.locator('.certificate-results');
  await results.scrollIntoViewIfNeeded();
  // The responsive layout stacks the form and preview; crop the preview at its real width.
  await capture('54-certificate-preview',results.locator('h3').first(),results.locator('p').last(),[
    [results.locator('dl'),'① 核对证书 KEY 与备份路径',.45,.04],
    [page.getByRole('button',{name:'原配置',exact:true}),'② 切换对照原配置',.57,.36],
    [page.getByRole('button',{name:'生成证书并应用到 Nginx',exact:true}),'③ 确认后生成并应用',.51,.84],
  ]);
  await page.getByRole('button',{name:'生成证书并应用到 Nginx',exact:true}).click();
  await page.getByRole('heading',{name:'正在生成与配置…'}).waitFor();
  complete();
  await page.getByRole('heading',{name:'已完成',exact:true}).waitFor();
  const job = page.locator('.certificate-job');
  await capture('55-certificate-result',job.locator('h3'),job.locator('p').last(),[
    [job.locator('h3'),'① 查看执行状态',.53,.02],
    [job.locator('p').nth(2),'② 保留配置备份路径',.45,.65],
  ]);
  setConfig('server { listen 80; server_name app.internal; return 301 https://$host$request_uri; }\nserver { listen 443 ssl; server_name app.internal; location / { proxy_pass http://127.0.0.1:9000; } }');
  await page.getByRole('button',{name:'读取配置',exact:true}).click();
  await page.getByLabel('HTTP 自动跳转 HTTPS',{exact:true}).check();
  const redirectPanel=page.locator('.certificate-redirect');
  await capture('58-certificate-redirect',redirectPanel,redirectPanel,[
    [label('HTTP 自动跳转 HTTPS'),'① HTTPS 独立站点也能勾选',.49,.02,{x: .5,y:1.8}],
    [page.getByRole('combobox',{name:'HTTP 入口',exact:true}),'② 选择对应的 HTTP 入口',.49,.26],
  ]);
  await writeFile('test-results/certificate-guide-shots.json',JSON.stringify(manifest,null,2));
}
