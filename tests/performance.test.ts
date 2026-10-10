import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalOutput } from '../electron/terminal-output';
import { historyLines, cacheDirectory, withoutKey } from '../src/performance';
import { SettingsSchema, defaults } from '../src/shared';

afterEach(() => vi.useRealTimers());
describe('bounded terminal output', () => {
  it('batches small writes, waits for parsing acknowledgements and pauses a fast producer', () => {
    vi.useFakeTimers();
    const send = vi.fn(),
      pause = vi.fn(),
      resume = vi.fn();
    const output = new TerminalOutput(send, pause, resume);
    const source = 'line 中文 😃\r\n'.repeat(30000);
    for (let i = 0; i < source.length; i += 4096) output.push(source.slice(i, i + 4096));
    expect(pause).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(8);
    expect(send).toHaveBeenCalledTimes(1);
    output.ack(999); // Invalid/stale acknowledgements must not unlock the stream.
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(1);
    let received = '';
    while (output.pending) {
      const [data, sequence] = send.mock.calls.at(-1)!;
      expect(data.length).toBeLessThanOrEqual(65536);
      received += data;
      output.ack(sequence);
      vi.advanceTimersByTime(8);
    }
    expect(received).toBe(source);
    expect(resume).toHaveBeenCalledTimes(1);
    output.dispose();
  });
  it('drains the last output before close and releases queued data on disposal', () => {
    vi.useFakeTimers();
    const send = vi.fn(),
      done = vi.fn();
    const output = new TerminalOutput(send, vi.fn(), vi.fn());
    output.push('last output');
    output.end(done);
    vi.advanceTimersByTime(8);
    expect(done).not.toHaveBeenCalled();
    output.ack(1);
    expect(done).toHaveBeenCalledTimes(1);
    output.push('queued');
    output.dispose();
    vi.runAllTimers();
    expect(output.pending).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
describe('cache budgets and migration', () => {
  it('shares a character-cell budget across wide terminals and many sessions', () => {
    for (const sessions of [1, 5, 10, 100])
      for (const cols of [80, 200, 1000]) {
        const lines = historyLines(2000, 1000000, sessions, cols);
        expect(lines * cols * sessions).toBeLessThanOrEqual(1000000);
        expect(lines).toBeLessThanOrEqual(2000);
      }
    expect(historyLines(0, 1000000, 10, 100)).toBe(0);
  });
  it('bounds cached paths and entries, removes only closed-session data', () => {
    let cache: Record<string, number[]> = {};
    for (let i = 0; i < 1000; i++) cache = cacheDirectory(cache, '/dir' + i, Array(100).fill(i));
    expect(Object.keys(cache).length).toBeLessThanOrEqual(64);
    expect(Object.values(cache).flat().length).toBeLessThanOrEqual(4000);
    expect(cache['/dir999']).toHaveLength(100);
    const before = { a: ['metrics'], b: ['still open'] };
    expect(withoutKey(before, 'a')).toEqual({ b: ['still open'] });
    expect(before.a).toEqual(['metrics']);
  });
  it('migrates old settings without disabling features and rejects excessive budgets', () => {
    const { features, performance, ...old } = defaults;
    expect(SettingsSchema.parse(old).features).toEqual(features);
    expect(SettingsSchema.parse(old).performance.scrollback).toBe(2000);
    expect(
      SettingsSchema.safeParse({ ...defaults, performance: { scrollback: 999999 } }).success,
    ).toBe(false);
  });
});
