"""Limited offline integrity verification, not Apple's codesign/Gatekeeper.

CodeDirectory layout: apple-oss-distributions/xnu, osfmk/kern/cs_blobs.h.
Checks code-page hashes, special slots, resource hashes and nested cdhash seals.
Supports the thin 64-bit Mach-O files used by these separate-architecture ZIPs.
"""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import struct
import sys


def macho(file):
    data = file.read_bytes()
    assert data[:4] == b'\xcf\xfa\xed\xfe', str(file)
    command = 32
    signature = None
    for _ in range(struct.unpack_from('<I', data, 16)[0]):
        kind, size = struct.unpack_from('<II', data, command)
        assert size >= 8
        if kind == 0x1d:
            offset, length = struct.unpack_from('<II', data, command + 8)
            signature = data[offset:offset + length]
        command += size
    assert signature is not None, 'No signature: ' + str(file)
    magic, length, count = struct.unpack_from('>III', signature)
    assert magic == 0xfade0cc0 and length <= len(signature)
    blobs = {}
    for i in range(count):
        kind, offset = struct.unpack_from('>II', signature, 12 + i * 8)
        size = struct.unpack_from('>I', signature, offset + 4)[0]
        assert offset + size <= length
        blobs[kind] = signature[offset:offset + size]
    candidates = [file.parent.parent / 'Info.plist', file.parent / 'Resources/Info.plist']
    manifests = [file.parent.parent / '_CodeSignature/CodeResources', file.parent / '_CodeSignature/CodeResources']
    specials = dict(blobs)
    for slot, paths in [(1, candidates), (3, manifests)]:
        existing = next((p for p in paths if p.is_file()), None)
        if existing:
            specials[slot] = existing.read_bytes()
    cdhashes = []
    for kind, directory in blobs.items():
        if kind != 0 and not 0x1000 <= kind < 0x1005:
            continue
        magic, size, version, flags, hash_offset, identifier, special_count, code_count, limit = struct.unpack_from('>9I', directory)
        assert magic == 0xfade0c02 and flags & 2, 'Expected ad-hoc CodeDirectory'
        hash_size, hash_type, platform, page_power = struct.unpack_from('4B', directory, 36)
        algorithm = {1: 'sha1', 2: 'sha256', 3: 'sha256', 4: 'sha384'}[hash_type]
        if version >= 0x20300:
            limit = struct.unpack_from('>Q', directory, 56)[0] or limit
        if version >= 0x20100:
            assert struct.unpack_from('>I', directory, 44)[0] == 0, 'Scatter unsupported'
        assert limit <= len(data)
        page_size = 1 << page_power if page_power else limit
        assert code_count == (limit + page_size - 1) // page_size
        def digest(value):
            return hashlib.new(algorithm, value).digest()[:hash_size]
        for i in range(code_count):
            expected = directory[hash_offset + i * hash_size:hash_offset + (i + 1) * hash_size]
            assert expected == digest(data[i * page_size:min((i + 1) * page_size, limit)]), 'Code page mismatch: ' + str(file)
        for i in range(1, special_count + 1):
            expected = directory[hash_offset - i * hash_size:hash_offset - (i - 1) * hash_size]
            if expected == bytes(hash_size):
                continue
            assert i in specials, 'Missing special slot {}: {}'.format(i, file)
            assert expected == digest(specials[i]), 'Special slot mismatch {}: {}'.format(i, file)
        cdhashes.append(hashlib.new(algorithm, directory).digest()[:20])
    assert cdhashes
    return cdhashes


def verify_bundle(root):
    root = Path(root).resolve()
    hashes = {}
    manifests = []
    for base, dirs, files in os.walk(str(root), followlinks=False):
        for name in files:
            file = Path(base) / name
            if file.is_symlink():
                continue
            if name == 'CodeResources' and file.parent.name == '_CodeSignature':
                manifests.append(file)
            with file.open('rb') as stream:
                magic = stream.read(4)
            if magic == b'\xcf\xfa\xed\xfe':
                hashes[file.resolve()] = macho(file)
    assert hashes and manifests
    checked_resources = 0
    for manifest in manifests:
        base = manifest.parent.parent
        sealed = plistlib.loads(manifest.read_bytes())['files2']
        for name, rule in sealed.items():
            file = base / name
            assert str(file.resolve()).startswith(str(root) + os.sep), name
            if isinstance(rule, bytes):
                assert hashlib.sha1(file.read_bytes()).digest() == rule
            elif 'symlink' in rule:
                assert file.is_symlink() and os.readlink(str(file)) == rule['symlink']
            elif 'cdhash' in rule:
                if file.suffix == '.app':
                    info = plistlib.loads((file / 'Contents/Info.plist').read_bytes())
                    executable = file / 'Contents/MacOS' / info['CFBundleExecutable']
                elif file.suffix == '.framework':
                    executable = file / file.stem
                else:
                    executable = file
                assert rule['cdhash'] in hashes[executable.resolve()], 'Nested signature mismatch: ' + name
            else:
                assert 'hash2' in rule or 'hash' in rule, 'Unknown seal: ' + name
                data = file.read_bytes()
                if 'hash2' in rule:
                    assert hashlib.sha256(data).digest() == rule['hash2'], 'Resource mismatch: ' + name
                if 'hash' in rule:
                    assert hashlib.sha1(data).digest() == rule['hash'], name
            checked_resources += 1
    return {'codePageAndSpecialSlotHashes': 'PASS', 'resourceAndNestedSeals': 'PASS',
            'signedBinaries': len(hashes), 'resourceManifests': len(manifests),
            'resourceEntriesChecked': checked_resources, 'appleCodesignAndGatekeeper': 'NOT RUN'}


if __name__ == '__main__':
    print(json.dumps(verify_bundle(sys.argv[1]), indent=2))
