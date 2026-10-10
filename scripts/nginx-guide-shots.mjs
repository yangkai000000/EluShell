import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
export async function nginxGuideShots(app, page, tool) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 1080));
  const out = path.resolve('artifacts/guide/screenshots');
  await mkdir(out, { recursive: true });
  const captures = [
    ['56-nginx-form', tool.locator('.certificate-form'), [
      [tool.getByLabel('Nginx 程序完整路径'), '① 程序路径需包含 nginx'],
      [tool.getByLabel('本机健康检查地址'), '② 填写可访问的本机接口'],
      [tool.getByRole('button', {name:'重新检测', exact:true}), '③ 检测配置与运行实例'],
    ]],
    ['57-nginx-checks', tool.locator('.certificate-results'), [
      [tool.locator('.nginx-checks').locator('li').first(), '① 自动选择服务器架构'],
      [tool.locator('.nginx-confirm'), '② 核对目标后勾选并升级'],
    ]],
  ];
  for (const [name, container, labels] of captures) {
    const bounds = await container.boundingBox();
    const boxes = [];
    for (const [target, text] of labels) boxes.push({box:await target.boundingBox(), text});
    await page.evaluate(({boxes,bounds}) => {
      const layer=document.createElement('div'); layer.id='nginx-guide-annotations';
      layer.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none';
      for(const {box,text} of boxes) {
        const label=document.createElement('div'); label.textContent=text;
        const left = box.width < 250 ? box.x + box.width + 12 : box.x + box.width - 250;
        label.style.cssText=`position:absolute;left:${Math.max(bounds.x+12,Math.min(left,bounds.x+bounds.width-258))}px;top:${box.y-9}px;padding:3px 7px;background:#fff8e9;color:#8b4513;border:1px solid #dd6915;border-radius:3px;font:600 15px/1.3 'Microsoft YaHei'`;
        layer.append(label);
      }
      document.body.append(layer);
    },{boxes,bounds});
    const box=await container.boundingBox();
    const bottom=await container.evaluate(el=>Math.max(...Array.from(el.children).map(child=>child.getBoundingClientRect().bottom)));
    box.height=Math.min(box.height,bottom-box.y+18);
    await page.screenshot({path:path.join(out,name+'.png'),clip:box});
    await page.evaluate(()=>document.getElementById('nginx-guide-annotations').remove());
  }
  await writeFile('test-results/nginx-guide-shots.json',JSON.stringify({version:'0.10.5',source:'Packaged Windows app, local SSH fixture; not a Kylin hardware test',images:captures.map(x=>x[0])},null,2));
}
