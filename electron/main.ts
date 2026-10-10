import { EditorWindows } from './editor-windows';
import { DeploymentService } from './deployment';
import { CertificateService } from './certificates';
import { NginxUpgradeService } from './nginx-upgrade';
import { ConfigStore } from './config-store';
import { AIService } from './ai';
import { createReadTool } from './ai-readonly';
import { UpdateService } from './updates';
import { ConnectionBundleSchema } from '../src/connection-sharing';
import { existsSync } from 'node:fs';
import { importBackground, readBackground } from './backgrounds';
import { TransferManager } from './transfers';
import { RemoteFiles } from './remote-files';
import { TransferDiagnostics } from './transfer-diagnostics';
import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard, Menu } from 'electron';
import { readFile, writeFile, rename, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { SSHService } from './ssh';
import { SettingsSchema, ProfileSchema } from '../src/shared';
let win: BrowserWindow;
let editors: EditorWindows;
let deployments: DeploymentService;
let certificates: CertificateService;
let nginxUpgrades: NginxUpgradeService;
let service: SSHService;
let store: ConfigStore;
let ai: AIService;
let transferDiagnostics: TransferDiagnostics;
let captures: import('./capture').CaptureService | undefined;
let captureLoading: Promise<import('./capture').CaptureService> | undefined;
let quitRequested = false;
// Isolated upgrade tests need to reconnect after the installer relaunches the app.
if (process.env.ELUSHELL_TEST_DATA && /^\d{4,5}$/.test(process.env.ELUSHELL_TEST_DEBUG_PORT || ''))
  app.commandLine.appendSwitch('remote-debugging-port', process.env.ELUSHELL_TEST_DEBUG_PORT!);
const read = <T>(name: string, fallback: T) => store.read(name, fallback);
let saving = Promise.resolve();
const atomic = (name: string, data: unknown) => {
  saving = store.write(name, data);
  return saving;
};
const id = z.string().uuid(),
  remotePath = z
    .string()
    .min(1)
    .max(4096)
    .refine((s) => !s.includes('\0'));
async function main() {
  const legacy = app.getPath('userData');
  const directory = process.env.ELUSHELL_TEST_DATA || path.join(app.getPath('home'), '.EluShell');
  store = new ConfigStore(directory, safeStorage);
  await store.initialize(process.env.ELUSHELL_TEST_DATA ? undefined : legacy);
  app.setPath('userData', directory);
  win = new BrowserWindow({
    width: 1500,
    height: 970,
    minWidth: 1060,
    minHeight: 700,
    title: 'EluShell',
    icon: path.join(
      app.isPackaged ? process.resourcesPath : app.getAppPath(),
      app.isPackaged ? 'icon.png' : 'build/icon.png',
    ),
    backgroundColor: '#f3f5f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  if (process.platform !== 'darwin')
    win.on('close', (event) => {
      if (!quitRequested) {
        event.preventDefault();
        app.quit();
      }
    });
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ]),
    );
    // Keep SSH sessions alive when the Mac window is closed; Dock click restores it.
    win.on('close', (event) => {
      if (!quitRequested) {
        event.preventDefault();
        win.hide();
      }
    });
    app.on('activate', () => {
      if (!win.isDestroyed()) {
        win.show();
        win.focus();
      }
    });
  }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  service = new SSHService(
    (event) => {
      if (!win.isDestroyed()) win.webContents.send('session-event', event);
    },
    async (host, key) => {
      const hosts = await read<Record<string, string>>('known-hosts.json', {});
      if (hosts[host] === key) return true;
      if (hosts[host]) {
        await dialog.showMessageBox(win, {
          type: 'error',
          title: '服务器身份发生变化',
          message: `${host} 的 SSH 指纹与已保存记录不符，连接已阻止。`,
          detail: `已保存：${hosts[host]}\n当前：${key}\n请与服务器管理员核实后维护 known-hosts.json。`,
        });
        return false;
      }
      const answer = await dialog.showMessageBox(win, {
        type: 'question',
        title: '首次连接 · 核对服务器身份',
        message: host,
        detail: `SHA256（十六进制）\n${key}\n请核对服务器公钥指纹。`,
        buttons: ['取消', '信任并连接'],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer.response !== 1) return false;
      hosts[host] = key;
      await atomic('known-hosts.json', hosts);
      return true;
    },
  );
  function handle(name: string, fn: (...args: any[]) => unknown) {
    ipcMain.handle(name, (event, ...args) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
        throw Error('无效来源');
      return fn(...args);
    });
  }
  handle('load', () => store.loadSettings());
  nginxUpgrades = new NginxUpgradeService(
    (id) => service.get(id).client,
    (id) => service.sftp(id),
    (job) => {
      if (!win.isDestroyed()) win.webContents.send('nginx-upgrade-event', job);
    },
  );
  certificates = new CertificateService(
    (id) => service.get(id).client,
    (job) => {
      if (!win.isDestroyed()) win.webContents.send('certificate-event', job);
    },
  );
  const checkCertificateTool = async (session: unknown) => {
    if (!(await store.loadSettings()).features.toolkit) throw Error('工具包已停用');
    const sessionId = id.parse(session);
    service.get(sessionId);
    return sessionId;
  };
  handle('certificate-inspect', async (s, source) =>
    certificates.inspect(await checkCertificateTool(s), source),
  );
  handle('certificate-prepare', async (s, options) =>
    certificates.prepare(await checkCertificateTool(s), options),
  );
  handle('certificate-start', async (s, preview) => {
    const sessionId = await checkCertificateTool(s);
    if (nginxUpgrades.isRunning()) throw Error('请等待 Nginx 升级任务完成后生成证书');
    return certificates.start(sessionId, id.parse(preview));
  });
  handle('certificate-list', async (s) => certificates.list(await checkCertificateTool(s)));
  handle('nginx-upgrade-inspect', async (s, source) => {
    const sessionId = await checkCertificateTool(s);
    if (certificates.isRunning()) throw Error('请等待证书任务完成');
    return nginxUpgrades.inspect(sessionId, source);
  });
  handle('nginx-upgrade-start', async (s, preview) => {
    const sessionId = await checkCertificateTool(s);
    if (certificates.isRunning()) throw Error('请等待证书任务完成');
    return nginxUpgrades.start(sessionId, id.parse(preview));
  });
  handle('nginx-upgrade-list', async (s) => nginxUpgrades.list(await checkCertificateTool(s)));
  const captureService = async () => {
    if (!(await store.loadSettings()).features.toolkit)
      throw Error('工具包已停用，请在功能与性能设置中开启');
    const result =
      captures ??
      (await (captureLoading ??= import('./capture').then(({ CaptureService }) => {
        captures = new CaptureService(
          path.join(store.directory, 'captures'),
          (id) => service.get(id).client,
          (job) => {
            if (!win.isDestroyed()) win.webContents.send('capture-event', job);
          },
        );
        return captures;
      })));
    if (!(await store.loadSettings()).features.toolkit) {
      await result.setEnabled(false);
      throw Error('工具包已停用');
    }
    return result;
  };
  handle('capture-check', async (s, sudo) =>
    (await captureService()).check(id.parse(s), z.boolean().parse(sudo)),
  );
  handle('capture-remove', async (s) => (await captureService()).remove(id.parse(s)));
  handle('capture-list', async () => (await captureService()).list());
  handle('capture-start', async (s, options) => {
    const session = service.get(id.parse(s));
    return (await captureService()).start(s, session.profile.name, session.profile.host, options);
  });
  handle('capture-stop', (job) => captures?.stop(id.parse(job)));
  handle('capture-stop-session', (s) => captures?.stopSession(id.parse(s)));
  handle('capture-export', async (job) => {
    const source = await (await captureService()).file(id.parse(job));
    const result = await dialog.showSaveDialog(win, {
      title: '下载 PCAP',
      defaultPath: path.basename(source),
      filters: [{ name: 'PCAP 抓包文件', extensions: ['pcap'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const { copyFile } = await import('node:fs/promises');
    if (path.resolve(result.filePath) !== path.resolve(source))
      await copyFile(source, result.filePath);
    return result.filePath;
  });
  handle('capture-open', async (job) => {
    const source = await (await captureService()).file(id.parse(job));
    const error = await shell.openPath(source);
    if (error)
      throw Error('无法打开 PCAP，请安装 Wireshark 并将其设为 .pcap 文件的默认打开程序。' + error);
  });
  handle('capture-ports', async (s, pid) => {
    const sessionId = id.parse(s),
      processId = z.number().int().min(1).max(2147483647).parse(pid);
    const output = await service.exec(sessionId, 'ss -H -lntup 2>/dev/null');
    return [
      ...new Set(
        output
          .split('\n')
          .filter((line) => line.includes(`pid=${processId},`))
          .map((line) =>
            Number(
              line
                .trim()
                .split(/\s+/)[4]
                ?.match(/:(\d+)$/)?.[1],
            ),
          )
          .filter((port) => port > 0 && port < 65536),
      ),
    ];
  });
  ai = new AIService(
    store,
    safeStorage,
    (e) => {
      if (!win.isDestroyed()) win.webContents.send('ai-event', e);
    },
    !!process.env.ELUSHELL_TEST_DATA,
    fetch,
    createReadTool(
      (id) => service.sftp(id),
      (id, command, signal) => service.exec(id, command, signal),
    ),
  );
  await ai.setEnabled((await store.loadSettings()).features.ai);
  handle('ai-image', (value) => ai.image(value));
  handle('ai-state', () => ai.state());
  handle('ai-configure', (c, k) => ai.configure(c, k));
  handle('ai-create', (p) => ai.create(p));
  handle('ai-get', (chat) => ai.get(chat));
  handle('ai-send', (chat, input, retry) =>
    ai.send(chat, input, z.boolean().optional().parse(retry)),
  );
  handle('ai-cancel', (chat) => ai.cancel(chat));
  handle('ai-rename', (chat, title) => ai.rename(chat, title));
  handle('ai-delete', (chat) => ai.remove(chat));
  handle('read-clipboard', () => clipboard.readText());
  handle('write-clipboard', (text) => clipboard.writeText(z.string().max(2_000_000).parse(text)));
  handle('choose-background', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: '选择背景图片',
      properties: ['openFile'],
      filters: [{ name: '背景图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    return result.canceled || !result.filePaths[0]
      ? null
      : importBackground(store.directory, result.filePaths[0]);
  });
  handle('background-image', (image) => readBackground(store.directory, image));
  handle('save', async (s) => {
    const settings = SettingsSchema.parse(s);
    if (!settings.features.toolkit && (certificates.isRunning() || nginxUpgrades.isRunning()))
      throw Error('证书或 Nginx 升级任务执行期间不能停用工具包');
    await atomic('settings.json', settings);
    await editors?.configure(settings);
    await ai.setEnabled(settings.features.ai);
    await captures?.setEnabled(settings.features.toolkit);
    if (!settings.features.toolkit) await deployments?.close();
  });
  handle('credential-status', (p) => store.credentialStatus(ProfileSchema.parse(p)));
  handle('save-credential', (p, secret, remember) =>
    store.saveCredential(
      ProfileSchema.parse(p),
      z.string().max(32768).parse(secret),
      z.boolean().parse(remember),
    ),
  );
  handle('connect', async (p, secret) => {
    p = ProfileSchema.parse(p);
    if (p.demo) throw Error('演示连接已移除');
    secret = z.string().max(32768).parse(secret);
    return service.connect(p, secret || (await store.secret(p)));
  });
  handle('config-info', async () => ({
    directory: store.directory,
    exportDirectory: await exportDirectory(),
    downloadDirectory: await downloadDirectory(),
    encrypted: safeStorage.isEncryptionAvailable(),
  }));
  handle('show-config-directory', () => shell.openPath(store.directory));
  const exportDirectory = async () =>
    (await read('exports.json', { directory: path.join(store.directory, 'exports') })).directory;
  handle('choose-export-directory', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: await exportDirectory(),
    });
    if (!r.canceled && r.filePaths[0]) await atomic('exports.json', { directory: r.filePaths[0] });
    return exportDirectory();
  });
  handle('export-connections', async (value, includePasswords = true) => {
    const s = value === undefined ? await store.loadSettings() : SettingsSchema.parse(value),
      dir = await exportDirectory();
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, 'connections-' + Date.now() + '.json');
    const bundle = await store.exportConnections(s, z.boolean().parse(includePasswords));
    const content = JSON.stringify(bundle, null, 2);
    if (Buffer.byteLength(content, 'utf8') > 5 * 1024 * 1024)
      throw Error('连接配置不能超过 5 MB，请减少连接内容后重试');
    await writeFile(target, content, { flag: 'wx', mode: 0o600 });
    return target;
  });
  handle('choose-connection-import', async () => {
    const picked = await dialog.showOpenDialog(win, {
      title: '导入 EluShell 连接配置',
      properties: ['openFile'],
      filters: [{ name: 'EluShell 连接配置', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const file = await open(picked.filePaths[0], 'r');
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 5 * 1024 * 1024)
        throw Error('请选择不超过 5 MB 的 JSON 配置文件');
      // Bounded read also protects against a file growing after stat.
      const bytes = Buffer.alloc(5 * 1024 * 1024 + 1);
      let length = 0;
      while (length < bytes.length) {
        const r = await file.read(bytes, length, bytes.length - length, null);
        if (!r.bytesRead) break;
        length += r.bytesRead;
      }
      if (length > 5 * 1024 * 1024) throw Error('连接配置不能超过 5 MB');
      try {
        return ConnectionBundleSchema.parse(
          JSON.parse(
            bytes
              .subarray(0, length)
              .toString('utf8')
              .replace(/^\uFEFF/, ''),
          ),
        );
      } catch {
        throw Error('配置格式无效，请选择 EluShell 导出的版本 1 或版本 2 连接 JSON 文件');
      }
    } finally {
      await file.close();
    }
  });
  handle('import-connections', async (bundle, current) => {
    return store.importConnections(SettingsSchema.parse(current), bundle);
  });
  handle('processes', (s) => service.processes(id.parse(s)));
  handle('terminate-process', async (s, pid, start) => {
    id.parse(s);
    pid = z.number().int().min(2).max(2147483647).parse(pid);
    start = z.string().regex(/^\d+$/).parse(start);
    const process = await service.processIdentity(s, pid);
    if (process.start !== start) throw Error('进程已退出或 PID 已被复用，请刷新列表');
    const answer = await dialog.showMessageBox(win, {
      type: 'warning',
      message: '终止此进程？',
      detail: `PID ${pid} · ${process.name}\n将发送 SIGTERM，按当前 SSH 用户权限执行。`,
      buttons: ['取消', '终止进程'],
      cancelId: 0,
      defaultId: 0,
    });
    if (answer.response !== 1) return false;
    await service.terminateProcess(s, pid, start);
    return true;
  });
  handle('start', (s) => service.start(id.parse(s), true));
  handle('terminal-ack', (s, sequence) =>
    service.ack(id.parse(s), z.number().int().positive().parse(sequence)),
  );
  win.webContents.on('render-process-gone', () => service.close());
  handle('disconnect', async (s, keepEditors = true) => {
    z.boolean().parse(keepEditors);
    if (certificates.hasSession(s)) throw Error('此连接正在生成证书，请等待任务完成再断开');
    if (nginxUpgrades.hasSession(s))
      throw Error('此连接正在检测或升级 Nginx，请等待任务完成再断开');
    if (deployments.hasSession(s)) throw Error('此连接正在部署，请先完成或停止部署任务');
    await captures?.stopSession(id.parse(s));
    if (!keepEditors || !editors.deferDisconnect(s)) service.disconnect(s);
  });
  handle('write', (s, data) => service.write(id.parse(s), z.string().max(65536).parse(data)));
  handle('resize', (s, cols, rows) =>
    service.resize(
      id.parse(s),
      z.number().int().min(1).max(1000).parse(cols),
      z.number().int().min(1).max(1000).parse(rows),
    ),
  );
  handle('metrics', (s) => service.metrics(id.parse(s)));
  handle('cwd', (s) => service.cwd(id.parse(s)));
  handle('realpath', (s, p) => service.realpath(id.parse(s), remotePath.parse(p)));
  handle('files', (s, p) => service.files(id.parse(s), remotePath.parse(p)));
  handle('complete', (s, p) => service.complete(id.parse(s), remotePath.parse(p)));
  handle('pick-key', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择 SSH 私钥',
      properties: ['openFile'],
    });
    return r.filePaths[0] || '';
  });
  transferDiagnostics = new TransferDiagnostics(store.directory, app.getVersion());
  const transfers = new TransferManager((event) => {
    if (!win.isDestroyed()) win.webContents.send('transfer-event', event);
  }, transferDiagnostics);
  const remote = new RemoteFiles(
    (s) => service.sftp(s),
    transfers,
    (id) => {
      const { profile } = service.get(id);
      return {
        host: profile.host,
        port: profile.port,
        loginUsername: profile.username,
        authMethod: profile.auth,
      };
    },
  );
  const downloadDirectory = async () =>
    (await read('downloads.json', { directory: path.join(app.getPath('desktop'), 'esdownload') }))
      .directory;
  handle('download-directory', downloadDirectory);
  handle('choose-download-directory', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: await downloadDirectory(),
    });
    if (!r.canceled && r.filePaths[0])
      await atomic('downloads.json', { directory: r.filePaths[0] });
    return downloadDirectory();
  });
  handle('show-download-directory', async () => {
    const p = await downloadDirectory();
    await mkdir(p, { recursive: true });
    await shell.openPath(p);
  });
  handle('transfer-list', () => transfers.list());
  handle('export-transfer-diagnostics', async () => {
    const result = await dialog.showSaveDialog(win, {
      title: '导出诊断日志（含服务器地址、账号与文件路径）',
      defaultPath: path.join(
        app.getPath('downloads'),
        `EluShell-${app.getVersion()}-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
      ),
      filters: [{ name: 'EluShell 诊断日志', extensions: ['jsonl'] }],
    });
    if (result.canceled || !result.filePath) return '';
    await transferDiagnostics.exportTo(result.filePath);
    shell.showItemInFolder(result.filePath);
    return result.filePath;
  });
  handle('cancel-transfer', (t) => transfers.cancel(id.parse(t)));
  handle('show-transfer', (t) => {
    const job = transfers.list().find((j) => j.id === id.parse(t));
    if (job?.localPath) shell.showItemInFolder(job.localPath);
  });
  for (const folder of [false, true])
    handle(folder ? 'upload-folder' : 'upload', async (s, p) => {
      id.parse(s);
      remotePath.parse(p);
      const r = await dialog.showOpenDialog(win, {
        title: folder ? '上传文件夹' : '上传文件',
        properties: [folder ? 'openDirectory' : 'openFile'],
      });
      if (r.canceled || !r.filePaths[0]) return '';
      return remote.upload(s, r.filePaths[0], p, async () => true);
    });
  handle('upload-dropped', async (s, p, value) => {
    id.parse(s);
    remotePath.parse(p);
    service.get(s);
    const localFiles = z
      .array(
        z
          .string()
          .min(1)
          .max(32768)
          .refine((file) => path.isAbsolute(file) && !file.includes('\0')),
      )
      .min(1)
      .max(100)
      .parse(value);
    // Paths originate from native File objects in preload, never from web-provided text.
    const results: string[] = [];
    for (const file of [...new Set(localFiles)])
      results.push(await remote.upload(s, file, p, async () => true));
    return results;
  });
  handle('download', async (s, p) =>
    remote.download(id.parse(s), remotePath.parse(p), await downloadDirectory()),
  );
  handle('download-many', async (s, paths) =>
    remote.downloadMany(
      id.parse(s),
      [...new Set(z.array(remotePath).min(1).max(20000).parse(paths))],
      await downloadDirectory(),
    ),
  );
  handle('file-action', async (s, value) => {
    const action = z
      .object({
        kind: z.enum(['rename', 'mkdir', 'touch', 'delete', 'chmod']),
        path: remotePath,
        name: z.string().max(255).optional(),
        mode: z.number().int().min(0).max(4095).optional(),
        recursive: z.boolean().optional(),
      })
      .parse(value);
    id.parse(s);
    await remote.action(s, action);
  });
  handle('file-actions', (s, value) =>
    remote.actions(
      id.parse(s),
      z
        .object({
          kind: z.enum(['delete', 'chmod']),
          paths: z.array(remotePath).min(1).max(20000),
          mode: z.number().int().min(0).max(4095).optional(),
          recursive: z.boolean().optional(),
        })
        .parse(value),
    ),
  );
  handle('move-files', (s, paths, directory) =>
    remote.moveMany(
      id.parse(s),
      z.array(remotePath).min(1).max(20000).parse(paths),
      remotePath.parse(directory),
    ),
  );
  editors = new EditorWindows(
    remote,
    () => store.loadSettings(),
    (s) => service.disconnect(s),
    path.join(
      app.isPackaged ? process.resourcesPath : app.getAppPath(),
      app.isPackaged ? 'icon.png' : 'build/icon.png',
    ),
  );
  deployments = new DeploymentService(
    store,
    (s) => service.get(s),
    (s) => service.sftp(s),
    remote,
    (job) => {
      if (!win.isDestroyed()) win.webContents.send('deployment-event', job);
    },
    (s) => service.acquireScript(s),
    (plans) => {
      if (!win.isDestroyed()) win.webContents.send('deployment-plans-event', plans);
    },
  );
  handle('deployment-state', (s) => deployments.state(service.get(id.parse(s)).profile.id));
  handle('deployment-save', (s, plan) => {
    service.get(id.parse(s));
    return deployments.save(plan);
  });
  handle('deployment-remove', (s, plan) => {
    service.get(id.parse(s));
    return deployments.remove(id.parse(plan));
  });
  handle('deployment-start', async (s, plan) => {
    if (!(await store.loadSettings()).features.toolkit) throw Error('工具包已停用');
    return deployments.start(id.parse(s), id.parse(plan));
  });
  handle('deployment-stop', (job) => deployments.stop(id.parse(job)));
  handle('deployment-pick', async (value) => {
    const kind = z.enum(['file', 'directory']).parse(value);
    const result = await dialog.showOpenDialog(win, {
      title: kind === 'file' ? '选择部署文件' : '选择部署目录',
      properties: [kind === 'file' ? 'openFile' : 'openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  handle('open-editor', (s, p) =>
    editors.open(id.parse(s), remotePath.parse(p), service.get(s).profile),
  );
  handle('open-text', (s, p) => remote.openText(id.parse(s), remotePath.parse(p)));
  handle('save-text', (d, t) => remote.saveText(id.parse(d), z.string().max(4194304).parse(t)));
  handle('close-text', (d) => remote.closeText(id.parse(d)));
  const updates = new UpdateService(
    store,
    app.getVersion(),
    process.platform === 'win32' && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE,
    async (url) => {
      const { NsisUpdater } = await import('electron-updater');
      const updater = new NsisUpdater({ provider: 'generic', url, useMultipleRangeRequest: false });
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.autoRunAppAfterInstall = true;
      updater.allowDowngrade = false;
      updater.allowPrerelease = false;
      updater.disableWebInstaller = true;
      updater.logger = null;
      updater.netSession.webRequest.onBeforeRequest((details, callback) => {
        const target = new URL(details.url);
        callback({
          cancel: !['https:', ...(updates.status().config.allowHttp ? ['http:'] : [])].includes(
            target.protocol,
          ),
        });
      });
      return Object.assign(updater, {
        stopRequests: () => {
          void updater.netSession.closeAllConnections();
        },
      });
    },
    (state) => {
      if (!win.isDestroyed()) win.webContents.send('update-event', state);
    },
  );
  const updatesReady = updates.initialize();
  handle('open-update-guide', () =>
    shell.openExternal('http://47.105.176.1:8800/elushell-updates/#mac-update'),
  );
  handle('update-status', async () => {
    await updatesReady;
    return updates.status();
  });
  handle('configure-updates', async (p) => {
    await updatesReady;
    return updates.configure(p);
  });
  handle('check-update', async () => {
    await updatesReady;
    return updates.check(true);
  });
  handle('download-update', () => updates.download());
  handle('cancel-update', () => updates.cancel());
  handle('dismiss-update', (ignore) => updates.dismiss(z.boolean().parse(ignore)));
  let installingUpdate = false;
  handle('install-update', async () => {
    if (installingUpdate) return false;
    installingUpdate = true;
    try {
      if (updates.status().phase !== 'ready') throw Error('请先下载更新');
      if (deployments.isRunning()) throw Error('请先完成或停止部署任务再安装更新');
      if (certificates.isRunning()) throw Error('请等待证书任务完成再安装更新');
      if (nginxUpgrades.isRunning()) throw Error('请等待 Nginx 升级任务完成再安装更新');
      if (!existsSync(path.join(path.dirname(app.getPath('exe')), 'Uninstall EluShell.exe')))
        throw Error('应用内安装更新需要先使用 Setup 安装包安装 EluShell');
      if (transfers.list().some((t) => ['preparing', 'running'].includes(t.state)))
        throw Error('有文件正在传输，请完成或取消传输后再安装更新');
      if (
        captures &&
        (await captures.list()).some((t) => ['starting', 'running', 'stopping'].includes(t.state))
      )
        throw Error('正在抓包，请停止采集后再安装更新');
      const canClose = await win.webContents.executeJavaScript(
        "window.dispatchEvent(new Event('elushell-before-update', {cancelable:true}))",
      );
      if (!canClose || editors.hasUnsaved())
        throw Error('编辑器有未保存修改，请先保存或关闭编辑器');
      if (
        service.sessions.size &&
        (
          await dialog.showMessageBox(win, {
            type: 'question',
            title: '重启安装更新',
            message: '安装更新需要重启 EluShell，当前 SSH 会话将断开。',
            buttons: ['取消', '重启并安装'],
            defaultId: 0,
            cancelId: 0,
          })
        ).response !== 1
      )
        return false;
      return await updates.install(async () => {
        await Promise.all([saving, store.flush()]);
        await store.write(
          `settings.pre-update-${app.getVersion()}.json`,
          await store.loadSettings(),
        );
        await store.flush();
        return true;
      });
    } finally {
      installingUpdate = false;
    }
  });
  win.webContents.on('will-prevent-unload', (event) => {
    if (
      dialog.showMessageBoxSync(win, {
        type: 'warning',
        message: '编辑器有未保存的修改，仍要退出？',
        buttons: ['取消', '放弃并退出'],
        defaultId: 0,
        cancelId: 0,
      }) === 1
    )
      event.preventDefault();
    else {
      quitRequested = false;
      quitting = false;
    }
  });
  if (process.env.ELUSHELL_DEV_URL) await win.loadURL(process.env.ELUSHELL_DEV_URL);
  else await win.loadFile(path.join(__dirname, '../dist/index.html'));
  void updatesReady
    .then(() => {
      const timer = setTimeout(() => {
        void updates.check(false);
      }, 3000);
      timer.unref();
    })
    .catch(() => {});
}
app.whenReady().then(main);
let quitting = false;
app.on('before-quit', (event) => {
  if (!quitting && (certificates?.isRunning() || nginxUpgrades?.isRunning())) {
    event.preventDefault();
    quitRequested = false;
    dialog.showMessageBoxSync(win, {
      message: '证书或 Nginx 升级任务正在执行，请等待完成再退出。',
    });
    return;
  }
  if (!quitting && deployments?.isRunning()) {
    event.preventDefault();
    quitRequested = false;
    dialog.showMessageBoxSync(win, {
      message: '部署任务正在执行，请先完成或在部署工具中停止任务再退出。',
    });
    return;
  }
  if (!quitting && editors && !editors.confirmQuit(win)) {
    event.preventDefault();
    quitRequested = false;
    return;
  }
  quitRequested = true;
  if (quitting) return;
  event.preventDefault();
  void Promise.allSettled([saving, ai?.close(), captures?.close(), transferDiagnostics?.flush()])
    .then(() => store?.flush())
    .finally(() => {
      quitting = true;
      app.quit();
    });
});
app.on('window-all-closed', () => {
  service?.close();
  app.quit();
});
