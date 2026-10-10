import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
// @ts-expect-error Local SSH fixture.
import { fixture } from '../scripts/sftp-fixture.mjs';
// @ts-expect-error Local PTY fixture.
import { deploymentFixture } from '../scripts/deployment-fixture.mjs';
import { SSHService } from '../electron/ssh';
import { ConfigStore } from '../electron/config-store';
import { RemoteFiles } from '../electron/remote-files';
import { TransferManager } from '../electron/transfers';
import { DeploymentService } from '../electron/deployment';
import { deploymentRunning, type DeploymentJob } from '../src/deployment-shared';
import { demoProfile } from './profile';

it('persists shared plans and uploads exact bytes before commands; failure and stop never report success', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'elu-deploy-'));
  const remote = path.join(root, 'remote');
  await mkdir(remote);
  const local = path.join(root, "orders release's.jar");
  await writeFile(local, 'new package bytes');
  const scripts: string[] = [],
    events: DeploymentJob[] = [];
  let outcome: 'success' | 'failure' | 'wait' = 'success',
    commandsStarted = 0;
  await mkdir(path.join(remote, 'tmp'));
  const server = await fixture(
    remote,
    deploymentFixture(
      remote,
      async (script: string, stream: any, finish: (code: number) => void) => {
        scripts.push(script);
        commandsStarted++;
        expect(
          await readFile(path.join(remote, 'home/EluShell', path.basename(local)), 'utf8'),
        ).toBe('new package bytes');
        stream.write(Buffer.from('部署输出 ✓\n'));
        if (outcome === 'wait') return;
        if (outcome === 'failure') stream.write('deployment failed\n');
        finish(outcome === 'failure' ? 7 : 0);
      },
    ),
  );
  const ssh = new SSHService(
    () => {},
    async () => true,
  );
  const store = new ConfigStore(path.join(root, '.EluShell'), {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s),
    decryptString: (s) => s.toString(),
  });
  await store.initialize();
  const files = new RemoteFiles((id) => ssh.sftp(id), new TransferManager(() => {}));
  const service = new DeploymentService(
    store,
    (id) => ssh.get(id),
    (id) => ssh.sftp(id),
    files,
    (job) => events.push(job),
    (id) => ssh.acquireScript(id),
  );
  try {
    const profile = { ...demoProfile, id: 'production', host: '127.0.0.1', port: server.port };
    const session = await ssh.connect(profile, '');
    ssh.start(session);
    await expect.poll(() => ssh.get(session).shellPid).toBe(42000);
    const plan = {
      id: randomUUID(),
      profileId: profile.id,
      name: '订单部署',
      localPath: local,
      remoteDirectory: '/home/EluShell',
      commands: 'printf "%s\\n" "$ELUSHELL_UPLOAD_PATH"\n',
      timeoutMinutes: 1,
    };
    await service.save(plan);
    expect((await service.state('other')).plans[0].id).toBe(plan.id);
    const reload = new DeploymentService(
      store,
      (id) => ssh.get(id),
      (id) => ssh.sftp(id),
      files,
      () => {},
      (id) => ssh.acquireScript(id),
    );
    expect((await reload.state(profile.id)).plans[0].localPath).toBe(local);
    const completed = await service.start(session, plan.id);
    await expect
      .poll(() => [...events].reverse().find((j) => j.id === completed.id)?.state)
      .toBe('completed');
    expect(scripts[0]).not.toContain('cd "$ELUSHELL_UPLOAD_DIR"');
    expect(scripts[0]).toContain("orders release'\\''s.jar");
    expect([...events].reverse().find((j) => j.id === completed.id)?.output).toContain(
      '部署输出 ✓',
    );
    // A missing local source never reaches a remote command channel.
    const missing = { ...plan, id: randomUUID(), localPath: path.join(root, 'missing.jar') };
    await service.save(missing);
    const failedUpload = await service.start(session, missing.id);
    await expect
      .poll(() => [...events].reverse().find((j) => j.id === failedUpload.id)?.state)
      .toBe('failed');
    expect(commandsStarted).toBe(1);
    outcome = 'failure';
    const failed = await service.start(session, plan.id);
    await expect
      .poll(() => [...events].reverse().find((j) => j.id === failed.id)?.state)
      .toBe('failed');
    expect([...events].reverse().find((j) => j.id === failed.id)?.exitCode).toBe(7);
    outcome = 'wait';
    const waiting = await service.start(session, plan.id);
    await expect.poll(() => commandsStarted).toBe(3);
    await expect(service.start(session, plan.id)).rejects.toThrow('已有部署任务');
    await service.stop(waiting.id);
    expect([...events].reverse().find((j) => j.id === waiting.id)?.state).toBe('stopped');
    expect((await service.state(profile.id)).jobs.some(deploymentRunning)).toBe(false);
    expect(service.hasSession(session)).toBe(false);
    await service.remove(plan.id);
    expect((await service.state('other')).plans.map((p) => p.id)).not.toContain(plan.id);
    expect((await service.state(profile.id)).plans.map((p) => p.id)).not.toContain(plan.id);
  } finally {
    await service.close();
    ssh.close();
    await server.close();
  }
});

it('migrates legacy plans without loss and runs one shared plan on two independent servers', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'elu-shared-deploy-'));
  const local = path.join(root, 'release.jar');
  await writeFile(local, 'shared deployment');
  const streams: any[] = [],
    events: DeploymentJob[] = [],
    changed: any[] = [];
  const roots = [path.join(root, 'server-a'), path.join(root, 'server-b')];
  const servers = [];
  for (const remote of roots) {
    await mkdir(remote);
    await mkdir(path.join(remote, 'tmp'));
    servers.push(
      await fixture(
        remote,
        deploymentFixture(
          remote,
          async (_script: string, _stream: any, finish: (code: number) => void) => {
            expect(await readFile(path.join(remote, 'home/EluShell/release.jar'), 'utf8')).toBe(
              'shared deployment',
            );
            streams.push(finish);
          },
        ),
      ),
    );
  }
  const ssh = new SSHService(
    () => {},
    async () => true,
  );
  const store = new ConfigStore(path.join(root, '.EluShell'), {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s),
    decryptString: (s) => s.toString(),
  });
  await store.initialize();
  const legacy = [
    {
      id: randomUUID(),
      profileId: 'a',
      name: 'Reusable deployment',
      localPath: local,
      remoteDirectory: '/home/EluShell',
      commands: 'echo deploy',
      timeoutMinutes: 1,
    },
    {
      id: randomUUID(),
      profileId: 'b',
      name: 'Same name is preserved',
      localPath: local,
      remoteDirectory: '/home/EluShell',
      commands: 'echo second',
      timeoutMinutes: 1,
    },
  ];
  await store.write('deployments.json', legacy);
  const files = new RemoteFiles((s) => ssh.sftp(s), new TransferManager(() => {}));
  const service = new DeploymentService(
    store,
    (s) => ssh.get(s),
    (s) => ssh.sftp(s),
    files,
    (j) => events.push(j),
    (s) => ssh.acquireScript(s),
    (plans) => changed.push(plans),
  );
  try {
    const shared = (await service.state('b')).plans;
    expect(shared).toHaveLength(2);
    expect(shared[0]).not.toHaveProperty('profileId');
    expect(await store.read('deployments.pre-shared.json', [])).toEqual(legacy);
    expect(await store.read('deployments.json', [])).toEqual(shared);
    const sessions = [];
    for (let i = 0; i < 2; i++) {
      const session = await ssh.connect(
        { ...demoProfile, id: i === 0 ? 'a' : 'b', host: '127.0.0.1', port: servers[i].port },
        '',
      );
      ssh.start(session);
      await expect.poll(() => ssh.get(session).shellPid).toBe(42000);
      sessions.push(session);
    }
    const a = await service.start(sessions[0], shared[0].id);
    const b = await service.start(sessions[1], shared[0].id);
    await expect.poll(() => streams.length).toBe(2);
    expect(a.profileId).toBe('a');
    expect(b.profileId).toBe('b');
    expect(a.host).not.toBe(b.host);
    await expect(service.start(sessions[0], shared[1].id)).rejects.toThrow('已有部署任务');
    await expect(service.remove(shared[0].id)).rejects.toThrow('方案正在执行');
    streams.forEach((finish) => finish(0));
    await expect.poll(() => events.filter((j) => j.state === 'completed').length).toBe(2);
    expect((await service.state('a')).jobs.map((j) => j.id)).toEqual([a.id]);
    expect((await service.state('b')).jobs.map((j) => j.id)).toEqual([b.id]);
    await service.save({ ...shared[0], name: 'Edited from another server' });
    expect(changed.at(-1)[0].name).toBe('Edited from another server');
    expect((await service.state('a')).plans).toEqual((await service.state('b')).plans);
    await service.remove(shared[0].id);
    expect(changed.at(-1)).toHaveLength(1);
  } finally {
    await service.close();
    ssh.close();
    for (const server of servers) await server.close();
  }
});
