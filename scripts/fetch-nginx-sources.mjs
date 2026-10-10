import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const directory = 'test-results/nginx-sources';
await mkdir(directory, { recursive: true });
const sources = [
  [
    'nginx-1.30.5.tar.gz',
    'https://nginx.org/download/nginx-1.30.5.tar.gz',
    '6c20565aa2325cb82216ae804f4a4ff1875179014759a381c42ddc8e11c4906d',
  ],
  [
    'openssl-3.5.8.tar.gz',
    'https://github.com/openssl/openssl/releases/download/openssl-3.5.8/openssl-3.5.8.tar.gz',
    'a8f84a39918ec6415ce765d9b429d313ba97b8143169c172e734b9514464f5b2',
  ],
  [
    'pcre2-10.48.tar.gz',
    'https://github.com/PCRE2Project/pcre2/releases/download/pcre2-10.48/pcre2-10.48.tar.gz',
    'ebcc25aadf2a51fa1fefa9b8bc9e7a79b3dae86870a0f1152a22e42befd46888',
  ],
  [
    'zlib-1.3.2.tar.gz',
    'https://zlib.net/zlib-1.3.2.tar.gz',
    'bb329a0a2cd0274d05519d61c667c062e06990d72e125ee2dfa8de64f0119d16',
  ],
];
const report = [];
for (const [name, url, expected] of sources) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw Error(`${name}: HTTP ${response.status}`);
  const content = Buffer.from(await response.arrayBuffer());
  if (content[0] !== 0x1f || content[1] !== 0x8b) throw Error('Not a gzip archive: ' + name);
  const sha256 = createHash('sha256').update(content).digest('hex');
  if (expected && expected !== sha256) throw Error('Checksum mismatch: ' + name);
  await writeFile(`${directory}/${name}`, content);
  report.push({ name, url, bytes: content.length, sha256 });
  await writeFile(`${directory}/sources.json`, JSON.stringify(report, null, 2));
  console.log(name, content.length, sha256);
}
