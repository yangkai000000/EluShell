import { chromium, expect } from '@playwright/test';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
const executable = path.resolve(process.argv[2]),
  out = path.resolve('test-results');
if (!executable.toLowerCase().startsWith((out + path.sep).toLowerCase()))
  throw Error('Upgrade test must target a workspace test installation');
const resume = process.argv[3];
const data = resume ? path.resolve(resume) : await mkdtemp(path.join(out, 'native-upgrade-data-'));
if (!data.toLowerCase().startsWith((out + path.sep).toLowerCase()))
  throw Error('Invalid test data directory');
const user = path.join(data, '.EluShell'),
  cache = path.join(data, 'cache');
await mkdir(cache, { recursive: true });
const published = new Set([
  'latest.yml',
  'EluShell-Setup-0.7.1-x64.exe',
  'EluShell-Setup-0.7.0-x64.exe.blockmap',
  'EluShell-Setup-0.7.1-x64.exe.blockmap',
]);
const server = createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1);
    if (!published.has(name)) {
      res.statusCode = 404;
      return res.end();
    }
    const file = path.resolve('release', name),
      size = (await stat(file)).size;
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0,
      end = range?.[2] ? Number(range[2]) : size - 1;
    if (start > end || end >= size) {
      res.statusCode = 416;
      return res.end();
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', end - start + 1);
    if (range) {
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    createReadStream(file, { start, end }).pipe(res);
  } catch {
    res.statusCode = 500;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const probe = netServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const env = {
  ...process.env,
  ELUSHELL_TEST_DATA: user,
  ELUSHELL_TEST_DEBUG_PORT: String(port),
  LOCALAPPDATA: cache,
};
if (!resume)
  spawn(executable, [`--remote-debugging-port=${port}`], {
    env,
    windowsHide: true,
    stdio: 'ignore',
  });
let browser,
  page,
  lastDebugger = '';
const connect = async () => {
  await expect
    .poll(
      async () => {
        let candidate;
        try {
          const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
          if (info.webSocketDebuggerUrl === lastDebugger) return false;
          candidate = await chromium.connectOverCDP(info.webSocketDebuggerUrl, { timeout: 2000 });
          const first = candidate.contexts()[0].pages()[0];
          if (!first) throw Error('Window not ready');
          await first.locator('.new-tab-page').waitFor({ timeout: 2000 });
          browser = candidate;
          page = first;
          lastDebugger = info.webSocketDebuggerUrl;
          return true;
        } catch {
          await candidate?.close().catch(() => {});
          return false;
        }
      },
      { timeout: 90000, intervals: [250] },
    )
    .toBe(true);
};
try {
  if (!resume) {
    await connect();
    expect((await page.evaluate(() => window.elu.updateStatus())).currentVersion).toBe('0.7.0');
    await page.evaluate(async () => {
      const s = await window.elu.load();
      s.history['upgrade-test'] = ['echo configuration-survived'];
      s.appearance.terminalFontSize = 17;
      await window.elu.save(s);
    });
    await page.evaluate(
      (url) => window.elu.configureUpdates({ url, allowHttp: true, autoCheck: true }),
      url,
    );
    await page.evaluate(() => window.elu.checkUpdate());
    expect((await page.evaluate(() => window.elu.updateStatus())).version).toBe('0.7.1');
    await page.evaluate(() => window.elu.downloadUpdate());
    expect((await page.evaluate(() => window.elu.updateStatus())).phase).toBe('ready');
    await page.screenshot({ path: path.join(out, 'native-update-before.png') });
    console.log(
      'Downloaded actual 0.7.1 installer; applying update to isolated 0.7.0 installation.',
    );
    await page
      .getByRole('dialog', { name: '软件更新' })
      .getByRole('button', { name: '重启并安装' })
      .click();
    await expect
      .poll(
        async () => {
          try {
            return !(await page.evaluate(() => true));
          } catch {
            return true;
          }
        },
        { timeout: 15000 },
      )
      .toBe(true);
    await browser.close().catch(() => {});
  }
  // NSIS launches through Explorer, which drops test-only environment variables.
  // Verify its automatic --updated process, then reopen with the isolated data directory for UI assertions.
  const quotePS = (s) => "'" + s.replace(/'/g, "''") + "'";
  const powershell = process.env.SystemRoot + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const owned = `Get-CimInstance Win32_Process -Filter \"Name = 'EluShell.exe'\" | Where-Object { $_.ExecutablePath -eq ${quotePS(executable)} }`;
  const runPS = (command) =>
    promisify(execFile)(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
    });
  const expectedHash = createHash('sha256')
    .update(await readFile('release/win-unpacked/resources/app.asar'))
    .digest('hex');
  await expect
    .poll(
      async () => {
        try {
          return createHash('sha256')
            .update(await readFile(path.join(path.dirname(executable), 'resources/app.asar')))
            .digest('hex');
        } catch {
          return '';
        }
      },
      { timeout: 90000 },
    )
    .toBe(expectedHash);
  await expect
    .poll(
      async () =>
        (
          await runPS(`@(${owned} | Where-Object { $_.CommandLine -like '*--updated' }).Count`)
        ).stdout.trim(),
      { timeout: 60000 },
    )
    .not.toBe('0');
  const savedUrl = JSON.parse(await readFile(path.join(user, 'updates.json'), 'utf8')).url;
  await runPS(`${owned} | ForEach-Object { Stop-Process -Id $_.ProcessId }`);
  spawn(executable, [`--remote-debugging-port=${port}`], {
    env,
    windowsHide: true,
    stdio: 'ignore',
  });
  await connect();
  await expect
    .poll(() => page.evaluate(() => window.elu.updateStatus().then((s) => s.currentVersion)), {
      timeout: 60000,
    })
    .toBe('0.7.1');
  const settings = await page.evaluate(() => window.elu.load());
  expect(settings.history['upgrade-test']).toEqual(['echo configuration-survived']);
  expect(settings.appearance.terminalFontSize).toBe(17);
  const updateConfig = JSON.parse(await readFile(path.join(user, 'updates.json'), 'utf8'));
  expect(updateConfig.url).toBe(savedUrl);
  await stat(path.join(user, 'settings.pre-update-0.7.0.json'));
  await page.getByTitle('工作区设置', { exact: true }).click();
  await expect(page.locator('.update-settings')).toContainText('当前版本 0.7.1');
  await page.screenshot({ path: path.join(out, 'native-update-after.png') });
  await page.evaluate(() =>
    window.elu.configureUpdates({ url: '', allowHttp: false, autoCheck: false }),
  );
  const report = {
    result: 'PASS',
    from: '0.7.0',
    to: '0.7.1',
    executable,
    configDirectory: user,
    checks: [
      'actual NSIS installation upgrade',
      'actual installer download and integrity verification',
      'user-initiated restart and automatic new-version --updated process',
      'installed application hash matches release',
      'command history and appearance preserved',
      'update preferences preserved',
      'pre-upgrade settings backup',
    ],
    note: 'NSIS Explorer relaunch does not retain test environment variables. Its automatic process was verified, then reopened using isolated test data for UI/configuration checks.',
  };
  await writeFile(path.join(out, 'native-upgrade-v07.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await page.evaluate(() => window.close()).catch(() => {});
} catch (e) {
  await page?.screenshot({ path: path.join(out, 'native-upgrade-failure.png') }).catch(() => {});
  throw e;
} finally {
  await browser?.close().catch(() => {});
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
