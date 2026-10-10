"""Pinned-host release transport; credentials stay in the private local record."""
import hashlib, json, re, shlex, socket, struct, sys, time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'test-results/ssh-runtime'))
import paramiko

known = json.loads((ROOT / 'test-results/live-readonly.json').read_text(encoding='utf8'))
match = re.search(r'服务器密码：`([^`]+)`', (ROOT / 'docs/RELEASING.md').read_text(encoding='utf8'))
assert match and known['host'] == '118.190.211.218'
class PinnedHost(paramiko.MissingHostKeyPolicy):
    def missing_host_key(self, client, hostname, key):
        if hashlib.sha256(key.asbytes()).hexdigest() != known['fingerprint']:
            raise RuntimeError('Host fingerprint mismatch')

file = Path(sys.argv[1]); operations = json.loads(file.read_text(encoding='utf-8-sig'))
client = paramiko.SSHClient(); client.set_missing_host_key_policy(PinnedHost())
report = []
try:
    connection = None
    if len(sys.argv)>2:
        assert sys.platform=='win32', 'Explicit interface is Windows-only'
        connection=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
        connection.settimeout(30)
        # Windows IP_UNICAST_IF applies to this socket only, not global routes.
        connection.setsockopt(socket.IPPROTO_IP,31,struct.pack('!I',int(sys.argv[2])))
        connection.connect((known['host'],22))
    client.connect(known['host'], username='itos', password=match[1], timeout=60, banner_timeout=60, auth_timeout=60, look_for_keys=False, allow_agent=False, sock=connection)
    print('Connected with pinned host key', flush=True)
    client.get_transport().set_keepalive(15)
    for op in operations:
        if 'command' in op:
            print('Running remote release operation', flush=True)
            channel = client.get_transport().open_session(timeout=60)
            channel.exec_command(op['command'])
            output, errors = bytearray(), bytearray()
            while True:
                while channel.recv_ready():
                    data=channel.recv(65536); output.extend(data); sys.stdout.buffer.write(data); sys.stdout.buffer.flush()
                while channel.recv_stderr_ready():
                    data=channel.recv_stderr(65536); errors.extend(data); sys.stderr.buffer.write(data); sys.stderr.buffer.flush()
                if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready(): break
                time.sleep(.05)
            code=channel.recv_exit_status(); channel.close()
            report.append({'code':code,'stdout':output.decode('utf8','replace'),'stderr':errors.decode('utf8','replace')})
            if code: raise RuntimeError('Remote exit '+str(code))
        elif 'uploadStream' in op:
            for item in op['uploadStream']:
                local=Path(item['local']); remote=item['remote']; temporary=remote+'.uploading'
                assert remote.startswith(('/home/itos/elushell-release-', '/home/itos/elushell-mac-build-'))
                print('Streaming',local.name,flush=True)
                expected=hashlib.sha256(local.read_bytes()).hexdigest()
                channel=client.get_transport().open_session(timeout=60); channel.settimeout(120)
                check="printf '%s  %s\\n' "+shlex.quote(expected)+' '+shlex.quote(temporary)+' | sha256sum -c -'
                channel.exec_command('cat > '+shlex.quote(temporary)+' && '+check+' && mv -- '+shlex.quote(temporary)+' '+shlex.quote(remote))
                done=0; last=0; started=time.monotonic()
                with local.open('rb') as src:
                    while data:=src.read(4096):
                        channel.sendall(data);done+=len(data)
                        time.sleep(.005)
                        if done-last>=1024*1024 or done==local.stat().st_size:
                            last=done;print('Stream',round(done/local.stat().st_size*100),'%',round(done/max(time.monotonic()-started,1)/1024),'KiB/s',flush=True)
                channel.shutdown_write()
                result=channel.makefile('rb').read().decode('utf8','replace');errors=channel.makefile_stderr('rb').read().decode('utf8','replace')
                code=channel.recv_exit_status();channel.close();print(result,errors,flush=True)
                if code:raise RuntimeError('Stream verification failed')
        else:
            with client.open_sftp() as ftp:
                ftp.get_channel().settimeout(120)
                for item in op.get('upload',[]):
                    print('Uploading',Path(item['local']).name,flush=True)
                    last=[0]
                    def progress(done,total):
                        if done-last[0] >= 10*1024*1024 or done==total:
                            last[0]=done; print('Upload',Path(item['local']).name,round(done/total*100),'%',flush=True)
                    ftp.put(item['local'],item['remote'],callback=progress,confirm=True)
                for item in op.get('download',[]):
                    ftp.get(item['remote'],item['local'])
                    print('Downloaded',Path(item['local']).name,flush=True)
    file.with_name(file.name+'.result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
finally:
    client.close()
