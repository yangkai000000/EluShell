"""Exercise incomplete release rejection and failed pointer switch recovery."""
import importlib.util,json,tempfile
from pathlib import Path
from unittest.mock import patch
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('publisher',root/'scripts/publish-release.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
version=json.loads((root/'package.json').read_text(encoding='utf8'))['version']
source=json.loads((root/f'artifacts/release-{version}/manifest.json').read_text(encoding='utf8'))
with tempfile.TemporaryDirectory(prefix='release-gate-',dir=str(root/'test-results')) as tmp:
    base=Path(tmp);stage=base/'stage';site=base/'site';mac=base/'mac'
    for p in (stage,site,mac):p.mkdir()
    failures=[]
    for label,mutate in [
        ('missing Mac architecture',lambda m:m['files'].pop()),
        ('missing Word guide',lambda m:m['files'].__setitem__(slice(None),[f for f in m['files'] if not f['path'].endswith('.docx')])),
        ('old guide',lambda m:m.update(guideVersion='0.0.0')),
        ('old Mac report',lambda m:m['macReports'][0].update(version='0.0.0')),
        ('unverified Mac signature',lambda m:m['macReports'][0]['offlineSignatureIntegrity'].update(resourceAndNestedSeals='FAIL')),
    ]:
        m=json.loads(json.dumps(source));mutate(m)
        (stage/'manifest.json').write_text(json.dumps(m),encoding='utf8')
        try:module.preflight(stage.resolve(),mac.resolve(),site.resolve());raise RuntimeError('Gate failed: '+label)
        except AssertionError:failures.append(label)
        assert not list(site.iterdir())
    for relative in module.POINTERS:
        for directory,value in [(site,b'old'),(stage/'site',b'new')]:
            p=directory/relative;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(value)
    real=module.atomic_copy
    def failing_copy(src,dst):
        if src==stage.resolve()/'site/windows/x64/latest.yml':raise OSError('simulated disk failure')
        return real(src,dst)
    with patch.object(module,'preflight',return_value={'version':version,'guideVersion':version,'notes':[],'files':[]}),patch.object(module,'atomic_copy',side_effect=failing_copy):
        try:module.publish(stage,mac,site);raise RuntimeError('Expected injected failure')
        except OSError:pass
    assert all((site/r).read_bytes()==b'old' for r in module.POINTERS)
    failures.append('pointer rollback on publish failure')
    assert not (site.parent/('.'+site.name+'.publish-lock')).exists()
(root/'test-results/release-gate.json').write_text(json.dumps({'result':'PASS','rejectionsAndRecovery':failures},indent=2),encoding='utf8')
print('Release gate PASS:',', '.join(failures))
