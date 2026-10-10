import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import './build.mjs';
import electron from 'electron';
const server = await createServer();
await server.listen();
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, ELUSHELL_DEV_URL: server.resolvedUrls.local[0] },
});
child.on('exit', async () => {
  await server.close();
  process.exit();
});
