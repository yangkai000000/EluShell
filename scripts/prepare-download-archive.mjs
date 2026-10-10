import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
const out = 'artifacts/mac-diagnostic-0.9.1';
await mkdir(out, { recursive: true });
const results = JSON.parse(await readFile('test-results/mac-diagnostic-build.json.result.json', 'utf8'));
const inventory = JSON.parse(results.at(-1).stdout);
const entries = inventory.map(f => ({ ...f, timeSource: 'server-file-time' }));
const upload = [];
for (const name of await readdir('release')) {
  if (!/^EluShell-(?:Setup-)?\d+\.\d+\.\d+-(?:windows-)?x64\.exe$/.test(name)) continue;
  const remotePath = 'windows/x64/' + name;
  const file = 'release/' + name;
  const info = await stat(file);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const sha256 = hash.digest('hex');
  const existing = entries.find(f => f.path === remotePath);
  if (existing) {
    if (existing.sha256 !== sha256 || existing.size !== info.size) throw Error('Local/remote archive mismatch: ' + name);
    continue;
  }
  entries.push({ path: remotePath, size: info.size, sha256, mtime: info.mtimeMs / 1000,
    timeSource: 'build-time-archived-now', source: 'archive-stage/' + name });
  upload.push({ local: file, remote: '/home/itos/elushell-mac-diagnostic-0.9.1/archive-stage/' + name });
}
await writeFile(out + '/archive-inventory.json', JSON.stringify(entries, null, 2));
await writeFile('test-results/mac-diagnostic-archive-upload.json', JSON.stringify([
  { upload },
  { download: ['arm64', 'x64'].map(arch => ({ remote: `/home/itos/elushell-mac-build-0.9.1/report-${arch}.json`, local: `${out}/report-${arch}.json` })) },
], null, 2));
console.log(JSON.stringify({ alreadyPublished: inventory.length, archiveUploads: upload.length, allExistingPackages: entries.length }));
