from pathlib import Path
import hashlib
import json
import urllib.request
from datetime import datetime, timezone
stage = Path('/home/itos/elushell-mac-diagnostic-0.9.1')
site = Path('/home/itos/application/web/elushell-updates')
base = 'http://47.105.176.1:8800/elushell-updates/'
manifest = json.loads((site/'releases/downloads-0.9.1.json').read_text())
published = json.loads((stage/'publish-result.json').read_text())
checks = []
for file in manifest['files']:
    with urllib.request.urlopen(urllib.request.Request(base+file['path'], method='HEAD'), timeout=30) as response:
        assert response.status == 200
        assert int(response.headers['Content-Length']) == file['size']
    if file['version'] != '0.9.1':
        continue
    h, size = hashlib.sha256(), 0
    with urllib.request.urlopen(base+file['path'], timeout=60) as response:
        assert response.status == 200
        for block in iter(lambda: response.read(1024*1024), b''):
            h.update(block)
            size += len(block)
    assert size == file['size'] and h.hexdigest() == file['sha256']
    checks.append(dict(path=file['path'],size=size,sha256=h.hexdigest()))
    print('Full public-URL HTTP download verified:',file['arch'],flush=True)
with urllib.request.urlopen(base, timeout=30) as response:
    assert hashlib.sha256(response.read()).hexdigest() == published['homeSha256']
with urllib.request.urlopen(base+'windows/x64/latest.yml', timeout=30) as response:
    assert hashlib.sha256(response.read()).hexdigest() == published['windowsFeedSha256']
result = dict(result='PASS',verificationHost='release-server',endpoint=base,
              checkedAt=datetime.now(timezone.utc).isoformat(), versions=len(manifest['versions']),
              packages=len(manifest['files']),fullHttpDownloads=checks,
              externalClient='All 32 HEAD requests and browser UI passed; full downloads interrupted by client connect timeout',
              windowsFeedUnchanged=True,macOSRuntime='NOT RUN')
(stage/'http-verification.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result),flush=True)
