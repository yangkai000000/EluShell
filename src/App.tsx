import { deploymentRunning, type DeploymentJob } from './deployment-shared';
import type { CertificateJob } from './certificate-shared';
import type { NginxUpgradeJob, NginxUpgradeSource } from './nginx-upgrade-shared';
import { sessionLabel } from './editor-shared';
import { useCaptures } from './capture-model';
import { captureRunning } from './capture-shared';
import { withoutKey } from './performance';
import CommandInput from './CommandInput';
import { isTerminalShortcut, terminalShortcut } from './platform';
import NewTab from './NewTab';
import { migrateCommands, dispatchCommand, recordCommand } from './commands';
import ConnectionManager from './ConnectionManager';
import ProcessManager from './ProcessManager';
import Preferences, { type PreferenceSection } from './Preferences';
import { useAI, AISidebar } from './AI';
import { useUpdates, UpdatePrompt } from './Updates';
import { effectiveTerminal, useBackground } from './appearance';
import Transfers from './Transfers';
import FileActions, { type FileTarget } from './FileActions';
import { useFileDrop } from './FileDrop';
import { useSessionActions } from './SessionActions';
import { useEffect, useRef, useState, useMemo, lazy, Suspense, type CSSProperties } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Command,
  Copy,
  Cpu,
  Database,
  Download,
  File,
  Folder,
  FolderOpen,
  HardDrive,
  History,
  Layers,
  MemoryStick,
  MoreHorizontal,
  Network,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings as SettingsIcon,
  ShieldCheck,
  Terminal as TerminalIcon,
  Upload,
  X,
  Zap,
  Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  defaults,
  SettingsSchema,
  emptyProfile,
  ProfileSchema,
  primaryInterface,
  quote,
  type Profile,
  type Metrics,
  type Settings,
  type RemoteFile,
} from './shared';

const DeploymentTool = lazy(() => import('./DeploymentTool'));
const CertificateTool = lazy(() => import('./CertificateTool'));
const NginxUpgradeTool = lazy(() => import('./NginxUpgradeTool'));
const CaptureTool = lazy(() => import('./CaptureTool'));
const Toolbox = lazy(() => import('./Toolbox'));
const Terminal = lazy(() => import('./Terminal'));
import DirectoryTree from './DirectoryTree';
import TunnelEditor from './TunnelEditor';
import { ResizeHandle } from './layout';
import { remotePath } from './paths';
import { diskRates, type DeviceIO } from './io';
import { fileOwner, sortFiles, selectFiles, type FileSort, type FileSelection } from './file-list';
const CommandWorkspace = lazy(() => import('./CommandWorkspace'));
type Session = { id: string; profile: Profile; connected: boolean };
const bytes = (n: number) => {
  if (!Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < 4) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
};
function Spark({ values, color = '#17a995' }: { values: number[]; color?: string }) {
  const max = Math.max(...values, 1);
  return (
    <svg viewBox="0 0 240 45" preserveAspectRatio="none" className="spark" aria-label="趋势图">
      <path d="M0 44H240 M0 22H240" stroke="#e8edf1" strokeDasharray="3 4" />
      <polyline
        points={values
          .map((v, i) => `${(i * 240) / Math.max(values.length - 1, 1)},${43 - (v / max) * 36}`)
          .join(' ')}
        stroke={color}
        strokeWidth="2"
        fill="none"
      />
    </svg>
  );
}
function Bar({ value, color }: { value: number; color?: string }) {
  return (
    <div className="bar">
      <i style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }} />
    </div>
  );
}
function MetricHead({
  icon: Icon,
  label,
  right,
}: {
  icon: LucideIcon;
  label: string;
  right?: string;
}) {
  return (
    <div className="metric-head">
      <span>
        <Icon size={14} />
        {label}
      </span>
      <small>
        {right}
        <ChevronRight size={12} />
      </small>
    </div>
  );
}
export default function App() {
  const updates = useUpdates();
  const [fileTarget, setFileTarget] = useState<FileTarget | null>(null),
    [openTextPath, setOpenTextPath] = useState<string | null>(null),
    [treeRevision, setTreeRevision] = useState(0);

  const [settings, setSettings] = useState<Settings>(defaults),
    [loaded, setLoaded] = useState(false);
  const lastSavedSettings = useRef<Settings | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]),
    [activeTab, setActive] = useState('new:initial');
  const [toolTabs, setToolTabs] = useState<
    {
      id: string;
      sessionId: string;
      kind?: 'capture' | 'deploy' | 'certificate' | 'nginx';
      initial?: Partial<NginxUpgradeSource>;
    }[]
  >([]);
  const [deploymentJobs, setDeploymentJobs] = useState<DeploymentJob[]>([]);
  const [certificateJobs, setCertificateJobs] = useState<CertificateJob[]>([]);
  const [nginxJobs, setNginxJobs] = useState<NginxUpgradeJob[]>([]);
  useEffect(
    () =>
      window.elu?.onNginxUpgrade?.((job) =>
        setNginxJobs((old) => [job, ...old.filter((j) => j.id !== job.id)].slice(0, 20)),
      ),
    [],
  );
  useEffect(
    () =>
      window.elu?.onCertificate((job) =>
        setCertificateJobs((old) => [job, ...old.filter((j) => j.id !== job.id)].slice(0, 20)),
      ),
    [],
  );
  useEffect(
    () =>
      window.elu?.onDeployment((job) =>
        setDeploymentJobs((old) => [job, ...old.filter((j) => j.id !== job.id)].slice(0, 30)),
      ),
    [],
  );
  const activeTool = toolTabs.find((t) => t.id === activeTab);
  const active = activeTool?.sessionId || activeTab;
  const [closingTool, setClosingTool] = useState<{ id: string; sessionId: string } | null>(null);
  const [closingBusy, setClosingBusy] = useState(false);
  const [tabs, setTabs] = useState<string[]>(['new:initial']);
  const workspace = useRef({ sessions, tabs, toolTabs, activeTab });
  workspace.current = { sessions, tabs, toolTabs, activeTab };
  const connectingRef = useRef(false);
  const current = sessions.find((s) => s.id === active);
  const [metricMap, setMetricMap] = useState<Record<string, Metrics>>({}),
    [trends, setTrends] = useState<Record<string, number[]>>({}),
    [monitorError, setMonitorError] = useState('');
  const previousMetrics = useRef<Record<string, Metrics>>({});
  const [ioMap, setIoMap] = useState<Record<string, DeviceIO[]>>({});
  const [netTrends, setNetTrends] = useState<Record<string, number[]>>({});
  const [bottom, setBottom] = useState('files'),
    [detail, setDetail] = useState(''),
    [manager, setManager] = useState(false),
    [editing, setEditing] = useState<Profile | null>(null),
    [secret, setSecret] = useState(''),
    [connecting, setConnecting] = useState(false),
    [filter, setFilter] = useState(''),
    [command, setCommand] = useState(''),
    [toast, setToast] = useState(''),
    [search, setSearch] = useState(''),
    [showSearch, setShowSearch] = useState(false),
    [path, setPath] = useState('/'),
    [pathInput, setPathInput] = useState('/'),
    [files, setFiles] = useState<RemoteFile[]>([]),
    [fileFilter, setFileFilter] = useState(''),
    [fileBusy, setFileBusy] = useState(false),
    [fileError, setFileError] = useState(''),
    [prefs, setPrefs] = useState<PreferenceSection | null>(null);
  const capture = useCaptures(
    settings.features.toolkit && (toolTabs.length > 0 || bottom === 'tools'),
  );
  const tabName = (id: string) => {
    const tool = toolTabs.find((t) => t.id === id);
    const session = sessions.find((s) => s.id === (tool?.sessionId || id));
    return session
      ? sessionLabel(session.profile, settings.sessionNameMode) +
          (tool
            ? ' · ' +
              { deploy: '部署', certificate: 'HTTPS 证书', nginx: 'Nginx 升级', capture: '抓包' }[
                tool.kind || 'capture'
              ]
            : '')
      : '新建标签页';
  };
  const blockedTab = (id: string) => {
    const sessionId = toolTabs.find((t) => t.id === id)?.sessionId || id;
    if (nginxJobs.some((j) => j.sessionId === sessionId && j.state === 'running'))
      return 'Nginx 任务运行中';
    if (certificateJobs.some((j) => j.sessionId === sessionId && j.state === 'running'))
      return '证书任务运行中';
    if (deploymentJobs.some((j) => j.sessionId === sessionId && deploymentRunning(j)))
      return '部署任务运行中';
    return '';
  };
  const tabActions = useSessionActions({
    tabs,
    tools: toolTabs,
    sessions,
    name: tabName,
    blocked: blockedTab,
    capturing: (id) => {
      const tool = toolTabs.find((t) => t.id === id);
      return (
        (!tool || !tool.kind || tool.kind === 'capture') &&
        capture.jobs.some((j) => j.sessionId === (tool?.sessionId || id) && captureRunning(j))
      );
    },
    close: finalizeCloseMany,
    disconnect: disconnectSessions,
    reconnect: reconnectSession,
    notify: (text) => notify(text),
  });
  const [aiOpen, setAiOpen] = useState(false);
  const ai = useAI(settings.features.ai && (aiOpen || !!prefs), settings.features.ai);
  const [layout, setLayout] = useState(() => {
    const fallback = {
      monitor: 240,
      tree: 220,
      files: 250,
      monitorClosed: false,
      treeClosed: false,
      filesClosed: false,
    };
    try {
      return { ...fallback, ...JSON.parse(localStorage.getItem('elushell-layout') || '{}') };
    } catch {
      return fallback;
    }
  });
  const follow = settings.features.directoryFollow;
  const [syncStatus, setSyncStatus] = useState('等待终端目录');
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const backgroundPaused = settings.performance.pauseWhenHidden && !visible;
  const currentPaths = useRef<Record<string, string>>({});
  useEffect(() => localStorage.setItem('elushell-layout', JSON.stringify(layout)), [layout]);
  const cmdInput = useRef<HTMLInputElement>(null);
  const fileRequest = useRef(0);
  const notify = (s: string) => setToast(s);
  const appearance = useMemo(
    () =>
      settings.features.backgroundImages
        ? settings.appearance
        : {
            ...settings.appearance,
            workspace: { ...settings.appearance.workspace, kind: 'color' as const },
            terminal: { ...settings.appearance.terminal, kind: 'color' as const },
          },
    [settings.appearance, settings.features.backgroundImages],
  );
  const workspaceBackground = useBackground(appearance.workspace, notify);
  const terminalBackground = useBackground(effectiveTerminal(appearance), notify);
  const [searchStep, setSearchStep] = useState({
    direction: 'next' as 'next' | 'previous',
    sequence: 0,
  });
  const [searchFound, setSearchFound] = useState(true);
  const [focusTerminal, setFocusTerminal] = useState(0);
  const [layoutMenu, setLayoutMenu] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const layoutMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (showSearch) searchInput.current?.focus();
  }, [showSearch]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        isTerminalShortcut(event) &&
        event.key.toLowerCase() === 'f' &&
        current &&
        !prefs &&
        !manager &&
        !detail
      ) {
        event.preventDefault();
        setShowSearch(true);
        searchInput.current?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [current, prefs, manager, detail]);
  useEffect(() => {
    if (!layoutMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (!layoutMenuRef.current?.contains(event.target as Node)) setLayoutMenu(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLayoutMenu(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', key);
    };
  }, [layoutMenu]);
  const metrics = metricMap[active];
  const profile = current?.profile || emptyProfile;
  const commands = settings.snippets;
  const [fileSort, setFileSort] = useState<{ field: FileSort; descending: boolean }>({
    field: 'name',
    descending: false,
  });
  const [fileSelection, setFileSelection] = useState<FileSelection>({ names: [], anchor: null });
  const visibleFiles = sortFiles(files, fileSort.field, fileSort.descending).filter((f) =>
    f.name.toLowerCase().includes(fileFilter.toLowerCase()),
  );
  const visibleNames = visibleFiles.map((f) => f.name);
  const selectedFiles = visibleFiles.filter((f) => fileSelection.names.includes(f.name));
  const fileDrop = useFileDrop({
    sessionId: active,
    server: current
      ? `${sessionLabel(current.profile, settings.sessionNameMode)} · ${current.profile.username}@${current.profile.host}`
      : '',
    connected: !!current?.connected,
    directory: path,
    refresh: () => {
      void loadFiles();
      setTreeRevision((v) => v + 1);
    },
    notify,
  });
  useEffect(() => {
    setFileSelection({ names: [], anchor: null });
    setFileTarget(null);
  }, [active, path, fileFilter]);
  useEffect(() => {
    setFileSelection((s) => ({
      names: s.names.filter((n) => files.some((f) => f.name === n)),
      anchor: files.some((f) => f.name === s.anchor) ? s.anchor : null,
    }));
  }, [files]);
  useEffect(() => {
    (window.elu
      ? window.elu.load()
      : Promise.resolve(JSON.parse(localStorage.getItem('elushell') || 'null') || defaults)
    )
      .then((s) => {
        const value = migrateCommands(SettingsSchema.parse(s));
        lastSavedSettings.current = value;
        setSettings(value);
        setLoaded(true);
      })
      .catch((e) => notify('配置读取失败：' + e));
  }, []);
  useEffect(() => {
    if (!loaded || settings === lastSavedSettings.current) return;
    lastSavedSettings.current = settings;
    if (window.elu) window.elu.save(settings).catch((e) => notify('保存失败：' + e));
    else localStorage.setItem('elushell', JSON.stringify(settings));
  }, [settings, loaded]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 6000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(
    () =>
      window.elu?.onEvent((event) => {
        if (event.type === 'closed')
          setSessions((s) => s.map((x) => (x.id === event.id ? { ...x, connected: false } : x)));
        if (event.type === 'error') notify(event.data);
      }, 'status'),
    [],
  );
  useEffect(() => {
    if (!current?.connected || !settings.features.monitoring || backgroundPaused) return;
    let cancelled = false,
      busy = false,
      tick = 0;
    setMonitorError('');
    const update = async () => {
      if (busy) return;
      busy = true;
      try {
        const m = await window.elu!.metrics(active);
        if (!cancelled) {
          const prev = previousMetrics.current[active];
          setIoMap((s) => ({
            ...s,
            [active]: diskRates(m.diskIO, prev?.diskIO, prev ? (m.at - prev.at) / 1000 : 0),
          }));
          previousMetrics.current[active] = m;
          setNetTrends((s) => ({
            ...s,
            [active]: [...(s[active] || []), primaryInterface(m)?.rxRate || 0].slice(-40),
          }));
          setMetricMap((s) => ({ ...s, [active]: m }));
          setTrends((s) => ({ ...s, [active]: [...(s[active] || []), m.cpu].slice(-40) }));
          setMonitorError('');
        }
      } catch (e) {
        if (!cancelled) setMonitorError(String(e));
      } finally {
        busy = false;
      }
    };
    void update();
    const timer = setInterval(update, settings.pollSeconds * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    active,
    current?.connected,
    settings.pollSeconds,
    settings.features.monitoring,
    backgroundPaused,
  ]);
  async function loadFiles(next = path) {
    const request = ++fileRequest.current;
    setFileBusy(true);
    setFileError('');
    try {
      if (!current?.connected) {
        setFiles([]);
        return;
      }
      next = await window.elu!.realpath(active, next);
      const result = await window.elu!.files(active, next);
      if (request === fileRequest.current) {
        setFiles(result);
        currentPaths.current[active] = next;
        setPath(next);
        setPathInput(next);
      }
    } catch (e) {
      if (request === fileRequest.current) {
        setFiles([]);
        setFileError(String(e));
      }
    } finally {
      if (request === fileRequest.current) setFileBusy(false);
    }
  }
  useEffect(() => {
    setCommand('');
    setFiles([]);
    setSearch('');
    void loadFiles(currentPaths.current[active] || '.');
  }, [active]);
  useEffect(() => {
    if (!current?.connected || !follow || backgroundPaused) return;
    let stopped = false,
      busy = false,
      last = '';
    const update = async () => {
      if (busy) return;
      busy = true;
      try {
        const cwd = await window.elu!.cwd(active);
        if (!stopped && cwd.startsWith('/')) {
          setSyncStatus('跟随终端');
          if (cwd !== last) {
            last = cwd;
            if (cwd !== currentPaths.current[active]) await loadFiles(cwd);
          }
        }
      } catch {
        if (!stopped) setSyncStatus('目录同步暂不可用');
      } finally {
        busy = false;
      }
    };
    void update();
    const timer = setInterval(update, 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active, current?.connected, follow, backgroundPaused]);
  function fill(s: string) {
    if (activeTool) setActive(active);
    setCommand(s);
    cmdInput.current?.focus();
  }
  async function sendToSessions(text: string, target: 'current' | 'all', appendNewline: boolean) {
    const selected = target === 'all' ? sessions : sessions.filter((s) => s.id === active);
    try {
      const result = await dispatchCommand(
        text,
        appendNewline,
        selected.map((s) => ({
          id: s.id,
          profileId: s.profile.id,
          name: s.profile.name,
          connected: s.connected,
        })),
        (id, data) => window.elu!.write(id, data),
      );
      if (result.sent.length && activeTool) setActive(active);
      if (result.sent.length && settings.features.commandHistory)
        setSettings((s) => ({
          ...s,
          history: recordCommand(
            s.history,
            result.sent.map((t) => t.profileId),
            result.text,
          ),
        }));
      if (result.failed.length)
        notify(
          '发送失败：' +
            result.failed.map((t) => t.name).join('、') +
            (result.sent.length ? '；其余 ' + result.sent.length + ' 个会话已发送' : ''),
        );
      else if (target === 'all') notify('已发送到 ' + result.sent.length + ' 个会话');
      return result.failed.length === 0;
    } catch (e) {
      notify(String(e));
      return false;
    }
  }
  async function complete() {
    if (!current) {
      notify('输入命令关键词，例如 docker、free 或 ls');
      return;
    }
    const m = command.match(/(?:^|\s)([^\s]+)$/);
    if (!m) return;
    try {
      const result = await window.elu!.complete(active, m[1]);
      if (result.length === 1) setCommand(command.slice(0, -m[1].length) + quote(result[0]));
      else notify(result.length ? result.join('  ') : '没有匹配的远程路径');
    } catch (e) {
      notify(String(e));
    }
  }
  async function connect(p: Profile, loginSecret = secret) {
    if (connectingRef.current || tabActions.busy) return;
    if (!window.elu) {
      notify('真实 SSH 连接需要运行 EluShell 桌面应用');
      return;
    }
    setConnecting(true);
    connectingRef.current = true;
    const fromTab = activeTab;
    try {
      const id = await window.elu.connect(p, loginSecret);
      setSessions((s) => [...s, { id, profile: p, connected: true }]);
      setTabs((t) =>
        fromTab.startsWith('new:') && t.includes(fromTab)
          ? t.map((x) => (x === fromTab ? id : x))
          : [...t, id],
      );
      setSettings((s) => ({
        ...s,
        recentConnections: [
          { profileId: p.id, at: Date.now() },
          ...s.recentConnections.filter((r) => r.profileId !== p.id),
        ].slice(0, 100),
      }));
      setActive(id);
      setManager(false);
      setEditing(null);
      setSecret('');
      if (p.autoStartup && p.startup.trim()) await window.elu.write(id, p.startup + '\n');
    } catch (e) {
      notify('连接失败：' + e);
      throw e;
    } finally {
      setConnecting(false);
      connectingRef.current = false;
    }
  }
  async function connectRecent(p: Profile) {
    if (connectingRef.current) return;
    try {
      if (p.auth === 'password' && !(await window.elu?.credentialStatus(p))) {
        setEditing(p);
        setManager(true);
        notify('请输入此连接的密码后连接');
        return;
      }
      await connect(p, '');
    } catch {
      /* connect reports the error and retains the new tab for retry. */
    }
  }
  function newTab() {
    const id = 'new:' + crypto.randomUUID();
    setTabs((t) => [...t, id]);
    setActive(id);
  }
  function clearSessionCache(id: string) {
    setMetricMap((s) => withoutKey(s, id));
    setTrends((s) => withoutKey(s, id));
    setIoMap((s) => withoutKey(s, id));
    setNetTrends((s) => withoutKey(s, id));
    delete previousMetrics.current[id];
    delete currentPaths.current[id];
  }
  useEffect(() => {
    if (!settings.features.monitoring) {
      setMetricMap({});
      setTrends({});
      setIoMap({});
      setNetTrends({});
      previousMetrics.current = {};
      setMonitorError('');
      setDetail('');
    }
  }, [settings.features.monitoring]);
  useEffect(() => {
    if (!settings.features.ai) setAiOpen(false);
  }, [settings.features.ai]);
  function openCapture(sessionId = active, port?: number) {
    if (!settings.features.toolkit) {
      notify('请在功能与性能设置中开启工具包');
      return;
    }
    const source = sessions.find((s) => s.id === sessionId);
    if (!source?.connected) {
      notify('请先连接服务器');
      return;
    }
    const id = `tool:${sessionId}:capture`;
    if (port) capture.setDraft(sessionId, { ...capture.draft(sessionId), port: String(port) });
    if (!toolTabs.some((t) => t.id === id)) {
      setToolTabs((t) => [...t, { id, sessionId }]);
      setTabs((t) => [...t, id]);
    }
    setActive(id);
    setDetail('');
  }
  function openDeployment() {
    if (!current?.connected || !settings.features.toolkit) return;
    const id = 'deploy:' + current.id;
    if (!toolTabs.some((t) => t.id === id)) {
      setToolTabs((t) => [...t, { id, sessionId: current.id, kind: 'deploy' }]);
      setTabs((t) => [...t, id]);
    }
    setActive(id);
    setDetail('');
  }
  function openNginx(sessionId = current?.id, initial?: Partial<NginxUpgradeSource>) {
    if (
      !sessions.find((s) => s.id === sessionId)?.connected ||
      !settings.features.toolkit ||
      !sessionId
    )
      return;
    const id = 'nginx:' + sessionId;
    if (!toolTabs.some((t) => t.id === id)) {
      setToolTabs((t) => [...t, { id, sessionId, kind: 'nginx', initial }]);
      setTabs((t) => [...t, id]);
    }
    setActive(id);
    setDetail('');
  }
  function openCertificate(sessionId = current?.id) {
    if (
      !sessions.find((s) => s.id === sessionId)?.connected ||
      !settings.features.toolkit ||
      !sessionId
    )
      return;
    const id = 'certificate:' + sessionId;
    if (!toolTabs.some((t) => t.id === id)) {
      setToolTabs((t) => [...t, { id, sessionId, kind: 'certificate' }]);
      setTabs((t) => [...t, id]);
    }
    setActive(id);
    setDetail('');
  }
  async function disconnectSessions(ids: string[]) {
    const failures: string[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        await window.elu!.disconnect(id, false);
        setSessions((s) =>
          s.map((session) => (session.id === id ? { ...session, connected: false } : session)),
        );
        clearSessionCache(id);
      } catch (e) {
        failures.push(tabName(id) + '：' + String(e));
      }
    }
    if (failures.length) notify('未断开的会话：' + failures.join('；'));
  }
  async function reconnectSession(oldId: string, password: string) {
    if (connectingRef.current) throw Error('另一个连接正在建立，请稍后重试');
    const source = workspace.current.sessions.find((s) => s.id === oldId);
    if (!source || source.connected) return;
    connectingRef.current = true;
    setConnecting(true);
    try {
      const profile = settings.profiles.find((p) => p.id === source.profile.id) || source.profile;
      const id = await window.elu!.connect(profile, password);
      if (!workspace.current.sessions.some((s) => s.id === oldId)) {
        await window.elu!.disconnect(id);
        return;
      }
      const renamed = new Map(
        workspace.current.toolTabs
          .filter((t) => t.sessionId === oldId)
          .map((t) => [t.id, t.id.replace(oldId, id)]),
      );
      setSessions((s) =>
        s.map((session) => (session.id === oldId ? { id, profile, connected: true } : session)),
      );
      setTabs((t) => t.map((tab) => (tab === oldId ? id : renamed.get(tab) || tab)));
      setToolTabs((t) =>
        t.map((tool) =>
          tool.sessionId === oldId ? { ...tool, id: renamed.get(tool.id)!, sessionId: id } : tool,
        ),
      );
      setActive((tab) => (tab === oldId ? id : renamed.get(tab) || tab));
      clearSessionCache(oldId);
      capture.release(oldId);
      setSettings((s) => ({
        ...s,
        recentConnections: [
          { profileId: profile.id, at: Date.now() },
          ...s.recentConnections.filter((r) => r.profileId !== profile.id),
        ].slice(0, 100),
      }));
      if (profile.autoStartup && profile.startup.trim())
        await window.elu!.write(id, profile.startup + '\n');
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  }
  const finalizeClose = (id: string) => finalizeCloseMany([id]);
  async function finalizeCloseMany(ids: string[]) {
    const removed = new Set<string>(),
      failed: string[] = [];
    const snapshot = workspace.current;
    // Disconnect server tabs before removing any dependent tool tabs.
    const ordered = [...ids].sort(
      (a, b) =>
        Number(!!snapshot.toolTabs.find((t) => t.id === a)) -
        Number(!!snapshot.toolTabs.find((t) => t.id === b)),
    );
    const blockedOwners = new Set<string>();
    for (const id of ordered) {
      if (removed.has(id) || !workspace.current.tabs.includes(id)) continue;
      const tool = snapshot.toolTabs.find((t) => t.id === id);
      if (tool && blockedOwners.has(tool.sessionId)) continue;
      try {
        const reason = blockedTab(id);
        if (reason) throw Error(reason);
        if (!tool && !id.startsWith('new:')) await window.elu!.disconnect(id);
        else if (tool && (!tool.kind || tool.kind === 'capture'))
          await window.elu!.captureStopSession(tool.sessionId);
        removed.add(id);
        if (!tool) {
          snapshot.toolTabs.filter((t) => t.sessionId === id).forEach((t) => removed.add(t.id));
          clearSessionCache(id);
          capture.release(id);
        } else if (!tool.kind || tool.kind === 'capture') capture.release(tool.sessionId);
      } catch (e) {
        failed.push(tabName(id) + '：' + String(e));
        if (!tool) blockedOwners.add(id);
      }
    }
    const current = workspace.current;
    const next = current.tabs.filter((id) => !removed.has(id));
    if (!next.length) next.push('new:' + crypto.randomUUID());
    if (removed.has(active)) fileRequest.current++;
    setSessions((s) => s.filter((session) => !removed.has(session.id)));
    setToolTabs((t) => t.filter((tool) => !removed.has(tool.id)));
    setTabs(next);
    if (removed.has(current.activeTab))
      setActive(
        next[Math.max(0, Math.min(current.tabs.indexOf(current.activeTab), next.length - 1))],
      );
    if (failed.length) notify('已保留无法关闭的会话：' + failed.join('；'));
  }
  function closeSession(id: string) {
    if (tabActions.busy) return;
    if (blockedTab(id)) {
      notify(blockedTab(id) + '，请等待完成或停止任务后再关闭');
      return;
    }
    const sessionId = toolTabs.find((t) => t.id === id)?.sessionId || id;
    if (nginxJobs.some((j) => j.sessionId === sessionId && j.state === 'running')) {
      notify('Nginx 升级正在执行，请等待完成再关闭此会话');
      return;
    }
    if (certificateJobs.some((j) => j.sessionId === sessionId && j.state === 'running')) {
      notify('证书任务正在执行，请等待完成再关闭此会话');
      return;
    }
    if (
      !id.startsWith('deploy:') &&
      !id.startsWith('certificate:') &&
      !id.startsWith('nginx:') &&
      capture.jobs.some((j) => j.sessionId === sessionId && captureRunning(j))
    ) {
      setClosingTool({ id, sessionId });
      return;
    }
    finalizeClose(id);
  }
  useEffect(() => {
    if (!settings.features.toolkit) {
      if (bottom === 'tools') setBottom('files');
      for (const tool of toolTabs) capture.release(tool.sessionId);
      const ids = new Set(toolTabs.map((t) => t.id));
      setTabs((t) => t.filter((id) => !ids.has(id)));
      if (activeTool) setActive(activeTool.sessionId);
      setToolTabs([]);
      setClosingTool(null);
    }
  }, [settings.features.toolkit]);
  const mainNetwork = metrics ? primaryInterface(metrics) : undefined;
  const totalRx = mainNetwork?.rxRate || 0,
    totalTx = mainNetwork?.txRate || 0;
  const memoryPercent = metrics ? 100 * (1 - metrics.memory.available / metrics.memory.total) : 0;
  const sessionBar = (
    <div className="session-tabs" onContextMenu={tabActions.onContextMenu}>
      <button
        className="icon-button connection-manager"
        title="连接管理"
        onClick={() => setManager(true)}
      >
        <Server size={18} />
      </button>
      <div className="session-tab-list">
        {tabs.map((tabId) => {
          const tool = toolTabs.find((t) => t.id === tabId);
          if (tool) {
            const source = sessions.find((s) => s.id === tool.sessionId);
            const name =
              settings.sessionNameMode === 'ip'
                ? source?.profile.host || '连接'
                : settings.profiles.find((p) => p.id === source?.profile.id)?.name ||
                  source?.profile.name ||
                  '连接';
            const running =
              tool.kind === 'nginx'
                ? nginxJobs.some((j) => j.sessionId === tool.sessionId && j.state === 'running')
                : tool.kind === 'certificate'
                  ? certificateJobs.some(
                      (j) => j.sessionId === tool.sessionId && j.state === 'running',
                    )
                  : tool.kind === 'deploy'
                    ? deploymentJobs.some(
                        (j) => j.sessionId === tool.sessionId && deploymentRunning(j),
                      )
                    : capture.jobs.some((j) => j.sessionId === tool.sessionId && captureRunning(j));
            const toolName =
              tool.kind === 'nginx'
                ? 'Nginx 升级'
                : tool.kind === 'certificate'
                  ? 'HTTPS 证书'
                  : tool.kind === 'deploy'
                    ? '部署'
                    : '抓包';
            return (
              <div
                className={'session-tab ' + (activeTab === tabId ? 'selected' : '')}
                key={tabId}
                data-tab-id={tabId}
              >
                <button
                  title={`${source?.profile.host || ''} · ${toolName}${running ? ' · 运行中' : ''}`}
                  onClick={() => setActive(tabId)}
                >
                  <Activity size={14} />
                  {name} · {toolName}
                  {running && <span className="status-dot" />}
                </button>
                <button title="关闭工具会话" onClick={() => closeSession(tabId)}>
                  <X size={13} />
                </button>
              </div>
            );
          }
          const s = sessions.find((s) => s.id === tabId);
          if (!s)
            return (
              <div
                className={'session-tab ' + (activeTab === tabId ? 'selected' : '')}
                key={tabId}
                data-tab-id={tabId}
              >
                <button onClick={() => setActive(tabId)}>新建标签页</button>
                <button title="关闭标签页" onClick={() => closeSession(tabId)}>
                  <X size={13} />
                </button>
              </div>
            );
          return (
            <div
              className={'session-tab ' + (activeTab === s.id ? 'selected' : '')}
              key={s.id}
              data-tab-id={s.id}
            >
              <button
                title={
                  s.profile.username +
                  '@' +
                  s.profile.host +
                  ':' +
                  s.profile.port +
                  ' · 双击编辑连接'
                }
                onClick={() => setActive(s.id)}
                onDoubleClick={() => {
                  setEditing(s.profile);
                  setManager(true);
                }}
              >
                <span className={'status-dot ' + (!s.connected ? 'offline' : '')} />
                {sessionLabel(
                  settings.profiles.find((p) => p.id === s.profile.id)
                    ? {
                        ...s.profile,
                        name: settings.profiles.find((p) => p.id === s.profile.id)!.name,
                      }
                    : s.profile,
                  settings.sessionNameMode,
                )}
              </button>
              <button title="关闭会话" onClick={() => closeSession(s.id)}>
                <X size={13} />
              </button>
            </div>
          );
        })}
        <button className="add-session" title="新建标签页" onClick={newTab}>
          <Plus size={18} />
        </button>
      </div>
      <div className="tabs-right">
        {current && (
          <div className="layout-menu-anchor" ref={layoutMenuRef}>
            <button
              className="icon-button"
              title="面板布局"
              aria-expanded={layoutMenu}
              onClick={() => setLayoutMenu(!layoutMenu)}
            >
              <Layers size={16} />
            </button>
            {layoutMenu && (
              <div className="layout-menu" role="menu">
                <button
                  title="切换监控栏"
                  onClick={() => {
                    setLayout({ ...layout, monitorClosed: !layout.monitorClosed });
                    setLayoutMenu(false);
                  }}
                >
                  <Activity size={14} />
                  {layout.monitorClosed ? '展开服务器概览' : '收起服务器概览'}
                </button>
                <button
                  title="切换文件面板"
                  onClick={() => {
                    setLayout({ ...layout, filesClosed: !layout.filesClosed });
                    setLayoutMenu(false);
                  }}
                >
                  <FolderOpen size={14} />
                  {layout.filesClosed ? '展开文件面板' : '收起文件面板'}
                </button>
                <button
                  title="终端专注模式"
                  onClick={() => {
                    setLayout({
                      ...layout,
                      monitorClosed: !(layout.monitorClosed && layout.filesClosed),
                      filesClosed: !(layout.monitorClosed && layout.filesClosed),
                    });
                    setLayoutMenu(false);
                  }}
                >
                  <Layers size={14} />
                  终端专注模式
                </button>
                <button
                  onClick={() => {
                    setEditing(profile);
                    setManager(true);
                    setLayoutMenu(false);
                  }}
                >
                  <SettingsIcon size={14} />
                  当前连接设置
                </button>
              </div>
            )}
          </div>
        )}
        <Transfers autoOpen={settings.features.transferAutoOpen} />
        {settings.features.ai && (
          <button
            className="icon-button"
            title="AI 命令助手"
            aria-expanded={aiOpen}
            onClick={() => setAiOpen(!aiOpen)}
          >
            <Sparkles size={17} />
          </button>
        )}
        <button className="icon-button" title="工作区设置" onClick={() => setPrefs('basic')}>
          <SettingsIcon size={17} />
        </button>
      </div>
    </div>
  );
  return (
    <div
      className={
        'app ' +
        (settings.appearance.workspace.kind === 'image' && settings.appearance.workspace.image
          ? 'workspace-image'
          : '')
      }
      style={
        {
          ...workspaceBackground,
          '--ui-font': settings.appearance.uiFont,
          '--ui-font-scale': settings.appearance.uiFontSize / 12,
        } as CSSProperties
      }
    >
      <FileActions
        sessionId={active}
        server={
          current
            ? `${sessionLabel(current.profile, settings.sessionNameMode)} · ${current.profile.username}@${current.profile.host}`
            : ''
        }
        connected={!!current?.connected}
        onSendAI={
          settings.features.ai
            ? (paths) => {
                ai.addAttachments(
                  paths.map((path) => ({
                    kind: 'path',
                    path,
                    sessionId: active,
                    label: current?.profile.name || '服务器',
                  })),
                );
                setAiOpen(true);
              }
            : undefined
        }
        target={fileTarget}
        setTarget={setFileTarget}
        openPath={openTextPath}
        setOpenPath={setOpenTextPath}
        navigate={(p) => void loadFiles(p)}
        changeDirectory={async (p) => {
          if (await sendToSessions('cd -- ' + quote(p), 'current', true))
            setFocusTerminal((n) => n + 1);
        }}
        refresh={() => {
          void loadFiles();
          setTreeRevision((v) => v + 1);
        }}
        notify={notify}
      />
      {fileDrop.dialog}
      {tabActions.ui}

      <div className="app-body">
        {current && settings.features.monitoring && (
          <aside
            className={'sidebar ' + (layout.monitorClosed ? 'panel-collapsed' : '')}
            style={{
              display: !current ? 'none' : undefined,
              width: layout.monitorClosed ? 0 : layout.monitor,
              minWidth: layout.monitorClosed ? 0 : layout.monitor,
            }}
          >
            <div className="sidebar-title">
              <span>服务器概览</span>
              <button className="icon-button" title="连接管理" onClick={() => setManager(true)}>
                <MoreHorizontal size={18} />
              </button>
            </div>
            <div className="server-card">
              <div className="server-symbol">
                <Server size={22} />
              </div>
              <div>
                <strong>{current ? profile.name : '尚未连接'}</strong>
                <span>{current ? profile.host : '新建连接开始工作'}</span>
              </div>
              <span className={'status-dot ' + (!current?.connected ? 'offline' : '')} />
            </div>
            <div className="server-meta">
              <span>
                <ShieldCheck size={12} />
                SSH 加密连接
              </span>
              <span>{metrics ? Math.floor(metrics.uptime / 86400) + ' 天运行' : '等待连接'}</span>
            </div>
            {metrics && current ? (
              <>
                <div className="os-label">
                  {metrics.os}
                  <br />
                  <span>{metrics.hostname}</span>
                </div>
                <button className="metric" onClick={() => setDetail('cpu')}>
                  <MetricHead icon={Cpu} label="CPU 使用率" right={`${metrics.cores.length} 核`} />
                  <div className="metric-value">
                    {metrics.cpu.toFixed(1)}
                    <small>%</small>
                    <span>负载 {metrics.load.map((x) => x.toFixed(2)).join(' / ')}</span>
                  </div>
                  <Spark values={trends[active] || [0, metrics.cpu]} />
                  <div className="core-mini">
                    {metrics.cores.slice(0, 16).map((v, i) => (
                      <i
                        key={i}
                        title={`CPU ${i}: ${v.toFixed(1)}%`}
                        style={{ background: `rgba(23,169,149,${0.15 + v / 120})` }}
                      />
                    ))}
                  </div>
                </button>
                <button className="metric" onClick={() => setDetail('memory')}>
                  <MetricHead icon={MemoryStick} label="内存" right="详情" />
                  <div className="memory-row">
                    <div
                      className="donut"
                      style={{
                        background: `conic-gradient(#5591ec ${memoryPercent}%, #edf1f7 0)`,
                      }}
                    >
                      <span>
                        {memoryPercent.toFixed(0)}
                        <small>%</small>
                      </span>
                    </div>
                    <div>
                      <strong>
                        {bytes(metrics.memory.total - metrics.memory.available)}{' '}
                        <em>/ {bytes(metrics.memory.total)}</em>
                      </strong>
                      <small>
                        <i className="legend blue" />
                        已使用 <i className="legend gray" />
                        可用
                      </small>
                      <small>缓存 {bytes(metrics.memory.cached)}</small>
                    </div>
                  </div>
                </button>
                <button className="metric" onClick={() => setDetail('network')}>
                  <MetricHead icon={Network} label="网络流量" right={mainNetwork?.name || '—'} />
                  <div className="network-values">
                    <span>
                      <ArrowDown size={13} />
                      <b>{bytes(totalRx)}</b>
                      <small>/s</small>
                    </span>
                    <span>
                      <ArrowUp size={13} />
                      <b>{bytes(totalTx)}</b>
                      <small>/s</small>
                    </span>
                  </div>
                  <Spark values={netTrends[active] || []} color="#5996ea" />
                </button>
                <button className="metric process-preview" onClick={() => setDetail('process')}>
                  <MetricHead icon={Activity} label="活跃进程" right="查看全部" />
                  {metrics.processes.slice(0, 3).map((p) => (
                    <div key={p.pid}>
                      <span>{p.command.split(' ')[0]}</span>
                      <small>{bytes(p.memory)}</small>
                      <b>{p.cpu}%</b>
                    </div>
                  ))}
                </button>
                <div className="metric disks">
                  <button className="plain metric-head-button" onClick={() => setDetail('disk')}>
                    <MetricHead icon={HardDrive} label="磁盘与 I/O" right="详情" />
                  </button>
                  {metrics.disks
                    .filter((d) => !d.path.startsWith('/sys'))
                    .slice(0, 5)
                    .map((d) => (
                      <button
                        className="disk-row"
                        key={d.path}
                        onClick={() => {
                          setDetail('disk');
                        }}
                      >
                        <div>
                          <span>
                            <Folder size={12} />
                            {d.path}
                          </span>
                          <b>{d.percent}%</b>
                        </div>
                        <Bar value={d.percent} color={d.percent > 85 ? '#e59f49' : undefined} />
                        <small>
                          {bytes(d.used)} / {bytes(d.total)}
                        </small>
                      </button>
                    ))}
                </div>
              </>
            ) : (
              <div className="empty">添加服务器后查看实时指标</div>
            )}
          </aside>
        )}
        {current && settings.features.monitoring && !layout.monitorClosed && (
          <ResizeHandle
            label="调整监控栏宽度"
            axis="x"
            value={layout.monitor}
            min={180}
            max={480}
            onChange={(v) => setLayout({ ...layout, monitor: v })}
            onCollapse={() => setLayout({ ...layout, monitorClosed: true })}
          />
        )}
        <main className="workspace">
          {sessionBar}
          {!current && (
            <NewTab
              settings={settings}
              connect={(p) => void connectRecent(p)}
              busy={connecting}
              clear={() => setSettings((s) => ({ ...s, recentConnections: [] }))}
            />
          )}
          <div className="session-workspace" style={{ display: current ? undefined : 'none' }}>
            {monitorError && <div className="inline-warning">监控暂不可用：{monitorError}</div>}
            <section
              className={'terminal-panel' + (activeTool ? ' tool-active' : '')}
              data-image={terminalBackground.backgroundImage !== 'none'}
              style={terminalBackground}
            >
              <div className="terminal-floating-tools">
                {showSearch ? (
                  <div className="terminal-search" role="search" aria-label="搜索终端输出">
                    <Search size={14} />
                    <input
                      ref={searchInput}
                      aria-label="终端搜索"
                      placeholder="搜索终端输出"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setSearchFound(true);
                        setSearchStep((s) => ({ direction: 'next', sequence: s.sequence + 1 }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          setSearchStep((s) => ({
                            direction: e.shiftKey ? 'previous' : 'next',
                            sequence: s.sequence + 1,
                          }));
                        }
                        if (e.key === 'Escape') {
                          setShowSearch(false);
                          setSearch('');
                          setFocusTerminal((n) => n + 1);
                        }
                      }}
                    />
                    {search && !searchFound && <small role="status">无结果</small>}
                    <button
                      title="上一个匹配 (Shift+Enter)"
                      disabled={!search}
                      onClick={() =>
                        setSearchStep((s) => ({
                          direction: 'previous',
                          sequence: s.sequence + 1,
                        }))
                      }
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      title="下一个匹配 (Enter)"
                      disabled={!search}
                      onClick={() =>
                        setSearchStep((s) => ({ direction: 'next', sequence: s.sequence + 1 }))
                      }
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      title="关闭搜索 (Esc)"
                      onClick={() => {
                        setShowSearch(false);
                        setSearch('');
                        setFocusTerminal((n) => n + 1);
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    className="search-trigger"
                    title="搜索输出"
                    aria-label={`搜索输出 (${terminalShortcut('F')})`}
                    onClick={() => setShowSearch(true)}
                  >
                    <Search size={16} />
                  </button>
                )}
              </div>
              <div className="terminal-area">
                {activeTool && (!activeTool.kind || activeTool.kind === 'capture') && current && (
                  <Suspense fallback={<div className="empty">正在打开抓包工具…</div>}>
                    <CaptureTool
                      sessionId={active}
                      name={
                        settings.profiles.find((p) => p.id === current.profile.id)?.name ||
                        current.profile.name
                      }
                      host={current.profile.host}
                      connected={current.connected}
                      model={capture}
                    />
                  </Suspense>
                )}
                {toolTabs
                  .filter((t) => t.kind === 'certificate')
                  .map((tool) => {
                    const source = sessions.find((s) => s.id === tool.sessionId);
                    return (
                      source && (
                        <div
                          key={tool.id}
                          style={{
                            display: activeTab === tool.id ? 'block' : 'none',
                            height: '100%',
                          }}
                        >
                          <Suspense fallback={<div className="empty">正在打开证书工具…</div>}>
                            <CertificateTool
                              sessionId={tool.sessionId}
                              name={sessionLabel(source.profile, settings.sessionNameMode)}
                              host={source.profile.host}
                              connected={source.connected}
                              onUpgrade={(initial) => openNginx(tool.sessionId, initial)}
                            />
                          </Suspense>
                        </div>
                      )
                    );
                  })}
                {toolTabs
                  .filter((t) => t.kind === 'deploy')
                  .map((tool) => {
                    const source = sessions.find((s) => s.id === tool.sessionId);
                    return (
                      source && (
                        <div
                          key={tool.id}
                          style={{
                            display: activeTab === tool.id ? 'block' : 'none',
                            height: '100%',
                          }}
                        >
                          <Suspense fallback={<div className="empty">正在打开部署工具…</div>}>
                            <DeploymentTool
                              sessionId={tool.sessionId}
                              profileId={source.profile.id}
                              name={sessionLabel(source.profile, settings.sessionNameMode)}
                              address={`${source.profile.username}@${source.profile.host}:${source.profile.port}`}
                              connected={source.connected}
                            />
                          </Suspense>
                        </div>
                      )
                    );
                  })}
                {toolTabs
                  .filter((t) => t.kind === 'nginx')
                  .map((tool) => {
                    const source = sessions.find((s) => s.id === tool.sessionId);
                    return (
                      source && (
                        <div
                          key={tool.id}
                          style={{
                            display: activeTab === tool.id ? 'block' : 'none',
                            height: '100%',
                          }}
                        >
                          <Suspense
                            fallback={<div className="empty">正在打开 Nginx 升级工具…</div>}
                          >
                            <NginxUpgradeTool
                              sessionId={tool.sessionId}
                              name={sessionLabel(source.profile, settings.sessionNameMode)}
                              host={source.profile.host}
                              connected={source.connected}
                              initial={tool.initial}
                              onCertificate={() => openCertificate(tool.sessionId)}
                            />
                          </Suspense>
                        </div>
                      )
                    );
                  })}
                <Suspense fallback={<div className="terminal-empty">正在打开终端…</div>}>
                  {sessions.map((s) => (
                    <Terminal
                      key={s.id}
                      id={s.id}
                      active={activeTab === s.id}
                      connected={s.connected}
                      search={active === s.id ? search : ''}
                      searchStep={searchStep}
                      focusRequest={focusTerminal}
                      appearance={appearance}
                      scrollback={settings.performance.scrollback}
                      historyCells={settings.performance.historyCells}
                      sessionCount={sessions.length}
                      onSendAI={
                        settings.features.ai
                          ? (text) => {
                              if (text.length > 64000) {
                                notify('选中内容过长，请缩小到 64000 字符以内');
                                return;
                              }
                              ai.addAttachments([
                                { kind: 'selection', text, sessionId: s.id, label: s.profile.name },
                              ]);
                              setAiOpen(true);
                            }
                          : undefined
                      }
                      onSearchResult={setSearchFound}
                      onRequestSearch={(text) => {
                        setShowSearch(true);
                        setSearch(text);
                        setSearchFound(true);
                        setSearchStep((step) => ({
                          direction: 'next',
                          sequence: step.sequence + 1,
                        }));
                        requestAnimationFrame(() => searchInput.current?.focus());
                      }}
                      report={notify}
                    />
                  ))}
                </Suspense>
                {!current && (
                  <div className="terminal-empty">
                    <TerminalIcon size={40} />
                    <p>你的下一次连接，从这里开始</p>
                    <button className="primary" onClick={() => setManager(true)}>
                      添加服务器
                    </button>
                  </div>
                )}
              </div>
              {!activeTool && (
                <CommandInput
                  value={command}
                  change={setCommand}
                  inputRef={cmdInput}
                  history={settings.history[profile.id] || []}
                  snippets={commands}
                  profileId={active}
                  disabled={!current?.connected}
                  send={(text) => sendToSessions(text, 'current', true)}
                  complete={complete}
                  clearHistory={() =>
                    setSettings((s) => ({ ...s, history: { ...s.history, [profile.id]: [] } }))
                  }
                />
              )}
            </section>
            {!layout.filesClosed &&
              activeTool?.kind !== 'certificate' &&
              activeTool?.kind !== 'nginx' && (
                <ResizeHandle
                  label="调整文件面板高度"
                  axis="y"
                  value={layout.files}
                  min={150}
                  max={Math.max(180, window.innerHeight - 320)}
                  onChange={(v) => setLayout({ ...layout, files: v })}
                  onCollapse={() => setLayout({ ...layout, filesClosed: true })}
                />
              )}
            <section
              className={'bottom-panel ' + (layout.filesClosed ? 'bottom-collapsed' : '')}
              style={{
                height: layout.filesClosed ? 40 : layout.files,
                display:
                  activeTool?.kind === 'certificate' || activeTool?.kind === 'nginx'
                    ? 'none'
                    : undefined,
              }}
            >
              <div className="bottom-tabs">
                {[
                  { id: 'files', label: '文件管理', icon: FolderOpen },
                  { id: 'commands', label: '命令库', icon: Command },
                  { id: 'history', label: '执行历史', icon: History },
                  { id: 'tools', label: '工具包', icon: Activity },
                ]
                  .filter((item) => item.id !== 'tools' || settings.features.toolkit)
                  .map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      className={bottom === id ? 'active' : ''}
                      onClick={() => {
                        setBottom(id);
                        setLayout({ ...layout, filesClosed: false });
                      }}
                    >
                      <Icon size={15} />
                      {label}
                      {id === 'commands' && <small>{commands.length}</small>}
                    </button>
                  ))}
                <span className="bottom-hint">
                  {`${(profile.tunnels || []).filter((t) => t.enabled).length} 条隧道 · SFTP`}
                </span>
                <button
                  title="折叠文件面板"
                  onClick={() => setLayout({ ...layout, filesClosed: !layout.filesClosed })}
                >
                  {layout.filesClosed ? <ChevronDown size={14} /> : <X size={14} />}
                </button>
              </div>
              {bottom === 'files' ? (
                <>
                  <div className="file-toolbar">
                    <button
                      disabled={!settings.features.directoryTree}
                      title="切换目录树"
                      onClick={() => setLayout({ ...layout, treeClosed: !layout.treeClosed })}
                    >
                      <Layers size={15} />
                    </button>
                    <label className="follow-toggle" title={syncStatus}>
                      <input
                        type="checkbox"
                        checked={follow}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            features: { ...s.features, directoryFollow: e.target.checked },
                          }))
                        }
                      />
                      跟随终端
                    </label>
                    <button
                      title="上级目录"
                      onClick={() =>
                        void loadFiles(
                          path === '.' ? '..' : path.split('/').slice(0, -1).join('/') || '/',
                        )
                      }
                    >
                      <ArrowUp size={15} />
                    </button>
                    <Folder size={15} />
                    <input
                      aria-label="远程目录"
                      value={pathInput}
                      onChange={(e) => setPathInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void loadFiles(pathInput);
                      }}
                    />
                    <button title="刷新文件" onClick={() => void loadFiles()}>
                      <RefreshCw size={14} className={fileBusy ? 'spin' : ''} />
                    </button>
                    <div className="file-search">
                      <Search size={13} />
                      <input
                        aria-label="筛选文件"
                        placeholder="筛选文件"
                        value={fileFilter}
                        onChange={(e) => setFileFilter(e.target.value)}
                      />
                    </div>
                    <button
                      onClick={async () => {
                        setFileBusy(true);
                        try {
                          const result = await window.elu!.upload(active, path);
                          if (result) {
                            notify('上传完成：' + result);
                            void loadFiles();
                          }
                        } catch (e) {
                          notify(String(e));
                        } finally {
                          setFileBusy(false);
                        }
                      }}
                      disabled={fileBusy || !current?.connected}
                    >
                      <Upload size={14} />
                      上传文件
                    </button>
                  </div>
                  <div
                    className={
                      'file-content' + (fileDrop.hover?.kind === 'upload' ? ' external-drop' : '')
                    }
                    {...fileDrop.area}
                  >
                    {settings.features.directoryTree && !layout.treeClosed && (
                      <>
                        <div className="tree-pane" style={{ width: layout.tree }}>
                          <DirectoryTree
                            key={active}
                            revision={treeRevision}
                            dropTarget={
                              fileDrop.hover?.tree && !fileDrop.hover.error
                                ? fileDrop.hover.path
                                : null
                            }
                            onContext={(e, p, mode) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setFileTarget({
                                path: p,
                                mode,
                                directory: true,
                                x: e.clientX,
                                y: e.clientY,
                              });
                            }}
                            selected={path}
                            load={(p) => window.elu!.files(active, p)}
                            onSelect={(p) => void loadFiles(p)}
                          />
                        </div>
                        <ResizeHandle
                          label="调整目录树宽度"
                          axis="x"
                          value={layout.tree}
                          min={140}
                          max={500}
                          onChange={(v) => setLayout({ ...layout, tree: v })}
                          onCollapse={() => setLayout({ ...layout, treeClosed: true })}
                        />
                      </>
                    )}
                    <div
                      className={
                        'file-table-wrap' +
                        (fileDrop.hover?.kind === 'upload' &&
                        !fileDrop.hover.tree &&
                        !fileDrop.hover.error
                          ? ' file-drop-zone'
                          : '')
                      }
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setFileTarget({ path, directory: true, x: e.clientX, y: e.clientY });
                      }}
                    >
                      {fileError ? (
                        <div className="empty">{fileError}</div>
                      ) : (
                        <table className="file-table">
                          <thead>
                            <tr>
                              {(
                                [
                                  ['name', '名称'],
                                  ['size', '大小'],
                                  ['modified', '修改时间'],
                                  ['mode', '权限'],
                                  ['owner', '用户 / 用户组'],
                                ] as const
                              ).map(([field, label]) => (
                                <th
                                  key={field}
                                  aria-sort={
                                    fileSort.field === field
                                      ? fileSort.descending
                                        ? 'descending'
                                        : 'ascending'
                                      : 'none'
                                  }
                                >
                                  <button
                                    onClick={() =>
                                      setFileSort((s) => ({
                                        field,
                                        descending: s.field === field ? !s.descending : false,
                                      }))
                                    }
                                  >
                                    {label}
                                    {fileSort.field === field &&
                                      (fileSort.descending ? (
                                        <ArrowDown size={11} />
                                      ) : (
                                        <ArrowUp size={11} />
                                      ))}
                                  </button>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {visibleFiles.map((f) => (
                              <tr
                                key={f.name}
                                aria-selected={fileSelection.names.includes(f.name)}
                                className={
                                  (fileSelection.names.includes(f.name) ? 'file-selected' : '') +
                                  (fileDrop.hover?.kind === 'upload' &&
                                  !fileDrop.hover.tree &&
                                  !fileDrop.hover.error &&
                                  f.directory &&
                                  fileDrop.hover.path === remotePath(f.name, path)
                                    ? ' file-drop-target'
                                    : '')
                                }
                                draggable={!!current?.connected && !fileBusy}
                                onDragStart={(e) => {
                                  const entries = fileSelection.names.includes(f.name)
                                    ? selectedFiles
                                    : [f];
                                  if (!fileSelection.names.includes(f.name))
                                    setFileSelection({ names: [f.name], anchor: f.name });
                                  setFileTarget(null);
                                  fileDrop.begin(e, entries);
                                }}
                                onDragEnd={fileDrop.end}
                                onMouseDown={(e) => {
                                  if (e.shiftKey) e.preventDefault();
                                }}
                                onClick={(e) => {
                                  setFileTarget(null);
                                  setFileSelection((s) =>
                                    selectFiles(s, visibleNames, f.name, {
                                      toggle: e.ctrlKey || e.metaKey,
                                      range: e.shiftKey,
                                    }),
                                  );
                                }}
                                data-drop-directory={
                                  f.directory ? remotePath(f.name, path) : undefined
                                }
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  const targets = fileSelection.names.includes(f.name)
                                    ? selectedFiles
                                    : [f];
                                  if (!fileSelection.names.includes(f.name))
                                    setFileSelection({ names: [f.name], anchor: f.name });
                                  setFileTarget({
                                    path: remotePath(f.name, path),
                                    directory: f.directory,
                                    mode: f.mode,
                                    x: e.clientX,
                                    y: e.clientY,
                                    paths: targets.map((entry) => remotePath(entry.name, path)),
                                    entries: targets.map((entry) => ({
                                      path: remotePath(entry.name, path),
                                      directory: entry.directory,
                                      mode: entry.mode,
                                    })),
                                  });
                                }}
                                onDoubleClick={(e) => {
                                  if (e.ctrlKey || e.metaKey || e.shiftKey) return;
                                  f.directory
                                    ? void loadFiles(remotePath(f.name, path))
                                    : setOpenTextPath(remotePath(f.name, path));
                                }}
                              >
                                <td>
                                  <button>
                                    {f.directory ? (
                                      <Folder size={17} className="folder-icon" />
                                    ) : (
                                      <File size={16} />
                                    )}
                                    <span>{f.name}</span>
                                  </button>
                                </td>
                                <td>{f.directory ? '—' : bytes(f.size)}</td>
                                <td>
                                  {new Date(f.modified * 1000).toLocaleString('zh-CN', {
                                    hour12: false,
                                  })}
                                </td>
                                <td>
                                  <code>{(f.mode & 0o777).toString(8)}</code>
                                </td>
                                <td title={fileOwner(f)}>{fileOwner(f)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                  <div className="file-footer">
                    {files.length} 个项目
                    {selectedFiles.length > 0 && ` · 已选择 ${selectedFiles.length} 项`}
                    <span>
                      {fileDrop.hint ||
                        'Ctrl / ⌘ 多选 · Shift 连选 · 拖到左侧目录移动 · 从电脑拖入上传'}
                    </span>
                  </div>
                </>
              ) : bottom === 'tools' ? (
                <Suspense fallback={<div className="empty">正在打开工具包…</div>}>
                  <Toolbox
                    enabled={settings.features.toolkit}
                    open={() => openCapture()}
                    deploy={openDeployment}
                    nginx={() => openNginx()}
                    certificate={() => openCertificate()}
                  />
                </Suspense>
              ) : bottom === 'commands' ? (
                <Suspense fallback={<div className="empty">正在加载命令库…</div>}>
                  <CommandWorkspace
                    settings={settings}
                    update={setSettings}
                    send={sendToSessions}
                    connectedCount={sessions.filter((s) => s.connected).length}
                    notify={notify}
                  />
                </Suspense>
              ) : (
                <div className="history-list">
                  <div className="section-caption">
                    <span>当前服务器最近 100 条命令</span>
                    <button
                      onClick={() =>
                        setSettings((s) => ({
                          ...s,
                          history: { ...s.history, [profile.id]: [] },
                        }))
                      }
                    >
                      清空历史
                    </button>
                  </div>
                  {(settings.history[profile.id] || []).map((c, i) => (
                    <button key={c} onClick={() => fill(c)}>
                      <Clock size={14} />
                      <small>{String(i + 1).padStart(2, '0')}</small>
                      <code>{c}</code>
                      <Copy size={13} />
                    </button>
                  ))}
                  {!settings.history[profile.id]?.length && (
                    <div className="empty">从输入栏、命令库或编辑器发送的命令会记录在这里</div>
                  )}
                </div>
              )}
            </section>
            <footer className="statusbar">
              <span>
                <span className={'status-dot ' + (!current?.connected ? 'offline' : '')} />
                {current?.connected ? '已连接' : '未连接'}
                <i />
                UTF-8
                <i />
                xterm-256color
              </span>
              <span>
                {!settings.features.monitoring
                  ? '监控已停用'
                  : backgroundPaused
                    ? '自动查询已暂停'
                    : monitorError
                      ? '指标采集失败'
                      : `监控间隔 ${settings.pollSeconds}s`}
                <i />
                {metrics ? new Date(metrics.at).toLocaleTimeString('zh-CN') : ''}
                <ShieldCheck size={12} />
              </span>
            </footer>
          </div>
        </main>
        {settings.features.ai && aiOpen && (
          <AISidebar
            model={ai}
            close={() => setAiOpen(false)}
            settings={() => setPrefs('ai')}
            sessionId={current?.connected ? current.id : undefined}
            connectedName={current?.connected ? current.profile.name : undefined}
          />
        )}
      </div>
      {closingTool && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-label="停止抓包并关闭">
            <div className="modal-header">
              <h2>正在抓包</h2>
            </div>
            <div className="modal-content">
              <p>关闭后会停止此服务器的抓包任务，已采集的完整数据包保留在本机。</p>
              <div className="capture-actions">
                <button disabled={closingBusy} onClick={() => setClosingTool(null)}>
                  取消
                </button>
                <button
                  className="primary"
                  disabled={closingBusy}
                  onClick={() => {
                    setClosingBusy(true);
                    void window
                      .elu!.captureStopSession(closingTool.sessionId)
                      .then(() => {
                        finalizeClose(closingTool.id);
                        setClosingTool(null);
                      })
                      .catch((e) => notify(String(e)))
                      .finally(() => setClosingBusy(false));
                  }}
                >
                  {closingBusy ? '正在停止…' : '停止并关闭'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{toast}</span>
          <button onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {detail === 'process' && current && (
        <ProcessManager
          sessionId={active}
          name={profile.name}
          onClose={() => setDetail('')}
          onCapture={
            settings.features.toolkit
              ? async (pid) => {
                  const ports = await window.elu!.capturePorts(active, pid);
                  if (!ports.length) {
                    notify('未找到可见的监听端口，请在抓包页填写条件');
                    openCapture();
                  } else if (ports.length === 1) openCapture(active, ports[0]);
                  else {
                    capture.setDraft(active, {
                      ...capture.draft(active),
                      filter: ports.map((p) => 'port ' + p).join(' or '),
                    });
                    openCapture();
                  }
                }
              : undefined
          }
        />
      )}
      {detail && detail !== 'process' && metrics && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDetail('');
          }}
        >
          <section className="modal detail-modal">
            <div className="modal-header">
              <div>
                <h2>
                  {
                    {
                      cpu: 'CPU 与系统负载',
                      memory: '内存详情',
                      network: '网络与路由',
                      disk: '磁盘与 I/O',
                      process: '进程管理',
                    }[detail]
                  }
                </h2>
                <p>{profile.name} · 只读实时指标</p>
              </div>
              <button onClick={() => setDetail('')}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-content">
              {detail === 'cpu' ? (
                <>
                  <div className="stat-cards">
                    <div>
                      <small>总 CPU 使用率</small>
                      <strong>{metrics.cpu.toFixed(1)}%</strong>
                    </div>
                    <div>
                      <small>1 / 5 / 15 分钟负载</small>
                      <strong>{metrics.load.join(' / ')}</strong>
                    </div>
                  </div>
                  <h3>各逻辑核心</h3>
                  <div className="cores-grid">
                    {metrics.cores.map((v, i) => (
                      <div key={i}>
                        <span>
                          CPU {i}
                          <b>{v.toFixed(1)}%</b>
                        </span>
                        <Bar value={v} />
                      </div>
                    ))}
                  </div>
                  <h3>当前会话趋势</h3>
                  <Spark values={trends[active] || []} />
                  <p className="muted-label">
                    真实连接首个采样作为基线，从第二次采样计算 CPU 占用。
                  </p>
                </>
              ) : detail === 'memory' ? (
                <>
                  <div className="stat-cards">
                    {[
                      ['总内存', metrics.memory.total],
                      ['可用内存', metrics.memory.available],
                      ['页缓存', metrics.memory.cached],
                      ['交换已用', metrics.memory.swapTotal - metrics.memory.swapFree],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <small>{k}</small>
                        <strong>{bytes(Number(v))}</strong>
                      </div>
                    ))}
                  </div>
                  <h3>实际内存压力（1 − MemAvailable / MemTotal）</h3>
                  <Bar value={memoryPercent} color="#5591ec" />
                  <p>可用内存包含可回收缓存。交换空间总计 {bytes(metrics.memory.swapTotal)}。</p>
                </>
              ) : detail === 'network' ? (
                <>
                  <table>
                    <thead>
                      <tr>
                        <th>接口</th>
                        <th>下载 / 秒</th>
                        <th>上传 / 秒</th>
                        <th>累计接收</th>
                        <th>累计发送</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.network.map((n) => (
                        <tr key={n.name}>
                          <td>{n.name}</td>
                          <td>{bytes(n.rxRate)}</td>
                          <td>{bytes(n.txRate)}</td>
                          <td>{bytes(n.rx)}</td>
                          <td>{bytes(n.tx)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <h3>路由表</h3>
                  <pre>{metrics.routes}</pre>
                  <h3>
                    TCP / UDP 连接{' '}
                    {settings.features.toolkit && (
                      <button onClick={() => openCapture()}>打开抓包工具</button>
                    )}
                  </h3>
                  <pre>{metrics.sockets}</pre>
                </>
              ) : detail === 'disk' ? (
                <>
                  <table>
                    <thead>
                      <tr>
                        <th>挂载目录</th>
                        <th>已用</th>
                        <th>总量</th>
                        <th>使用率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.disks.map((d) => (
                        <tr key={d.path}>
                          <td>{d.path}</td>
                          <td>{bytes(d.used)}</td>
                          <td>{bytes(d.total)}</td>
                          <td>{d.percent}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <h3>块设备 I/O 速率</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>设备</th>
                        <th>读取 / 秒</th>
                        <th>写入 / 秒</th>
                        <th>IOPS</th>
                        <th>忙碌率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(ioMap[active] || []).map((d) => (
                        <tr key={d.name}>
                          <td>{d.name}</td>
                          <td>{bytes(d.readRate)}</td>
                          <td>{bytes(d.writeRate)}</td>
                          <td>{d.iops.toFixed(1)}</td>
                          <td>{d.utilization.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <h3>块设备 I/O 原始计数</h3>
                  <pre>{metrics.diskIO}</pre>
                  <p className="muted-label">
                    目录容量按挂载点展示；I/O 为设备累计读写计数，可用 iostat 命令进一步诊断。
                  </p>
                </>
              ) : null}
            </div>
          </section>
        </div>
      )}
      {manager && (
        <ConnectionManager
          settings={settings}
          initial={editing}
          onChange={setSettings}
          onConnect={connect}
          onClose={() => {
            setManager(false);
            setEditing(null);
          }}
        />
      )}
      {prefs && (
        <Preferences
          initial={prefs}
          settings={settings}
          setSettings={setSettings}
          ai={ai}
          updates={updates}
          close={() => setPrefs(null)}
        />
      )}
      <UpdatePrompt model={updates} />
    </div>
  );
}
