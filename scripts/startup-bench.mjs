import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
const executable = path.resolve(process.argv[2]);
const label = process.argv[3] || 'startup';
const count = Number(process.argv[4] || 3);
const out = path.resolve('test-results');
await mkdir(out, { recursive: true });
const data = await mkdtemp(path.join(out, label + '-'));
const rounds = [];
for (let i = 0; i < count; i++) {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const start = performance.now();
  const child = spawn(executable, [`--remote-debugging-port=${port}`], {
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, ELUSHELL_TEST_DATA: data },
  });
  const exit = new Promise((resolve) => child.once('exit', resolve));
  let browser;
  try {
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
          } catch {
            return false;
          }
        },
        { timeout: 60000, intervals: [50] },
      )
      .toBe(true);
    const engineReady = Math.round(performance.now() - start);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = browser.contexts()[0].pages()[0];
    await page.locator('.new-tab-page').waitFor();
    await page.evaluate(() => window.elu.load());
    const ready = Math.round(performance.now() - start);
    const resources = await page
      .locator('script[src],link[rel=modulepreload]')
      .evaluateAll((nodes) => nodes.map((n) => (n.src || n.href).split('/').pop()));
    const configMtimeMs = (await stat(path.join(data, 'settings.json'))).mtimeMs;
    rounds.push({
      run: i + 1,
      engineReadyMs: engineReady,
      workspaceReadyMs: ready,
      resources,
      configMtimeMs,
    });
    console.log(JSON.stringify({ label, ...rounds.at(-1) }));
    await page.evaluate(() => window.close()).catch(() => {});
  } finally {
    await browser?.close().catch(() => {});
  }
  await exit;
}
const average = Math.round(rounds.reduce((sum, r) => sum + r.workspaceReadyMs, 0) / rounds.length);
const report = {
  executable,
  label,
  result: 'PASS',
  rounds,
  averageReadyMs: average,
  note: 'Consecutive starts on this Windows machine; includes CDP/UI polling overhead, not an OS cold-boot benchmark.',
};
await writeFile(path.join(out, label + '.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ label, averageReadyMs: average }));
