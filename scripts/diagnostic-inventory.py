import hashlib
import json
from pathlib import Path
root = Path('/home/itos/application/web/elushell-updates')
result = []
for p in root.rglob('*'):
    if not p.is_file() or p.suffix not in ('.zip', '.exe'):
        continue
    h = hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    result.append(dict(path=str(p.relative_to(root)), size=p.stat().st_size,
                       mtime=p.stat().st_mtime, sha256=h.hexdigest()))
print(json.dumps(result))
