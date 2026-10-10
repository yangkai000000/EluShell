import { createServer, createConnection, type Server, type Socket } from 'node:net';
import type { Client, ClientChannel } from 'ssh2';
import type { Tunnel } from '../src/shared';
export class TunnelManager {
  private listeners: Server[] = [];
  private sockets = new Set<Socket | ClientChannel>();
  private remote: Tunnel[] = [];
  private closed = false;
  constructor(
    private client: Client,
    private report: (message: string) => void,
  ) {}
  private pair(a: Socket | ClientChannel, b: Socket | ClientChannel) {
    if (this.closed) {
      a.destroy();
      b.destroy();
      return;
    }
    this.sockets.add(a);
    this.sockets.add(b);
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      x.on('error', () => y.destroy());
      x.on('close', () => {
        this.sockets.delete(x);
        y.destroy();
      });
    }
    a.pipe(b);
    b.pipe(a);
  }

  async open(rules: Tunnel[]) {
    this.client.on('tcp connection', (info, accept, reject) => {
      const rule = this.remote.find((r) => r.bindPort === info.destPort);
      if (!rule || this.closed) {
        reject();
        return;
      }
      const socket = createConnection({ host: rule.targetHost, port: rule.targetPort });
      this.sockets.add(socket);
      const failed = () => {
        reject();
        this.sockets.delete(socket);
      };
      socket.once('error', failed);
      socket.once('connect', () => {
        socket.removeListener('error', failed);
        this.pair(socket, accept());
      });
    });
    try {
      for (const rule of rules.filter((r) => r.enabled)) {
        if (rule.type === 'local') {
          const server = createServer((socket) => {
            this.sockets.add(socket);
            socket.on('close', () => this.sockets.delete(socket));
            socket.on('error', () => {});
            this.client.forwardOut(
              socket.remoteAddress || '127.0.0.1',
              socket.remotePort || 0,
              rule.targetHost,
              rule.targetPort,
              (err, stream) => {
                if (err) {
                  this.report(`隧道 ${rule.bindPort} 转发失败：${err.message}`);
                  socket.destroy();
                  return;
                }
                this.pair(socket, stream);
              },
            );
          });
          this.listeners.push(server);
          await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(rule.bindPort, rule.bindHost, () => {
              server.removeListener('error', reject);
              server.on('error', (e) => this.report(e.message));
              resolve();
            });
          });
        } else {
          this.remote.push(rule);
          await new Promise<void>((resolve, reject) =>
            this.client.forwardIn(rule.bindHost, rule.bindPort, (err) =>
              err ? reject(err) : resolve(),
            ),
          );
        }
      }
    } catch (e) {
      this.close();
      throw Error('SSH 隧道建立失败：' + (e as Error).message);
    }
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const server of this.listeners) server.close();
    for (const socket of this.sockets) socket.destroy();
    for (const rule of this.remote) {
      try {
        this.client.unforwardIn(rule.bindHost, rule.bindPort, () => {});
      } catch {}
    }
    this.sockets.clear();
  }
}
