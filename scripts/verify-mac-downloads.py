import hashlib
import json
from pathlib import Path
import re
import stat
import sys
import urllib.request
import zipfile

base = 'http://47.105.176.1:8800/elushell-updates/'
output = Path('release/macos')
output.mkdir(parents=True, exist_ok=True)
manifest = output / 'checksums-0.8.0.json'
if '--manifest' in sys.argv:
    with urllib.request.urlopen(base + 'macos/checksums-0.8.0.json', timeout=20) as response:
        data = response.read(1024 * 1024)
    json.loads(data)
    manifest.write_bytes(data)
    print('Manifest SHA256: ' + hashlib.sha256(data).hexdigest())
    sys.exit(0)

reports = json.loads(manifest.read_bytes())
assert {r['arch'] for r in reports} == {'arm64', 'x64'}
checks = []
for item in reports:
    name = item['file']
    assert re.fullmatch(r'EluShell-0\.8\.0-macos-(arm64|x64)-preview\.zip', name)
    target = output / name
    temp = target.with_suffix('.zip.download')
    digest = hashlib.sha256()
    size = 0
    with urllib.request.urlopen(base + 'macos/' + item['arch'] + '/' + name, timeout=60) as response, temp.open('wb') as stream:
        for chunk in iter(lambda: response.read(1024 * 1024), b''):
            stream.write(chunk)
            digest.update(chunk)
            size += len(chunk)
            if size % (32 * 1024 * 1024) == 0:
                print(name + ': ' + str(size // 1024 // 1024) + ' MiB', flush=True)
    assert size == item['size'] and digest.hexdigest() == item['sha256'], 'Download mismatch'
    with zipfile.ZipFile(temp) as archive:
        assert archive.testzip() is None
        assert archive.getinfo('EluShell.app/Contents/MacOS/EluShell').external_attr >> 16 & 0o111
        assert sum(stat.S_ISLNK(entry.external_attr >> 16) for entry in archive.infolist()) == item['symlinks']
        payload = archive.read('EluShell.app/Contents/Resources/app.asar')
        assert hashlib.sha256(payload).digest() == hashlib.sha256((output / 'app.asar').read_bytes()).digest()
    temp.replace(target)
    checks.append({'file': name, 'size': size, 'sha256': digest.hexdigest(), 'zipCRC': 'PASS', 'payloadMatchesTestedBuild': True})
    print(name + ': PASS', flush=True)
with urllib.request.urlopen(base, timeout=20) as response:
    page = response.read().decode('utf-8')
assert 'macOS 测试版' in page and all(item['file'] in page for item in reports)
request = urllib.request.Request(base + 'windows/x64/EluShell-Setup-0.8.0-x64.exe', method='HEAD')
with urllib.request.urlopen(request, timeout=20) as response:
    assert response.status == 200
report = {'result': 'PASS', 'page': base, 'downloads': checks, 'windowsDownloadStatus': 200, 'macOSRuntime': 'NOT RUN'}
Path('test-results/macos-public-downloads.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
