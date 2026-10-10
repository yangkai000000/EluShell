import { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import type { UpdateStatus } from './update-shared';
import { isMac } from './platform';
const labels: Record<UpdateStatus['phase'], string> = {
  disabled: '未配置更新服务器',
  idle: '尚未检查',
  checking: '正在检查更新…',
  available: '发现新版本',
  current: '当前已是最新版本',
  downloading: '正在下载更新…',
  ready: '更新已下载，等待安装',
  installing: '正在准备安装更新…',
  error: '更新未完成',
};
export function useUpdates() {
  const [state, setState] = useState<UpdateStatus | null>(null);
  const [message, setMessage] = useState('');
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    const bridge = window.elu;
    if (!bridge) return;
    const off = bridge.onUpdate(setState);
    void bridge
      .updateStatus()
      .then(setState)
      .catch((e) => setMessage(String(e)));
    return off;
  }, []);
  const run = async (fn: () => Promise<unknown>) => {
    setMessage('');
    try {
      await fn();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const install = async () => {
    setInstalling(true);
    await run(() => window.elu!.installUpdate());
    setInstalling(false);
  };
  return { state, message, run, install, installing };
}
type Model = ReturnType<typeof useUpdates>;
function UpdateActions({ model }: { model: Model }) {
  const s = model.state!;
  return (
    <div className="update-actions">
      {s.phase === 'available' && (
        <>
          <button
            className="primary"
            onClick={() => void model.run(() => window.elu!.downloadUpdate())}
          >
            <Download size={14} />
            下载更新
          </button>
          <button onClick={() => void model.run(() => window.elu!.dismissUpdate(true))}>
            忽略此版本
          </button>
        </>
      )}
      {s.phase === 'downloading' && (
        <button onClick={() => void model.run(() => window.elu!.cancelUpdate())}>取消下载</button>
      )}
      {s.phase === 'ready' && (
        <button
          className="primary"
          disabled={model.installing}
          onClick={() => void model.install()}
        >
          {model.installing ? '准备安装…' : '重启并安装'}
        </button>
      )}
      {s.prompt && s.phase !== 'installing' && !model.installing && (
        <button onClick={() => void model.run(() => window.elu!.dismissUpdate(false))}>
          {s.phase === 'available' ? '明天提醒' : '稍后'}
        </button>
      )}
    </div>
  );
}
function InstallProgress({ state }: { state: UpdateStatus }) {
  if (state.phase !== 'installing') return null;
  return (
    <div className="update-install-progress" role="status" aria-live="polite">
      <progress aria-label="安装准备进度" />
      <strong>
        {state.installStep === 'launching' ? '正在打开安装窗口…' : '正在保存配置并准备安装…'}
      </strong>
      <p>稍后本窗口会关闭，安装窗口将显示文件安装进度。完成后会自动重新打开 EluShell。</p>
    </div>
  );
}
export function UpdateSettings({ model }: { model: Model }) {
  const s = model.state;
  const [url, setUrl] = useState(''),
    [allowHttp, setHttp] = useState(false),
    [autoCheck, setAuto] = useState(true);
  useEffect(() => {
    if (s) {
      setUrl(s.config.url);
      setHttp(s.config.allowHttp);
      setAuto(s.config.autoCheck);
    }
  }, [s?.config.url, s?.config.allowHttp, s?.config.autoCheck]);
  if (!s) return <p>{model.message || '正在读取更新设置…'}</p>;
  if (!s.supported && isMac)
    return (
      <section className="update-settings">
        <h3>
          软件更新 <small>当前版本 {s.currentVersion}</small>
        </h3>
        <p>当前版本需手动更新。应用内自动安装仅支持 Windows Setup 安装版。</p>
        <p>
          Mac 测试版请按芯片类型下载新版 ZIP，保存工作并按 Command+Q 完全退出后，替换“应用程序”中的
          EluShell.app。个人配置保留在 ~/.EluShell。
        </p>
        <p>
          当前 Mac 测试包使用 ad-hoc 签名，尚未提供经过实机验证的自动更新流程；填写 Windows
          更新目录不能更新 Mac 应用。
        </p>
        <button
          className="primary"
          onClick={() => void model.run(() => window.elu!.openUpdateGuide())}
        >
          查看官网下载与 Mac 更新步骤
        </button>
        {model.message && <p role="alert">{model.message}</p>}
      </section>
    );
  const busy = ['checking', 'downloading', 'installing'].includes(s.phase) || model.installing;
  const changed =
    url !== s.config.url || allowHttp !== s.config.allowHttp || autoCheck !== s.config.autoCheck;
  return (
    <section className="update-settings">
      <h3>
        软件更新 <small>当前版本 {s.currentVersion}</small>
      </h3>
      <label>
        更新服务器地址
        <input
          aria-label="更新服务器地址"
          value={url}
          disabled={busy}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="留空关闭更新检查；填写完整的 HTTP(S) 发布目录"
        />
      </label>
      <label className="update-checkbox">
        <input
          type="checkbox"
          checked={autoCheck}
          disabled={busy}
          onChange={(e) => setAuto(e.target.checked)}
        />
        启动后在后台检查更新
      </label>
      <label className="update-checkbox">
        <input
          type="checkbox"
          checked={allowHttp}
          disabled={busy}
          onChange={(e) => setHttp(e.target.checked)}
        />
        允许 HTTP 测试源（未加密，仅用于可信测试地址）
      </label>
      <div className="update-actions">
        <button
          className="primary settings-save"
          disabled={busy}
          onClick={() =>
            void model.run(() => window.elu!.configureUpdates({ url, allowHttp, autoCheck }))
          }
        >
          保存更新设置
        </button>
        <button
          disabled={busy || !s.config.url || !s.supported || changed || s.phase === 'ready'}
          onClick={() => void model.run(() => window.elu!.checkUpdate())}
        >
          <RefreshCw size={13} />
          检查更新
        </button>
      </div>
      {changed && <p>请先保存更新设置，再检查更新。</p>}
      {!s.supported && (
        <p>应用内安装更新仅支持 Windows Setup 安装版；便携版请下载新版程序后手动替换。</p>
      )}
      <p role="status">
        {labels[s.phase]}
        {s.version ? ` · ${s.version}` : ''}
      </p>
      {s.config.ignoredVersion && <p>已忽略 {s.config.ignoredVersion}；手动检查仍可更新。</p>}
      {s.config.lastChecked > 0 && (
        <p>最近检查：{new Date(s.config.lastChecked).toLocaleString()}</p>
      )}
      {s.phase === 'downloading' && <progress max={100} value={s.percent || 0} />}
      <InstallProgress state={s} />
      {(s.error || model.message) && <p className="update-error">{model.message || s.error}</p>}
      <UpdateActions model={model} />
      <p>地址和更新偏好保存在 .EluShell/updates.json。留空时不检查更新；安装更新会保留本地配置。</p>
    </section>
  );
}
export function UpdatePrompt({ model }: { model: Model }) {
  const s = model.state;
  if (!s?.prompt) return null;
  return (
    <div className="modal-backdrop update-backdrop">
      <section className="modal update-modal" role="dialog" aria-label="软件更新">
        <div className="modal-header">
          <h2>{labels[s.phase]}</h2>
          <button
            title="稍后处理更新"
            disabled={s.phase === 'installing' || model.installing}
            onClick={() => void model.run(() => window.elu!.dismissUpdate(false))}
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-content">
          <p>
            EluShell {s.currentVersion} → {s.version}
          </p>
          {s.notes && s.phase !== 'installing' && <pre className="update-notes">{s.notes}</pre>}
          {s.phase === 'downloading' && (
            <>
              <progress max={100} value={s.percent || 0} />
              <p>{(s.percent || 0).toFixed(1)}%</p>
            </>
          )}
          {s.phase === 'ready' && (
            <p>
              下载已完成。点击“重启并安装”后会显示安装进度，完成后自动重新打开。重启前请保存编辑内容并完成文件传输。
            </p>
          )}
          <InstallProgress state={s} />
          {(s.error || model.message) && (
            <p className="update-error" role="alert">
              {model.message || s.error}
            </p>
          )}
          <UpdateActions model={model} />
        </div>
      </section>
    </div>
  );
}
