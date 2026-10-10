import { useMemo, useState } from 'react';
import { Download, Upload, X } from 'lucide-react';
import { mergeConnectionBundle, type ConnectionBundle } from './connection-sharing';
import type { Settings } from './shared';
export default function ConnectionSharing({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
}) {
  const [bundle, setBundle] = useState<ConnectionBundle | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [exportOpen, setExportOpen] = useState(false),
    [includePasswords, setIncludePasswords] = useState(true);
  const preview = useMemo(() => {
    if (!bundle) return null;
    try {
      return { ...mergeConnectionBundle(settings, bundle), error: '' };
    } catch {
      return {
        error: '导入后将超过 1000 个连接或文件夹，请减少项目后重试。',
        rows: [],
        added: 0,
        skipped: 0,
        foldersAdded: 0,
        passwordsAdded: 0,
      };
    }
  }, [settings, bundle]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="connection-sharing">
      <div className="sharing-actions">
        <button
          title="导入连接配置"
          aria-label="导入连接配置"
          disabled={busy}
          onClick={() =>
            void run(async () => setBundle(await window.elu!.chooseConnectionImport()))
          }
        >
          <Upload size={14} />
          导入
        </button>
        <button
          title="导出连接配置"
          aria-label="导出连接配置"
          disabled={busy}
          onClick={() => { setIncludePasswords(true); setMessage(''); setExportOpen(true); }}
        >
          <Download size={14} />
          导出
        </button>
      </div>
      {message && (
        <p className="sharing-message" role="status">
          {message}
        </p>
      )}
      {exportOpen && (
        <div className="modal-backdrop sharing-backdrop" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' && !busy) setExportOpen(false); }}>
          <section className="modal sharing-modal sharing-export-modal" role="dialog" aria-modal="true" aria-label="导出连接">
            <div className="modal-header">
              <h2>导出连接</h2>
              <button title="关闭导出" disabled={busy} onClick={() => setExportOpen(false)}><X size={18} /></button>
            </div>
            <div className="sharing-notes">
              <p>导出 {settings.profiles.length} 个连接和 {settings.folders.length} 个分类文件夹。</p>
              <label className="checkbox"><input autoFocus type="checkbox" checked={includePasswords} disabled={busy} onChange={(e) => setIncludePasswords(e.target.checked)} />包含已保存的连接密码</label>
              <p className="sharing-password-notice">{includePasswords
                ? '导出文件含明文登录密码，请仅分享给可信同事。对方使用 EluShell 0.8.1 或更新版本导入后，密码会在其电脑上重新加密保存，可直接用于连接。'
                : '导出不携带登录密码，接收人需自行输入。此格式兼容旧版 EluShell。'}</p>
              <p>仅包含已保存的密码。私钥文件、私钥路径和 SSH Agent 需在接收人的电脑上配置；登录命令会按原文导出。</p>
              {message && <p role="alert">{message}</p>}
              <div className="sharing-actions">
                <button disabled={busy} onClick={() => setExportOpen(false)}>取消</button>
                <button className="primary" disabled={busy} onClick={() => void run(async () => {
                  const target = await window.elu!.exportConnections(settings, includePasswords);
                  setExportOpen(false);
                  setMessage('已导出：' + target);
                })}>{busy ? '导出中…' : '确认导出'}</button>
              </div>
            </div>
          </section>
        </div>
      )}
      {bundle && preview && (
        <div className="modal-backdrop sharing-backdrop" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' && !busy) setBundle(null); }}>
          <section className="modal sharing-modal" role="dialog" aria-label="导入连接预览">
            <div className="modal-header">
              <h2>导入连接预览</h2>
              <button title="关闭导入预览" disabled={busy} onClick={() => setBundle(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="sharing-summary">
              新增 {preview.added} 个连接 · 新增 {preview.foldersAdded} 个文件夹 · 跳过{' '}
              {preview.skipped} 个重复连接 · 导入 {preview.passwordsAdded} 个密码
            </div>
            {preview.error && <p role="alert">{preview.error}</p>}
            <div className="sharing-table">
              <table>
                <thead>
                  <tr>
                    <th>连接名称</th>
                    <th>服务器</th>
                    <th>用户</th>
                    <th>处理方式</th>
                    <th>认证信息</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((p, i) => (
                    <tr key={i}>
                      <td>{p.name}</td>
                      <td>{p.host}</td>
                      <td>{p.username}</td>
                      <td>{p.action}</td>
                      <td>{p.credential}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sharing-notes">
              <p>
                按文件夹路径合并分类。同一分类下名称、地址、端口、用户和认证方式相同的连接会跳过，已有配置不被覆盖。
              </p>
              <p>
                随文件导入的密码会在本机重新加密保存。未附带密码的连接需自行输入；私钥或 Agent 需在本机配置。首次连接需核对服务器指纹。
              </p>
              <p>登录命令自动执行与隧道规则默认关闭，核对后可自行启用。导入不会连接服务器。</p>
              <p>仅共享连接与分类，命令库、历史和外观保持原样。导入前自动备份本地配置。</p>
              {message && <p role="status">{message}</p>}
              <div className="sharing-actions">
                <button disabled={busy} onClick={() => setBundle(null)}>
                  取消
                </button>
                <button
                  className="primary"
                  disabled={busy || !!preview.error || (!preview.added && !preview.foldersAdded)}
                  onClick={() =>
                    void run(async () => {
                      const result = await window.elu!.importConnections(bundle, settings);
                      onChange(result.settings);
                      setBundle(null);
                      setMessage(
                        `导入完成：新增 ${result.added} 个连接，${result.foldersAdded} 个文件夹，跳过 ${result.skipped} 个重复连接`,
                      );
                    })
                  }
                >
                  {busy ? '导入中…' : '确认导入'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
