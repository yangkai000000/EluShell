import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { fixture } from './sftp-fixture.mjs';

// Capture the actual packaged UI against a loopback-only SSH/SFTP fixture.
// Labels are DOM overlays added only while taking documentation screenshots.
const out = path.resolve('artifacts/guide/screenshots');
await mkdir(out, { recursive: true });
const base = await mkdtemp(path.resolve('test-results/guide-'));
const remote = path.join(base, 'remote'), user = path.join(base, '.EluShell');
for (const p of ['config', 'logs', 'backups', 'releases/v1']) await mkdir(path.join(remote, p), { recursive: true });
await writeFile(path.join(remote, 'application.yml'), 'server:\n  port: 8080\nspring:\n  application:\n    name: orders-service\nlogging:\n  level:\n    root: INFO\n');
await writeFile(path.join(remote, 'env_app.sh'), '# 应用环境变量\nexport APP_NAME="orders-service"\nexport APP_PORT=8080 # 服务端口\nexport APP_LOG=$HOME/logs/orders.log\n\n# 数据库地址\nexport DB_HOST=192.0.2.24\nexport DB_PORT=5432\n');
await writeFile(path.join(remote, 'README.md'), '# Orders service\n\nService configuration and deployment files.\n');
await writeFile(path.join(remote, 'start.sh'), '#!/bin/sh\njava -jar orders-service.jar\n');
await writeFile(path.join(remote, 'logs/app.log'), '2026-09-15 09:30:00.123 INFO 服务已启动\n2026-09-15 09:30:03.456 WARN 请求耗时超过阈值\n2026-09-15 09:30:05.789 ERROR 数据库连接失败\nCaused by: java.net.ConnectException\n');
for (let i=1;i<=6;i++) await writeFile(path.join(remote, `logs/app-2026-09-${String(i).padStart(2,'0')}.log`), `INFO Daily log ${i}\n`);
await writeFile(path.join(remote, 'config/nginx.conf'), 'server {\n    listen 8080;\n    root /srv/www;\n}\n');
let sample = 0;
const processes = [
 [2048,'deploy',12.4,4120166,'Sl','java','8801','/usr/bin/java','/srv/orders',['java','-jar','orders-service.jar'],'java -jar orders-service.jar'],
 [2080,'deploy',3.2,760000,'Sl','dotnet','8802','/usr/bin/dotnet','/srv/gateway',['dotnet','Gateway.dll'],'dotnet Gateway.dll'],
 [1024,'www',1.1,28500,'S','nginx','7001','/usr/sbin/nginx','/',['nginx'],'nginx: worker process'],
 [920,'deploy',0.3,126000,'Sl','node','6500','/usr/bin/node','/srv/web',['node','server.js'],'node server.js'],
 [820,'root',0.1,8100,'S','sshd','6001','/usr/sbin/sshd','/',['sshd'],'sshd: deploy'],
];
function metrics() {
 const n=++sample, c=Array.from({length:8},(_,i)=>`cpu${i} ${1000+n*(12+i*3)} 0 0 ${8000+n*(88-i*3)} 0 0 0 0`).join('\n');
 return `\n@@HOST\norders-test\nLinux 6.8.0 x86_64\n@@UP\n864000 200\n0.42 0.58 0.61\n@@CPU\ncpu ${8000+n*192} 0 0 ${64000+n*608} 0 0 0 0\n${c}\n@@MEM\nMemTotal: 33554432 kB\nMemAvailable: 13631488 kB\nCached: 6291456 kB\nSwapTotal: 4194304 kB\nSwapFree: 3932160 kB\n@@DISK\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 125829120 47815066 78014054 38% /\n/dev/vdb1 524288000 356515840 167772160 68% /data\n@@NET\neth0: ${12000000+n*1600000} 0 0 0 0 0 0 0 ${4000000+n*700000} 0 0 0 0 0 0 0\nlo: 10000 0 0 0 0 0 0 0 10000 0 0 0 0 0 0 0\n@@PS\nPID USER CPU RSS ARGS\n${processes.map(p=>`${p[0]} ${p[1]} ${p[2]} ${p[3]} ${p[10]}`).join('\n')}\n@@ROUTE\ndefault via 192.0.2.1 dev eth0\n192.0.2.0/24 dev eth0 proto kernel scope link\n@@SOCKET\nNetid State Recv-Q Send-Q Local Address:Port Peer Address:Port\ntcp ESTAB 0 0 192.0.2.24:22 192.0.2.10:52100\ntcp ESTAB 0 0 192.0.2.24:8080 192.0.2.11:43020\n@@IO\n8 0 vda ${1000+n*12} 0 ${200000+n*4096} 0 ${3000+n*24} 0 ${600000+n*8192} 0 0 ${1000+n*400} 0\n`;
}
const server=await fixture(remote, {silentHandshake:true,greeting:'\x1b[36mEluShell 操作指南专用测试连接\x1b[0m\r\n\r\nUbuntu 24.04 LTS  |  8 vCPU  |  32 GB RAM\r\n\r\n$ pwd\r\n/srv/orders\r\n$ systemctl status orders-service\r\n● orders-service.service - Orders API\r\n   Active: active (running)\r\n\r\n\x1b[32mdeploy@orders-test\x1b[0m:~$ ',exec:cmd=>cmd.includes('@@INTERFACES')?'@@SSH\n192.0.2.10 52100 192.0.2.24 22\n@@INTERFACES\n1.any (All interfaces)\n2.eth0\n':cmd.includes('@@HOST')?metrics():cmd.includes('ps -eo pid=,user=,pcpu=')?processes.map(p=>[...p.slice(0,9),Buffer.from(p[9].join('\0')+'\0').toString('hex'),p[10]].join('\t')).join('\n'):''});
// A local response fixture illustrates the real AI UI without paid provider requests.
const aiServer = createServer(async (req, res) => {
 let raw=''; for await (const chunk of req) raw+=chunk;
 const rawContent=JSON.parse(raw).messages.at(-1).content; const prompt=typeof rawContent==='string'?rawContent:JSON.stringify(rawContent);
 const content=prompt.includes('多行')
  ? '可以按顺序查看服务状态和最近日志：\n```bash\nsystemctl status orders-service --no-pager\njournalctl -u orders-service -n 50 --no-pager\n```\n先核对服务名。若服务不存在，请替换为实际名称。'
  : '使用下面的命令查看 TCP 监听端口及对应进程：\n```bash\nss -lntp\n```\n-l 仅显示监听端口；-n 显示数字地址；-t 查看 TCP；-p 显示进程信息。部分进程详情需要相应权限。';
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const frame=d=>res.write('data: '+JSON.stringify(d)+'\n\n');
 frame({choices:[{delta:{reasoning_content:'先查看监听端口，再根据端口定位进程。以下提供人工检查命令。'}}]});
 for(let i=0;i<content.length;i+=18){await new Promise(r=>setTimeout(r,25));frame({choices:[{delta:{content:content.slice(i,i+18)}}]});}
 frame({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:310,completion_tokens:123}});
 res.end('data: [DONE]\n\n');
});
await new Promise(r=>aiServer.listen(0,'127.0.0.1',r));
const app=await electron.launch({executablePath:path.resolve('release/win-unpacked/EluShell.exe'),env:{...process.env,ELUSHELL_TEST_DATA:user}});
let page; const manifest=[];
async function capture(name, crop, labels=[]) {
 if(process.env.ELUSHELL_GUIDE_CAPTURE_ONLY && !process.env.ELUSHELL_GUIDE_CAPTURE_ONLY.split(',').includes(name)) return;
 await page.waitForTimeout(180);
 let box=crop?await page.locator(typeof crop==='string'?crop:crop.selector).first().boundingBox():{x:0,y:0,...await page.evaluate(()=>({width:innerWidth,height:innerHeight}))};
 if(crop?.height) box.height=Math.min(box.height,crop.height);
 box={x:Math.max(0,box.x-5),y:Math.max(0,box.y-5),width:box.width+10,height:box.height+10};
 const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
 box.width=Math.min(box.width,viewport.width-box.x);box.height=Math.min(box.height,viewport.height-box.y);
 const resolved=[];
 for(const [selector,text,x,y] of labels){const target=await page.locator(selector).filter({ visible: true }).first().boundingBox();if(!target)throw Error('Missing annotation '+selector);resolved.push({text,x:box.x+x*box.width,y:box.y+y*box.height,tx:target.x+target.width/2,ty:target.y+target.height/2});}
 await page.evaluate(({labels,box})=>{
  const root=document.createElement('div');root.id='guide-annotations';root.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.style.cssText='position:absolute;width:100%;height:100%;overflow:visible';root.append(svg);
  for(const p of labels){const line=document.createElementNS(ns,'line');for(const [k,v]of Object.entries({x1:p.x+8,y1:p.y+18,x2:p.tx,y2:p.ty,stroke:'#dd6915','stroke-width':2}))line.setAttribute(k,v);svg.append(line);const dot=document.createElementNS(ns,'circle');for(const[k,v]of Object.entries({cx:p.tx,cy:p.ty,r:4,fill:'#dd6915',stroke:'white','stroke-width':1}))dot.setAttribute(k,v);svg.append(dot);const tag=document.createElement('div');tag.textContent=p.text;tag.style.cssText=`position:absolute;left:${p.x}px;top:${p.y}px;font:600 19px/1.35 'Microsoft YaHei';color:#163951;background:#fff9ed;border:1px solid #dd6915;border-radius:3px;padding:4px 8px;white-space:nowrap;box-shadow:0 1px 3px #0002`;root.append(tag);}
  document.body.append(root);
  for(const tag of root.querySelectorAll('div')){tag.style.maxWidth=(box.width-24)+'px';tag.style.whiteSpace='normal';const r=tag.getBoundingClientRect();tag.style.left=Math.max(box.x+8,Math.min(r.x,box.x+box.width-r.width-8))+'px';tag.style.top=Math.max(box.y+8,Math.min(r.y,box.y+box.height-r.height-8))+'px';}
 },{labels:resolved,box});
 await page.screenshot({path:path.join(out,name+'.png'),clip:box});
 await page.evaluate(()=>document.getElementById('guide-annotations')?.remove());
 manifest.push({name,crop,labels:labels.map(l=>l[1])});console.log('Captured '+name);
}
const closeModal=()=>page.locator('.modal-header > button').last().click();
captureRun: try{
 page=await app.firstWindow();
 await app.evaluate(({dialog,BrowserWindow})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});BrowserWindow.getAllWindows()[0].setSize(1320,940);});
 page=await app.firstWindow();page.setDefaultTimeout(30000);
 await page.locator('.new-tab-page').waitFor();
 if(process.env.ELUSHELL_GUIDE_CAPTURE_ONLY==='26-updates') {
  await page.getByTitle('工作区设置',{exact:true}).click();
  await page.locator('.update-settings').scrollIntoViewIfNeeded();
  await capture('26-updates','.update-settings',[['.update-settings input','① 默认留空 填写发布目录',.1,.035],['.update-actions','② 保存后检查更新',.46,.66]]);
  console.log(JSON.stringify({result:'PASS',screenshots:manifest.length,base}));
  break captureRun;
 }

 await page.evaluate(async port=>{
  const s=await window.elu.load(), folders=[{id:'guide-team',name:'公司环境'},{id:'guide-test',name:'测试服务',parentId:'guide-team'},{id:'guide-prod',name:'生产服务',parentId:'guide-team'}];
  const profiles=['订单服务 测试','网关服务 测试','日志服务 测试','订单服务 生产'].map((name,i)=>({id:crypto.randomUUID(),name,host:'127.0.0.1',port,username:'deploy',group:'',folderId:i===3?'guide-prod':'guide-test',tags:['linux','java'],auth:'password',startup:'cd /srv/orders\npwd',autoStartup:false,tunnels:[]}));
  for(const p of profiles)await window.elu.saveCredential(p,'local-guide-fixture',true);
  await window.elu.save({...s,profiles,folders,pollSeconds:2,recentConnections:profiles.map((p,i)=>({profileId:p.id,at:Date.now()-i*3600000})),history:{[profiles[0].id]:['systemctl status orders-service','journalctl -u orders-service -n 100','tail -n 100 logs/app.log','free -h','df -h','pwd']},commandFolders:[{id:'commands-default',name:'默认分类'},{id:'guide-commands',name:'订单服务'},{id:'guide-daily',name:'日常巡检'}],snippets:[...s.snippets,...[{name:'服务状态',command:'systemctl status orders-service'},{name:'最近日志',command:'journalctl -u orders-service -n 100'},{name:'进入服务目录',command:'cd /srv/orders'},{name:'磁盘容量',command:'df -h'}].map(c=>({...c,id:crypto.randomUUID(),tags:[],folderId:'guide-commands',appendNewline:true}))]});
 },server.port);
 await page.reload();await page.locator('.recent-connections tbody tr').first().waitFor();
 await capture('01-recent','.new-tab-page',[['.recent-toolbar input','① 搜索名称 用户或分类',.5,.17],['.recent-connections tbody tr','② 双击连接服务器',.08,.46],['.recent-count','③ 最近最多保留 100 条',.48,.65]]);
  await page.getByTitle('连接管理',{exact:true}).click();
  await page.getByTitle('导出连接配置',{exact:true}).click();
  await capture('41-sharing-export','.sharing-export-modal',[['.sharing-export-modal input','① 默认携带已保存密码',.28,.11],['.sharing-password-notice','② 仅分享给可信同事',.45,.87]]);
  await page.getByRole('button',{name:'取消',exact:true}).click();
  const sharedBundle = await page.evaluate(async () => {
    const s = await window.elu.load();
    return { version: 2, credentials: [{profileId:'team-new',password:'guide-fixture-only'}], folders: [...s.folders, { id: 'team-shared', name: '同事共享' }], profiles: [...s.profiles, { ...s.profiles[0], id: 'team-new', name: '库存服务 测试', folderId: 'team-shared', host: '192.0.2.30', port: 22 }] };
  });
  const sharedPath = path.join(base, 'connections-team.json');
  await writeFile(sharedPath, JSON.stringify(sharedBundle));
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},sharedPath);
  await page.getByTitle('导入连接配置',{exact:true}).click();
  await page.getByRole('dialog',{name:'导入连接预览'}).waitFor();
  await capture('29-sharing','.sharing-modal',[['.sharing-summary','① 预览新增与重复数量',.45,.035],['.sharing-table','② 核对服务器列表',.70,.14]]);
  await page.getByRole('button',{name:'取消',exact:true}).click();
 await page.locator('.folder-select').filter({hasText:'测试服务'}).click();
 await capture('03-folder','.connection-modal',[['.connection-columns','① 每个连接只占一行',.42,.47],['.connection-list-status','② 所选文件夹和直属数量',.32,.82],['.connection-toolbar','③ 搜索 导入 导出',.04,.64]]);
 await page.locator('.connection-folder.selected').click({button:'right'});
 await capture('04-folder-menu','.connection-modal',[['.connection-context','① 右键添加 SSH 或改名',.48,.68],['.connection-folder.selected','② 拖动可调整所属分类',.4,.83]]);
 await page.keyboard.press('Escape');
 await page.locator('.connection-list .profile-item').filter({hasText:'订单服务 测试'}).click({button:'right'});
 await capture('33-connection-menu','.connection-modal',[['.connection-context','① 右键编辑或删除连接',.51,.58],['.profile-item.selected','② 双击直接连接',.43,.81]]);
 await page.getByRole('menuitem',{name:'编辑连接',exact:true}).click();
 await capture('05-ssh','.connection-editor-dialog',[['.connection-tabs','① 独立弹窗修改连接',.34,.035],['input[type=password]','② 黑点表示密码已保存',.39,.67]]);
 await page.getByRole('button',{name:'登录命令',exact:true}).click();
 await capture('06-startup','.connection-editor-dialog',[['textarea','① 每个连接独立配置',.4,.48],['.connection-editor-dialog label.checkbox','② 勾选后登录自动执行',.35,.73]]);
 await page.getByRole('button',{name:'隧道 (0)',exact:true}).click();await page.getByRole('button',{name:'添加隧道',exact:true}).click();
 await page.getByRole('checkbox',{name:'启用规则 1'}).uncheck();
 await capture('07-tunnel','.connection-editor-dialog',[['.tunnel-editor','① 本地或远程端口转发',.33,.63],['.form-actions','② 保存后在下次连接生效',.33,.79]]);
 await page.getByTitle('关闭连接编辑').click();
 await page.getByTitle('关闭连接管理').click();
 await page.locator('.recent-connections tbody tr').first().dblclick();await page.locator('.xterm').waitFor();
 await page.getByLabel('远程目录',{exact:true}).fill('/');await page.getByLabel('远程目录',{exact:true}).press('Enter');
 await page.locator('.file-table').getByText('application.yml',{exact:true}).waitFor();await page.waitForTimeout(2500);
 await capture('02-workspace',null,[['.session-tabs','① 连接与会话',.26,.09],['.sidebar','② 点击指标展开详情',.02,.55],['.terminal-mount','③ SSH 终端',.62,.23],['.file-table','④ 目录树和文件列表',.59,.82],['.command-input','⑤ 命令输入与历史',.39,.5]]);
 await page.getByTitle('面板布局',{exact:true}).click();
 await capture('08-layout',null,[['.layout-menu','① 显示 折叠或专注模式',.45,.26],['[aria-label="调整监控栏宽度"]','② 拖动分隔线调整宽度',.3,.5]]);
 await page.getByTitle('面板布局',{exact:true}).click();
 await page.getByTitle('搜索输出',{exact:true}).click();await page.getByLabel('终端搜索',{exact:true}).fill('service');
 await capture('09-terminal','.terminal-panel',[['.terminal-search','① 浮动搜索 Enter 下一个',.26,.28],['.command-input','② 输入命令后 Enter 执行',.22,.68]]);
 await page.getByTitle('关闭搜索 (Esc)').click();
 const screen = page.locator('.terminal-mount:visible .xterm-screen');
 const screenBox = await screen.boundingBox();
 await page.mouse.move(screenBox.x + 1, screenBox.y + 8); await page.mouse.down();
 await page.mouse.move(screenBox.x + 165, screenBox.y + 8, {steps:12}); await page.mouse.up();
 await page.getByRole('menu',{name:'选中文字操作'}).waitFor();
 await capture('30-terminal-selection','.terminal-panel', [['.terminal-context','① 选中文字后 就近复制或搜索',.3,.34]]);
 await page.keyboard.press('Escape');
 await screen.click({button:'right',position:{x:210,y:130}});
 await capture('31-terminal-menu','.terminal-panel', [['.terminal-context','② 右键粘贴 查找和清空缓存',.45,.58]]);
 await page.keyboard.press('Escape');
 await page.getByLabel('命令输入',{exact:true}).fill('srv');
 await capture('10-suggestions','.terminal-panel',[['.command-suggestions','① 模糊匹配本连接历史',.18,.15],['.command-input','② Tab 补全 上下选择',.52,.5]]);
 await page.getByLabel('命令输入',{exact:true}).press('Escape');await page.getByLabel('命令输入',{exact:true}).fill('');
 for(const [name,button,labels]of [
  ['11-cpu','CPU 使用率',[['.cores-grid','① 各逻辑核心占用',.47,.5],['.stat-cards','② 总占用和系统负载',.08,.7]]],
  ['12-memory','内存 详情',[['.stat-cards','① 总量 可用 缓存 交换',.22,.7]]],
  ['13-network','网络流量',[['.modal-content table','① 网卡速率与累计流量',.22,.83]]],
  ['14-disk','磁盘与 I/O',[['.modal-content table','① 挂载点容量',.56,.23],['.modal-content pre','② 设备读写计数',.25,.83]]],
 ]){await page.getByRole('button',{name:new RegExp(button)}).click();await page.locator('.detail-modal').waitFor();await capture(name,'.detail-modal',labels);await closeModal();}
 await page.getByRole('button',{name:/活跃进程/}).click();await page.locator('.process-table tbody tr').first().waitFor();await page.locator('.process-table tbody tr').first().click();
 await page.locator('.process-table tbody tr').first().locator('td').nth(5).click({button:'right'});
 await capture('15-process','.process-modal',[['.process-table th:nth-child(3)','① 点击列头切换升降序',.08,.55],['.process-selection','② 服务位置 工作目录和运行时',.36,.71],['.process-context','③ 复制字段或终止进程',.5,.17]]);
 await page.keyboard.press('Escape');await page.getByTitle('关闭进程管理').click();
 await capture('16-files','.bottom-panel',[['.directory-tree','① 多级目录树',.02,.54],['.file-table','② 当前目录内容',.44,.65],['.follow-toggle','③ 跟随终端目录',.22,.26]]);
 await page.locator('.file-table').getByText('logs',{exact:true}).dblclick();
 await page.locator('.file-table').getByText('app-2026-09-01.log',{exact:true}).click();
 await page.locator('.file-table').getByText('app-2026-09-04.log',{exact:true}).click({modifiers:['Shift']});
 await page.locator('.file-table').getByText('app-2026-09-03.log',{exact:true}).click({button:'right'});
 await capture('42-files-multiple','.bottom-panel',[['.file-selected','① Ctrl 多选 Shift 连选',.01,.72],['.file-context','② 右键批量下载',.58,.32]]);
 await page.keyboard.press('Escape');
 await page.getByLabel('远程目录',{exact:true}).fill('/');await page.getByLabel('远程目录',{exact:true}).press('Enter');
 await page.locator('.file-table').getByText('logs',{exact:true}).waitFor();
 await page.locator('.file-table th').getByRole('button',{name:'大小',exact:true}).click();
 const dropped = path.join(base,'drag-upload.txt'); await writeFile(dropped,'Guide drag upload');
 const cdp = await page.context().newCDPSession(page), target = await page.locator('.file-table thead').boundingBox();
 const dragData={items:[],files:[dropped],dragOperationsMask:1}, dragPoint={x:target.x+target.width/2,y:target.y+target.height/2,data:dragData};
 await cdp.send('Input.dispatchDragEvent',{type:'dragEnter',...dragPoint}); await cdp.send('Input.dispatchDragEvent',{type:'dragOver',...dragPoint});
 await capture('32-files-drop','.bottom-panel',[['.file-table th:nth-child(2)','① 列头点击切换升降序',.24,.53],['.file-table th:last-child','② 用户和用户组',.64,.67],['.file-footer','③ 外部拖入 同名直接替换',.32,.82]]);
 await cdp.send('Input.dispatchDragEvent',{type:'drop',...dragPoint}); await page.getByRole('dialog',{name:'确认上传',exact:true}).getByRole('button',{name:'确认上传',exact:true}).click(); await page.locator('.file-table').getByText('drag-upload.txt',{exact:true}).waitFor();
 await page.locator('.file-table').getByText('logs',{exact:true}).click({button:'right'});
 await capture('17-file-menu',null,[['.file-context','① 文件夹也可上传 下载和改权限',.46,.25],['.file-table','② 右键目录可执行 cd',.48,.38]]);
 await page.getByRole('menuitem',{name:'文件权限…',exact:true}).click();await page.getByLabel('八进制权限').fill('755');
 await capture('18-permissions','.file-action-form',[['.permission-editor','① 勾选与数字双向同步',.08,.015]]);
 await page.getByRole('button',{name:'取消',exact:true}).click();
 const workspacePage=page;
 let editorReady=app.waitForEvent('window');
 await page.locator('.file-table').getByText('env_app.sh',{exact:true}).dblclick(); page=await editorReady;await page.locator('.text-editor').waitFor();
 await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())if(w.webContents.getURL().includes('editor=1'))w.setSize(1050,520);});
 await capture('19-editor','.text-editor',[['.text-editor header strong','① 连接名称与文件名',.08,.61],['.cm-line:nth-child(3) span','② 变量 注释与数值分色',.35,.43],['.text-editor header .primary','③ 仅保存当前窗口文件',.58,.77]]);
 await page.getByTitle('关闭编辑器').click();page=workspacePage;
 await page.getByLabel('远程目录',{exact:true}).fill('/logs');await page.getByLabel('远程目录',{exact:true}).press('Enter');
 editorReady=app.waitForEvent('window'); await page.locator('.file-table').getByText('app.log',{exact:true}).dblclick();page=await editorReady;await page.locator('.text-editor').waitFor();
 await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows())if(w.webContents.getURL().includes('editor=1'))w.setSize(1050,520);});
 await capture('48-editor-log','.text-editor',[['.cm-line:nth-child(3) span:nth-child(2)','① INFO WARN ERROR 各用不同颜色',.40,.44],['[aria-label="语法配色"]','② 可手动选择日志或其他类型',.1,.70]]);
 await page.getByTitle('关闭编辑器').click();page=workspacePage;
 await page.getByLabel('远程目录',{exact:true}).fill('/');await page.getByLabel('远程目录',{exact:true}).press('Enter');
 const downloads=path.join(base,'esdownload');await mkdir(downloads);
 await app.evaluate(({dialog},downloads)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[downloads]});},downloads);
 if(!await page.locator('.transfer-panel').isVisible()) await page.getByTitle('上传下载进度',{exact:true}).click();await page.getByRole('button',{name:'更改目录'}).click();await page.getByTitle('关闭传输面板').click();
 await page.locator('.file-table').getByText('logs',{exact:true}).click({button:'right'});await page.getByRole('menuitem',{name:'下载文件夹',exact:true}).click();
 await expect(page.locator('.transfer-jobs')).toContainText('已完成');
 const sid=await page.locator('.session-tab.selected').getAttribute('data-session-id');
 await app.evaluate(({BrowserWindow},sessionId)=>BrowserWindow.getAllWindows()[0].webContents.send('transfer-event',{id:'guide-progress',sessionId,direction:'download',label:'orders-service-logs.zip',localPath:'C:/guide/esdownload',state:'running',total:52428800,done:20971520,filesDone:8,filesTotal:20,started:Date.now()}),sid);
 await capture('20-transfers','.transfer-panel',[['.download-directory','① 更改或打开目录',.05,.1],['.transfer-progress','② 蓝色进度 灰色余量',.05,.74]]);
 await page.getByTitle('关闭传输面板').click();
 await page.getByRole('button',{name:/^命令库/}).click();await page.locator('.command-workspace').waitFor();
 await page.locator('.command-folder-tabs').getByRole('button',{name:'订单服务',exact:true}).click();
 await page.getByRole('textbox',{name:'命令编辑器内容',exact:true}).fill('pwd\nfree -h\ndf -h');
 await capture('21-commands','.bottom-panel',[['.command-folder-tabs','① 全部连接共享分类',.05,.59],['.compact-commands','② 单击命令直接发送到终端',.2,.75],['.command-editor-pane','③ 多行命令编辑器',.67,.46]]);
 await page.locator('.compact-command').first().click({button:'right'});
 await capture('22-command-menu',null,[['.command-context','① 编辑 复制 删除或移动分类',.41,.39]]);
 await page.getByRole('menuitem',{name:'编辑命令…',exact:true}).click();
 await capture('23-command-edit','.command-form-modal',[['.command-form-code','① 编辑命令正文',.53,.41],['.command-form-modal .checkbox','② 是否在末尾执行回车',.12,.71]]);
 await page.getByTitle('关闭命令编辑').click();await page.getByTitle('命令编辑器设置').click();
 await capture('24-command-options','.bottom-panel',[['.command-editor-popover','① 发送行为 字号和换行',.15,.25],['[aria-label="命令编辑器发送目标"]','② 当前或全部已连接会话',.37,.75]]);
 await page.getByTitle('命令编辑器设置').click();
 await page.getByRole('button',{name:'执行历史',exact:true}).click();
 await capture('25-history','.bottom-panel',[['.history-list','① 每个连接最近 100 条',.39,.54]]);
 await page.getByTitle('工作区设置',{exact:true}).click();await page.locator('.update-settings').waitFor();
 await capture('40-settings-navigation','.preferences-modal', [['.preferences-nav','① 点击目录快速定位',.27,.07],['#preferences-basic','② 基础配置在最上方',.5,.29],['.preferences-nav [data-section=ai]','③ AI 与更新配置在最后',.05,.76]]);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1500,1280));
 await page.getByRole('button',{name:'功能与性能',exact:true}).click();
 await capture('45-performance',{selector:'#preferences-performance',height:540}, [['#preferences-performance input[type=checkbox]','① 按需关闭非核心功能',.48,.17]]);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1320,940));
 await page.locator('.update-settings').scrollIntoViewIfNeeded();
 await capture('26-updates','.update-settings',[['.update-settings input','① 默认留空 填写发布目录',.1,.035],['.update-actions','② 保存后检查更新',.46,.66]]);
 await page.locator('.appearance-panel').scrollIntoViewIfNeeded();
 await capture('27-appearance','.appearance-panel',[['.font-grid','① 界面与终端独立字体',.32,.34],['.appearance-checkbox','② 是否共用背景',.55,.65]]);
 await page.locator('.config-panel').scrollIntoViewIfNeeded();
 await capture('28-config','.config-panel',[['.config-panel code','① 配置保存在本机',.5,.2],['.config-panel p','② 导出可携带已保存密码',.46,.71]]);
 await page.locator('.ai-settings').scrollIntoViewIfNeeded();
 await page.getByLabel('DeepSeek API Key',{exact:true}).fill('guide-local-fixture-key');
 await page.getByRole('button',{name:'保存 AI 配置',exact:true}).click();
 await expect(page.getByLabel('DeepSeek API Key',{exact:true})).toHaveAttribute('placeholder','••••••••');
 await page.locator('.ai-settings').scrollIntoViewIfNeeded();
 await capture('34-ai-settings','.ai-settings',[['.ai-provider-choices','① 选择供应商',.55,.02],['[aria-label="AI 思考强度"]','② 选择模型与思考强度',.56,.34],['.ai-settings > .primary','③ 保存后用于新对话',.38,.85]]);
 await page.locator('.ai-provider-choices').getByRole('button',{name:/Kimi/}).click();
 await capture('35-ai-kimi','.ai-settings',[['[aria-label="Kimi API Key"]','① 只需填写自己的 Key',.37,.31],['[aria-label="AI 模型"]','② 不同模型支持不同强度',.31,.51]]);
 await page.locator('.ai-provider-choices').getByRole('button',{name:/自定义/}).click();
 await page.getByLabel('自定义 API 基础地址',{exact:true}).fill('https://api.example.com/v1');
 await page.getByLabel('自定义 API Key',{exact:true}).fill('guide-custom-fixture-key');
 await page.getByLabel('自定义模型名称',{exact:true}).fill('my-chat-model');
 await page.getByRole('button',{name:'保存 AI 配置',exact:true}).click();
 await expect(page.getByLabel('自定义 API Key',{exact:true})).toHaveAttribute('placeholder','••••••••');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1320,1100));
 await page.locator('.ai-settings').evaluate(el=>el.scrollIntoView({block:'start'}));
 await capture('43-ai-custom','.ai-settings',[['[aria-label="自定义 API 基础地址"]','① 填写 API 地址',.54,.15],['[aria-label="自定义 API Key"]','② 黑点表示已保存',.54,.31],['[aria-label="自定义模型名称"]','③ 模型 ID',.33,.48]]);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1320,940));
 await page.locator('.ai-provider-choices').getByRole('button',{name:/DeepSeek/}).click();
 await page.getByLabel('DeepSeek API Key',{exact:true}).fill('guide-local-fixture-key');
 await page.locator('.ai-settings').getByText('高级配置',{exact:true}).click();
 await page.getByLabel('AI 基础地址').fill('http://127.0.0.1:'+aiServer.address().port);
 await page.getByRole('button',{name:'保存 AI 配置',exact:true}).click();
 await expect(page.locator('.ai-settings')).toContainText('已保存。');
 await page.locator('.preferences-modal .modal-header button').click();
 await page.getByTitle('AI 命令助手',{exact:true}).click();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1320,760));
 const aiResize=page.getByRole('separator',{name:'调整 AI 侧栏宽度'});
 for(let i=0;i<10;i++) await aiResize.press('ArrowLeft');
 const ai=page.getByRole('complementary',{name:'AI 对话'});
 await ai.getByLabel('AI 消息').fill('想检查服务器有哪些 TCP 端口正在监听，需要什么命令？');
 await ai.getByRole('button',{name:'发送',exact:true}).click();
 await expect(ai.locator('.ai-code').getByRole('button',{name:'复制',exact:true})).toBeEnabled();
 await capture('36-ai-chat','.ai-sidebar',[['.ai-header','① 新建 历史 设置',.15,.08],['.ai-code-tools','② 复制代码供人工核对',.45,.48],['.ai-context','③ 上下文余量为估算',.14,.66]]);
 await ai.getByTitle('历史对话').click();
 await ai.locator('.ai-history-item').first().getByTitle('重命名对话').click();
 await ai.getByLabel('对话名称').fill('订单服务排查');await ai.getByRole('button',{name:'保存',exact:true}).click();
 await capture('39-ai-history',{selector:'.ai-sidebar',height:400},[['[aria-label="搜索历史对话"]','① 搜索本机对话记录',.12,.72],['.ai-history-item','② 打开 改名或删除',.47,.87]]);
 await ai.getByTitle('历史对话').click();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1320,940));
 const selectionScreen=page.locator('.terminal-mount:visible .xterm-screen');
 const selectionBox=await selectionScreen.boundingBox();
 await page.mouse.move(selectionBox.x+1,selectionBox.y+8);await page.mouse.down();await page.mouse.move(selectionBox.x+190,selectionBox.y+8,{steps:12});await page.mouse.up();
 await page.getByRole('menuitem',{name:'发送给 AI',exact:true}).click();
 await ai.getByLabel('AI 消息').fill('请分析这段服务器输出，告诉我下一步应该检查什么。');
 await capture('44-ai-reference','.ai-composer',[['.ai-attachments','① 引用与问题分开显示',.25,.24],['[aria-label="AI 消息"]','② 输入自己的问题',.26,.72]]);
 await page.getByTitle('收起 AI 侧栏').click();
 await page.getByRole('button',{name:'工具包',exact:true}).click();
 await capture('46-toolbox',null,[['.toolbox-icon','① 双击打开独立工具',.30,.7]]);
 await page.getByRole('button',{name:'抓包',exact:true}).dblclick();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1700,1200));
 await page.getByRole('button',{name:'开始抓包',exact:true}).waitFor();
 await page.getByLabel('抓包端口',{exact:true}).fill('8080');
 await capture('47-capture','.capture-tool',[['.capture-fields','① 限定采集目标',.15,.35],['.capture-actions','② 按需开始并限制采集',.47,.78]]);
 await page.getByRole('button',{name:'部署',exact:true}).dblclick();
 await page.getByRole('button',{name:'新建方案',exact:true}).click();
 await page.getByLabel('方案名称',{exact:true}).fill('订单服务发布');
 await page.getByLabel('本地文件或目录',{exact:true}).fill('D:\\releases\\orders-service.jar');
 await page.getByLabel('部署命令',{exact:true}).fill('ls -lh "$ELUSHELL_UPLOAD_PATH"\n# 核对并替换为团队实际部署命令\ncp "$ELUSHELL_UPLOAD_PATH" /srv/orders/orders-service.jar\ncd /srv/orders\n./appctl.sh restart');
 await page.getByRole('button',{name:'保存方案',exact:true}).click();
 await page.getByRole('button',{name:'新建方案',exact:true}).click();
 await page.getByLabel('方案名称',{exact:true}).fill('静态资源更新');
 await page.getByLabel('本地文件或目录',{exact:true}).fill('D:\\releases\\web-dist');
 await page.getByLabel('部署命令',{exact:true}).fill('cp -R "$ELUSHELL_UPLOAD_PATH/." /srv/www/');
 await page.getByRole('button',{name:'保存方案',exact:true}).click();
 await capture('49-deployment-list',{selector:'.deployment-tool',height:300},[['.deployment-row strong','① 一行一个方案',.07,.48],['.deployment-row .primary','② 执行先上传再运行命令',.48,.62],['.deployment-row button:last-child','③ 编辑完整内容',.76,.82]]);
 await page.getByTitle('编辑方案 订单服务发布').click();
 await capture('50-deployment-edit','.deployment-dialog',[['.deployment-dialog label input','① 方案供各服务器共用',.47,.05],['textarea','② 顺序执行预制命令',.48,.50],['.deployment-dialog footer .primary','③ 保存供下次使用',.53,.88]]);
 await page.getByTitle('关闭部署方案编辑').click();
 if(!process.env.ELUSHELL_GUIDE_CAPTURE_ONLY) await writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
 console.log(JSON.stringify({result:'PASS',screenshots:manifest.length,base}));
}catch(error){console.error(error);if(page)await page.screenshot({path:path.join(out,'capture-error.png'),timeout:5000}).catch(()=>{});throw error;}finally{await app.close();await server.close();await new Promise(r=>aiServer.close(r));}



