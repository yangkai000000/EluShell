import { Client } from 'ssh2';
import { createHash } from 'node:crypto';
const client = new Client();
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
let buffer = '',
  connected = false,
  queue = Promise.resolve();
const exec = (command) =>
  new Promise((resolve, reject) =>
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let stdout = '',
        stderr = '';
      stream.on('data', (data) => (stdout += data));
      stream.stderr.on('data', (data) => (stderr += data));
      stream.on('close', (code) => resolve({ code, stdout, stderr }));
    }),
  );
const sftp = () =>
  new Promise((resolve, reject) => client.sftp((e, s) => (e ? reject(e) : resolve(s))));
async function handle(input) {
  if (!connected) {
    await new Promise((resolve, reject) => {
      client
        .once('ready', resolve)
        .once('error', reject)
        .connect({
          host: input.host,
          port: 22,
          username: input.username,
          password: input.password,
          readyTimeout: 15000,
          keepaliveInterval: 10000,
          keepaliveCountMax: 3,
          hostVerifier(key) {
            const hash = createHash('sha256').update(key).digest('hex');
            console.log(JSON.stringify({ fingerprint: hash }));
            return !input.fingerprint || hash === input.fingerprint;
          },
        });
    });
    input.password = '';
    connected = true;
    console.log(JSON.stringify({ connected: true }));
  }
  if (input.command) {
    console.log(JSON.stringify(await exec(input.command)));
  } else if (input.download) {
    const s = await sftp();
    for (const file of input.download) {
      await new Promise((resolve, reject) => s.fastGet(file.remote, file.local, error => error ? reject(error) : resolve()));
      console.log(JSON.stringify({ downloaded: file.local }));
    }
    s.end();
  } else if (input.upload) {
    const s = await sftp();
    for (const file of input.upload) {
      let previous = 0;
      await new Promise((resolve, reject) =>
        s.fastPut(
          file.local,
          file.remote,
          {
            concurrency: 8,
            step(done, chunk, total) {
              if (done - previous >= 10 * 1024 * 1024) {
                previous = done;
                console.log(
                  JSON.stringify({
                    uploadProgress: file.remote,
                    percent: Math.round((done / total) * 100),
                  }),
                );
              }
            },
          },
          (e) => (e ? reject(e) : resolve()),
        ),
      );
      console.log(JSON.stringify({ uploaded: file.remote }));
    }
    s.end();
  }
  if (input.after) console.log(JSON.stringify(await exec(input.after)));
  if (input.close || input.once) {
    client.end();
    process.exit(0);
  }
}
process.stdin.on('data', (data) => {
  buffer += data.toString().replace(/\r/g, '\n');
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line)
      queue = queue
        .then(() => handle(JSON.parse(line)))
        .catch((error) => console.log(JSON.stringify({ error: error.message })));
  }
});
console.log('Ready for credentials on stdin; stdin echo disabled; credentials are not persisted.');
