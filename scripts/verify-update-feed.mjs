import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const base = new URL(process.argv[2]);
const response = await fetch(new URL('latest.yml', base), {
  signal: AbortSignal.timeout(15000),
  cache: 'no-store',
});
if (!response.ok) throw Error('Update manifest HTTP ' + response.status);
const manifest = await response.json(),
  local = JSON.parse(await readFile('release/latest.yml', 'utf8'));
if (manifest.version !== local.version || manifest.sha512 !== local.sha512)
  throw Error('Published manifest differs from local release');
const file = manifest.files[0],
  url = new URL(file.url, base);
if (url.origin !== base.origin) throw Error('Unexpected artifact origin');
const download = await fetch(url, { signal: AbortSignal.timeout(180000) });
if (!download.ok) throw Error('Installer HTTP ' + download.status);
const hash = createHash('sha512');
let total = 0,
  previous = 0;
for await (const chunk of download.body) {
  hash.update(chunk);
  total += chunk.length;
  if (total - previous > 25 * 1024 * 1024) {
    previous = total;
    console.log('Public installer download ' + Math.round((total / file.size) * 100) + '%');
  }
}
if (total !== file.size || hash.digest('base64') !== file.sha512)
  throw Error('Public installer checksum/size mismatch');
const range = await fetch(url, {
  headers: { Range: 'bytes=0-1' },
  signal: AbortSignal.timeout(15000),
});
const magic = Buffer.from(await range.arrayBuffer()).toString();
if (range.status !== 206 || magic !== 'MZ')
  throw Error('Expected range support and Windows executable header');
const bootstrap = await fetch(new URL('EluShell-Setup-0.7.0-x64.exe', base), {
  method: 'HEAD',
  signal: AbortSignal.timeout(15000),
});
if (!bootstrap.ok) throw Error('Bootstrap installer unavailable');
const report = {
  result: 'PASS',
  updateDirectory: base.href,
  latestVersion: manifest.version,
  downloadedBytes: total,
  sha512Matches: true,
  rangeRequests: true,
  bootstrapVersion: '0.7.0',
  bootstrapStatus: bootstrap.status,
};
await writeFile('test-results/published-update-v07.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
