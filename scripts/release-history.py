"""Keep the published download archive when generating the next unified release."""
import json, html
from pathlib import Path

def history(root, site, version, current):
    old = json.loads((root/'test-results/current-downloads.json').read_text(encoding='utf8'))
    assert old.get('files'), 'Published download inventory required'
    entries = {f['path']: f for f in old['files']}
    for f in current:
        entries[f['path']] = dict(f, version=version, platform='macos' if f['path'].startswith('macos/') else 'windows', arch='arm64' if '/arm64/' in f['path'] else 'x64')
    files = list(entries.values())
    versions = sorted({f['version'] for f in files}, key=lambda s:tuple(map(int,s.split('.'))), reverse=True)
    folder=site/'releases';folder.mkdir(exist_ok=True)
    (folder/f'downloads-{version}.json').write_text(json.dumps({'version':version,'timeZone':'Asia/Shanghai','versions':versions,'files':files},ensure_ascii=False,indent=2),encoding='utf8')
    esc=html.escape
    def link(file):
        label = ('Apple 芯片' if file['arch']=='arm64' else 'Intel 芯片') if file['platform']=='macos' else ('安装版' if 'Setup-' in file['path'] else '便携版')
        return f'<div class="archive-download"><a download href="{esc(file["path"])}">{label} · {file["size"]/1048576:.1f} MiB</a><details><summary>SHA256</summary><code>{file["sha256"]}</code></details></div>'
    rows=[]
    for v in versions:
        related=[f for f in files if f['version']==v]
        cells=[]
        for title, select in [('Windows x64',lambda f:f['platform']=='windows'),('Mac Apple 芯片',lambda f:f['platform']=='macos' and f['arch']=='arm64'),('Mac Intel 芯片',lambda f:f['platform']=='macos' and f['arch']=='x64')]:
            cells.append(f'<td data-label="{title}">'+(''.join(link(f) for f in related if select(f)) or '未提供')+'</td>')
        rows.append(f'<tr><th scope="row">{v}'+(' · 最新' if v==version else '')+'</th>'+''.join(cells)+'</tr>')
    return f'<section class="card" id="all-versions"><h2>全部版本下载</h2><p>共 {len(versions)} 个版本、{len(files)} 个安装包。历史版本和原有校验信息继续保留。</p><div class="table-scroll"><table class="archive-table"><thead><tr><th>版本</th><th>Windows x64</th><th>Mac Apple 芯片</th><th>Mac Intel 芯片</th></tr></thead><tbody>'+''.join(rows)+f'</tbody></table></div><p><a href="releases/downloads-{version}.json">完整版本与 SHA256 清单</a></p></section>'
