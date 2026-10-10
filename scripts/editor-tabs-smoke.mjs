import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp,mkdir,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './sftp-fixture.mjs';
const base=await mkdtemp(path.resolve('test-results/editor-tabs-'));
const roots=['a','b'].map(n=>path.join(base,n));
for(let i=0;i<2;i++){await mkdir(roots[i]);await writeFile(path.join(roots[i],'env_app.sh'),`# server ${i}\nexport APP_PORT=${8080+i}\nexport APP_NAME="orders"\n`);await writeFile(path.join(roots[i],'app.log'),'2026-09-16 INFO ready\nWARN retry\nERROR failed\n');}
const servers=await Promise.all(roots.map(r=>fixture(r)));
const packaged=process.argv.includes('--packaged');
const app=await electron.launch({...packaged?{executablePath:path.resolve('release/win-unpacked/EluShell.exe')}:{args:['.']},env:{...process.env,ELUSHELL_TEST_DATA:path.join(base,'.EluShell')}});
const errors=[];app.on('window',p=>p.on('pageerror',e=>errors.push(e.message)));
try{
 const page=await app.firstWindow();await page.locator('.welcome-workspace').waitFor();
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});dialog.showMessageBoxSync=()=>0;});
 for(let i=0;i<2;i++){
  await page.locator('.session-tabs').getByTitle('连接管理',{exact:true}).click();await page.locator('.folder-root').click({button:'right'});await page.getByRole('menuitem',{name:'添加 SSH 服务器'}).click();
  await page.getByLabel('连接名称',{exact:true}).fill('Server '+i);await page.getByLabel('主机 / IP',{exact:true}).fill('127.0.0.1');await page.getByLabel('端口',{exact:true}).fill(String(servers[i].port));await page.locator('input[type=password]').fill('fixture');await page.getByRole('button',{name:'保存并连接',exact:true}).click();await page.locator('.session-tab.selected').filter({hasText:'Server '+i}).waitFor();
 }
 const open=async(i,file)=>{await page.bringToFront();await page.locator('.session-tab').filter({hasText:'Server '+i}).locator('button').first().click();const input=page.getByRole('textbox',{name:'远程目录'});await input.fill('/');await input.press('Enter');await page.locator('.file-table').getByText(file,{exact:true}).dblclick();};
 const ready=app.waitForEvent('window');await open(0,'env_app.sh');const editor=await ready;await editor.locator('.cm-content').waitFor();
 const content=p=>p.locator('.editor-tab-content:not([hidden]) .cm-content');
 const pane=p=>p.locator('.editor-tab-content:not([hidden])');
 const tab=(name)=>editor.getByRole('tab',{name,exact:true});
 const type=async(p,text)=>{await content(p).click();await p.keyboard.press('Control+End');await p.keyboard.type(text);};
 await type(editor,'# unsaved A');await open(1,'env_app.sh');await expect(editor.getByRole('tab')).toHaveCount(2);expect(app.windows()).toHaveLength(2);
 await type(editor,'# unsaved B');await content(editor).press('Control+s');await expect.poll(()=>readFile(path.join(roots[1],'env_app.sh'),'utf8')).toContain('unsaved B');expect(await readFile(path.join(roots[0],'env_app.sh'),'utf8')).not.toContain('unsaved A');
 await tab('● Server 0 · env_app.sh').click();await expect(content(editor)).toContainText('unsaved A');await content(editor).press('Control+s');await expect.poll(()=>readFile(path.join(roots[0],'env_app.sh'),'utf8')).toContain('unsaved A');
 await type(editor,'\n# survives detach');
 // Reorder using the real renderer's drag/drop handlers.
 const drag=await editor.evaluateHandle(()=>new DataTransfer());
 await tab('Server 1 · env_app.sh').dispatchEvent('dragstart',{dataTransfer:drag});await tab('● Server 0 · env_app.sh').dispatchEvent('drop',{dataTransfer:drag});await expect(editor.getByRole('tab').first()).toHaveText('Server 1 · env_app.sh');
 // Simulate an outside drop with an OS cursor outside the source window.
 await app.evaluate(({screen})=>{globalThis.originalCursor=screen.getCursorScreenPoint;screen.getCursorScreenPoint=()=>({x:-10000,y:-10000});});
 const detachedReady=app.waitForEvent('window');const drag2=await editor.evaluateHandle(()=>new DataTransfer());await tab('● Server 0 · env_app.sh').dispatchEvent('dragstart',{dataTransfer:drag2});await tab('● Server 0 · env_app.sh').dispatchEvent('dragend',{dataTransfer:drag2});
 const detached=await detachedReady;await expect(content(detached)).toContainText('survives detach');await expect(editor.getByRole('tab')).toHaveCount(1);await expect(pane(detached).locator('footer')).toContainText('未保存');
 await app.evaluate(({screen})=>{screen.getCursorScreenPoint=globalThis.originalCursor;});
 await content(detached).press('Control+z');await expect(content(detached)).not.toContainText('survives detach');await content(detached).press('Control+y');await expect(content(detached)).toContainText('survives detach');
 await content(detached).press('Control+s');await expect.poll(()=>readFile(path.join(roots[0],'env_app.sh'),'utf8')).toContain('survives detach');expect(await readFile(path.join(roots[1],'env_app.sh'),'utf8')).not.toContain('survives detach');
 // The primary group receives later files; reopening detached files focuses them.
 await open(0,'app.log');await expect(editor.getByRole('tab')).toHaveCount(2);expect(app.windows()).toHaveLength(3);await open(0,'env_app.sh');expect(app.windows()).toHaveLength(3);
 await page.bringToFront();await page.getByTitle('工作区设置',{exact:true}).click();await page.getByLabel('会话名称显示').selectOption('ip');await expect(detached).toHaveTitle('127.0.0.1 · env_app.sh · EluShell');await page.getByTitle('关闭工作区设置').click();
 // Cross-window save requests must not gain access to another window's file.
 const otherId=await detached.evaluate(async()=>(await window.eluEditor.load()).active);expect(await editor.evaluate(id=>window.eluEditor.save(id,'wrong server').then(()=>false,()=>true),otherId)).toBe(true);
 const logColors=await content(editor).locator('span').evaluateAll(spans=>Object.fromEntries(spans.filter(e=>['INFO','WARN','ERROR'].includes(e.textContent)).map(e=>[e.textContent,getComputedStyle(e).color])));expect(new Set(Object.values(logColors)).size).toBe(3);
 await editor.screenshot({path:'test-results/editor-tabs.png'});await detached.screenshot({path:'test-results/editor-detached.png'});
 await type(detached,'\n# guard');await content(detached).press('Control+w');await expect(pane(detached).locator('.editor-confirm')).toBeVisible();await detached.getByRole('button',{name:'继续编辑'}).click();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().startsWith('● 127.0.0.1 · env_app.sh')).close());expect(app.windows()).toHaveLength(3);await expect(content(detached)).toContainText('# guard');
 await writeFile(path.join(roots[0],'env_app.sh'),'external edit\n');await content(detached).press('Control+s');await expect(pane(detached).locator('.editor-error')).toContainText('其他程序修改');
 await detached.getByTitle('关闭编辑器').click();await detached.getByRole('button',{name:'放弃修改'}).click();
 // Closing a workspace session keeps its open editor connected until the last file closes.
 await page.bringToFront();await page.locator('.session-tab').first().getByTitle('关闭会话',{exact:true}).click();
 await editor.bringToFront();await type(editor,'\n# retained SSH');await content(editor).press('Control+s');
 await expect.poll(()=>readFile(path.join(roots[0],'app.log'),'utf8')).toContain('retained SSH');
 expect(errors).toEqual([]);
 const report={result:'PASS',version:JSON.parse(await readFile('package.json','utf8')).version,packaged,sharedWindow:true,reorder:true,outsideDropHandler:true,unsavedDraftAndUndoPreserved:true,saveOnlyActive:true,sameNameServers:true,primaryAndDetachedReuse:true,closeGuards:true,conflictProtection:true,crossWindowOwnership:true,retainsSSH:true,logColors,errors};
 await writeFile('test-results/editor-tabs.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;}).catch(()=>{});await app.close();await Promise.all(servers.map(s=>s.close()));}
