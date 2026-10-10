// Release transport using the already saved itos connection. Secrets stay in memory.
const path = require('node:path');
const fs = require('node:fs/promises');
if (!process.versions.electron) {
  (async () => {
    const isolated = path.resolve('test-results/release-transport');
    await fs.mkdir(isolated, { recursive: true });
    await fs.copyFile(path.join(process.env.APPDATA, 'elushell', 'Local State'), path.join(isolated, 'Local State'));
    const child = require('node:child_process').spawn(require('electron'), [__filename, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
    child.on('exit', code => process.exit(code ?? 1));
  })().catch(e => { console.error(e.message); process.exit(1); });
} else {
  const { app, safeStorage } = require('electron');
  const { Client } = require('ssh2');
  const { createHash } = require('node:crypto');
  app.setPath('userData', path.resolve('test-results/release-transport'));
  app.whenReady().then(async () => {
    const root = path.join(app.getPath('home'), '.EluShell');
    const settings = JSON.parse(await fs.readFile(path.join(root,'settings.json'),'utf8'));
    const profile = settings.profiles.find(p => p.host === '118.190.211.218' && p.username === 'itos' && p.auth === 'password');
    if (!profile) throw Error('Saved release connection unavailable');
    const vault = JSON.parse(await fs.readFile(path.join(root,'credentials.json'),'utf8'));
    const entry = vault[profile.id];
    const binding = createHash('sha256').update(JSON.stringify([profile.host, profile.port, profile.username, profile.auth, profile.privateKeyPath || ''])).digest('hex');
    if (!entry || entry.binding !== binding) throw Error('Saved release credentials unavailable');
    const expected = JSON.parse(await fs.readFile('test-results/live-readonly.json','utf8')).fingerprint;
    if (!expected) throw Error('Known release host fingerprint unavailable');
    const operations = JSON.parse(await fs.readFile(process.argv[2],'utf8'));
    const client = new Client();
    try {
      await new Promise((resolve,reject) => client.once('ready',resolve).once('error',reject).connect({ host: profile.host, port: profile.port, username: profile.username, password: safeStorage.decryptString(Buffer.from(entry.encrypted,'base64')), hostVerifier: key => createHash('sha256').update(key).digest('hex') === expected, readyTimeout: 15000 }));
      for (const op of operations) {
        if (op.command) {
          await new Promise((resolve,reject) => client.exec(op.command, (error,stream) => {
            if (error) return reject(error);
            stream.on('data', b => process.stdout.write(b)); stream.stderr.on('data', b => process.stderr.write(b));
            stream.on('error',reject); stream.on('close', code => code ? reject(Error('Remote exit '+code)) : resolve());
          }));
        } else {
          const ftp = await new Promise((resolve,reject) => client.sftp((e,s) => e ? reject(e) : resolve(s)));
          try {
            for (const file of op.upload || []) { await new Promise((resolve,reject) => ftp.fastPut(file.local,file.remote,e => e ? reject(e) : resolve())); console.log('Uploaded '+path.basename(file.local)); }
            for (const file of op.download || []) { await new Promise((resolve,reject) => ftp.fastGet(file.remote,file.local,e => e ? reject(e) : resolve())); console.log('Downloaded '+path.basename(file.local)); }
          } finally { ftp.end(); }
        }
      }
    } finally { client.end(); }
    app.exit(0);
  }).catch(error => { console.error(error.message); app.exit(1); });
}
