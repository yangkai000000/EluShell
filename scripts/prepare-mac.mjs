// Prepare the architecture-independent app payload; no Windows native addons.
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import asar from '@electron/asar';
const root = process.cwd();
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const output = path.resolve('release/macos');
await mkdir(output, { recursive: true });
const stage = await mkdtemp(path.resolve('test-results/mac-payload-'));
for (const name of ['dist', 'dist-electron']) await cp(name, path.join(stage, name), { recursive: true });
const copied = new Set();
async function dependency(name, parent = root) {
  const require = createRequire(path.join(parent, 'package.json'));
  let directory = path.dirname(require.resolve(name));
  let info;
  for (;;) {
    try { info = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')); } catch {}
    if (info?.name === name) break;
    const next = path.dirname(directory);
    if (next === directory) throw Error(`Cannot locate dependency ${name}`);
    directory = next;
  }
  if (copied.has(directory)) return;
  copied.add(directory);
  const relative = path.relative(root, directory);
  if (!relative.startsWith(`node_modules${path.sep}`)) throw Error(`Dependency outside project: ${name}`);
  await cp(directory, path.join(stage, relative), {
    recursive: true,
    filter: (file) => !file.endsWith('.node') && !file.includes(`${path.sep}.bin${path.sep}`),
  });
  // ssh2's native optional acceleration has a supported JavaScript fallback.
  for (const child of Object.keys(info.dependencies || {})) await dependency(child, directory);
}
for (const name of ['ssh2', 'electron-updater']) await dependency(name);
await writeFile(path.join(stage, 'package.json'), JSON.stringify({
  name: pkg.name, version: pkg.version, productName: 'EluShell', main: pkg.main,
  description: pkg.description, author: pkg.author,
}, null, 2));
await asar.createPackage(stage, path.join(output, 'app.asar'));
if (asar.listPackage(path.join(output, 'app.asar')).some((name) => name.endsWith('.node')))
  throw Error('Architecture-specific native addon leaked into Mac payload');
const stagedRequire = createRequire(path.join(stage, 'package.json'));
const { Client, Server } = stagedRequire('ssh2');
const { generateKeyPairSync } = await import('node:crypto');
const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
const server = new Server({ hostKeys: [key] }, (client) => {
  client.on('authentication', (ctx) => ctx.method === 'password' && ctx.password === 'fixture-only' ? ctx.accept() : ctx.reject());
  client.on('ready', () => client.on('session', (accept) => accept().on('exec', (accept) => {
    const stream = accept(); stream.write('mac-payload-ssh-ok'); stream.exit(0); stream.end();
  })));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const client = new Client();
try {
  await new Promise((resolve, reject) => {
    client.on('error', reject).on('ready', () => client.exec('fixture', (error, stream) => {
      if (error) return reject(error);
      let text = '';
      stream.on('data', (data) => text += data).on('close', () => text === 'mac-payload-ssh-ok' ? resolve() : reject(Error(text)));
    })).connect({ host: '127.0.0.1', port: server.address().port, username: 'fixture', password: 'fixture-only', readyTimeout: 5000 });
  });
} finally {
  client.end(); server.close();
}
await cp('build/icon.png', path.join(output, 'icon.png'));
await cp('build/app-update.yml', path.join(output, 'app-update.yml'));
const electron = JSON.parse(await readFile('node_modules/electron/package.json', 'utf8')).version;
const report = { version: pkg.version, electron, stage, nativeAddons: 0, sshJavaScriptFallback: 'PASS', macOSRuntime: 'NOT RUN: Windows host' };
await writeFile(path.join(output, 'payload-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
