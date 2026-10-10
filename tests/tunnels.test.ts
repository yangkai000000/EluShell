import { it, expect } from 'vitest';
import { Server as SSHServer, utils } from 'ssh2';
import { createServer, createConnection, type Server } from 'node:net';
import { SSHService } from '../electron/ssh';
import { demoProfile } from './profile';
import type { Tunnel } from '../src/shared';
const port = (server: Server) => (server.address() as { port: number }).port;
async function listen(server: Server) {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return port(server);
}
async function freePort() {
  const server = createServer();
  const p = await listen(server);
  await new Promise<void>((r) => server.close(() => r()));
  return p;
}
async function exchange(p: number) {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection(p, '127.0.0.1');
    socket.setTimeout(3000, () => socket.destroy(Error('echo timeout')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write('tunnel-proof'));
    socket.on('data', (b) => {
      resolve(b.toString());
      socket.destroy();
    });
  });
}
async function setup() {
  const forwarding: Server[] = [],
    clients: any[] = [];
  const echo = createServer((s) => s.pipe(s));
  const echoPort = await listen(echo);
  const server = new SSHServer(
    { hostKeys: [utils.generateKeyPairSync('ed25519').private] },
    (client) => {
      clients.push(client);
      client.on('error', () => {});
      client.on('authentication', (ctx) => ctx.accept());
      client.on('ready', () => {
        client.on('session', (accept) => {
          const s = accept();
          s.on('pty', (a) => a?.());
          s.on('shell', (a) => a());
          s.on('exec', (a) => a());
        });
        client.on('tcpip', (accept, _reject, info) => {
          const stream = accept();
          const socket = createConnection(info.destPort, info.destIP);
          socket.on('error', () => stream.destroy());
          stream.on('close', () => socket.destroy());
          stream.pipe(socket).pipe(stream);
        });
        client.on('request', (accept, reject, name, info) => {
          if (name === 'tcpip-forward') {
            const relay = createServer((socket) => {
              client.forwardOut(
                info.bindAddr,
                info.bindPort,
                socket.remoteAddress || '127.0.0.1',
                socket.remotePort || 0,
                (err, stream) => {
                  if (err) {
                    socket.destroy();
                    return;
                  }
                  socket.on('error', () => stream.destroy());
                  stream.on('close', () => socket.destroy());
                  socket.pipe(stream).pipe(socket);
                },
              );
            });
            forwarding.push(relay);
            relay.once('error', () => reject?.());
            relay.listen(info.bindPort, info.bindAddr, () => accept?.());
          } else if (name === 'cancel-tcpip-forward') {
            for (const relay of forwarding) relay.close();
            accept?.();
          } else reject?.();
        });
      });
    },
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const service = new SSHService(
    () => {},
    async () => true,
  );
  const base = {
    ...demoProfile,
    host: '127.0.0.1',
    port: (server.address() as { port: number }).port,
  };
  const close = async () => {
    service.close();
    for (const c of clients) c.end();
    for (const s of forwarding) s.close();
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => echo.close(() => r()));
  };
  return { service, base, echoPort, close };
}
for (const type of ['local', 'remote'] as const)
  it(`${type} tunnel transfers data and releases its port on disconnect`, async () => {
    const f = await setup();
    const bindPort = await freePort();
    const rule: Tunnel = {
      id: 'rule',
      type,
      bindHost: '127.0.0.1',
      bindPort,
      targetHost: '127.0.0.1',
      targetPort: f.echoPort,
      enabled: true,
    };
    try {
      const id = await f.service.connect({ ...f.base, tunnels: [rule] }, '');
      expect(await exchange(bindPort)).toBe('tunnel-proof');
      f.service.disconnect(id);
      await expect
        .poll(async () => {
          try {
            await exchange(bindPort);
            return false;
          } catch {
            return true;
          }
        })
        .toBe(true);
    } finally {
      await f.close();
    }
  }, 10000);
it('rolls back previously opened tunnels when a later listener conflicts', async () => {
  const f = await setup();
  const busy = createServer();
  const busyPort = await listen(busy),
    goodPort = await freePort();
  const rule: Tunnel = {
    id: 'first',
    type: 'local',
    bindHost: '127.0.0.1',
    bindPort: goodPort,
    targetHost: '127.0.0.1',
    targetPort: f.echoPort,
    enabled: true,
  };
  try {
    await expect(
      f.service.connect(
        { ...f.base, tunnels: [rule, { ...rule, id: 'second', bindPort: busyPort }] },
        '',
      ),
    ).rejects.toThrow('隧道建立失败');
    expect(f.service.sessions.size).toBe(0);
    await expect(exchange(goodPort)).rejects.toThrow();
  } finally {
    await new Promise<void>((r) => busy.close(() => r()));
    await f.close();
  }
});
