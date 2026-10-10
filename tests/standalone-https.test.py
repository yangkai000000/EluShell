"""Run on Linux: python3 standalone-https.test.py /path/to/elushell-https.sh.

Uses real OpenSSL and an isolated fake Nginx; never touches the running service.
"""
import os
import pty
from pathlib import Path
import shutil
import stat
import select
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPT = Path(sys.argv.pop(1)).resolve()
subprocess.check_call(['bash', '-n', str(SCRIPT)])

CONFIG = '''# server { ignored }
server {
    listen 8080;
    server_name first.internal;
    location / { return 200 "quoted } # brace"; }
    set $example "${request_uri}";
}
server { listen 8443 ssl; server_name other.internal; ssl_certificate /old.crt; ssl_certificate_key /old.key; }
'''

FAKE_NGINX = '''#!/bin/bash
set -eu
site=$ELUSHELL_FAKE_SITE
mode=${ELUSHELL_FAKE_MODE:-success}
updated=0
if grep -q 'elushell-test.crt' "$site"; then updated=1; fi
printf '%s\\n' "$*" >> "$site.calls"
case " $* " in
  *' -T '*)
    if [[ $mode == unloaded ]]; then echo '# configuration file /other.conf:'
    else printf '# configuration file %s:\\n' "$site"; fi
    cat "$site" ;;
  *' -t '*)
    if (( updated )); then
      if [[ $mode == concurrent ]]; then printf '# external edit\\n' >> "$site"; exit 1; fi
      if [[ $mode == reject ]]; then exit 1; fi
    fi ;;
  *' -s reload '*) if (( updated )) && [[ $mode == reload-fail ]]; then exit 1; fi ;;
esac
exit 0
'''


class ScriptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='elushell-sh-test-')
        self.root = Path(self.temp.name)
        self.site = self.root / 'site with spaces.conf'
        self.site.write_text(CONFIG)
        self.nginx = self.root / 'nginx'
        self.nginx.write_text(FAKE_NGINX)
        self.nginx.chmod(0o700)
        self.cert_dir = self.root / "public certs' directory"
        self.key_dir = self.root / 'private keys'
        self.cert = self.cert_dir / 'elushell-test.crt'
        self.key = self.key_dir / 'elushell-test.key'
        self.env = dict(os.environ, ELUSHELL_FAKE_SITE=str(self.site))

    def tearDown(self):
        self.temp.cleanup()

    def call(self, extra=(), apply=False, mode='success', names='10.0.0.7,app.internal,2001:db8::7'):
        command = ['bash', str(SCRIPT), '--names', names, '--cert-dir', str(self.cert_dir),
                   '--key-dir', str(self.key_dir), '--name', 'elushell-test', '--days', '2']
        if apply:
            command += ['--site-conf', str(self.site), '--nginx-bin', str(self.nginx),
                        '--nginx-conf', str(self.site), '--apply-nginx', '--yes']
        result = subprocess.run(command + list(extra), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                universal_newlines=True, timeout=30,
                                env=dict(self.env, ELUSHELL_FAKE_MODE=mode))
        return result.returncode, result.stdout + result.stderr

    def assert_cert(self):
        self.assertEqual(stat.S_IMODE(self.key.stat().st_mode), 0o600)
        text = subprocess.check_output(['openssl', 'x509', '-in', str(self.cert), '-noout', '-text'], universal_newlines=True)
        self.assertIn('IP Address:10.0.0.7', text)
        self.assertIn('DNS:app.internal', text)
        self.assertIn('IP Address:2001:DB8:0:0:0:0:0:7', text)
        public_cert = subprocess.check_output(['openssl', 'x509', '-in', str(self.cert), '-pubkey', '-noout'])
        public_key = subprocess.check_output(['openssl', 'pkey', '-in', str(self.key), '-pubout'])
        self.assertEqual(public_cert, public_key)
        subprocess.check_output(['openssl', 'verify', '-CAfile', str(self.cert), str(self.cert)])

    def test_generate_only_real_crypto_and_no_overwrite(self):
        status, log = self.call()
        self.assertEqual(status, 0, log)
        self.assert_cert()
        self.assertEqual(self.site.read_text(), CONFIG)
        self.assertFalse(Path(str(self.site) + '.calls').exists())
        old_key = self.key.read_bytes()
        status, log = self.call()
        self.assertNotEqual(status, 0, log)
        self.assertIn('不会覆盖', log)
        self.assertEqual(self.key.read_bytes(), old_key)

    def test_apply_selected_site_and_backup(self):
        status, log = self.call(['--server-index', '1'], apply=True)
        self.assertEqual(status, 0, log)
        self.assert_cert()
        changed = self.site.read_text()
        self.assertIn('listen 443 ssl;', changed)
        self.assertIn('listen 8080;', changed)
        self.assertIn(CONFIG.split('server { listen 8443')[1], changed)
        self.assertIn('set $example "${request_uri}";', changed)
        self.assertIn('"quoted } # brace"', changed)
        self.assertEqual(next(self.root.glob('*.bak')).read_text(), CONFIG)
        self.assertIn('-s reload', Path(str(self.site) + '.calls').read_text())
        self.assertFalse(list(self.root.glob('*.lock')))

    def test_check_and_reload_failures_restore(self):
        for mode in ['reject', 'reload-fail']:
            status, log = self.call(['--server-index', '1'], apply=True, mode=mode)
            self.assertNotEqual(status, 0, log)
            self.assertIn('已恢复原 Nginx 配置', log)
            self.assertEqual(self.site.read_text(), CONFIG)
            self.assertFalse(self.key.exists())
            self.assertFalse(self.cert.exists())
            self.assertFalse(list(self.root.glob('*.lock')))

    def test_concurrent_edit_is_preserved(self):
        status, log = self.call(['--server-index', '1'], apply=True, mode='concurrent')
        self.assertNotEqual(status, 0, log)
        self.assertIn('配置被其他操作修改', log)
        self.assertIn('# external edit', self.site.read_text())
        self.assertTrue(self.cert.exists())
        self.assertTrue(self.key.exists())

    def test_unloaded_configuration_refused_before_generation(self):
        status, log = self.call(['--server-index', '1'], apply=True, mode='unloaded')
        self.assertNotEqual(status, 0, log)
        self.assertIn('未被指定', log)
        self.assertEqual(self.site.read_text(), CONFIG)
        self.assertFalse(self.cert_dir.exists())

    def test_multiple_sites_require_explicit_choice(self):
        status, log = self.call(apply=True)
        self.assertNotEqual(status, 0, log)
        self.assertIn('--server-index', log)
        self.assertFalse(self.cert_dir.exists())

    def test_invalid_name_injection_refused(self):
        for names in ['https://app.internal', '10.0.0.999', 'app.internal,[evil]', '$(touch /tmp/nope)']:
            status, log = self.call(names=names)
            self.assertNotEqual(status, 0, log)
            self.assertFalse(self.cert_dir.exists())

    def test_existing_tls_and_port_conflict(self):
        status, log = self.call(['--server-index', '1', '--https-port', '8080'], apply=True)
        self.assertNotEqual(status, 0, log)
        self.assertIn('普通 HTTP', log)
        status, log = self.call(['--server-index', '2', '--https-port', '8443'], apply=True)
        self.assertEqual(status, 0, log)
        changed = self.site.read_text()
        self.assertNotIn('/old.crt', changed)
        self.assertNotIn('listen 443', changed)
        self.assertIn(CONFIG.split('server { listen 8443')[0], changed)

    def test_listing_sites_is_read_only(self):
        result = subprocess.run(['bash', str(SCRIPT), '--list-sites', '--site-conf', str(self.site)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('站点 1', result.stdout)
        self.assertIn('站点 2', result.stdout)
        self.assertEqual(set(f.name for f in self.root.iterdir()), {self.site.name, 'nginx'})

    def test_implicit_http_listener_and_single_site_selection(self):
        self.site.write_text('server { server_name app.internal; }\n')
        status, log = self.call(['--https-port', '80'], apply=True)
        self.assertNotEqual(status, 0, log)
        self.assertIn('普通 HTTP', log)
        self.assertFalse(self.cert_dir.exists())
        status, log = self.call(apply=True)
        self.assertEqual(status, 0, log)
        self.assertIn('listen 80;', self.site.read_text())
        self.assertIn('listen 443 ssl;', self.site.read_text())

    def test_interactive_generation_from_terminal(self):
        pid, fd = pty.fork()
        if pid == 0:
            os.execvp('bash', ['bash', str(SCRIPT)])
        answers = [('访问 IP', '10.0.0.7'), ('证书存放目录', str(self.cert_dir)),
                   ('KEY 存放目录', str(self.key_dir)), ('有效期', '2'), ('是否写入配置', 'no')]
        log, answered = b'', 0
        deadline = time.monotonic() + 25
        try:
            while time.monotonic() < deadline:
                if not select.select([fd], [], [], 0.2)[0]:
                    continue
                try:
                    chunk = os.read(fd, 8192)
                except OSError:
                    break
                if not chunk:
                    break
                log += chunk
                if answered < len(answers) and answers[answered][0].encode('utf-8') in log:
                    os.write(fd, (answers[answered][1] + '\n').encode('utf-8'))
                    answered += 1
            else:
                os.kill(pid, 9)
                self.fail('Interactive flow timed out: ' + log.decode('utf-8', 'replace'))
            _, status = os.waitpid(pid, 0)
            self.assertEqual(status, 0, log.decode('utf-8', 'replace'))
            self.assertEqual(answered, len(answers))
            self.assertEqual(len(list(self.cert_dir.glob('*.crt'))), 1)
            self.assertEqual(len(list(self.key_dir.glob('*.key'))), 1)
        finally:
            os.close(fd)

    def test_no_python_java_or_node_in_path(self):
        tools = self.root / 'tools'
        tools.mkdir()
        for name in ['bash', 'awk', 'cat', 'chmod', 'cmp', 'cp', 'date', 'diff', 'grep',
                     'ln', 'mkdir', 'mktemp', 'mv', 'readlink', 'rm', 'rmdir', 'timeout', 'wc', 'openssl']:
            (tools / name).symlink_to(shutil.which(name))
        self.env['PATH'] = str(tools)
        for name in ['python', 'python3', 'java', 'node']:
            self.assertIsNone(shutil.which(name, path=self.env['PATH']))
        status, log = self.call(['--server-index', '1'], apply=True)
        self.assertEqual(status, 0, log)
        self.assert_cert()
        self.assertIn('-s reload', Path(str(self.site) + '.calls').read_text())

    def test_http_container_ignores_stream_server(self):
        stream = 'stream { server { listen 1234; proxy_pass backend; } }\n'
        self.site.write_text('events {}\nhttp {\n' + CONFIG + '}\n' + stream)
        status, log = self.call(['--server-index', '1'], apply=True)
        self.assertEqual(status, 0, log)
        self.assertIn(stream, self.site.read_text())
        self.assertNotIn('站点 3', log)

    def test_empty_malformed_and_multiple_certificate_configs(self):
        for content in ['', 'server { server_name "unclosed; }', 'server {']:
            self.site.write_text(content)
            result = subprocess.run(['bash', str(SCRIPT), '--list-sites', '--site-conf', str(self.site)],
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=10)
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(self.site.read_text(), content)
        self.site.write_text('server { listen 443 ssl; ssl_certificate /a; ssl_certificate /b; }')
        status, log = self.call(apply=True)
        self.assertNotEqual(status, 0, log)
        self.assertIn('多套证书', log)
        self.assertFalse(self.cert_dir.exists())

    def test_no_trailing_newline_is_preserved(self):
        self.site.write_text('server { listen 8080; server_name app.internal; }')
        status, log = self.call(apply=True)
        self.assertEqual(status, 0, log)
        self.assertTrue(self.site.read_bytes().endswith(b'}'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
