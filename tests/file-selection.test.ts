import { describe, expect, it } from 'vitest';
import { selectFiles } from '../src/file-list';
import { RemoteFiles } from '../electron/remote-files';
import { TransferManager } from '../electron/transfers';

describe('file multi-selection', () => {
  const names = ['1.log', '2.log', '3.log', '4.log'];
  it('toggles individual rows and keeps an anchor for contiguous selection', () => {
    let s = selectFiles({ names: [], anchor: null }, names, '1.log');
    s = selectFiles(s, names, '3.log', { toggle: true });
    expect(s.names).toEqual(['1.log', '3.log']);
    s = selectFiles(s, names, '1.log', { toggle: true });
    expect(s.names).toEqual(['3.log']);
    s = selectFiles(s, names, '4.log', { range: true });
    expect(s.names).toEqual(names);
  });
  it('uses displayed sort order, reverses ranges and excludes filtered rows', () => {
    const s = { names: ['1.log'], anchor: '1.log' };
    expect(selectFiles(s, [...names].reverse(), '3.log', { range: true }).names).toEqual([
      '3.log',
      '2.log',
      '1.log',
    ]);
    expect(selectFiles(s, ['2.log', '4.log'], '4.log', { range: true }).names).toEqual(['4.log']);
    expect(
      selectFiles({ names: ['4.log'], anchor: '2.log' }, names, '3.log', {
        toggle: true,
        range: true,
      }).names,
    ).toEqual(['4.log', '2.log', '3.log']);
  });
  it('bounds batch concurrency and continues after one file fails', async () => {
    const remote = new RemoteFiles(
      async () => {
        throw Error('unused');
      },
      new TransferManager(() => {}),
    );
    let active = 0,
      peak = 0;
    const started: string[] = [];
    remote.download = async (_session, file) => {
      started.push(file);
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (file === '/missing.log') throw Error('Missing file');
      return file;
    };
    const paths = ['/1.log', '/2.log', '/missing.log', '/3.log', '/4.log', '/5.log'];
    expect(await remote.downloadMany('session', paths, 'unused')).toEqual({
      completed: 5,
      failed: [{ path: '/missing.log', error: 'Missing file' }],
    });
    expect(peak).toBe(3);
    expect(started).toEqual(paths);
  });
});
