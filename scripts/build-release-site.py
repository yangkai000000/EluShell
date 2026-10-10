"""Export the reviewed Word manual verbatim to HTML and assemble a unified release.

Requires both Mac reports, Windows artifacts, a current guide QA report, and release
notes. The remote publisher validates every artifact before changing public pointers.
"""
import hashlib
import importlib.util
import html
import json
import shutil
from io import BytesIO
from PIL import Image
from pathlib import Path
from docx import Document
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph
from docx.table import Table

ROOT = Path(__file__).resolve().parents[1]
read = lambda p: json.loads(p.read_text(encoding='utf8'))
VERSION = read(ROOT/'package.json')['version']
notes = read(ROOT/f'docs/releases/{VERSION}.json')
GUIDE_VERSION = notes.get('guideVersion', VERSION)
REUSE_GUIDE = GUIDE_VERSION != VERSION
layout = read(ROOT/'artifacts/guide/guide-layout.json')
qa = read(ROOT/'test-results/guide-qa.json')
feed = read(ROOT/'release/latest.yml')
reports = [read(ROOT/f'release/macos/report-{arch}.json') for arch in ('arm64','x64')]
assert all(o['version'] == VERSION for o in [notes,feed]+reports), 'All packages must have the same version'
assert layout['version'] == qa['version'] == GUIDE_VERSION, 'Guide version mismatch'
assert qa['result'] == 'PASS' and qa['visuallyReviewedPages'] == list(range(1,layout['pages']+1)), 'Guide visual review required'
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
docx = ROOT/f'artifacts/guide/EluShell操作指南-{GUIDE_VERSION}.docx'
assert digest(docx) == qa['docxSha256'], 'Guide changed after review'
assert digest(ROOT/'artifacts/guide/rendered/guide.pdf') == qa['pdfSha256'], 'PDF changed after review'
OUT = ROOT/f'artifacts/release-{VERSION}'
SITE = OUT/'site'
GUIDE = SITE/f'guide/{GUIDE_VERSION}'
(GUIDE/'images').mkdir(parents=True, exist_ok=True)
if REUSE_GUIDE:
    shutil.copytree(ROOT/f'artifacts/release-{GUIDE_VERSION}/site/guide/{GUIDE_VERSION}', GUIDE, dirs_exist_ok=True)
else:
    shutil.copyfile(docx,GUIDE/f'EluShell-Guide-{VERSION}.docx')
    shutil.copyfile(ROOT/'artifacts/guide/rendered/guide.pdf',GUIDE/f'EluShell-Guide-{VERSION}.pdf')

e = html.escape
CSS = '''*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f3f6f8;color:#23364b;font:15px/1.8 system-ui,-apple-system,"Microsoft YaHei",sans-serif}a{color:#087e6d;text-underline-offset:3px}a:focus-visible{outline:2px solid #087e6d;outline-offset:4px}main{max-width:1160px;margin:0 auto;padding:38px 24px}h1{font-size:34px;line-height:1.3;margin:12px 0 18px}h2{font-size:22px;line-height:1.5}h3{font-size:17px}.eyebrow{font-size:12px;font-weight:700;letter-spacing:2px;color:#087e6d}.muted{color:#66798a}.card,article{padding:24px;background:white;border:1px solid #dbe6ec;border-radius:10px;margin:20px 0}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.grid .card{margin:8px 0}.button{display:inline-flex;align-items:center;justify-content:center;background:#087e6d;color:white;text-decoration:none;border-radius:6px;padding:9px 16px;font-weight:600}.secondary{background:#e7f3ef;color:#087e6d}.actions{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}code{overflow-wrap:anywhere;font-size:12px}details{margin-top:15px}summary{cursor:pointer;font-weight:600}footer{text-align:center;padding:28px 16px;border-top:1px solid #dbe6ec;color:#66798a}.guide-layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:24px}.guide-nav{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow:auto;align-self:start;padding:16px;border:1px solid #dbe6ec;background:white;border-radius:10px}.guide-nav a{display:block;text-decoration:none;padding:5px 0;font-size:13px}.guide-content{min-width:0}.guide-content article:first-child{margin-top:0}.guide-content img{display:block;max-width:100%;height:auto;margin:16px auto}.guide-content .caption{text-align:center;font-size:13px;color:#52697b}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #dbe6ec;padding:8px;text-align:left;vertical-align:top}th{background:#eaf1f5}article{scroll-margin-top:12px}p{overflow-wrap:anywhere}li{margin:7px 0}.note{border-left:4px solid #b78430}@media(max-width:800px){main{padding:24px 14px}.grid,.guide-layout{grid-template-columns:1fr}.guide-nav{position:static;max-height:230px}h1{font-size:28px}.card,article{padding:18px}}'''
def shell(title, body):
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="elushell-version" content="'+VERSION+'"><title>'+e(title)+'</title><style>'+CSS+'</style></head><body>'+body+'<footer>联系开发人员反馈：杨凯 · 邮箱：<a href="mailto:2272017540@qq.com">2272017540@qq.com</a></footer></body></html>'
downloads = '<div class="actions"><a class="button" download href="EluShell-Guide-'+VERSION+'.docx">下载 Word</a><a class="button secondary" href="EluShell-Guide-'+VERSION+'.pdf">查看 PDF</a><a class="button secondary" download href="EluShell-Guide-'+VERSION+'.pdf">下载 PDF</a></div>'
if not REUSE_GUIDE:
    document = Document(docx)
    sections, current, skip = [], [], False
    toc, image_count = [], 0
    for node in document.element.body:
        if node.tag == qn('w:p'):
            para = Paragraph(node,document)
            text, style = para.text, para.style.name
            if style == 'Heading 1':
                if current: sections.append(''.join(current));current=[]
                skip = text == '功能索引'
                if skip: continue
                identifier='topic-'+str(len(toc)+1)
                toc.append((identifier,text))
                current.append('<h2 id="'+identifier+'">'+e(text)+'</h2>')
            elif not skip:
                for blip in node.iter(qn('a:blip')):
                    part = document.part.related_parts[blip.get(qn('r:embed'))]
                    image_count += 1
                    filename='figure-'+str(image_count)+'.'+part.partname.ext
                    (GUIDE/'images'/filename).write_bytes(part.blob)
                    width,height=Image.open(BytesIO(part.blob)).size
                    current.append('<img loading="lazy" width="'+str(width)+'" height="'+str(height)+'" src="images/'+filename+'" alt="EluShell 功能截图 '+str(image_count)+'">')
                if text:
                    tag='h3' if style=='Heading 2' else 'p'
                    current.append('<'+tag+(' class="caption"' if style=='Caption' else '')+'>'+e(text).replace('\n','<br>')+'</'+tag+'>')
        elif node.tag == qn('w:tbl') and not skip:
            table = Table(node,document)
            current.append('<div class="table-scroll"><table>')
            for i,row in enumerate(table.rows):
                tag='th' if i==0 else 'td'
                current.append('<tr>'+''.join('<'+tag+'>'+e(cell.text).replace('\n','<br>')+'</'+tag+'>' for cell in row.cells)+'</tr>')
            current.append('</table></div>')
    if current: sections.append(''.join(current))
    assert image_count == layout['figures']+1, 'HTML must include every Word screenshot'
    body='<main><a href="../../">← 返回下载页</a><h1>EluShell 操作指南</h1><p class="muted">版本 '+VERSION+' · '+str(layout['pages'])+' 页 · '+str(layout['figures'])+' 张功能说明图</p>'+downloads
    body+='<div class="guide-layout"><nav class="guide-nav" aria-label="操作指南目录"><strong>操作目录</strong>'+''.join('<a href="#'+id+'">'+e(title)+'</a>' for id,title in toc)+'</nav><div class="guide-content">'+''.join('<article>'+section+'</article>' for section in sections)+'</div></div>'+downloads+'</main>'
    (GUIDE/'index.html').write_text(shell('EluShell '+VERSION+' 操作指南',body),encoding='utf8')
    assert all(e(t) in body for t in layout['titles'][2:]), 'HTML guide missing a topic'

windows=SITE/'windows/x64';windows.mkdir(parents=True,exist_ok=True)
installer=feed['files'][0]['url']
portable='EluShell-'+VERSION+'-windows-x64.exe'
for filename in [installer,installer+'.blockmap',portable]:
    shutil.copyfile(ROOT/'release'/filename,windows/filename)
shutil.copyfile(ROOT/'release/latest.yml',windows/'latest.yml')
assert hashlib.sha512((windows/installer).read_bytes()).digest() == __import__('base64').b64decode(feed['sha512'])
for report in reports:
    assert report['archiveIntegrity']=='PASS' and report['offlineSignatureIntegrity']['resourceAndNestedSeals']=='PASS'
mac_json=SITE/f'macos/checksums-{VERSION}.json';mac_json.parent.mkdir(exist_ok=True)
mac_json.write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf8')
cards='<div class="card"><span class="eyebrow">WINDOWS</span><h2>Windows x64</h2><p>安装版 · 支持应用内更新</p><a class="button" href="windows/x64/'+installer+'">下载 Windows 版</a><details><summary>SHA256 校验值</summary><code>'+digest(windows/installer)+'</code></details></div>'
for r in reports:
    label='Apple 芯片 · M 系列' if r['arch']=='arm64' else 'Intel 芯片'
    cards+='<div class="card"><span class="eyebrow">MACOS 测试版</span><h2>'+label+'</h2><p>macOS '+e(r['minimumMacOS'])+'+ · '+str(round(r['size']/1024/1024,1))+' MB</p><a class="button" href="macos/'+r['arch']+'/'+e(r['file'])+'">下载 '+r['arch']+' 测试版</a><details><summary>SHA256 校验值</summary><code>'+r['sha256']+'</code></details></div>'
guide_url='guide/'+GUIDE_VERSION+'/'
body='<main><span class="eyebrow">ELUSHELL · SSH 工作台</span><h1>EluShell 下载与操作指南</h1><p class="muted">当前版本 '+VERSION+' · '+notes['date']+' · Windows 与 Mac 同步发布</p><div class="grid">'+cards+'</div>'
body+='<section class="card"><h2>操作指南</h2><p>'+('沿用 '+GUIDE_VERSION+' 操作指南，本次未变更。包含 ' if REUSE_GUIDE else '与 '+VERSION+' 同步更新，包含 ')+str(layout['pages'])+' 页说明、'+str(layout['figures'])+' 张标注截图，以及 Windows / Mac 安装更新步骤。</p><div class="actions"><a class="button" href="'+guide_url+'">在线阅读</a><a class="button secondary" download href="'+guide_url+'EluShell-Guide-'+GUIDE_VERSION+'.docx">下载 Word</a><a class="button secondary" href="'+guide_url+'EluShell-Guide-'+GUIDE_VERSION+'.pdf">查看 PDF</a><a class="button secondary" download href="'+guide_url+'EluShell-Guide-'+GUIDE_VERSION+'.pdf">下载 PDF</a></div></section>'
body+='<section class="card"><h2>本版更新</h2><ul>'+''.join('<li>'+e(note)+'</li>' for note in notes['notes'])+'</ul></section>'
body+='<section class="card" id="mac-update"><h2>Mac 更新步骤</h2><p>当前 Mac 测试版采用手动更新。Windows 更新目录不能用于 Mac，在客户端填写该目录也不会自动安装 Mac 新版。</p><ol><li>在苹果菜单“关于本机”确认芯片。Apple M 系列选择上方 arm64 下载，Intel 选择 x64 下载。</li><li>下载新版 ZIP，核对下载卡片中的 SHA256 后解压。</li><li>保存编辑内容、完成传输并停止抓包，按 <strong>Command+Q 完全退出</strong> EluShell。仅关闭窗口会隐藏应用，不能代替退出。</li><li>在访达打开“应用程序”，用新版 <strong>EluShell.app</strong> 替换旧版。保留 <code>~/.EluShell</code>，连接和个人设置存放在这个独立目录。</li><li>从“应用程序”启动，在设置 → 更新配置确认版本号。若提示应用正在使用，先完全退出再替换。</li></ol><p>若系统阻止打开，请核对下载来源和校验值后，在系统设置 → 隐私与安全性中针对 EluShell 选择“仍要打开”。</p><details><summary>为什么暂时不能像 Windows 一样自动更新？</summary><p>目前 Mac 使用 ad-hoc 签名测试包，尚未接入经过实机升级验证的 Mac 更新流程。自动更新还需要 Mac 专用更新清单、满足校验要求的签名包和客户端支持，仅提供下载目录不能实现自动替换应用。</p></details></section>'
body+='<section class="card note"><h2>Mac 测试版说明</h2><p>Apple 芯片和 Intel 包通过了包结构及离线签名完整性检查，尚未完成 Mac 实机启动、Dock、Keychain 与系统对话框验收。使用 ad-hoc 签名，没有 Apple Developer ID 签名或公证。</p><p>解压后将 EluShell.app 放入“应用程序”。若系统阻止打开，核对来源及校验值后，在“隐私与安全性”中针对本应用选择“仍要打开”。Mac 更新请退出后手动替换应用，个人配置保留在 ~/.EluShell。</p></section>'
body+='<section class="card"><h2>Windows 更新设置</h2><p>打开工作区设置 → 更新配置，保存更新目录后检查更新。新安装的更新地址默认留空。</p><code id="windows-update-url"></code><script>document.getElementById("windows-update-url").textContent=new URL("windows/x64/",location.href).href;</script><p>此测试发布页使用 HTTP，需要在客户端勾选允许 HTTP 测试源。软件更新与卸载不会主动删除 .EluShell 本地配置。</p></section></main>'
history_spec=importlib.util.spec_from_file_location('release_history',ROOT/'scripts/release-history.py')
history_module=importlib.util.module_from_spec(history_spec);history_spec.loader.exec_module(history_module)
current_packages=[{'path':'windows/x64/'+name,'size':(windows/name).stat().st_size,'sha256':digest(windows/name)} for name in [installer,portable]]
current_packages += [{'path':'macos/'+r['arch']+'/'+r['file'],'size':r['size'],'sha256':r['sha256']} for r in reports]
body=body.replace('</main>',history_module.history(ROOT,SITE,VERSION,current_packages)+'</main>')
body=body.replace('<div class="grid">','<nav class="actions"><a class="button secondary" href="#all-versions">全部版本下载</a><a class="button secondary" href="#mac-update">Mac 更新步骤</a></nav><div class="grid">',1)
CSS += '.archive-download{margin:8px 0}.archive-download code{display:block;word-break:break-all}.archive-download details{margin-top:4px}.archive-table{table-layout:fixed}.archive-table th:first-child{width:100px}@media(max-width:800px){.archive-table thead{display:none}.archive-table tbody,.archive-table tr,.archive-table td,.archive-table th{display:block}.archive-table tr{margin-bottom:15px}.archive-table th:first-child{width:auto}.archive-table td:before{content:attr(data-label);display:block;font-weight:600}}'
(SITE/'index.html').write_text(shell('EluShell '+VERSION+' 下载与操作指南',body),encoding='utf8')
files=[]
for file in sorted(SITE.rglob('*')):
    if file.is_file():
        relative=file.relative_to(SITE).as_posix()
        files.append({'path':relative,'source':'site/'+relative,'kind':'stage','size':file.stat().st_size,'sha256':digest(file)})
for report in reports:
    files.append({'path':'macos/'+report['arch']+'/'+report['file'],'source':report['file'],'kind':'mac','size':report['size'],'sha256':report['sha256']})
manifest={'version':VERSION,'guideVersion':layout['version'],'guideUnchanged':REUSE_GUIDE,'guidePages':layout['pages'],'guideFigures':layout['figures'],'notes':notes['notes'],'macReports':reports,'files':files}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'version':VERSION,'files':len(files),'guidePages':layout['pages'],'guideFigures':layout['figures'],'output':str(OUT)},ensure_ascii=False))
