import { afterEach, describe, it, expect } from 'vitest';
import { Server, utils } from 'ssh2';
import { SSHService } from '../electron/ssh';
import { demoProfile } from './profile';
const key = utils.generateKeyPairSync('ed25519').private;
let server: Server, service: SSHService;
afterEach(async () => {
  service?.close();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});
async function fixture(verify = true) {
  server = new Server({ hostKeys: [key] }, (client) => {
    client.on('error', () => {});
    client
      .on('authentication', (ctx) => {
        if (ctx.method === 'password' && ctx.password === 'test-pass') ctx.accept();
        else ctx.reject();
      })
      .on('ready', () =>
        client.on('session', (accept) => {
          const session = accept();
          session.on('pty', (accept) => accept?.());
          session.on('shell', (accept) => {
            const stream = accept();
            stream.write('fixture-ready\r\n');
            stream.on('data', (d: Buffer) => stream.write('echo:' + d.toString()));
          });
          session.on('exec', (accept, _, info) => {
            const stream = accept();
            const marker = info.command.match(/elushell;([a-f0-9-]{36});/);
            if (marker) {
              stream.write(`\x1b]777;elushell;${marker[1]};23456\x07fixture-ready\r\n`);
              stream.on('data', (d: Buffer) => stream.write('echo:' + d.toString()));
              return;
            }
            stream.end(
              info.command.includes('@@CPU')
                ? '\n@@CPU\ncpu 1 0 0 9 0 0 0 0\n@@MEM\nMemTotal: 1000 kB\nMemAvailable: 500 kB\n'
                : 'ok',
            );
          });
        }),
      );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const events: string[] = [];
  service = new SSHService(
    (e) => events.push(e.data),
    async () => verify,
  );
  return {
    events,
    profile: { ...demoProfile, demo: false, host: '127.0.0.1', port: address.port },
  };
}
describe('real SSH transport', () => {
  it('authenticates, allocates a PTY, echoes input and collects metrics separately', async () => {
    const { events, profile } = await fixture();
    const id = await service.connect(profile, 'test-pass');
    service.start(id);
    service.write(id, 'hello\n');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(events.join('')).toContain('echo:hello');
    expect(service.sessions.get(id)?.shellPid).toBe(23456);
    expect(events.join('')).not.toContain('printf');
    expect(events.join('')).not.toContain('elushell;');
    const metrics = await service.metrics(id);
    expect(metrics.memory.total).toBe(1024000);
    expect(events.join('')).not.toContain('MemTotal');
    service.resize(id, 90, 25);
    service.disconnect(id);
    expect(service.sessions.has(id)).toBe(false);
  });
  it('rejects invalid credentials', async () => {
    const { profile } = await fixture();
    await expect(service.connect(profile, 'wrong')).rejects.toThrow();
  });
  it('rejects untrusted host fingerprints', async () => {
    const { profile } = await fixture(false);
    await expect(service.connect(profile, 'test-pass')).rejects.toThrow();
  });
});
