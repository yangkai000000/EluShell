// Release transport. The private release record and pinned host key stay local;
// no credential is passed on the command line or written into release artifacts.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from 'ssh2';
const operationFile = process.argv[2];
if (!operationFile) throw Error('Usage: node scripts/release-mac-diagnostic.mjs operations.json');
const operations = JSON.parse(await readFile(operationFile, 'utf8'));
const known = JSON.parse(await readFile('test-results/live-readonly.json', 'utf8'));
const privateRecord = await readFile('docs/RELEASING.md', 'utf8');
const password = privateRecord.match(/服务器密码：`([^`]+)`/)?.[1];
if (!password || known.host !== '118.190.211.218' || !/^[a-f0-9]{64}$/.test(known.fingerprint))
  throw Error('Private release credential or pinned host key unavailable');
const client = new Client();
const report = [];
try {
  await new Promise((resolve, reject) => client.once('ready', resolve).once('error', reject).connect({
    host: known.host, port: 22, username: 'itos', password,
    readyTimeout: 20000, keepaliveInterval: 10000, keepaliveCountMax: 3,
    hostVerifier: key => createHash('sha256').update(key).digest('hex') === known.fingerprint,
  }));
  for (const op of operations) {
    if (op.command) {
      const result = await new Promise((resolve, reject) => client.exec(op.command, (error, stream) => {
        if (error) return reject(error);
        let stdout = '', stderr = '';
        stream.on('data', data => { stdout += data; process.stdout.write(data); });
        stream.stderr.on('data', data => { stderr += data; process.stderr.write(data); });
        stream.on('error', reject);
        stream.on('close', code => code ? reject(Error(`Remote exit ${code}`)) : resolve({ stdout, stderr, code }));
      }));
      report.push(result);
    } else {
      const ftp = await new Promise((resolve, reject) => client.sftp((e, s) => e ? reject(e) : resolve(s)));
      try {
        for (const file of op.upload || []) {
          await new Promise((resolve, reject) => ftp.fastPut(file.local, file.remote, e => e ? reject(e) : resolve()));
          console.log('Uploaded ' + path.basename(file.local));
        }
        for (const file of op.download || []) {
          await new Promise((resolve, reject) => ftp.fastGet(file.remote, file.local, e => e ? reject(e) : resolve()));
          console.log('Downloaded ' + path.basename(file.local));
        }
      } finally { ftp.end(); }
    }
  }
  await writeFile(operationFile + '.result.json', JSON.stringify(report, null, 2));
} finally { client.end(); }
