import { it, expect } from 'vitest';
import { uploadNginxPackage } from '../electron/nginx-upload';

it('uploads exact bytes with a bounded request window and acknowledged progress', async () => {
  const input = Buffer.alloc(1_100_123, 37),
    output = Buffer.alloc(input.length);
  let active = 0,
    peak = 0,
    closed = false;
  const progress: number[] = [];
  const ftp = {
    open(_path: string, flags: string, mode: number, cb: Function) {
      expect(flags).toBe('wx');
      expect(mode).toBe(0o600);
      queueMicrotask(() => cb(null, Buffer.from('handle')));
    },
    write(
      _handle: Buffer,
      bytes: Buffer,
      offset: number,
      length: number,
      position: number,
      cb: Function,
    ) {
      active++;
      peak = Math.max(peak, active);
      setImmediate(() => {
        bytes.copy(output, position, offset, offset + length);
        active--;
        cb(null, length);
      });
    },
    close(_handle: Buffer, cb: Function) {
      closed = true;
      cb(null);
    },
  };
  await uploadNginxPackage(ftp as any, '/tmp/fixture/nginx', input, (sent) => progress.push(sent));
  expect(output).toEqual(input);
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(16);
  expect(progress.at(-1)).toBe(input.length);
  expect(progress).toEqual([...progress].sort((a, b) => a - b));
  expect(closed).toBe(true);
});

it('rejects failed and stalled transfers before switching programs', async () => {
  for (const stall of [false, true]) {
    let closed = false;
    const ftp = {
      open(_p: string, _f: string, _m: number, cb: Function) {
        queueMicrotask(() => cb(null, Buffer.from('h')));
      },
      write(_h: Buffer, _b: Buffer, _o: number, _l: number, _p: number, cb: Function) {
        if (!stall) queueMicrotask(() => cb(Error('connection lost')));
      },
      close(_h: Buffer, cb: Function) {
        closed = true;
        cb(null);
      },
    };
    await expect(
      uploadNginxPackage(ftp as any, '/tmp/fixture/nginx', Buffer.alloc(100), () => {}, 15),
    ).rejects.toThrow(stall ? '上传超时' : 'connection lost');
    expect(closed).toBe(true);
  }
});
