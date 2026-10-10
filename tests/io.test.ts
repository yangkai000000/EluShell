import { it, expect } from 'vitest';
import { diskRates } from '../src/io';
it('calculates block device throughput, IOPS and utilization without partitions', () => {
  const old = '8 0 sda 10 0 100 2 20 0 200 4 0 6 0';
  const next = '8 0 sda 14 0 108 2 22 0 216 4 0 506 0\n8 1 sda1 14 0 108 2 22 0 216 4 0 506 0';
  const d = diskRates(next, old, 2);
  expect(d).toHaveLength(1);
  expect(d[0].readRate).toBe(2048);
  expect(d[0].writeRate).toBe(4096);
  expect(d[0].iops).toBe(3);
  expect(d[0].utilization).toBe(25);
});
it('uses a zero-rate baseline and clamps counter resets', () => {
  const raw = '8 0 sda 10 0 100 2 20 0 200 4 0 6 0';
  expect(diskRates(raw)[0].readRate).toBe(0);
  expect(diskRates(raw, raw, 0)[0].iops).toBe(0);
});
