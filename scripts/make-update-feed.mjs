import { createReadStream } from 'node:fs';
import { stat, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw Error('Expected release version');
const notes = JSON.parse(await readFile(`docs/releases/${version}.json`, 'utf8'));
if (notes.version !== version || !notes.notes?.length) throw Error('Release notes version mismatch');
const file = `EluShell-Setup-${version}-x64.exe`;
const target = path.resolve('release', file),
  hash = createHash('sha512');
for await (const chunk of createReadStream(target)) hash.update(chunk);
const sha512 = hash.digest('base64');
const info = {
  version,
  files: [{ url: file, sha512, size: (await stat(target)).size }],
  path: file,
  sha512,
  releaseDate: new Date().toISOString(),
  releaseNotes: [`EluShell ${version}`, ...notes.notes].join('\n'),
};
// JSON is valid YAML; keep the checksum metadata reproducible and escaped correctly.
await writeFile('release/latest.yml', JSON.stringify(info, null, 2) + '\n');
console.log(JSON.stringify(info, null, 2));
