"""Build ad-hoc-signed macOS previews on Linux with official Electron binaries.

Run in an isolated build directory containing app.asar, icon.png, app-update.yml,
payload-report.json and a checksum-verified rcodesign binary. No macOS execution
is implied by these structural and cryptographic checks.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import shutil
import stat
import struct
import subprocess
import sys
import urllib.request
import zipfile
import runpy

ROOT = Path.cwd().resolve()
META = json.loads((ROOT / 'payload-report.json').read_text())
VERSION, ELECTRON = META['version'], META['electron']
SIGNER = ROOT / 'apple-codesign-0.29.0-x86_64-unknown-linux-musl/rcodesign'


def download(url, target):
    if not target.exists():
        temp = target.with_suffix(target.suffix + '.part')
        with urllib.request.urlopen(url, timeout=120) as response, temp.open('wb') as out:
            shutil.copyfileobj(response, out)
        temp.rename(target)


def sha256(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def extract(archive, destination):
    # Python's extractall does not preserve Unix symlinks or executable modes.
    with zipfile.ZipFile(archive) as source:
        assert source.testzip() is None
        for entry in source.infolist():
            relative = PurePosixPath(entry.filename)
            assert not relative.is_absolute() and '..' not in relative.parts
            target = destination.joinpath(*relative.parts)
            mode = entry.external_attr >> 16
            target.parent.mkdir(parents=True, exist_ok=True)
            if entry.is_dir():
                target.mkdir(exist_ok=True)
            elif stat.S_ISLNK(mode):
                link = source.read(entry).decode()
                assert not os.path.isabs(link)
                resolved = Path(os.path.abspath(target.parent / link))
                assert str(resolved).startswith(str(destination) + os.sep)
                target.symlink_to(link)
            else:
                with source.open(entry) as src, target.open('wb') as out:
                    shutil.copyfileobj(src, out)
                target.chmod(mode & 0o777 or 0o644)


def update_plist(file, changes):
    data = plistlib.loads(file.read_bytes())
    data.update(changes)
    file.write_bytes(plistlib.dumps(data))
    return data


def build(arch):
    assert arch in ('arm64', 'x64')
    filename = 'electron-v{}-darwin-{}.zip'.format(ELECTRON, arch)
    base = 'https://github.com/electron/electron/releases/download/v{}/'.format(ELECTRON)
    checks = ROOT / 'electron-SHASUMS256.txt'
    download(base + 'SHASUMS256.txt', checks)
    expected = dict((line.split()[1].lstrip('*'), line.split()[0]) for line in checks.read_text().splitlines())
    archive = ROOT / filename
    download(base + filename, archive)
    assert sha256(archive) == expected[filename], 'Electron checksum mismatch'
    work = ROOT / ('bundle-' + arch)
    work.mkdir()  # Refuse to reuse a partially built bundle.
    extract(archive, work)
    app = work / 'EluShell.app'
    (work / 'Electron.app').rename(app)
    contents = app / 'Contents'
    original = plistlib.loads((contents / 'Info.plist').read_bytes())
    (contents / 'MacOS' / original['CFBundleExecutable']).rename(contents / 'MacOS/EluShell')
    update_plist(contents / 'Info.plist', {
        'CFBundleDisplayName': 'EluShell', 'CFBundleName': 'EluShell',
        'CFBundleExecutable': 'EluShell', 'CFBundleIdentifier': 'dev.elushell.desktop',
        'CFBundleShortVersionString': VERSION, 'CFBundleVersion': VERSION,
        'CFBundleIconFile': 'elushell.icns',
        'LSApplicationCategoryType': 'public.app-category.developer-tools',
        'NSHighResolutionCapable': True,
    })
    for helper in list((contents / 'Frameworks').glob('Electron Helper*.app')):
        infofile = helper / 'Contents/Info.plist'
        data = plistlib.loads(infofile.read_bytes())
        new_name = helper.stem.replace('Electron', 'EluShell', 1)
        (helper / 'Contents/MacOS' / data.get('CFBundleExecutable', helper.stem)).rename(helper / 'Contents/MacOS' / new_name)
        update_plist(infofile, {
            'CFBundleName': new_name, 'CFBundleDisplayName': new_name,
            'CFBundleExecutable': new_name,
            'CFBundleIdentifier': 'dev.elushell.desktop.helper' + ('.' + helper.stem.split('(')[1].rstrip(')').lower() if '(' in helper.stem else ''),
        })
        helper.rename(helper.with_name(new_name + '.app'))
    resources = contents / 'Resources'
    default = resources / 'default_app.asar'
    if default.exists():
        default.unlink()
    for name in ('app.asar', 'icon.png', 'app-update.yml'):
        shutil.copyfile(ROOT / name, resources / name)
    png = (ROOT / 'icon.png').read_bytes()
    dimensions = struct.unpack('>II', png[16:24])
    kind = {(256, 256): b'ic08', (512, 512): b'ic09', (1024, 1024): b'ic10'}[dimensions]
    icon = kind + struct.pack('>I', len(png) + 8) + png
    (resources / 'elushell.icns').write_bytes(b'icns' + struct.pack('>I', len(icon) + 8) + icon)
    entitlements = ROOT / 'entitlements.plist'
    entitlements.write_bytes(plistlib.dumps({
        'com.apple.security.cs.allow-jit': True,
        'com.apple.security.cs.allow-unsigned-executable-memory': True,
    }))
    with (ROOT / ('sign-' + arch + '.log')).open('w') as log:
        subprocess.run([str(SIGNER), 'sign', '--entitlements-xml-file', 'main:' + str(entitlements), str(app)], stdout=log, stderr=log, check=True)
    with (ROOT / ('verify-' + arch + '.log')).open('w') as log:
        # This tool's verify command reports an upstream warning and rejects empty
        # CMS data in ad-hoc signatures. Retain its output, never count it as PASS.
        subprocess.run([str(SIGNER), 'verify', str(contents / 'MacOS/EluShell')], stdout=log, stderr=log)
    integrity = runpy.run_path(str(ROOT / 'verify-mac-signatures.py'))['verify_bundle'](app)
    links = []
    binaries = []
    for base_dir, directories, files in os.walk(str(app), followlinks=False):
        for name in directories + files:
            item = Path(base_dir) / name
            if item.is_symlink():
                assert item.exists(), 'Broken symlink: ' + str(item)
                assert str(item.resolve()).startswith(str(app) + os.sep)
                links.append(str(item.relative_to(app)))
            elif item.is_file():
                assert item.suffix != '.node', 'Native addon in application'
                with item.open('rb') as stream:
                    header = stream.read(8)
                if header[:4] == b'\xcf\xfa\xed\xfe':
                    cpu = struct.unpack('<I', header[4:8])[0]
                    assert cpu == {'arm64': 0x100000c, 'x64': 0x1000007}[arch]
                    assert item.stat().st_mode & 0o111, 'Missing execute bit'
                    binaries.append(str(item.relative_to(app)))
    assert len(binaries) >= 6 and links
    readme = work / '安装说明.txt'
    readme.write_text('EluShell {} macOS {} 测试版\n\n解压后将 EluShell.app 拖到“应用程序”，再打开。\n需要 macOS {} 或更新版本。\n本包仅做 ad-hoc 签名，没有 Apple Developer ID 签名或公证。\n如果系统阻止打开，请先核对下载页 SHA256，再按 macOS“系统设置 → 隐私与安全性”针对该应用选择“仍要打开”。无需关闭系统安全功能。\n已完成包结构、签名和跨平台逻辑检查；没有 Mac 环境，未做 macOS 启动、Keychain、Dock 或窗口实机验收。\n退出：菜单 EluShell → 退出 / Command+Q。关闭窗口会隐藏窗口并保留 SSH 连接，可从 Dock 恢复。\nMac 测试版暂不支持应用内自动更新；退出后手动替换应用，配置保留在 ~/.EluShell。\nWindows 导出的版本 2 连接 JSON 可携带已保存密码，导入后在本机重新加密。未携带密码的连接和私钥认证仍需在本机配置。\n'.format(VERSION, arch, original.get('LSMinimumSystemVersion', '见 Info.plist')), encoding='utf-8')
    target = ROOT / 'EluShell-{}-macos-{}-preview.zip'.format(VERSION, arch)
    extras = [name for name in ('LICENSE', 'LICENSES.chromium.html') if (work / name).exists()]
    diagnostic_readme = ROOT / 'diagnostic-readme.txt'
    if diagnostic_readme.exists():
        shutil.copyfile(diagnostic_readme, work / '诊断日志回传说明.txt')
        extras.append('诊断日志回传说明.txt')
    subprocess.run(['zip', '-qry', str(target), 'EluShell.app', readme.name] + extras, cwd=str(work), check=True)
    with zipfile.ZipFile(target) as package:
        assert package.testzip() is None
        assert package.getinfo('EluShell.app/Contents/MacOS/EluShell').external_attr >> 16 & 0o111
        assert sum(stat.S_ISLNK(i.external_attr >> 16) for i in package.infolist()) == len(links)
    report = {'version': VERSION, 'electron': ELECTRON, 'arch': arch, 'file': target.name,
              'size': target.stat().st_size, 'sha256': sha256(target),
              'minimumMacOS': original.get('LSMinimumSystemVersion'),
              'signature': 'ad-hoc (rcodesign); not Developer ID or notarized',
              'machOBinaries': len(binaries), 'symlinks': len(links),
              'archiveIntegrity': 'PASS', 'macOSRuntime': 'NOT RUN: no macOS environment'}
    report['offlineSignatureIntegrity'] = integrity
    report['rcodesignVerify'] = 'UNRELIABLE: upstream warning and empty CMS error; see verify log'
    (ROOT / ('report-' + arch + '.json')).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)


for architecture in sys.argv[1:] or ['arm64', 'x64']:
    build(architecture)
