import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const root = 'artifacts/mac-diagnostic-0.9.1';
await mkdir(root + '/site/releases', { recursive: true });
await mkdir(root + '/site/macos', { recursive: true });
const entries = JSON.parse(await readFile(root + '/archive-inventory.json', 'utf8'));
const status = JSON.parse(await readFile('test-results/mac-diagnostic-build-status.json.result.json', 'utf8'));
const reports = status[0].stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
if (reports.length !== 2 || new Set(reports.map(r => r.arch)).size !== 2) throw Error('Both Mac reports required');
for (const report of reports) {
  if (report.version !== '0.9.1' || report.archiveIntegrity !== 'PASS' || report.offlineSignatureIntegrity.resourceAndNestedSeals !== 'PASS')
    throw Error('Mac package report failed');
  entries.push({ path: `macos/${report.arch}/${report.file}`, size: report.size, sha256: report.sha256,
    source: report.file, sourceKind: 'mac-build', timeSource: 'release', publishedAt: '__RELEASE_ISO_091__' });
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = seconds => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(seconds * 1000));
for (const f of entries) {
  f.version = f.path.match(/(?:Setup-)?(\d+\.\d+\.\d+)/)[1];
  f.platform = f.path.startsWith('windows/') ? 'windows' : 'macos';
  f.arch = f.path.includes('/arm64/') ? 'arm64' : 'x64';
}
const versions = [...new Set(entries.map(e => e.version))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
const download = f => {
  const label = f.platform === 'macos' ? f.arch === 'arm64' ? 'Apple 芯片' : 'Intel 芯片' : f.path.includes('Setup-') ? '安装版' : '便携版';
  return `<div class="archive-download"><a download href="${escape(f.path)}" aria-label="${f.version} ${f.platform} ${label}">${label} · ${(f.size / 1048576).toFixed(1)} MiB</a><details><summary>校验与文件信息</summary><p>${escape(f.path.split('/').at(-1))}</p><code>${f.sha256}</code>${f.mtime ? `<p>文件时间：${date(f.mtime)}</p>` : ''}</details></div>`;
};
const rows = versions.map(version => {
  const files = entries.filter(f => f.version === version);
  const published = files.filter(f => f.timeSource === 'server-file-time');
  const dates = published.length ? published : files.filter(f => f.mtime);
  const time = version === '0.9.1' ? '__RELEASE_TEXT_091__' : date(Math.min(...dates.map(f => f.mtime)));
  const source = version === '0.9.1' ? '本次发布' : published.length ? '服务器留存时间' : '构建时间 · 本次补档';
  const cell = fn => files.filter(fn).map(download).join('') || '<span class="muted">未提供</span>';
  return `<tr><th scope="row">${version}${version === '0.9.1' ? '<br><span class="tag">Mac 诊断版</span>' : ''}</th><td class="archive-time" data-label="发布时间 / 历史记录">${time}<br><small>${source}</small></td><td data-label="Windows x64">${cell(f => f.platform === 'windows')}</td><td data-label="Mac · Apple 芯片">${cell(f => f.platform === 'macos' && f.arch === 'arm64')}</td><td data-label="Mac · Intel 芯片">${cell(f => f.platform === 'macos' && f.arch === 'x64')}</td></tr>`;
}).join('\n');
const history = `<section class="card" id="all-versions"><h2>全部版本下载</h2><p>共 ${versions.length} 个版本、${entries.length} 个安装包，按版本从新到旧排列。所有时间均为北京时间（UTC+8）。</p><p class="muted">历史版本优先展示服务器留存文件的时间；早期 Windows 包缺少首次发布时间记录，明确标为“构建时间 · 本次补档”，不将构建时间当作首次发布时间。首次补入下载站的旧包上架时间：__RELEASE_TEXT_091__。Mac 0.9.1 为本次上传诊断版。</p><div class="table-scroll"><table class="archive-table"><thead><tr><th>版本</th><th>发布时间 / 历史记录</th><th>Windows x64</th><th>Mac · Apple 芯片</th><th>Mac · Intel 芯片</th></tr></thead><tbody>${rows}</tbody></table></div><p><a href="releases/downloads-0.9.1.json">下载完整版本与 SHA256 清单</a></p></section>`;
const diagnostic = `<section class="card note" id="diagnostic"><h2>Mac 0.9.1 · 上传诊断版</h2><p>发布时间：__RELEASE_TEXT_091__（北京时间）。用于定位上传时的 <code>Permission denied</code>，本版增加日志，保留原有上传策略。</p><ol><li>按芯片下载上方 Mac 0.9.1，按 <strong>Command+Q 完全退出</strong> 后替换“应用程序”内的 EluShell.app，保留 <code>~/.EluShell</code>。</li><li>在设置 → 更新配置确认版本为 0.9.1，使用原来的连接和远程目录，再上传一次发生问题的文件。</li><li>报错后打开<strong>文件传输 → 导出诊断日志</strong>，把生成的 <code>EluShell-0.9.1-diagnostics-时间.jsonl</code> 回传给开发人员。上传成功也可以导出对比日志。</li></ol><p>请附上 Mac 系统版本、芯片、上传方式（拖拽 / 按钮）、是否覆盖同名文件，以及 Windows 成功时使用的账号、目录与版本。</p><p class="muted">日志包含服务器地址、登录账号和文件路径；不记录密码、私钥、终端内容或文件内容。无需导出连接配置。原始日志位于 <code>~/.EluShell/logs/</code>，自动轮换保留最近三份，每份约 2 MiB。</p><p><a href="macos/diagnostics-0.9.1.txt" download>下载日志回传说明</a></p></section>`;
const original = await readFile('test-results/release-home-before-091.html', 'utf8');
let html = original.replace('<title>EluShell 0.9.0 下载与操作指南</title>', '<title>EluShell 下载、全部版本与诊断日志</title>')
  .replace('<footer>联系开发人员反馈：杨凯</footer>', '<footer>联系开发人员反馈：杨凯 · 邮箱：<a href="mailto:2272017540@qq.com">2272017540@qq.com</a></footer>')
  .replace('name="elushell-version" content="0.9.0"', 'name="elushell-version" content="0.9.1"')
  .replace('当前版本 0.9.0 · 2026-09-12 · Windows 与 Mac 同步发布', 'Windows 0.9.0 · Mac 0.9.1 上传诊断版 · 全部历史版本可下载')
  .replace('<div class="grid">', '<nav class="actions" aria-label="下载导航"><a class="button secondary" href="#all-versions">全部版本（' + versions.length + '）</a><a class="button secondary" href="#diagnostic">日志回传方法</a><a class="button secondary" href="#mac-update">Mac 更新步骤</a></nav><div class="grid">')
  .replace('<section class="card"><h2>操作指南</h2>', diagnostic + '<section class="card"><h2>操作指南</h2>')
  .replace('<h2>本版更新</h2>', '<h2>0.9.0 基础功能更新</h2>')
  .replace('</main>', history + '</main>')
  .replace('</style>', '.archive-table{min-width:850px}.archive-time{white-space:nowrap}.archive-download{margin-bottom:12px}.archive-download:last-child{margin-bottom:0}.archive-download details{font-size:12px;margin-top:5px}.archive-download p{max-width:220px}.archive-download code{display:block;max-width:220px;word-break:break-all}.archive-table th[scope=row]{font-size:15px}.tag{display:inline-block;font-size:11px;color:#087e6d;background:#e7f3ef;border-radius:4px;padding:2px 6px}section[id]{scroll-margin-top:12px}nav.actions{margin:20px 0 10px}</style>');
for (const report of reports) {
  const old = entries.find(f => f.version === '0.9.0' && f.platform === 'macos' && f.arch === report.arch);
  html = html.replace(old.path, `macos/${report.arch}/${report.file}`).replace(old.sha256, report.sha256);
}
html = html.replaceAll('<span class="eyebrow">MACOS 测试版</span>', '<span class="eyebrow">MACOS 0.9.1 · 诊断测试版</span>');
html = html.replace('<p>安装版 · 支持应用内更新</p>', '<p>0.9.0 安装版 · 2026-09-12 发布<br>支持应用内更新</p>');
html = html.replace('</style>', '@media(max-width:800px){.archive-table{min-width:0}.archive-table thead{display:none}.archive-table tbody,.archive-table tr,.archive-table td,.archive-table th{display:block}.archive-table tr{border:1px solid #dbe6ec;border-radius:8px;margin-bottom:16px;overflow:hidden}.archive-table td,.archive-table th{border:0;border-bottom:1px solid #e8eef2;padding:12px}.archive-table td:before{content:attr(data-label);display:block;font-weight:600;color:#23364b;margin-bottom:5px}.archive-table td:last-child{border-bottom:0}.archive-download code,.archive-download p{max-width:100%}}</style>');
await writeFile(root + '/site/index.html', html);
const manifest = { version: '0.9.1', channel: 'mac-diagnostic', windowsVersion: '0.9.0', publishedAt: '__RELEASE_ISO_091__',
  timeZone: 'Asia/Shanghai', versions, files: entries.map(({ source, sourceKind, ...file }) => file) };
await writeFile(root + '/site/releases/downloads-0.9.1.json', JSON.stringify(manifest, null, 2));
await writeFile(root + '/site/macos/checksums-0.9.1.json', JSON.stringify(reports, null, 2));
await writeFile(root + '/site/releases/0.9.1.json', await readFile('docs/releases/0.9.1.json'));
await writeFile(root + '/site/macos/diagnostics-0.9.1.txt', await readFile('docs/MACOS-DIAGNOSTICS-0.9.1.md'));
const notes = JSON.parse(await readFile('docs/releases/0.9.1.json'));
notes.publishedAt = '__RELEASE_ISO_091__';
await writeFile(root + '/site/releases/0.9.1.json', JSON.stringify(notes, null, 2));
const artifacts = [];
for (const file of ['index.html', 'releases/downloads-0.9.1.json', 'releases/0.9.1.json', 'macos/checksums-0.9.1.json', 'macos/diagnostics-0.9.1.txt']) {
  const data = await readFile(root + '/site/' + file);
  artifacts.push({ path: file, size: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
const payloadHash = createHash('sha256').update(await readFile('release/macos/app.asar')).digest('hex');
const release = { ...manifest, files: entries, siteFiles: artifacts, payloadHash, macReports: reports,
  expectedOldHomeHash: createHash('sha256').update(original).digest('hex') };
await writeFile(root + '/publish-plan.json', JSON.stringify(release, null, 2));
console.log(JSON.stringify({ versions: versions.length, packages: entries.length, newMac: reports.map(r => r.file), payloadHash }));
