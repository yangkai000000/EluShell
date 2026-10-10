"""Execute release operations with an explicitly pinned target; password stays in memory.

Set ELUSHELL_RELEASE_PASSWORD and pass operations.json, host, user, SHA256 host-key
fingerprint (hex), and optionally a Windows interface index. No saved SSH access is added.
"""
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'test-results/ssh-runtime'))
import paramiko

operations, host, user, fingerprint = sys.argv[1:5]
class PinnedHost(paramiko.MissingHostKeyPolicy):
    def missing_host_key(self, client, hostname, key):
        if hashlib.sha256(key.asbytes()).hexdigest() != fingerprint:
            raise RuntimeError('Host fingerprint mismatch')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(PinnedHost())
connection = None
if len(sys.argv) > 5:
    connection = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    connection.settimeout(60)
    connection.setsockopt(socket.IPPROTO_IP, 31, struct.pack('!I', int(sys.argv[5])))
    connection.connect((host, 22))
try:
    client.connect(host, username=user, password=os.environ.pop('ELUSHELL_RELEASE_PASSWORD'),
                   timeout=60, banner_timeout=60, auth_timeout=60,
                   look_for_keys=False, allow_agent=False, sock=connection)
    client.get_transport().set_keepalive(15)
    for op in json.loads(Path(operations).read_text(encoding='utf-8-sig')):
        if 'command' in op:
            _, stdout, _ = client.exec_command(op['command'], timeout=600)
            channel = stdout.channel
            while not channel.exit_status_ready() or channel.recv_ready() or channel.recv_stderr_ready():
                if channel.recv_ready():
                    sys.stdout.buffer.write(channel.recv(65536)); sys.stdout.buffer.flush()
                if channel.recv_stderr_ready():
                    sys.stderr.buffer.write(channel.recv_stderr(65536)); sys.stderr.buffer.flush()
                time.sleep(.05)
            code = channel.recv_exit_status()
            if code: raise RuntimeError('Remote exit ' + str(code))
        else:
            with client.open_sftp() as sftp:
                sftp.get_channel().settimeout(120)
                for item in op.get('upload', []): sftp.put(item['local'], item['remote'])
                for item in op.get('download', []): sftp.get(item['remote'], item['local'])
finally:
    client.close()
