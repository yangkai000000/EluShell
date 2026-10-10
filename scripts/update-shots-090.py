from pathlib import Path
p=Path('scripts/guide-screenshots.mjs');s=p.read_text(encoding='utf8')
s=s.replace("exec:cmd=>cmd.includes('@@HOST')?", "exec:cmd=>cmd.includes('@@INTERFACES')?'@@SSH\\n192.0.2.10 52100 192.0.2.24 22\\n@@INTERFACES\\n1.any (All interfaces)\\n2.eth0\\n':cmd.includes('@@HOST')?")
s=s.replace("const prompt=JSON.parse(raw).messages.at(-1).content;", "const rawContent=JSON.parse(raw).messages.at(-1).content; const prompt=typeof rawContent==='string'?rawContent:JSON.stringify(rawContent);")
s=s.replace("await page.locator('.update-settings').scrollIntoViewIfNeeded();", "await page.getByRole('button',{name:'功能与性能',exact:true}).click();\n await capture('45-performance','#preferences-performance', [['[aria-label=\"终端历史行数\"]','① 控制回滚缓存',.48,.69]]);\n await page.locator('.update-settings').scrollIntoViewIfNeeded();",1)
a=s.index(" await expect(ai.locator('.ai-code').getByRole('button',{name:'填入'")
b=s.index(" await ai.getByTitle('历史对话').click();",a)
s=s[:a]+''' await expect(ai.locator('.ai-code').getByRole('button',{name:'复制',exact:true})).toBeEnabled();
 await capture('36-ai-chat','.ai-sidebar',[['.ai-header','① 新建 历史 设置',.15,.08],['.ai-code-tools','② 复制代码供人工核对',.45,.48],['.ai-context','③ 上下文余量为估算',.14,.66]]);
''' +s[b:]
a=s.index(" if(!process.env.ELUSHELL_GUIDE_CAPTURE_ONLY) await writeFile")
s=s[:a]+''' await ai.getByTitle('历史对话').click();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1320,940));
 const selectionScreen=page.locator('.terminal-mount:visible .xterm-screen');
 const selectionBox=await selectionScreen.boundingBox();
 await page.mouse.move(selectionBox.x+1,selectionBox.y+8);await page.mouse.down();await page.mouse.move(selectionBox.x+190,selectionBox.y+8,{steps:12});await page.mouse.up();
 await page.getByRole('menuitem',{name:'发送给 AI',exact:true}).click();
 await ai.getByLabel('AI 消息').fill('请分析这段服务器输出，告诉我下一步应该检查什么。');
 await capture('44-ai-reference','.ai-sidebar',[['.ai-attachments','① 引用与问题分开显示',.12,.58],['[aria-label="AI 消息"]','② 输入自己的问题',.15,.83]]);
 await page.getByTitle('收起 AI 对话').click();
 await page.getByRole('button',{name:'工具包',exact:true}).click();
 await capture('46-toolbox',null,[['.toolbox-icon','① 双击打开独立工具',.30,.7]]);
 await page.getByRole('button',{name:'抓包',exact:true}).dblclick();
 await page.getByRole('button',{name:'开始抓包',exact:true}).waitFor();
 await page.getByLabel('抓包端口',{exact:true}).fill('8080');
 await capture('47-capture','.capture-tool',[['.capture-fields','① 限定采集目标',.15,.35],['.capture-actions','② 按需开始并限制采集',.47,.78]]);
''' +s[a:]
p.write_text(s,encoding='utf8')
