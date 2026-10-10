"""Publish only Mac 0.9.1 diagnostics and the requested historical downloads.

All content is hash-verified in staging first. The Windows update feed remains
0.9.0; an immutable archive index lists every version. The home-page switch is
last, protected by the original hash and a backup for rollback.
"""
import argparse
from datetime import datetime, timezone, timedelta
import hashlib
import json
import os
from pathlib import Path
import shutil
import zipfile

STAGE = Path('/home/itos/elushell-mac-diagnostic-0.9.1')
BUILD = Path('/home/itos/elushell-mac-build-0.9.1')
SITE = Path('/home/itos/application/web/elushell-updates')

def inside(root, relative):
    p = (root / relative).resolve()
    if root.resolve() not in p.parents:
        raise ValueError('Path outside release root')
    return p

def digest(p):
    h = hashlib.sha256()
    with p.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def verify(p, item):
    assert p.is_file() and p.stat().st_size == item['size'], 'Missing or wrong size: ' + str(p)
    assert digest(p) == item['sha256'], 'Checksum mismatch: ' + str(p)

def source(item):
    if item.get('sourceKind') == 'mac-build':
        return inside(BUILD, item['source'])
    if item.get('source'):
        return inside(STAGE, item['source'])
    return inside(SITE, item['path'])

def immutable_copy(src, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        assert digest(src) == digest(dest), 'Refusing to replace a published file'
        return
    temporary = dest.with_name(dest.name + '.publishing-091')
    assert not temporary.exists(), 'Previous unfinished publish requires inspection'
    shutil.copy2(src, temporary)
    try:
        os.link(temporary, dest)  # Create exclusively, never overwrite published archives.
    finally:
        temporary.unlink()

def run(check_only=False):
    plan = json.loads((STAGE / 'publish-plan.json').read_text())
    assert plan['version'] == '0.9.1' and plan['windowsVersion'] == '0.9.0'
    assert len(plan['files']) == len({f['path'] for f in plan['files']})
    assert {f['arch'] for f in plan['files'] if f['version'] == '0.9.1'} == {'arm64', 'x64'}
    assert all(f['platform'] == 'macos' for f in plan['files'] if f['version'] == '0.9.1')
    assert all(f['path'].startswith(('macos/', 'windows/x64/')) for f in plan['files'])
    assert digest(SITE / 'index.html') == plan['expectedOldHomeHash'], 'Download page changed; rebase before publish'
    feed = SITE / 'windows/x64/latest.yml'
    original_feed_hash = digest(feed)
    assert '0.9.0' in feed.read_text(), 'Unexpected Windows version'
    for f in plan['files']:
        verify(source(f), f)
        existing = inside(SITE, f['path'])
        if existing.exists():
            verify(existing, f)
    for f in plan['siteFiles']:
        verify(inside(STAGE / 'site', f['path']), f)
    for report in plan['macReports']:
        assert report['version'] == '0.9.1'
        assert report['archiveIntegrity'] == 'PASS'
        signature = report['offlineSignatureIntegrity']
        assert signature['codePageAndSpecialSlotHashes'] == signature['resourceAndNestedSeals'] == 'PASS'
        with zipfile.ZipFile(BUILD / report['file']) as z:
            assert z.testzip() is None
            assert '诊断日志回传说明.txt' in z.namelist()
            payload = z.read('EluShell.app/Contents/Resources/app.asar')
            assert hashlib.sha256(payload).hexdigest() == plan['payloadHash'], 'Mac app payload mismatch'
    print(json.dumps({'preflight': 'PASS', 'packages': len(plan['files']), 'versions': len(plan['versions'])}), flush=True)
    if check_only:
        return
    backup = STAGE / 'previous-public-entry'
    backup.mkdir()  # Never overwrite a previous rollback snapshot.
    shutil.copy2(SITE / 'index.html', backup / 'index.html')
    shutil.copy2(feed, backup / 'latest.yml')
    now = datetime.now(timezone(timedelta(hours=8)))
    replacements = {'__RELEASE_ISO_091__': now.isoformat(timespec='seconds'),
                    '__RELEASE_TEXT_091__': now.strftime('%Y-%m-%d %H:%M')}
    final = STAGE / 'final-site'
    final.mkdir()
    for item in plan['siteFiles']:
        text = inside(STAGE / 'site', item['path']).read_text(encoding='utf-8')
        for old, new in replacements.items():
            text = text.replace(old, new)
        assert '__RELEASE_' not in text
        dest = inside(final, item['path'])
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text, encoding='utf-8')
    # New artifacts become visible only after the entire set passed verification.
    for item in plan['files']:
        if item.get('source'):
            immutable_copy(source(item), inside(SITE, item['path']))
    for item in plan['siteFiles']:
        if item['path'] != 'index.html':
            immutable_copy(inside(final, item['path']), inside(SITE, item['path']))
    pointer = SITE / 'index.html.next-091'
    assert not pointer.exists()
    shutil.copyfile(final / 'index.html', pointer)
    switched = False
    try:
        assert digest(SITE / 'index.html') == plan['expectedOldHomeHash'], 'Concurrent homepage change'
        assert digest(feed) == original_feed_hash, 'Concurrent Windows update change'
        os.replace(pointer, SITE / 'index.html')
        switched = True
        assert digest(SITE / 'index.html') == digest(final / 'index.html')
        assert digest(feed) == original_feed_hash
    except Exception:
        if switched:
            shutil.copyfile(backup / 'index.html', pointer)
            os.replace(pointer, SITE / 'index.html')
        raise
    record = {'result': 'PASS', 'version': '0.9.1', 'publishedAt': now.isoformat(timespec='seconds'),
              'packages': len(plan['files']), 'versions': len(plan['versions']),
              'homeSha256': digest(SITE / 'index.html'), 'windowsFeedSha256': original_feed_hash,
              'backup': str(backup)}
    (STAGE / 'publish-result.json').write_text(json.dumps(record, indent=2))
    print(json.dumps(record), flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    run(args.check_only)
