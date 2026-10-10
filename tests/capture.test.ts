import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PcapWriter } from '../electron/pcap';
import { captureFilter, captureCommand } from '../electron/capture';
import { CaptureOptionsSchema } from '../src/capture-shared';

function pcap(little = true) {
  const h = Buffer.alloc(24);
  h.writeUInt32LE(little ? 0xa1b2c3d4 : 0xd4c3b2a1);
  const u32 = (b: Buffer, n: number, offset: number) =>
    little ? b.writeUInt32LE(n, offset) : b.writeUInt32BE(n, offset);
  if (little) {
    h.writeUInt16LE(2, 4);
    h.writeUInt16LE(4, 6);
  } else {
    h.writeUInt16BE(2, 4);
    h.writeUInt16BE(4, 6);
  }
  u32(h, 65535, 16);
  u32(h, 1, 20);
  const packet = Buffer.alloc(80);
  u32(packet, 64, 8);
  u32(packet, 64, 12);
  return { h, packet, data: Buffer.concat([h, packet, packet, packet]) };
}
async function parse(chunks: Buffer[], bytes = 10000, count = 100) {
  let limits = 0;
  const parser = new PcapWriter(bytes, count, () => limits++),
    output: Buffer[] = [];
  await pipeline(
    Readable.from(chunks),
    parser,
    new Writable({
      write(b, _e, next) {
        output.push(Buffer.from(b));
        next();
      },
    }),
  );
  return { data: Buffer.concat(output), parser, limits };
}
describe('bounded PCAP stream', () => {
  it.each([true, false])('handles byte boundaries and byte order %s', async (little) => {
    const { data } = pcap(little);
    const result = await parse([...data].map((byte) => Buffer.from([byte])));
    expect(result.data).toEqual(data);
    expect(result.parser.packets).toBe(3);
    expect(result.parser.bytes).toBe(data.length);
  });
  it('keeps only complete packets at size and count limits', async () => {
    const { data, h, packet } = pcap();
    for (const [size, count] of [
      [110, 100],
      [10000, 1],
    ]) {
      const result = await parse([data], size, count);
      expect(result.data).toEqual(Buffer.concat([h, packet]));
      expect(result.limits).toBe(1);
    }
    const partial = await parse([data.subarray(0, data.length - 3)]);
    expect(partial.parser.packets).toBe(2);
    expect(partial.data).toEqual(data.subarray(0, 184));
  });
  it('rejects invalid headers and packet lengths', async () => {
    await expect(parse([Buffer.alloc(24)])).rejects.toThrow('PCAP');
    const { data } = pcap();
    data.writeUInt32LE(0xffffffff, 32);
    await expect(parse([data])).rejects.toThrow('长度');
    await expect(parse([Buffer.alloc(12)])).rejects.toThrow('文件头');
  });
});
describe('capture command boundary', () => {
  it('validates filters and excludes only the management TCP tuple', () => {
    const options = CaptureOptionsSchema.parse({ port: '443', source: '10.0.0.2' });
    const filter = captureFilter(options, {
      client: '10.0.0.3',
      clientPort: 51234,
      serverPort: 22,
    });
    expect(filter).toContain('src host 10.0.0.2');
    expect(filter).toContain('not (tcp and host 10.0.0.3 and port 51234 and port 22)');
    expect(() => captureFilter(options)).toThrow('管理连接');
    expect(() => captureFilter({ ...options, port: '65536' })).toThrow('端口');
    expect(() => captureFilter({ ...options, source: 'x; touch x' })).toThrow('IP');
    expect(() => CaptureOptionsSchema.parse({ interface: '-i any; echo' })).toThrow();
  });
  it('quotes BPF and supervises remote process without a remote output file', () => {
    const options = CaptureOptionsSchema.parse({
      excludeSSH: false,
      filter: "host x'; touch /tmp/x; '",
    });
    const command = captureCommand(options, captureFilter(options));
    expect(command).toMatch(/^exec timeout -s TERM -k 3 30s sh -c '/);
    expect(command).toContain('tcpdump -U -n -i');
    expect(command).toContain(' -w -');
    expect(command).toContain('kill -INT');
    expect(command).not.toContain(' -w /');
  });
});
