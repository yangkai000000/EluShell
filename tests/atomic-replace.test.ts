import { it, expect, vi } from 'vitest';
import { atomicReplace } from '../electron/atomic-replace';
it('retries transient Windows file locks without deleting the destination', async () => {
  const locked = Object.assign(new Error('locked'), { code: 'EPERM' });
  const replace = vi
    .fn()
    .mockRejectedValueOnce(locked)
    .mockRejectedValueOnce(locked)
    .mockResolvedValue(undefined);
  const pause = vi.fn().mockResolvedValue(undefined);
  await atomicReplace('new.tmp', 'settings.json', replace, pause);
  expect(replace).toHaveBeenCalledTimes(3);
  expect(replace).toHaveBeenLastCalledWith('new.tmp', 'settings.json');
  expect(pause.mock.calls).toEqual([[20], [40]]);
});
it('reports permanent failures and stops retrying a persistent lock', async () => {
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
  const replace = vi.fn().mockRejectedValue(missing),
    pause = vi.fn().mockResolvedValue(undefined);
  await expect(atomicReplace('new.tmp', 'settings.json', replace, pause)).rejects.toBe(missing);
  expect(replace).toHaveBeenCalledTimes(1);
  expect(pause).not.toHaveBeenCalled();
  replace.mockReset().mockRejectedValue(Object.assign(new Error('locked'), { code: 'EBUSY' }));
  await expect(atomicReplace('new.tmp', 'settings.json', replace, pause)).rejects.toThrow('locked');
  expect(replace).toHaveBeenCalledTimes(6);
});
