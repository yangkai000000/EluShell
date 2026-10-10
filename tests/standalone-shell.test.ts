import { it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { quote } from '../src/shared';

const bash = process.env.ELUSHELL_BASH || (process.platform === 'win32'
  ? path.resolve(path.dirname(execFileSync('where.exe', ['git'], { encoding: 'utf8' }).split(/\r?\n/)[0]), '../bin/bash.exe')
  : '/bin/bash');
const posix = (p: string) => process.platform === 'win32'
  ? p.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase()) : p;
const env = { ...process.env, MSYS2_ARG_CONV_EXCL: '*', MSYS_NO_PATHCONV: '1' };
const shell = (script: string) => spawnSync(bash, ['-c', 'export PATH=/usr/bin:/bin;\n' + script], {
  encoding: 'utf8', env, timeout: 20000,
});
const available = existsSync(bash) && shell('openssl version').status === 0;
const standalone = posix(path.resolve('scripts/elushell-https.sh'));

it.skipIf(!available)('runs standalone Bash certificate generation and Nginx rollback without interpreter runtimes', async () => {
  const base = await mkdtemp(path.resolve('test-results/standalone-shell-'));
  const before = `# server { ignored }
events {}
http {
 server { listen 8080; server_name first.internal; location / { return 200 "brace } #"; } set $example "\${request_uri}"; }
 server { listen 8443 ssl; server_name other.internal; ssl_certificate /old.crt; ssl_certificate_key /old.key; }
}
stream { server { listen 1234; } }
`;
  const modes = ['success', 'generate-only', 'reject', 'reload-fail', 'concurrent', 'unloaded', 'multiple', 'existing-key'];
  for (const mode of modes) {
    const root = path.join(base, mode);
    await mkdir(root);
    const remoteRoot = posix(root);
    const site = remoteRoot + '/site with spaces.conf';
    const executable = remoteRoot + '/nginx';
    await writeFile(path.join(root, 'site with spaces.conf'), before);
    await writeFile(path.join(root, 'nginx'), `#!/bin/bash
set -eu
site=${quote(site)}
mode=${quote(mode)}
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
`, { mode: 0o700 });
    if (mode === 'existing-key') {
      await mkdir(path.join(root, 'private keys'));
      await writeFile(path.join(root, 'private keys/elushell-test.key'), 'preserve-existing-key');
    }
    const args = ['--names', '10.0.0.7,app.internal,2001:db8::7', '--cert-dir', remoteRoot + "/public certs' directory",
      '--key-dir', remoteRoot + '/private keys', '--name', 'elushell-test', '--days', '2'];
    if (mode !== 'generate-only') args.push('--apply-nginx', '--yes', '--site-conf', site, '--nginx-bin', executable, '--nginx-conf', site);
    if (mode !== 'multiple') args.push('--server-index', '1');
    const run = shell(`bash ${quote(standalone)} ${args.map(quote).join(' ')}`);
    const log = run.stdout + run.stderr;
    await writeFile(path.join(root, 'run.log'), log);
    const crt = path.join(root, "public certs' directory/elushell-test.crt");
    const key = path.join(root, 'private keys/elushell-test.key');
    if (mode === 'success' || mode === 'generate-only') {
      expect(run.status, mode + ': ' + log).toBe(0);
      const certificate = new X509Certificate(await readFile(crt));
      expect(certificate.checkIP('10.0.0.7')).toBeTruthy();
      expect(certificate.checkIP('2001:db8::7')).toBeTruthy();
      expect(certificate.checkHost('app.internal')).toBeTruthy();
      expect(certificate.verify(certificate.publicKey)).toBe(true);
      expect(certificate.checkPrivateKey(createPrivateKey(await readFile(key)))).toBe(true);
      if (mode === 'success') {
        const updated = await readFile(path.join(root, 'site with spaces.conf'), 'utf8');
        expect(updated).toContain('listen 443 ssl;');
        expect(updated).toContain('listen 8080;');
        expect(updated).toContain('set $example "${request_uri}";');
        expect(updated).toContain('stream { server { listen 1234; } }');
        expect(updated).toContain('ssl_certificate /old.crt;');
        expect(await readFile(path.join(root, (await readdir(root)).find(p => p.endsWith('.bak'))!), 'utf8')).toBe(before);
        expect(await readFile(path.join(root, 'site with spaces.conf.calls'), 'utf8')).toContain('-s reload');
      } else {
        expect(await readFile(path.join(root, 'site with spaces.conf'), 'utf8')).toBe(before);
        expect(existsSync(path.join(root, 'site with spaces.conf.calls'))).toBe(false);
      }
    } else if (mode === 'concurrent') {
      expect(run.status, log).not.toBe(0);
      expect(log).toContain('配置被其他操作修改');
      expect(await readFile(path.join(root, 'site with spaces.conf'), 'utf8')).toContain('# external edit');
      expect(existsSync(crt)).toBe(true);
      expect(existsSync(key)).toBe(true);
    } else {
      expect(run.status, log).not.toBe(0);
      expect(await readFile(path.join(root, 'site with spaces.conf'), 'utf8')).toBe(before);
      expect(existsSync(crt)).toBe(false);
      if (mode === 'existing-key') expect(await readFile(key, 'utf8')).toBe('preserve-existing-key');
      else expect(existsSync(key)).toBe(false);
      if (mode === 'reject' || mode === 'reload-fail') expect(log).toContain('已恢复原 Nginx 配置');
    }
    expect((await readdir(root)).some(p => p.endsWith('.lock'))).toBe(false);
  }
}, 120000);
