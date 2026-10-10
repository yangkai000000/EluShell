import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { Bridge, SessionEvent, Transfer } from '../src/shared';
import type { UpdateStatus } from '../src/update-shared';
const sessionListeners = new Map<string, Set<(event: SessionEvent) => void>>();
const dispatchSession = (_: unknown, event: SessionEvent) => {
  for (const key of ['*', event.id, ...(event.type === 'data' ? [] : ['status'])])
    for (const fn of sessionListeners.get(key) || []) fn(event);
};
const api: Bridge = {
  nginxUpgradeInspect: (id, source) => ipcRenderer.invoke('nginx-upgrade-inspect', id, source),
  nginxUpgradeStart: (id, preview) => ipcRenderer.invoke('nginx-upgrade-start', id, preview),
  nginxUpgradeList: (id) => ipcRenderer.invoke('nginx-upgrade-list', id),
  onNginxUpgrade: (fn) => {
    const cb = (_: unknown, job: import('../src/nginx-upgrade-shared').NginxUpgradeJob) => fn(job);
    ipcRenderer.on('nginx-upgrade-event', cb);
    return () => ipcRenderer.removeListener('nginx-upgrade-event', cb);
  },
  certificateInspect: (id, source) => ipcRenderer.invoke('certificate-inspect', id, source),
  certificatePrepare: (id, options) => ipcRenderer.invoke('certificate-prepare', id, options),
  certificateStart: (id, preview) => ipcRenderer.invoke('certificate-start', id, preview),
  certificateList: (id) => ipcRenderer.invoke('certificate-list', id),
  onCertificate: (fn) => {
    const cb = (_: unknown, job: import('../src/certificate-shared').CertificateJob) => fn(job);
    ipcRenderer.on('certificate-event', cb);
    return () => ipcRenderer.removeListener('certificate-event', cb);
  },
  deploymentState: (id) => ipcRenderer.invoke('deployment-state', id),
  deploymentSave: (id, plan) => ipcRenderer.invoke('deployment-save', id, plan),
  deploymentRemove: (id, plan) => ipcRenderer.invoke('deployment-remove', id, plan),
  deploymentStart: (id, plan) => ipcRenderer.invoke('deployment-start', id, plan),
  deploymentStop: (id) => ipcRenderer.invoke('deployment-stop', id),
  deploymentPick: (kind) => ipcRenderer.invoke('deployment-pick', kind),
  onDeploymentPlans: (fn) => {
    const cb = (_: unknown, plans: import('../src/deployment-shared').DeploymentPlan[]) =>
      fn(plans);
    ipcRenderer.on('deployment-plans-event', cb);
    return () => ipcRenderer.removeListener('deployment-plans-event', cb);
  },
  onDeployment: (fn) => {
    const cb = (_: unknown, job: import('../src/deployment-shared').DeploymentJob) => fn(job);
    ipcRenderer.on('deployment-event', cb);
    return () => ipcRenderer.removeListener('deployment-event', cb);
  },
  captureCheck: (id, sudo) => ipcRenderer.invoke('capture-check', id, sudo),
  captureRemove: (id) => ipcRenderer.invoke('capture-remove', id),
  captureStart: (id, options) => ipcRenderer.invoke('capture-start', id, options),
  captureStop: (id) => ipcRenderer.invoke('capture-stop', id),
  captureStopSession: (id) => ipcRenderer.invoke('capture-stop-session', id),
  captureList: () => ipcRenderer.invoke('capture-list'),
  captureExport: (id) => ipcRenderer.invoke('capture-export', id),
  captureOpen: (id) => ipcRenderer.invoke('capture-open', id),
  capturePorts: (id, pid) => ipcRenderer.invoke('capture-ports', id, pid),
  onCapture: (fn) => {
    const cb = (_: unknown, job: import('../src/capture-shared').CaptureJob) => fn(job);
    ipcRenderer.on('capture-event', cb);
    return () => ipcRenderer.removeListener('capture-event', cb);
  },
  aiImage: (asset) => ipcRenderer.invoke('ai-image', asset),
  aiState: () => ipcRenderer.invoke('ai-state'),
  aiConfigure: (c, k) => ipcRenderer.invoke('ai-configure', c, k),
  aiCreate: (p) => ipcRenderer.invoke('ai-create', p),
  aiGet: (id) => ipcRenderer.invoke('ai-get', id),
  aiSend: (id, input, retry) => ipcRenderer.invoke('ai-send', id, input, retry),
  aiCancel: (id) => ipcRenderer.invoke('ai-cancel', id),
  aiRename: (id, title) => ipcRenderer.invoke('ai-rename', id, title),
  aiDelete: (id) => ipcRenderer.invoke('ai-delete', id),
  onAI: (fn) => {
    const cb = (_: unknown, e: import('../src/ai-shared').AIEvent) => fn(e);
    ipcRenderer.on('ai-event', cb);
    return () => ipcRenderer.removeListener('ai-event', cb);
  },
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  writeClipboard: (text) => ipcRenderer.invoke('write-clipboard', text),
  updateStatus: () => ipcRenderer.invoke('update-status'),
  openUpdateGuide: () => ipcRenderer.invoke('open-update-guide'),
  configureUpdates: (p) => ipcRenderer.invoke('configure-updates', p),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  cancelUpdate: () => ipcRenderer.invoke('cancel-update'),
  dismissUpdate: (ignore) => ipcRenderer.invoke('dismiss-update', ignore),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdate: (fn) => {
    const cb = (_: unknown, state: UpdateStatus) => fn(state);
    ipcRenderer.on('update-event', cb);
    return () => ipcRenderer.removeListener('update-event', cb);
  },
  chooseBackground: () => ipcRenderer.invoke('choose-background'),
  backgroundImage: (image) => ipcRenderer.invoke('background-image', image),
  credentialStatus: (p) => ipcRenderer.invoke('credential-status', p),
  saveCredential: (p, s, r) => ipcRenderer.invoke('save-credential', p, s, r),
  configInfo: () => ipcRenderer.invoke('config-info'),
  showConfigDirectory: () => ipcRenderer.invoke('show-config-directory'),
  chooseExportDirectory: () => ipcRenderer.invoke('choose-export-directory'),
  exportConnections: (s, includePasswords) =>
    ipcRenderer.invoke('export-connections', s, includePasswords),
  chooseConnectionImport: () => ipcRenderer.invoke('choose-connection-import'),
  importConnections: (b, s) => ipcRenderer.invoke('import-connections', b, s),
  processes: (id) => ipcRenderer.invoke('processes', id),
  terminateProcess: (id, pid, start) => ipcRenderer.invoke('terminate-process', id, pid, start),

  uploadFolder: (s, p) => ipcRenderer.invoke('upload-folder', s, p),
  transferList: () => ipcRenderer.invoke('transfer-list'),
  exportTransferDiagnostics: () => ipcRenderer.invoke('export-transfer-diagnostics'),
  cancelTransfer: (id) => ipcRenderer.invoke('cancel-transfer', id),
  downloadDirectory: () => ipcRenderer.invoke('download-directory'),
  chooseDownloadDirectory: () => ipcRenderer.invoke('choose-download-directory'),
  showDownloadDirectory: () => ipcRenderer.invoke('show-download-directory'),
  showTransfer: (id) => ipcRenderer.invoke('show-transfer', id),
  fileAction: (s, a) => ipcRenderer.invoke('file-action', s, a),
  fileActions: (s, a) => ipcRenderer.invoke('file-actions', s, a),
  moveFiles: (s, paths, directory) => ipcRenderer.invoke('move-files', s, paths, directory),
  openEditor: (s, p) => ipcRenderer.invoke('open-editor', s, p),
  openText: (s, p) => ipcRenderer.invoke('open-text', s, p),
  saveText: (d, t) => ipcRenderer.invoke('save-text', d, t),
  closeText: (d) => ipcRenderer.invoke('close-text', d),
  onTransfer: (fn) => {
    const cb = (_: unknown, event: Transfer) => fn(event);
    ipcRenderer.on('transfer-event', cb);
    return () => ipcRenderer.removeListener('transfer-event', cb);
  },
  cwd: (id) => ipcRenderer.invoke('cwd', id),
  realpath: (id, path) => ipcRenderer.invoke('realpath', id, path),
  start: (id) => ipcRenderer.invoke('start', id),
  load: () => ipcRenderer.invoke('load'),
  save: (s) => ipcRenderer.invoke('save', s),
  connect: (p, s) => ipcRenderer.invoke('connect', p, s),
  disconnect: (id, keepEditors) => ipcRenderer.invoke('disconnect', id, keepEditors),
  write: (id, data) => ipcRenderer.invoke('write', id, data),
  resize: (id, c, r) => ipcRenderer.invoke('resize', id, c, r),
  metrics: (id) => ipcRenderer.invoke('metrics', id),
  files: (id, p) => ipcRenderer.invoke('files', id, p),
  upload: (id, p) => ipcRenderer.invoke('upload', id, p),
  uploadDropped: (id, p, files) =>
    ipcRenderer.invoke(
      'upload-dropped',
      id,
      p,
      files.map((file) => webUtils.getPathForFile(file)),
    ),
  download: (id, p) => ipcRenderer.invoke('download', id, p),
  downloadMany: (id, paths) => ipcRenderer.invoke('download-many', id, paths),
  complete: (id, p) => ipcRenderer.invoke('complete', id, p),
  pickKey: () => ipcRenderer.invoke('pick-key'),
  terminalAck: (id, sequence) => ipcRenderer.invoke('terminal-ack', id, sequence),
  onEvent: (fn, filter) => {
    if (!sessionListeners.size) ipcRenderer.on('session-event', dispatchSession);
    const key = filter || '*';
    const listeners = sessionListeners.get(key) || new Set();
    listeners.add(fn);
    sessionListeners.set(key, listeners);
    return () => {
      listeners.delete(fn);
      if (!listeners.size) sessionListeners.delete(key);
      if (!sessionListeners.size) ipcRenderer.removeListener('session-event', dispatchSession);
    };
  },
};
contextBridge.exposeInMainWorld('elu', api);

const editor: import('../src/editor-shared').EditorBridge = {
  load: () => ipcRenderer.invoke('editor-load'),
  save: (id, text) => ipcRenderer.invoke('editor-save', id, text),
  state: (id, dirty) => ipcRenderer.send('editor-state', id, dirty),
  close: (id) => ipcRenderer.invoke('editor-close', id),
  activate: (id) => ipcRenderer.invoke('editor-activate', id),
  reorder: (id, before) => ipcRenderer.invoke('editor-reorder', id, before),
  detach: (id, draft, dragged) => ipcRenderer.invoke('editor-detach', id, draft, dragged),
  onChange: (fn) => {
    const cb = (
      _event: Electron.IpcRendererEvent,
      group: import('../src/editor-shared').EditorGroup,
    ) => fn(group);
    ipcRenderer.on('editor-changed', cb);
    return () => ipcRenderer.removeListener('editor-changed', cb);
  },
};
contextBridge.exposeInMainWorld('eluEditor', editor);
