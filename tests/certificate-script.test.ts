import { it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, X509Certificate, createPrivateKey } from 'node:crypto';
import { certificateScript, type CertificatePlan } from '../electron/certificates';
import { configureTLS } from '../electron/nginx-config';
import { quote } from '../src/shared';

const bash =
  process.env.ELUSHELL_BASH ||
  (process.platform === 'win32'
    ? (() => {
        try {
          return path.resolve(
            path.dirname(
              execFileSync('where.exe', ['git'], { encoding: 'utf8' }).split(/\r?\n/)[0],
            ),
            '../bin/bash.exe',
          );
        } catch {
          return '';
        }
      })()
    : '/bin/bash');
const posix = (p: string) =>
  process.platform === 'win32'
    ? p.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase())
    : p;
const env = { ...process.env, MSYS2_ARG_CONV_EXCL: '*', MSYS_NO_PATHCONV: '1' };
const shell = (script: string) =>
  spawnSync(bash, ['-c', 'export PATH=/usr/bin:/bin:$PATH;\n' + script], {
    encoding: 'utf8',
    env,
    timeout: 20000,
  });
const available = !!bash && existsSync(bash) && shell('openssl version').status === 0;

it.skipIf(!available)(
  'generates real certificates and SANs, applies atomically, and rolls back rejected/reload-failed configurations',
  async () => {
    const base = await mkdtemp(path.resolve('test-results/certificate-script-'));
    for (const mode of [
      'success',
      'reject',
      'reload-fail',
      'stale',
      'generate-only',
      'existing-key',
      'unreferenced',
      'concurrent-edit',
      'missing-ssl',
    ]) {
      const root = path.join(base, mode);
      await mkdir(root);
      const rootPath = posix(root),
        configPath = rootPath + '/internal site.conf';
      const before =
        'server { listen 8080; server_name app.internal; location / { return 200 "ok"; } }\n';
      await writeFile(path.join(root, 'internal site.conf'), before);
      const id = randomUUID(),
        crt = rootPath + "/public certs' directory/elushell.crt",
        key = rootPath + '/private keys/elushell.key';
      const backup = rootPath + '/.internal.conf.backup';
      const nginx = rootPath + '/nginx';
      const fakeNginx = `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> ${quote(rootPath + '/nginx.calls')}
case "$*" in
 '-V') if test ${quote(mode)} = missing-ssl; then echo 'configure arguments:'; else echo 'configure arguments: --with-http_ssl_module'; fi ;;
 *' -T') printf '# configuration file %s:\\n' ${quote(mode === 'unreferenced' ? '/other/nginx.conf' : configPath)}; cat ${quote(configPath)} ;;
 *' -t')
   if test ${quote(mode)} = concurrent-edit && grep -q ssl_certificate ${quote(configPath)}; then printf '\\n# another administrator changed this\\n' >> ${quote(configPath)}; exit 1; fi
   if test ${quote(mode)} = reject && grep -q ssl_certificate ${quote(configPath)}; then echo 'new config rejected' >&2; exit 1; fi ;;
 *' -s reload') if test ${quote(mode)} = reload-fail && grep -q ssl_certificate ${quote(configPath)}; then echo 'reload failed' >&2; exit 1; fi ;;
esac
`;
      await writeFile(path.join(root, 'nginx'), fakeNginx, { mode: 0o700 });
      const apply = mode !== 'generate-only';
      const after = apply ? configureTLS(before, 0, crt, key, 8443) : before;
      const plan: CertificatePlan = {
        sessionId: randomUUID(),
        source: { configPath, sudo: false },
        configPath,
        at: Date.now(),
        options: {
          inspectionId: randomUUID(),
          serverIndex: 0,
          names: ['10.0.0.7', 'app.internal', '2001:db8::7'],
          days: 365,
          port: 8443,
          applyNginx: apply,
          redirectHttp: false,
          mainConfigPath: configPath,
          nginxPath: nginx,
          certificateDirectory: path.posix.dirname(crt),
          keyDirectory: path.posix.dirname(key),
        },
        preview: {
          id,
          before,
          after,
          certificatePath: crt,
          privateKeyPath: key,
          backupPath: backup,
          names: ['10.0.0.7', 'app.internal', '2001:db8::7'],
          days: 365,
          applyNginx: apply,
          redirectHttp: false,
        },
      };
      if (mode === 'stale')
        await writeFile(path.join(root, 'internal site.conf'), before + '# external edit\n');
      if (mode === 'existing-key') {
        await mkdir(path.join(root, 'private keys'));
        await writeFile(path.join(root, 'private keys/elushell.key'), 'do not overwrite');
      }
      const result = shell(certificateScript(plan));
      const log = result.stdout + result.stderr;
      await writeFile(path.join(root, 'run.log'), log);
      if (mode === 'success' || mode === 'generate-only') {
        expect(result.status, log).toBe(0);
        const certificate = new X509Certificate(
          await readFile(path.join(root, "public certs' directory/elushell.crt")),
        );
        expect(certificate.subjectAltName).toContain('IP Address:10.0.0.7');
        expect(certificate.subjectAltName).toContain('DNS:app.internal');
        expect(certificate.checkIP('2001:db8::7')).toBeTruthy();
        expect(
          certificate.checkPrivateKey(
            createPrivateKey(await readFile(path.join(root, 'private keys/elushell.key'))),
          ),
        ).toBe(true);
        expect(certificate.verify(certificate.publicKey)).toBe(true);
        expect(await readFile(path.join(root, 'internal site.conf'), 'utf8')).toBe(after);
        if (apply) {
          expect(await readFile(path.join(root, '.internal.conf.backup'), 'utf8')).toBe(before);
          expect(await readFile(path.join(root, 'nginx.calls'), 'utf8')).toContain('-s reload');
        } else expect(existsSync(path.join(root, 'nginx.calls'))).toBe(false);
      } else if (mode === 'concurrent-edit') {
        expect(result.status).not.toBe(0);
        expect(await readFile(path.join(root, 'internal site.conf'), 'utf8')).toBe(
          after + '\n# another administrator changed this\n',
        );
        expect(existsSync(path.join(root, "public certs' directory/elushell.crt"))).toBe(true);
        expect(existsSync(path.join(root, 'private keys/elushell.key'))).toBe(true);
        expect(log).toContain('配置被其他操作修改，未自动覆盖，已保留证书');
      } else {
        if (mode === 'missing-ssl') expect(log).toContain('未启用 HTTP SSL 模块');
        expect(result.status, log).not.toBe(0);
        expect(await readFile(path.join(root, 'internal site.conf'), 'utf8')).toBe(
          before + (mode === 'stale' ? '# external edit\n' : ''),
        );
        expect(existsSync(path.join(root, "public certs' directory/elushell.crt"))).toBe(false);
        if (mode === 'existing-key')
          expect(await readFile(path.join(root, 'private keys/elushell.key'), 'utf8')).toBe(
            'do not overwrite',
          );
        else expect(existsSync(path.join(root, 'private keys/elushell.key'))).toBe(false);
        if (mode === 'reject' || mode === 'reload-fail')
          expect(log).toContain('已恢复原 Nginx 配置');
      }
      expect((await readdir(root)).some((p) => p.endsWith('.elushell-https.lock'))).toBe(false);
    }
  },
  60000,
);
