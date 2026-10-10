import { build } from 'esbuild';
import { cp, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const nginxBundles = JSON.parse(await readFile('build/nginx-bundles/manifest.json', 'utf8'));
for (const arch of ['x86_64', 'aarch64']) {
  const metadata = nginxBundles.find((b) => b.arch === arch);
  if (!metadata) throw Error(`Missing verified Nginx bundle: ${arch}`);
  const binary = await readFile(`build/nginx-bundles/${arch}/nginx`);
  if (
    binary.length !== metadata.bytes ||
    createHash('sha256').update(binary).digest('hex') !== metadata.sha256
  )
    throw Error(`Nginx bundle checksum mismatch: ${arch}`);
  if (
    binary.length < 64 ||
    binary.readUInt32BE(0) !== 0x7f454c46 ||
    binary[4] !== 2 ||
    binary[5] !== 1 ||
    binary.readUInt16LE(18) !== (arch === 'x86_64' ? 62 : 183)
  )
    throw Error(`Invalid Linux executable architecture: ${arch}`);
}
await cp('build/nginx-bundles', 'dist-electron/nginx-bundles', { recursive: true });
await build({
  entryPoints: ['electron/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'ssh2', 'electron-updater'],
  outfile: 'dist-electron/main.cjs',
});
await build({
  entryPoints: ['electron/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  outfile: 'dist-electron/preload.cjs',
});
