import { it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { UpdateService, type UpdateDriver } from '../electron/updates';
import { normalizeUpdatePreferences } from '../src/update-shared';

function fixture(saved: any = {}) {
  let data = structuredClone(saved);
  const store = {
    read: vi.fn(async (_: string, fallback: any) => (Object.keys(data).length ? data : fallback)),
    write: vi.fn(async (_: string, next: any) => {
      data = structuredClone(next);
    }),
  };
  const driver = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async () => ({
      isUpdateAvailable: true,
      updateInfo: { version: '0.7.1', releaseNotes: '更新测试' },
      cancellationToken: { cancel: vi.fn() },
    })),
    downloadUpdate: vi.fn(async () => ['installer.exe']),
    quitAndInstall: vi.fn(),
    stopRequests: vi.fn(),
  });
  const factory = vi.fn(async () => driver as UpdateDriver),
    emit = vi.fn();
  const service = new UpdateService(store as any, '0.7.0', true, factory, emit, () => 1000, 10);
  return { service, store, driver, factory, emit, saved: () => data };
}
it('empty default update address makes no network requests and no startup writes', async () => {
  const f = fixture();
  await f.service.initialize();
  await f.service.check();
  await f.service.check(true);
  expect(f.service.status().config.url).toBe('');
  expect(f.factory).not.toHaveBeenCalled();
  expect(f.store.write).not.toHaveBeenCalled();
});
it('migrates the retired official feed and preserves update preferences', async () => {
  const f = fixture({
    url: 'http://118.190.211.218:8800/elushell-updates/windows/x64/',
    allowHttp: true,
    autoCheck: false,
    ignoredVersion: '0.10.9',
    lastChecked: 123,
  });
  await f.service.initialize();
  expect(f.saved()).toMatchObject({
    url: 'http://47.105.176.1:8800/elushell-updates/windows/x64/',
    allowHttp: true,
    autoCheck: false,
    ignoredVersion: '0.10.9',
    lastChecked: 0,
  });
  expect(f.factory).not.toHaveBeenCalled();
});
it('does not migrate a custom feed on the retired host', async () => {
  const f = fixture({ url: 'http://118.190.211.218:8800/custom/', allowHttp: true });
  await f.service.initialize();
  expect(f.service.status().config.url).toBe('http://118.190.211.218:8800/custom/');
  expect(f.store.write).not.toHaveBeenCalled();
});
it('validates configurable URLs, explicit HTTP consent and directory normalization', () => {
  expect(normalizeUpdatePreferences({ url: 'https://updates.example/a' }).url).toBe(
    'https://updates.example/a/',
  );
  expect(() => normalizeUpdatePreferences({ url: 'http://127.0.0.1/u' })).toThrow('HTTP');
  expect(normalizeUpdatePreferences({ url: 'http://127.0.0.1/u', allowHttp: true }).url).toBe(
    'http://127.0.0.1/u/',
  );
  for (const url of [
    'file:///C:/a',
    'https://user:secret@example.com/',
    'https://example.com/latest.yml',
    'https://example.com/?token=123',
  ])
    expect(() => normalizeUpdatePreferences({ url })).toThrow();
});
it('persists ignored versions across restart; manual checks override ignore and changed source clears it', async () => {
  const f = fixture({ url: 'https://updates.example/' });
  await f.service.initialize();
  await f.service.check();
  expect(f.service.status().prompt).toBe(true);
  expect(f.driver.downloadUpdate).not.toHaveBeenCalled();
  await f.service.dismiss(true);
  const reopened = fixture(f.saved());
  await reopened.service.initialize();
  await reopened.service.check();
  expect(reopened.service.status().prompt).toBe(false);
  await reopened.service.check(true);
  expect(reopened.service.status().prompt).toBe(true);
  await reopened.service.configure({ url: 'https://other.example/' });
  expect(reopened.service.status().config.ignoredVersion).toBe('');
});
it('disabled auto checks and deferred reminders do not contact the server', async () => {
  const f = fixture({ url: 'https://updates.example/', autoCheck: false });
  await f.service.initialize();
  await f.service.check();
  expect(f.factory).not.toHaveBeenCalled();
  await f.service.check(true);
  await f.service.dismiss(false);
  await f.service.configure({ url: 'https://updates.example/', autoCheck: true });
  await f.service.check();
  expect(f.driver.checkForUpdates).toHaveBeenCalledTimes(1);
});
it('download requires availability, does not install automatically, and guards changing source while downloading', async () => {
  const f = fixture({ url: 'https://updates.example/' });
  await f.service.initialize();
  await expect(f.service.install()).rejects.toThrow();
  await f.service.check();
  let done!: (v: string[]) => void;
  f.driver.downloadUpdate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  const download = f.service.download();
  await expect(f.service.configure({ url: '' })).rejects.toThrow();
  f.driver.emit('download-progress', { percent: 45 });
  expect(f.service.status().percent).toBe(45);
  f.service.cancel();
  expect(
    (await f.driver.checkForUpdates.mock.results[0].value).cancellationToken.cancel,
  ).toHaveBeenCalled();
  done(['installer.exe']);
  await download;
  expect(f.driver.quitAndInstall).not.toHaveBeenCalled();
  await f.service.install();
  expect(f.driver.quitAndInstall).toHaveBeenCalledWith(false, true);
});
it('rejects failed downloads and allows retry checks; old versions never become available', async () => {
  const f = fixture({ url: 'https://updates.example/' });
  await f.service.initialize();
  await f.service.check();
  f.driver.downloadUpdate.mockRejectedValueOnce(Error('checksum mismatch'));
  await f.service.download();
  expect(f.service.status().phase).toBe('error');
  await expect(f.service.install()).rejects.toThrow();
  f.driver.checkForUpdates.mockResolvedValueOnce({
    isUpdateAvailable: false,
    updateInfo: { version: '0.6.2', releaseNotes: '' },
    cancellationToken: { cancel: vi.fn() },
  });
  await f.service.check(true);
  expect(f.service.status().phase).toBe('current');
});
it('times out unreachable checks, releases busy state and does not show a startup modal', async () => {
  const f = fixture({ url: 'https://updates.example/' });
  await f.service.initialize();
  f.driver.checkForUpdates.mockImplementationOnce(() => new Promise(() => {}));
  await f.service.check();
  expect(f.service.status().phase).toBe('error');
  expect(f.service.status().prompt).toBe(false);
  expect(f.driver.stopRequests).toHaveBeenCalled();
  await f.service.configure({ url: '' });
  expect(f.service.status().phase).toBe('disabled');
});

it('keeps preparation visible and locks update actions until the visible installer starts', async () => {
  const f = fixture({ url: 'https://updates.example/' });
  await f.service.initialize();
  await f.service.check();
  await f.service.download();
  let finish!: (value: boolean) => void;
  const installing = f.service.install(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  expect(f.service.status()).toMatchObject({
    phase: 'installing',
    installStep: 'preparing',
    prompt: true,
  });
  await expect(f.service.configure({ url: '' })).rejects.toThrow();
  await f.service.dismiss(false);
  expect(f.service.status().prompt).toBe(true);
  expect(await f.service.install()).toBe(false);
  expect(f.driver.quitAndInstall).not.toHaveBeenCalled();
  finish(true);
  expect(await installing).toBe(true);
  expect(f.driver.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true);
  expect(f.service.status()).toMatchObject({ phase: 'installing', installStep: 'launching' });
});
it('failed preparation keeps the downloaded installer available for retry', async () => {
  const f = fixture({ url: 'https://updates.example/' });
  await f.service.initialize();
  await f.service.check();
  await f.service.download();
  expect(
    await f.service.install(async () => {
      throw Error('configuration write failed');
    }),
  ).toBe(false);
  expect(f.service.status()).toMatchObject({ phase: 'ready', prompt: true });
  expect(f.service.status().error).toContain('configuration write failed');
  expect(f.driver.quitAndInstall).not.toHaveBeenCalled();
  expect(await f.service.install()).toBe(true);
  expect(f.service.status().error).toBeUndefined();
});
it('cancelled preparation does not launch or report failure', async () => {
  const f = fixture({ url: 'https://updates.example/' });
  await f.service.initialize();
  await f.service.check();
  await f.service.download();
  expect(await f.service.install(async () => false)).toBe(false);
  expect(f.service.status()).toMatchObject({ phase: 'ready' });
  expect(f.service.status().error).toBeUndefined();
  expect(f.driver.quitAndInstall).not.toHaveBeenCalled();
});
it('surfaces installer errors and clears the busy state', async () => {
  const f = fixture({ url: 'https://updates.example/' });
  await f.service.initialize();
  await f.service.check();
  await f.service.download();
  f.driver.quitAndInstall.mockImplementationOnce(() => {
    f.driver.emit('error', Error('installer missing'));
  });
  expect(await f.service.install()).toBe(false);
  expect(f.service.status()).toMatchObject({ phase: 'ready', prompt: true });
  expect(f.service.status().error).toContain('installer missing');
  await f.service.configure({ url: '' });
  expect(f.service.status().phase).toBe('disabled');
});
