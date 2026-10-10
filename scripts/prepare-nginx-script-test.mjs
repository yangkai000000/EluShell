// Produces a single isolated remote test job. No production instance is signalled.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
await build({
  entryPoints: ['electron/nginx-upgrade-scripts.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'test-results/nginx-scripts-test.cjs',
});
const { upgradeScript, prepareScript, shellPreamble } = createRequire(import.meta.url)(
  '../test-results/nginx-scripts-test.cjs',
);
const bundle = JSON.parse(await readFile('build/nginx-bundles/manifest.json', 'utf8')).find(
  (b) => b.arch === 'x86_64',
);
const root = '/home/itos/elushell-nginx-script-test-' + randomUUID();
const q = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
let script =
  shellPreamble +
  `
test "$(id -un)" = itos
mkdir -m 700 ${q(root)}
cleanup() {
  for p in /proc/[0-9]*/exe; do
    target=$(readlink "$p" 2>/dev/null || :)
    case "$target" in ${q(root + '/')}*) pid=\${p#/proc/}; pid=\${pid%/exe}; kill -QUIT "$pid" 2>/dev/null || :;; esac
  done
}
trap cleanup EXIT
`;
for (const [index, mode] of ['success', 'stale-config', 'health-rollback'].entries()) {
  const prefix = root + '/' + mode,
    port = 21881 + index;
  const config = `pid ${prefix}/logs/nginx.pid;\nerror_log ${prefix}/logs/error.log notice;\nworker_processes 1;\nevents { worker_connections 128; }\nhttp { access_log off; server { listen 127.0.0.1:${port}; location /health { ${mode === 'health-rollback' ? 'if ($nginx_version != "1.19.9") { return 503; }' : ''} return 200 "ok\\n"; } } }\n`;
  const snapshot = {
    binary: prefix + '/nginx',
    config: prefix + '/nginx.conf',
    prefix,
    pidPath: prefix + '/logs/nginx.pid',
    pid: 999999,
    start: 'RUNTIME_START',
    commandHash: 'RUNTIME_COMMAND',
    binaryHash: 'RUNTIME_BINARY',
    configHash: 'RUNTIME_CONFIG',
    files: [prefix + '/nginx.conf'],
  };
  let upgrade = upgradeScript(
    snapshot,
    prefix + '/backup',
    bundle.sha256,
    `http://127.0.0.1:${port}/health`,
  ).replace('old=999999', 'old="$FIXTURE_PID"');
  for (const key of ['START', 'COMMAND', 'BINARY', 'CONFIG'])
    upgrade = upgrade.replaceAll(q('RUNTIME_' + key), '"$FIXTURE_' + key + '"');
  script += `
mkdir -m 700 ${q(prefix)}
mkdir ${q(prefix + '/logs')}
cp /usr/local/nginx/sbin/nginx ${q(snapshot.binary)}
printf '%s' ${q(Buffer.from(config).toString('base64'))} | base64 -d > ${q(snapshot.config)}
${q(snapshot.binary)} -p ${q(prefix)} -c ${q(snapshot.config)}
FIXTURE_PID=$(cat ${q(snapshot.pidPath)})
FIXTURE_START=$(start "$FIXTURE_PID")
FIXTURE_COMMAND=$(hash "/proc/$FIXTURE_PID/cmdline")
FIXTURE_BINARY=$(hash ${q(snapshot.binary)})
dump=$(${q(snapshot.binary)} -T -p ${q(prefix)} -c ${q(snapshot.config)} 2>/dev/null)
FIXTURE_CONFIG=$(printf '%s' "$dump" | sha256sum | cut -d ' ' -f 1)
export FIXTURE_PID FIXTURE_START FIXTURE_COMMAND FIXTURE_BINARY FIXTURE_CONFIG
printf '%s' ${q(Buffer.from(prepareScript(prefix + '/backup', '/home/itos/elushell-nginx-build-20260920/bundle/nginx', bundle.sha256, snapshot)).toString('base64'))} | base64 -d > ${q(prefix + '/prepare.sh')}
bash ${q(prefix + '/prepare.sh')}
${mode === 'stale-config' ? `printf '\n# concurrent edit\n' >> ${q(snapshot.config)}` : ':'}
printf '%s' ${q(Buffer.from(upgrade).toString('base64'))} | base64 -d > ${q(prefix + '/upgrade.sh')}
result=0
bash ${q(prefix + '/upgrade.sh')} > ${q(prefix + '/upgrade.log')} 2>&1 || result=$?
cat ${q(prefix + '/upgrade.log')}
test "$result" ${mode === 'success' ? '= 0' : '!= 0'}
${mode === 'health-rollback' ? `grep -q '^ELUSHELL_ROLLBACK_OK$' ${q(prefix + '/upgrade.log')}` : ':'}
${mode === 'stale-config' ? `grep -q '^ELUSHELL_NO_CHANGE$' ${q(prefix + '/upgrade.log')}` : ':'}
test "$(hash ${q(snapshot.binary)})" = ${mode === 'success' ? q(bundle.sha256) : '"$FIXTURE_BINARY"'}
test "$(curl --noproxy '*' -fsS http://127.0.0.1:${port}/health)" = ok
echo 'PASS ${mode}'
`;
}
script += `echo 'Isolated evidence: ${root}'\n`;
const remoteScript = root + '.sh';
const command = `printf '%s' ${q(Buffer.from(script).toString('base64'))} | base64 -d > ${q(remoteScript)} && bash ${q(remoteScript)}`;
await writeFile('test-results/nginx-script-live.json', JSON.stringify([{ command }], null, 2));
console.log(root);
