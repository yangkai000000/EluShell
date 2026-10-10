import json
from pathlib import Path
import runpy
import shutil
import sys
import tempfile

verify = runpy.run_path(str(Path(__file__).with_name('verify-mac-signatures.py')))['verify_bundle']
with tempfile.TemporaryDirectory(prefix='elushell-signature-test-') as temporary:
    original = Path(sys.argv[1]) / 'Contents/Frameworks/EluShell Helper.app'
    fixture = Path(temporary) / 'EluShell Helper.app'
    shutil.copytree(str(original), str(fixture), symlinks=True)
    verify(fixture)
    for relative, expected in [('Contents/MacOS/EluShell Helper', 'Code page mismatch'),
                               ('Contents/Info.plist', 'Special slot mismatch'),
                               ('Contents/_CodeSignature/CodeResources', 'Special slot mismatch')]:
        file = fixture / relative
        data = file.read_bytes()
        if relative.startswith('Contents/MacOS/'):
            changed = bytearray(data)
            changed[4096] ^= 1
            file.write_bytes(changed)
        else:
            file.write_bytes(data + b'\n')
        try:
            verify(fixture)
            raise RuntimeError('Verifier accepted tampered file: ' + relative)
        except AssertionError as error:
            assert expected in str(error), str(error)
        finally:
            file.write_bytes(data)
    verify(fixture)
print(json.dumps({'result': 'PASS', 'cases': ['valid signature', 'changed code byte rejected',
    'changed Info.plist rejected', 'changed resource manifest rejected', 'restored fixture accepted']}))
