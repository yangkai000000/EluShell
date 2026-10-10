import { z } from 'zod';
import type { UpdatePreferences, UpdateStatus } from './update-shared';
export const TunnelSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['local', 'remote']),
  bindHost: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[\w.:[\]-]+$/),
  bindPort: z.number().int().min(1).max(65535),
  targetHost: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[\w.:[\]-]+$/),
  targetPort: z.number().int().min(1).max(65535),
  enabled: z.boolean(),
});
export type Tunnel = z.infer<typeof TunnelSchema>;
export const ProfileSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(80),
  host: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9.:[\]_-]+$/),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1).max(80),
  group: z.string().max(80),
  folderId: z.string().optional(),
  tags: z.array(z.string().max(30)).max(20),
  auth: z.enum(['password', 'key', 'agent']),
  privateKeyPath: z.string().max(2048).optional(),
  startup: z.string().max(8000),
  autoStartup: z.boolean(),
  demo: z.boolean().optional(),
  tunnels: z.array(TunnelSchema).max(30).optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;
export type Snippet = {
  id: string;
  name: string;
  command: string;
  tags: string[];
  serverId?: string;
  folderId?: string;
  appendNewline?: boolean;
};
export const DEFAULT_COMMAND_FOLDER = 'commands-default';
export const FolderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  parentId: z.string().optional(),
});
export type ConnectionFolder = z.infer<typeof FolderSchema>;
export const BackgroundSchema = z.object({
  kind: z.enum(['color', 'image']).default('color'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  image: z
    .string()
    .regex(/^[a-f0-9]{64}\.png$/)
    .optional(),
  imageName: z.string().max(255).optional(),
});
export const AppearanceSchema = z.object({
  uiFont: z.string().trim().min(1).max(200).default('"Segoe UI", "Microsoft YaHei", sans-serif'),
  uiFontSize: z.number().int().min(10).max(18).default(12),
  terminalFont: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default('"Cascadia Code", Consolas, "Microsoft YaHei", monospace'),
  terminalFontSize: z.number().int().min(9).max(32).default(13),
  workspace: BackgroundSchema.default({ kind: 'color', color: '#f3f5f8' }),
  includeTerminal: z.boolean().default(false),
  terminal: BackgroundSchema.default({ kind: 'color', color: '#101923' }),
});
export type Appearance = z.infer<typeof AppearanceSchema>;
export type Background = z.infer<typeof BackgroundSchema>;
export const CommandWorkspaceSchema = z.object({
  folderId: z.string().default(DEFAULT_COMMAND_FOLDER),
  editorVisible: z.boolean().default(true),
  editorWidth: z.number().int().min(220).max(650).default(310),
  draft: z.string().max(8000).default(''),
  target: z.enum(['current', 'all']).default('current'),
  clearAfterSend: z.boolean().default(true),
  appendNewline: z.boolean().default(true),
  ctrlEnterSend: z.boolean().default(true),
  fontSize: z.number().int().min(9).max(28).default(12),
  wordWrap: z.boolean().default(true),
});
export type CommandWorkspaceSettings = z.infer<typeof CommandWorkspaceSchema>;
export const FeatureSchema = z.object({
  monitoring: z.boolean().default(true),
  directoryTree: z.boolean().default(true),
  directoryFollow: z.boolean().default(true),
  ai: z.boolean().default(true),
  backgroundImages: z.boolean().default(true),
  commandHistory: z.boolean().default(true),
  transferAutoOpen: z.boolean().default(true),
  toolkit: z.boolean().default(true),
});
export const PerformanceSchema = z.object({
  scrollback: z.number().int().min(0).max(10000).default(2000),
  historyCells: z.number().int().min(100000).max(4000000).default(1000000),
  pauseWhenHidden: z.boolean().default(true),
});
export const SettingsSchema = z
  .object({
    profiles: z.array(ProfileSchema).max(1000),
    folders: z.array(FolderSchema).max(1000).default([]),
    snippets: z
      .array(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(100),
          command: z.string().min(1).max(8000),
          tags: z.array(z.string()),
          serverId: z.string().optional(),
          folderId: z.string().optional(),
          appendNewline: z.boolean().optional(),
        }),
      )
      .max(1000),
    commandFolders: z
      .array(FolderSchema)
      .max(1000)
      .default([{ id: DEFAULT_COMMAND_FOLDER, name: '默认分类' }]),
    commandLibraryVersion: z.number().int().min(0).max(1).default(0),
    commandWorkspace: CommandWorkspaceSchema.default({}),
    history: z.record(z.array(z.string().max(8000)).max(100)),
    recentConnections: z
      .array(z.object({ profileId: z.string().min(1), at: z.number().finite().nonnegative() }))
      .max(100)
      .default([]),
    sessionNameMode: z.enum(['name', 'ip']).default('name'),
    pollSeconds: z.number().min(2).max(60),
    appearance: AppearanceSchema.default({}),
    features: FeatureSchema.default({}),
    performance: PerformanceSchema.default({}),
  })
  .superRefine((s, ctx) => {
    const ids = new Set(s.folders.map((f) => f.id));
    if (ids.size !== s.folders.length) ctx.addIssue({ code: 'custom', message: '文件夹 ID 重复' });
    for (const f of s.folders) {
      const seen = new Set([f.id]);
      let p = f.parentId;
      while (p) {
        if (seen.has(p) || !ids.has(p)) {
          ctx.addIssue({ code: 'custom', message: '文件夹层级无效' });
          break;
        }
        seen.add(p);
        p = s.folders.find((x) => x.id === p)?.parentId;
      }
    }
    for (const p of s.profiles)
      if (p.folderId && !ids.has(p.folderId))
        ctx.addIssue({ code: 'custom', message: '连接的文件夹不存在' });
    const commandIds = new Set(s.commandFolders.map((f) => f.id));
    if (commandIds.size !== s.commandFolders.length || !commandIds.has(DEFAULT_COMMAND_FOLDER))
      ctx.addIssue({ code: 'custom', message: '命令分类无效，必须保留默认分类' });
    for (const f of s.commandFolders) {
      const seen = new Set([f.id]);
      let parent = f.parentId;
      while (parent) {
        if (seen.has(parent) || !commandIds.has(parent)) {
          ctx.addIssue({ code: 'custom', message: '命令分类层级无效' });
          break;
        }
        seen.add(parent);
        parent = s.commandFolders.find((x) => x.id === parent)?.parentId;
      }
    }
    for (const command of s.snippets)
      if (command.folderId && !commandIds.has(command.folderId))
        ctx.addIssue({ code: 'custom', message: '命令的分类不存在' });
    if (new Set(s.snippets.map((c) => c.id)).size !== s.snippets.length)
      ctx.addIssue({ code: 'custom', message: '命令 ID 重复' });
  });
export type Settings = z.infer<typeof SettingsSchema>;
export type RemoteProcess = {
  pid: number;
  user: string;
  cpu: number;
  memory: number;
  state: string;
  name: string;
  command: string;
  executable: string;
  cwd: string;
  location: string;
  locationSource: 'entry' | 'cwd' | 'executable' | 'unknown';
  start: string;
};
export type ConfigInfo = {
  directory: string;
  exportDirectory: string;
  downloadDirectory: string;
  encrypted: boolean;
};
export const emptyProfile: Profile = {
  id: '',
  name: '尚未连接',
  host: '',
  port: 22,
  username: '',
  group: '',
  tags: [],
  auth: 'password',
  startup: '',
  autoStartup: false,
};
export type Cpu = { name: string; idle: number; total: number };
export type Metrics = {
  at: number;
  hostname: string;
  os: string;
  uptime: number;
  load: number[];
  cpu: number;
  cores: number[];
  memory: { total: number; available: number; cached: number; swapTotal: number; swapFree: number };
  disks: { path: string; total: number; used: number; percent: number }[];
  network: { name: string; rx: number; tx: number; rxRate: number; txRate: number }[];
  processes: { pid: number; user: string; cpu: number; memory: number; command: string }[];
  routes: string;
  sockets: string;
  diskIO: string;
  rawCpu: Cpu[];
};
export function primaryInterface(metrics: Metrics) {
  const defaultName = metrics.routes.match(/^default\b.*?\bdev\s+(\S+)/m)?.[1];
  return (
    metrics.network.find((n) => n.name === defaultName) ??
    metrics.network.find((n) => !/^(lo$|veth|br-|docker)/.test(n.name)) ??
    metrics.network[0]
  );
}
export type RemoteFile = {
  uid?: number;
  gid?: number;
  user?: string;
  group?: string;
  name: string;
  directory: boolean;
  size: number;
  modified: number;
  mode: number;
};
export type SessionEvent = {
  id: string;
  type: 'data' | 'closed' | 'error';
  data: string;
  sequence?: number;
};
export type Transfer = {
  id: string;
  sessionId: string;
  label: string;
  direction: 'upload' | 'download';
  state: 'preparing' | 'running' | 'completed' | 'failed' | 'cancelled';
  done: number;
  total: number;
  filesDone: number;
  filesTotal: number;
  started: number;
  error?: string;
  localPath?: string;
};
export type RemoteDocument = {
  id: string;
  sessionId: string;
  path: string;
  text: string;
  newline: 'LF' | 'CRLF';
};
export type FileAction = {
  kind: 'rename' | 'mkdir' | 'touch' | 'delete' | 'chmod';
  path: string;
  name?: string;
  mode?: number;
  recursive?: boolean;
};
export interface Bridge {
  nginxUpgradeInspect(
    sessionId: string,
    source: import('./nginx-upgrade-shared').NginxUpgradeSource,
  ): Promise<import('./nginx-upgrade-shared').NginxUpgradePreview>;
  nginxUpgradeStart(
    sessionId: string,
    previewId: string,
  ): Promise<import('./nginx-upgrade-shared').NginxUpgradeJob>;
  nginxUpgradeList(sessionId: string): Promise<import('./nginx-upgrade-shared').NginxUpgradeJob[]>;
  onNginxUpgrade(fn: (job: import('./nginx-upgrade-shared').NginxUpgradeJob) => void): () => void;
  certificateInspect(
    sessionId: string,
    source: import('./certificate-shared').CertificateSource,
  ): Promise<import('./certificate-shared').CertificateInspection>;
  certificatePrepare(
    sessionId: string,
    options: import('./certificate-shared').CertificateOptions,
  ): Promise<import('./certificate-shared').CertificatePreview>;
  certificateStart(
    sessionId: string,
    previewId: string,
  ): Promise<import('./certificate-shared').CertificateJob>;
  certificateList(sessionId: string): Promise<import('./certificate-shared').CertificateJob[]>;
  onCertificate(fn: (job: import('./certificate-shared').CertificateJob) => void): () => void;
  deploymentState(sessionId: string): Promise<import('./deployment-shared').DeploymentState>;
  deploymentSave(
    sessionId: string,
    plan: import('./deployment-shared').DeploymentPlan,
  ): Promise<import('./deployment-shared').DeploymentPlan>;
  deploymentRemove(sessionId: string, planId: string): Promise<void>;
  deploymentStart(
    sessionId: string,
    planId: string,
  ): Promise<import('./deployment-shared').DeploymentJob>;
  deploymentStop(jobId: string): Promise<void>;
  deploymentPick(kind: 'file' | 'directory'): Promise<string | null>;
  onDeploymentPlans(
    fn: (plans: import('./deployment-shared').DeploymentPlan[]) => void,
  ): () => void;
  onDeployment(fn: (job: import('./deployment-shared').DeploymentJob) => void): () => void;
  captureCheck(sessionId: string, sudo: boolean): Promise<import('./capture-shared').CaptureCheck>;
  captureRemove(id: string): Promise<import('./capture-shared').CaptureJob[]>;
  captureStart(
    sessionId: string,
    options: import('./capture-shared').CaptureOptions,
  ): Promise<import('./capture-shared').CaptureJob>;
  captureStop(id: string): Promise<void>;
  captureStopSession(sessionId: string): Promise<void>;
  captureList(): Promise<import('./capture-shared').CaptureJob[]>;
  captureExport(id: string): Promise<string | null>;
  captureOpen(id: string): Promise<void>;
  capturePorts(sessionId: string, pid: number): Promise<number[]>;
  onCapture(fn: (job: import('./capture-shared').CaptureJob) => void): () => void;
  aiImage(asset: string): Promise<string>;
  aiState(): Promise<import('./ai-shared').AIState>;
  aiConfigure(
    config: import('./ai-shared').AIConfig,
    keys?: Partial<Record<import('./ai-shared').AIProvider, string>>,
  ): Promise<import('./ai-shared').AIState>;
  aiCreate(provider: import('./ai-shared').AIProvider): Promise<import('./ai-shared').AIChat>;
  aiGet(id: string): Promise<import('./ai-shared').AIChat>;
  aiSend(
    id: string,
    input: string | import('./ai-shared').AIInput,
    retry?: boolean,
  ): Promise<import('./ai-shared').AIChat>;
  aiCancel(id: string): Promise<void>;
  aiRename(id: string, title: string): Promise<import('./ai-shared').AIState>;
  aiDelete(id: string): Promise<import('./ai-shared').AIState>;
  onAI(fn: (event: import('./ai-shared').AIEvent) => void): () => void;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  updateStatus(): Promise<UpdateStatus>;
  openUpdateGuide(): Promise<void>;
  configureUpdates(preferences: UpdatePreferences): Promise<UpdateStatus>;
  checkUpdate(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<UpdateStatus>;
  cancelUpdate(): Promise<void>;
  dismissUpdate(ignore: boolean): Promise<UpdateStatus>;
  installUpdate(): Promise<boolean>;
  onUpdate(fn: (state: UpdateStatus) => void): () => void;
  chooseBackground(): Promise<{ image: string; imageName: string } | null>;
  backgroundImage(image: string): Promise<string>;
  credentialStatus(profile: Profile): Promise<boolean>;
  saveCredential(profile: Profile, secret: string, remember: boolean): Promise<void>;
  configInfo(): Promise<ConfigInfo>;
  showConfigDirectory(): Promise<void>;
  chooseExportDirectory(): Promise<string>;
  exportConnections(settings?: Settings, includePasswords?: boolean): Promise<string>;
  chooseConnectionImport(): Promise<import('./connection-sharing').ConnectionBundle | null>;
  importConnections(
    bundle: import('./connection-sharing').ConnectionBundle,
    settings: Settings,
  ): Promise<{ settings: Settings; added: number; skipped: number; foldersAdded: number }>;
  processes(id: string): Promise<RemoteProcess[]>;
  terminateProcess(id: string, pid: number, start: string): Promise<boolean>;

  uploadFolder(id: string, path: string): Promise<string>;
  transferList(): Promise<Transfer[]>;
  exportTransferDiagnostics(): Promise<string>;
  onTransfer(fn: (transfer: Transfer) => void): () => void;
  cancelTransfer(id: string): Promise<void>;
  downloadDirectory(): Promise<string>;
  chooseDownloadDirectory(): Promise<string>;
  showDownloadDirectory(): Promise<void>;
  showTransfer(id: string): Promise<void>;
  fileAction(id: string, action: FileAction): Promise<void>;
  fileActions(
    id: string,
    action: { kind: 'delete' | 'chmod'; paths: string[]; mode?: number; recursive?: boolean },
  ): Promise<{ completed: string[]; failed: { path: string; error: string }[] }>;
  moveFiles(
    id: string,
    paths: string[],
    directory: string,
  ): Promise<{
    moved: string[];
    failed: { path: string; error: string }[];
  }>;
  openEditor(id: string, path: string): Promise<void>;
  openText(id: string, path: string): Promise<RemoteDocument>;
  saveText(documentId: string, text: string): Promise<void>;
  closeText(documentId: string): Promise<void>;
  cwd(id: string): Promise<string>;
  realpath(id: string, path: string): Promise<string>;
  start(id: string): Promise<void>;
  load(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
  connect(profile: Profile, secret: string): Promise<string>;
  disconnect(id: string, keepEditors?: boolean): Promise<void>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  metrics(id: string): Promise<Metrics>;
  files(id: string, path: string): Promise<RemoteFile[]>;
  upload(id: string, path: string): Promise<string>;
  uploadDropped(id: string, path: string, files: File[]): Promise<string[]>;
  download(id: string, path: string): Promise<string>;
  downloadMany(
    id: string,
    paths: string[],
  ): Promise<{ completed: number; failed: { path: string; error: string }[] }>;
  complete(id: string, path: string): Promise<string[]>;
  pickKey(): Promise<string>;
  terminalAck(id: string, sequence: number): Promise<void>;
  onEvent(fn: (event: SessionEvent) => void, filter?: string): () => void;
}
declare global {
  interface Window {
    elu?: Bridge;
  }
}
export const defaults: Settings = {
  profiles: [],
  folders: [],
  snippets: [],
  commandFolders: [{ id: DEFAULT_COMMAND_FOLDER, name: '默认分类' }],
  commandLibraryVersion: 0,
  commandWorkspace: CommandWorkspaceSchema.parse({}),
  history: {},
  recentConnections: [],
  sessionNameMode: 'name',
  pollSeconds: 3,
  appearance: AppearanceSchema.parse({}),
  features: FeatureSchema.parse({}),
  performance: PerformanceSchema.parse({}),
};
export const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
export function remember(history: string[], command: string) {
  return [command, ...history.filter((x) => x !== command)].slice(0, 100);
}
export const commandLibrary: Snippet[] = [
  { id: 'sys', name: '系统概览', command: 'uname -a && uptime', tags: ['linux'] },
  { id: 'ls', name: '详细文件列表', command: 'ls -lah', tags: ['linux'] },
  { id: 'du', name: '当前目录容量', command: 'du -h --max-depth=1 . | sort -h', tags: ['linux'] },
  { id: 'failed', name: '异常系统服务', command: 'systemctl --failed --no-pager', tags: ['linux'] },
  { id: 'who', name: '在线用户', command: 'w', tags: ['linux'] },
  {
    id: 'java-memory',
    name: 'Java 进程内存排序',
    command: 'ps -eo pid,rss,args --sort=-rss | head -20',
    tags: ['java'],
  },
  {
    id: 'kube',
    name: 'Kubernetes 工作负载',
    command: 'kubectl get pods -A -o wide',
    tags: ['kubernetes'],
  },
  { id: 'mem', name: '内存使用', command: 'free -h', tags: ['linux'] },
  { id: 'disk', name: '磁盘容量', command: 'df -hT', tags: ['linux'] },
  { id: 'ports', name: '监听端口', command: 'ss -tulnp', tags: ['network'] },
  { id: 'route', name: '路由表', command: 'ip route show', tags: ['network'] },
  { id: 'top', name: '进程监控', command: 'top', tags: ['linux'] },
  {
    id: 'docker',
    name: '容器状态',
    command: 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"',
    tags: ['docker'],
  },
  { id: 'dockerlog', name: '容器资源', command: 'docker stats --no-stream', tags: ['docker'] },
  { id: 'java', name: 'JVM 进程', command: 'jps -lv', tags: ['java'] },
  { id: 'nginx', name: 'Nginx 配置检查', command: 'nginx -t', tags: ['nginx'] },
  { id: 'journal', name: '近期系统日志', command: 'journalctl -n 100 --no-pager', tags: ['linux'] },
  { id: 'io', name: '磁盘 I/O', command: 'iostat -xz 1 5', tags: ['linux'] },
  { id: 'git', name: '仓库状态', command: 'git status --short --branch', tags: ['git'] },
];
export function recommendations(profile: Profile, custom: Snippet[] = []) {
  return [...custom, ...commandLibrary].sort(
    (a, b) =>
      Number(b.tags.some((t) => profile.tags.includes(t))) -
      Number(a.tags.some((t) => profile.tags.includes(t))),
  );
}
export function suggestions(input: string, history: string[], commands: Snippet[]) {
  if (!input.trim()) return [];
  return [...new Set([...history, ...commands.map((x) => x.command)])]
    .filter((x) => x.toLowerCase().includes(input.toLowerCase()) && x !== input)
    .slice(0, 7);
}
