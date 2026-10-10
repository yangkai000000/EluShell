"""Public HTTP checks using an explicitly selected Windows network interface."""
import http.client
import json
import socket
import struct
import sys
from pathlib import Path
from urllib.parse import urlparse

root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf8'))['version']
manifest=json.loads((root/f'artifacts/release-{version}/manifest.json').read_text(encoding='utf8'))
base=urlparse(sys.argv[1]); interface=int(sys.argv[2])
assert base.scheme=='http' and base.hostname=='47.105.176.1' and base.path.endswith('/')

class DirectConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
        self.sock.settimeout(20)
        self.sock.setsockopt(socket.IPPROTO_IP,31,struct.pack('!I',interface))
        self.sock.connect((self.host,self.port))

def request(path,method='GET',headers=None,limit=None):
    connection=DirectConnection(base.hostname,base.port,timeout=20)
    try:
        connection.request(method,base.path+path,headers=headers or {})
        response=connection.getresponse()
        return response.status,dict(response.getheaders()),response.read(limit)
    finally:
        connection.close()

checks=[]
for path in ('index.html',f"guide/{manifest['guideVersion']}/index.html"):
    status,headers,data=request(path)
    text=data.decode('utf8');expected=manifest['guideVersion'] if path.startswith('guide/') else version
    assert status==200 and f'name="elushell-version" content="{expected}"' in text
    assert '联系开发人员反馈：杨凯' in text
    checks.append({'path':path,'result':'PASS'})
for file in manifest['files']:
    if not file['path'].endswith(('.exe','.zip','.docx','.pdf')):continue
    status,headers,data=request(file['path'],'HEAD')
    assert status==200 and int(headers['Content-Length'])==file['size'],file['path']
    status,headers,data=request(file['path'],headers={'Range':'bytes=0-63'},limit=65)
    magic=b'MZ' if file['path'].endswith('.exe') else b'%PDF' if file['path'].endswith('.pdf') else b'PK'
    assert status==206 and len(data)==64 and data.startswith(magic),file['path']
    assert headers['Content-Range'].endswith('/'+str(file['size']))
    checks.append({'path':file['path'],'result':'PASS','method':'Public HEAD size and range/magic; server HTTP full hashes verified separately'})
status,headers,data=request('windows/x64/latest.yml');feed=json.loads(data)
expected=json.loads((root/'release/latest.yml').read_text(encoding='utf8'))
assert status==200 and feed==expected
status,headers,data=request(f'releases/{version}.json');record=json.loads(data)
expected_files=[{key:file[key] for key in ('path','size','sha256')} for file in manifest['files']]
assert status==200 and record['version']==version and record['files']==expected_files
report={'result':'PASS','version':version,'base':sys.argv[1],'checks':checks,'feed':True,'transport':'Public HTTP, per-socket WLAN interface'}
(root/'test-results/public-release-metadata.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps({'result':'PASS','version':version,'checks':len(checks),'feed':True}))
