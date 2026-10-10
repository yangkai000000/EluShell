import { Transform, type TransformCallback } from 'node:stream';
// Streaming classic PCAP validation; retain at most one packet between chunks.
export class PcapWriter extends Transform {
  private pending: Buffer = Buffer.alloc(0);
  private header = false;
  private little = true;
  private snaplen = 262144;
  packets = 0;
  bytes = 0;
  limited = false;
  constructor(
    private maxBytes: number,
    private maxPackets: number,
    private limit: () => void,
  ) {
    super({ highWaterMark: 65536 });
  }
  _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback) {
    try {
      if (this.limited) {
        done();
        return;
      }
      this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
      if (!this.header) {
        if (this.pending.length < 24) {
          done();
          return;
        }
        const magic = this.pending.subarray(0, 4).toString('hex');
        if (!['d4c3b2a1', 'a1b2c3d4', '4d3cb2a1', 'a1b23c4d'].includes(magic))
          throw Error('远端未返回有效的 PCAP 数据，请检查 tcpdump 与抓包权限');
        this.little = ['d4c3b2a1', '4d3cb2a1'].includes(magic);
        this.snaplen = this.number(16);
        if (!this.snaplen || this.snaplen > 262144) throw Error('PCAP 包长度超出安全上限');
        this.bytes = 24;
        this.push(this.pending.subarray(0, 24));
        this.pending = this.pending.subarray(24);
        this.header = true;
      }
      while (this.pending.length >= 16) {
        const length = this.number(8);
        if (length > this.snaplen) throw Error('PCAP 数据包长度无效');
        if (this.pending.length < 16 + length) break;
        if (this.bytes + 16 + length > this.maxBytes || this.packets >= this.maxPackets) {
          this.reached();
          break;
        }
        this.bytes += 16 + length;
        this.packets++;
        this.push(this.pending.subarray(0, 16 + length));
        this.pending = this.pending.subarray(16 + length);
        if (this.packets >= this.maxPackets) {
          this.reached();
          break;
        }
      }
      // Copy the remainder so a tiny tail doesn't retain the previous large network buffer.
      this.pending = Buffer.from(this.pending);
      done();
    } catch (e) {
      done(e as Error);
    }
  }
  private number(offset: number) {
    return this.little ? this.pending.readUInt32LE(offset) : this.pending.readUInt32BE(offset);
  }
  private reached() {
    this.limited = true;
    this.pending = Buffer.alloc(0);
    this.limit();
  }
  _flush(done: TransformCallback) {
    // Interrupted captures retain only complete packets, never a malformed partial record.
    this.pending = Buffer.alloc(0);
    done(this.header ? undefined : Error('没有收到 PCAP 文件头，请检查服务器依赖与抓包权限'));
  }
}
