// Real isolated Nginx instances. Never signals or modifies the business instance.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { Client } from 'ssh2';
import assert from 'node:assert/strict';
import path from 'node:path';

await build({
  entryPoints: ['electron/nginx-upgrade.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'test-results/nginx-service-test.cjs',
});
const { NginxUpgradeService } = createRequire(import.meta.url)(
  '../test-results/nginx-service-test.cjs',
);
const known = JSON.parse(await readFile('test-results/live-readonly.json', 'utf8'));
const privateRecord = await readFile('docs/RELEASING.md', 'utf8');
const password = privateRecord.match(/服务器密码：`([^`]+)`/)?.[1];
if (!password || known.host !== '118.190.211.218') throw Error('Missing private test transport');
const client = new Client();
const root = '/home/itos/elushell-nginx-check-' + randomUUID();

const reportName = 'nginx-linux-upgrade';
const report = { root, transport: 'SFTP upload', cases: [] };
const exec = (command) =>
  new Promise((resolve, reject) =>
    client.exec(command, (e, stream) => {
      if (e) return reject(e);
      let output = '';
      stream.on('data', (b) => (output += b));
      stream.stderr.on('data', (b) => (output += b));
      stream.on('error', reject);
      stream.on('close', (code) =>
        code === 0 ? resolve(output) : reject(Error(output || `exit ${code}`)),
      );
    }),
  );
const q = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
try {
  await new Promise((resolve, reject) =>
    client
      .once('ready', resolve)
      .once('error', reject)
      .connect({
        host: known.host,
        port: 22,
        username: 'itos',
        password,
        readyTimeout: 60000,
        keepaliveInterval: 10000,
        hostVerifier: (key) => createHash('sha256').update(key).digest('hex') === known.fingerprint,
      }),
  );
  await exec(`umask 077; mkdir -m 700 ${q(root)}`);
  await writeFile(`test-results/${reportName}.json`, JSON.stringify(report, null, 2));
  const ftp = await new Promise((resolve, reject) =>
    client.sftp((e, s) => (e ? reject(e) : resolve(s))),
  );
  const service = new NginxUpgradeService(
    () => client,
    async () => ftp,
    (j) => {
      if (j.stage !== report.stage) {
        report.stage = j.stage;
        console.log(j.stage);
      }
    },
    path.resolve('build/nginx-bundles'),
  );
  const old = await exec('/usr/local/nginx/sbin/nginx -v 2>&1');
  const version = old.match(/nginx\/(\S+)/)?.[1];
  assert(version);
  for (const [index, mode] of (process.argv.includes('--all')
    ? ['success', 'stale-config', 'health-rollback']
    : ['success']
  ).entries()) {
    const prefix = root + '/' + mode;
    const port = 19881 + index;
    const config = `pid ${prefix}/logs/nginx.pid;\nerror_log ${prefix}/logs/error.log notice;\nworker_processes 1;\nevents { worker_connections 128; }\nhttp { access_log off; server { listen 127.0.0.1:${port}; location /health { ${mode === 'health-rollback' ? `if ($nginx_version != "${version}") { return 503; }` : ''} return 200 "ok\\n"; } } }\n`;
    await exec(
      `mkdir -m 700 ${q(prefix)} && mkdir ${q(prefix + '/logs')} && cp /usr/local/nginx/sbin/nginx ${q(prefix + '/nginx')} && printf '%s' ${q(Buffer.from(config).toString('base64'))} | base64 -d > ${q(prefix + '/nginx.conf')} && ${q(prefix + '/nginx')} -p ${q(prefix)} -c ${q(prefix + '/nginx.conf')}`,
    );
    const source = {
      binary: prefix + '/nginx',
      config: prefix + '/nginx.conf',
      prefix,
      pidPath: '',
      sudo: false,
      healthUrl: `http://127.0.0.1:${port}/health`,
    };
    const preview = await service.inspect(mode, source);
    assert.equal(preview.ready, true, JSON.stringify(preview.checks));
    if (mode === 'stale-config')
      await exec(`printf '\n# concurrent edit\n' >> ${q(source.config)}`);
    await service.start(mode, preview.id);
    const deadline = Date.now() + 900000;
    while (service.isRunning() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(service.isRunning(), false, 'test deadline');
    const job = service.list(mode)[0];
    await writeFile(`test-results/${reportName}-${mode}.json`, JSON.stringify(job, null, 2));
    assert.equal(
      job.state,
      mode === 'success' ? 'completed' : 'failed',
      job.output + '\n' + job.error,
    );
    if (mode === 'health-rollback') assert(job.output.includes('ELUSHELL_ROLLBACK_OK'));
    const actual = await exec(`${q(source.binary)} -V 2>&1`);
    assert(actual.includes(mode === 'success' ? '--with-http_ssl_module' : `nginx/${version}`));
    assert.equal((await exec(`curl --noproxy '*' -fsS ${q(source.healthUrl)}`)).trim(), 'ok');
    report.cases.push({ mode, result: 'PASS', backup: job.backupPath });
    console.log('PASS', mode);
  }
  ftp.end();
} finally {
  // Only this randomly named, unprivileged fixture tree is eligible for signals.
  if (/^\/home\/itos\/elushell-nginx-check-[a-f0-9-]{36}$/.test(root))
    await exec(
      `for p in /proc/[0-9]*/exe; do target=$(readlink "$p" 2>/dev/null || :); case "$target" in ${q(root + '/')}*) pid=\${p#/proc/}; pid=\${pid%/exe}; kill -QUIT "$pid" 2>/dev/null || :;; esac; done`,
    ).catch(() => {});
  client.end();
  await writeFile(`test-results/${reportName}.json`, JSON.stringify(report, null, 2));
}
