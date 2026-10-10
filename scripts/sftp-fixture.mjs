import ssh2 from 'ssh2';
import * as fs from 'node:fs/promises';
import path from 'node:path';
const { Server, utils } = ssh2;
// Isolated filesystem-backed SSH server for integration tests, bound to loopback only.
export async function fixture(root, options = {}) {
  const clients = new Set();
  const resolve = (p) => {
    const result = path.resolve(root, '.' + path.posix.resolve('/', p));
    if (result !== root && !result.startsWith(root + path.sep)) throw Error('Fixture path escape');
    return result;
  };
  const server = new Server(
    { hostKeys: [utils.generateKeyPairSync('ed25519').private] },
    (client) => {
      clients.add(client);
      client.on('close', () => clients.delete(client));
      client.on('error', () => {});
      client.on('authentication', (ctx) => {
        if (options.password && (ctx.method !== 'password' || ctx.password !== options.password))
          ctx.reject();
        else {
          options.authenticated?.();
          ctx.accept();
        }
      });
      client.on('ready', () =>
        client.on('session', (accept) => {
          const session = accept();
          session.on('pty', (a) => a?.());
          const shell = (accept, command = '') => {
            const stream = accept();
            const marker = command.match(/elushell;([a-f0-9-]{36});/);
            if (marker) stream.write(`\x1b]777;elushell;${marker[1]};42000\x07`);
            stream.write(options.greeting || 'Local file integration fixture\r\n$ ');
            options.shell?.(stream);
            stream.on('data', (d) => {
              options.input?.(d.toString());
              if (!options.silentHandshake || !d.toString().includes('elushell;')) stream.write(d);
            });
          };
          session.on('shell', shell);
          session.on('exec', (accept, _reject, info) => {
            if (info.command.includes('elushell;')) { shell(accept, info.command); return; }
            const stream = accept();
            if (options.execStream?.(info.command, stream)) return;
            stream.end(options.exec?.(info.command) || '');
          });
          session.on('sftp', (accept) => {
            const ftp = accept(),
              handles = new Map();
            let seq = 0;
            const attrs = (st) => ({
              mode: st.mode,
              size: st.size,
              uid: 1000,
              gid: 1000,
              atime: Math.floor(st.atimeMs / 1000),
              mtime: Math.floor(st.mtimeMs / 1000),
            });
            const status = (id, e) =>
              ftp.status(
                id,
                e?.code === 'ENOENT' ? 2 : e?.code === 'EACCES' ? 3 : 4,
                e?.message || 'Failure',
              );
            const on = (name, fn) =>
              ftp.on(name, (id, ...args) =>
                Promise.resolve()
                  .then(async () => {
                    await options.sftpRequest?.(name, ...args);
                    return fn(id, ...args);
                  })
                  .catch((e) => status(id, e)),
              );
            const handle = (id, value) => {
              const key = String(++seq);
              handles.set(key, value);
              ftp.handle(id, Buffer.from(key));
            };
            on('REALPATH', async (id, p) => {
              await fs.stat(resolve(p));
              ftp.name(id, [{ filename: path.posix.resolve('/', p), longname: p, attrs: {} }]);
            });
            on('STAT', async (id, p) => ftp.attrs(id, attrs(await fs.stat(resolve(p)))));
            on('LSTAT', async (id, p) => ftp.attrs(id, attrs(await fs.lstat(resolve(p)))));
            on('OPENDIR', async (id, p) => {
              const entries = await fs.readdir(resolve(p));
              handle(id, { directory: p, entries });
            });
            on('READDIR', async (id, h) => {
              const d = handles.get(h.toString());
              if (!d.entries.length) {
                ftp.status(id, 1);
                return;
              }
              const entries = d.entries.splice(0, 100),
                items = [];
              for (const name of entries)
                items.push({
                  filename: name,
                  longname: name,
                  attrs: attrs(await fs.lstat(resolve(path.posix.join(d.directory, name)))),
                });
              ftp.name(id, items);
            });
            on('OPEN', async (id, p, flags) =>
              handle(id, { file: await fs.open(resolve(p), utils.sftp.flagsToString(flags)) }),
            );
            on('FSTAT', async (id, h) =>
              ftp.attrs(id, attrs(await handles.get(h.toString()).file.stat())),
            );
            on('READ', async (id, h, offset, length) => {
              const buffer = Buffer.alloc(length);
              const { bytesRead } = await handles
                .get(h.toString())
                .file.read(buffer, 0, length, offset);
              bytesRead ? ftp.data(id, buffer.subarray(0, bytesRead)) : ftp.status(id, 1);
            });
            on('WRITE', async (id, h, offset, data) => {
              await handles.get(h.toString()).file.write(data, 0, data.length, offset);
              ftp.status(id, 0);
            });
            on('CLOSE', async (id, h) => {
              const value = handles.get(h.toString());
              await value?.file?.close();
              handles.delete(h.toString());
              ftp.status(id, 0);
            });
            on('MKDIR', async (id, p) => {
              await fs.mkdir(resolve(p));
              ftp.status(id, 0);
            });
            on('RMDIR', async (id, p) => {
              await fs.rmdir(resolve(p));
              ftp.status(id, 0);
            });
            on('REMOVE', async (id, p) => {
              await fs.unlink(resolve(p));
              ftp.status(id, 0);
            });
            on('RENAME', async (id, a, b) => {
              await fs.rename(resolve(a), resolve(b));
              ftp.status(id, 0);
            });
            on('SETSTAT', async (id, p, a) => {
              options.chmod?.(p, a.mode);
              if (a.mode !== undefined) await fs.chmod(resolve(p), a.mode);
              ftp.status(id, 0);
            });
            on('EXTENDED', async (id, name, a, b) => {
              if (name !== 'posix-rename@openssh.com') {
                ftp.status(id, 8);
                return;
              }
              await fs.rename(resolve(a), resolve(b));
              ftp.status(id, 0);
            });
            ftp.on('close', () => {
              for (const h of handles.values()) void h.file?.close().catch(() => {});
              handles.clear();
            });
          });
        }),
      );
    },
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    close: async () => {
      for (const c of clients) c.end();
      await new Promise((r) => server.close(r));
    },
  };
}
