"""Verify every released byte through nginx on the release host (Python 3.6+)."""
import argparse,hashlib,json,urllib.request
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,required=True);p.add_argument('--base',required=True);p.add_argument('--host',required=True)
args=p.parse_args();manifest=json.loads(args.manifest.read_text(encoding='utf8'));checks=[]
for entry in manifest['files']:
    digest=hashlib.sha256();length=0
    request=urllib.request.Request(args.base+entry['path'],headers={'Host':args.host})
    with urllib.request.urlopen(request,timeout=30) as response:
        assert response.status==200,entry['path']
        while True:
            data=response.read(1024*1024)
            if not data:break
            digest.update(data);length+=len(data)
    assert length==entry['size'] and digest.hexdigest()==entry['sha256'],'HTTP integrity failed: '+entry['path']
    checks.append({'path':entry['path'],'size':length,'sha256':digest.hexdigest()})
report={'result':'PASS','version':manifest['version'],'method':'Full download through local nginx HTTP, public Host header','files':checks}
(args.manifest.parent/'http-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'result':'PASS','version':manifest['version'],'files':len(checks)}))
