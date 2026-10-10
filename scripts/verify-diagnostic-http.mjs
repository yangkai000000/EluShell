import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const base = 'http://47.105.176.1:8800/elushell-updates/';
const report = JSON.parse(await readFile('artifacts/mac-diagnostic-0.9.1/publish-result.json', 'utf8'));
const expected = JSON.parse(await readFile('artifacts/mac-diagnostic-0.9.1/published-downloads.json', 'utf8'));
const get = async p => {
  const r = await fetch(new URL(p, base), { signal: AbortSignal.timeout(60000) });
  assert.equal(r.status, 200, p);
  return r;
};
const home = await (await get('')).text();
assert.equal(createHash('sha256').update(home).digest('hex'), report.homeSha256);
assert(!home.includes('__RELEASE_'));
assert(home.includes('导出诊断日志') && home.includes('全部版本（17）'));
const manifest = await (await get('releases/downloads-0.9.1.json')).json();
assert.deepEqual(manifest, expected);
const feed = await (await get('windows/x64/latest.yml')).text();
assert.equal(createHash('sha256').update(feed).digest('hex'), report.windowsFeedSha256);
const checks = [];
let next = 0;
await Promise.all(Array.from({length:4}, async () => {
  while (next < manifest.files.length) {
    const file = manifest.files[next++];
    const r = await fetch(new URL(file.path, base), { method: 'HEAD', signal: AbortSignal.timeout(30000) });
    assert.equal(r.status, 200, file.path);
    assert.equal(Number(r.headers.get('content-length')), file.size, file.path);
    assert(home.includes(file.path), 'Missing download link: ' + file.path);
    checks.push({ path: file.path, status: 200, bytes: file.size });
  }
}));
console.log('All 32 public package links and sizes verified');
const fullDownloads = await Promise.all(manifest.files.filter(f => f.version === '0.9.1').map(async f => {
  const hash = createHash('sha256');
  let bytes = 0;
  // Hash in byte order while fetching bounded independent ranges concurrently.
  // The public test server can be slow on one long-lived download connection.
  const chunkSize = 4 * 1024 * 1024;
  for (let start = 0; start < f.size; start += 4 * chunkSize) {
    const ranges = Array.from({ length: 4 }, (_, index) => start + index * chunkSize).filter(offset => offset < f.size);
    const blocks = await Promise.all(ranges.map(async offset => {
      const end = Math.min(offset + chunkSize, f.size) - 1;
      const response = await fetch(new URL(f.path, base), {
        headers: { Range: `bytes=${offset}-${end}` }, signal: AbortSignal.timeout(120000),
      });
      assert.equal(response.status, 206, f.path);
      assert.equal(response.headers.get('content-range'), `bytes ${offset}-${end}/${f.size}`);
      const block = Buffer.from(await response.arrayBuffer());
      assert.equal(block.length, end - offset + 1);
      return block;
    }));
    for (const block of blocks) { hash.update(block); bytes += block.length; }
    console.log('Mac download:', f.arch, Math.round(bytes / f.size * 100) + '%');
  }
  const sha256 = hash.digest('hex');
  assert.equal(bytes, f.size); assert.equal(sha256, f.sha256);
  console.log('Full Mac download checksum PASS:', f.arch);
  return { path: f.path, bytes, sha256 };
}));
await get('macos/diagnostics-0.9.1.txt');
await get('macos/checksums-0.9.1.json');
await get('releases/0.9.1.json');
await writeFile('test-results/diagnostic-public-release.json', JSON.stringify({
  result: 'PASS', checkedAt: new Date().toISOString(), publishedAt: report.publishedAt,
  versions: manifest.versions.length, packages: checks.length, checks, fullDownloads,
  windowsFeedUnchanged: true, macOSRuntime: 'NOT RUN',
}, null, 2));
console.log(JSON.stringify({result:'PASS',versions:manifest.versions.length,packages:checks.length,publishedAt:report.publishedAt}));
