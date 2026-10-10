import { useEffect, useRef, useState } from 'react';
import { X, Trash2, ShieldCheck } from 'lucide-react';
import type { FileAction } from './shared';
import PermissionEditor from './PermissionEditor';
export type FileTarget = {
  path: string;
  directory: boolean;
  mode?: number;
  x: number;
  y: number;
  paths?: string[];
  entries?: { path: string; directory: boolean; mode: number }[];
};
export default function FileActions({
  sessionId,
  server,
  connected,
  target,
  setTarget,
  openPath,
  setOpenPath,
  navigate,
  changeDirectory,
  refresh,
  notify,
  onSendAI,
}: {
  onSendAI?: (paths: string[]) => void;
  sessionId: string;
  server: string;
  connected: boolean;
  target: FileTarget | null;
  setTarget: (v: FileTarget | null) => void;
  openPath: string | null;
  setOpenPath: (v: string | null) => void;
  navigate: (p: string) => void;
  changeDirectory: (p: string) => Promise<void>;
  refresh: () => void;
  notify: (s: string) => void;
}) {
  const [form, setForm] = useState<{ kind: FileAction['kind']; target: FileTarget } | null>(null),
    [value, setValue] = useState(''),
    [recursive, setRecursive] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{
    completed: string[];
    failed: { path: string; error: string }[];
  } | null>(null);
  const submitting = useRef(false);
  const latest = useRef({ sessionId, refresh, notify });
  latest.current = { sessionId, refresh, notify };
  useEffect(() => {
    if (!openPath) return;
    const p = openPath;
    setOpenPath(null);
    void window.elu!.openEditor(sessionId, p).catch((e) => notify(String(e)));
  }, [openPath]);
  useEffect(() => {
    setTarget(null);
    setForm(null);
  }, [sessionId]);
  useEffect(() => {
    if (!target) return;
    const close = () => setTarget(null),
      key = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close();
      };
    window.addEventListener('click', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', key);
    };
  }, [target]);
  const run = async (fn: () => Promise<unknown>) => {
    setTarget(null);

    try {
      await fn();
      refresh();
    } catch (e) {
      notify(String(e));
    }
  };
  const edit = (kind: FileAction['kind']) => {
    if (!target) return;
    setForm({ kind, target });
    setValue(
      kind === 'chmod' &&
        target.entries &&
        new Set(target.entries.map((e) => e.mode & 0o7777)).size > 1
        ? ''
        : kind === 'chmod'
          ? ((target.mode ?? 0o755) & 0o7777).toString(8).padStart(3, '0')
          : kind === 'rename'
            ? target.path.split('/').pop() || ''
            : '',
    );
    setRecursive(false);
    setError('');
    setOutcome(null);
    setTarget(null);
  };
  const submit = async () => {
    if (!form || submitting.current || !connected) return;

    const { kind, target: t } = form;
    const parent = t.directory ? t.path : t.path.substring(0, t.path.lastIndexOf('/')) || '/';
    if (
      kind === 'delete'
        ? false
        : kind === 'chmod'
          ? !/^[0-7]{3,4}$/.test(value)
          : !value || value === '.' || value === '..' || /[\\/\0]/.test(value)
    ) {
      setError(
        kind === 'chmod'
          ? '请输入 3 或 4 位八进制权限，例如 644、755'
          : '请输入不含路径分隔符的名称',
      );
      return;
    }
    setBusy(true);
    submitting.current = true;
    setError('');
    try {
      if (kind === 'delete' || kind === 'chmod') {
        const result = await window.elu!.fileActions(sessionId, {
          kind,
          paths: t.paths || [t.path],
          mode: kind === 'chmod' ? parseInt(value, 8) : undefined,
          recursive,
        });
        if (latest.current.sessionId !== sessionId) {
          latest.current.notify(
            `${kind === 'delete' ? '删除' : '权限修改'}：${result.completed.length} 项成功，${result.failed.length} 项失败`,
          );
          return;
        }
        if (result.failed.length) setOutcome(result);
        else {
          setForm(null);
          notify(`${kind === 'delete' ? '已删除' : '已修改权限'} ${result.completed.length} 项`);
        }
        refresh();
        return;
      }
      await window.elu!.fileAction(sessionId, {
        kind,
        path:
          kind === 'mkdir' || kind === 'touch' ? parent.replace(/\/$/, '') + '/' + value : t.path,
        name: kind === 'rename' ? value : undefined,
        recursive,
      });
      setForm(null);
      refresh();
    } catch (e) {
      if (latest.current.sessionId === sessionId) setError(String(e));
      else latest.current.notify(String(e));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const parent = target
    ? target.directory
      ? target.path
      : target.path.substring(0, target.path.lastIndexOf('/')) || '/'
    : '/';
  const multiple = !!target?.paths && target.paths.length > 1;
  return (
    <>
      {target && (
        <div
          className="file-context"
          role="menu"
          style={{
            left: Math.max(0, Math.min(target.x, window.innerWidth - 220)),
            top: Math.max(0, Math.min(target.y, window.innerHeight - (multiple ? 310 : 490))),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <small title={target.paths?.join('\n') || target.path}>
            {multiple ? `已选择 ${target.paths!.length} 项` : target.path.split('/').pop() || '/'}
          </small>
          {onSendAI && (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  onSendAI(target.paths || [target.path]);
                  setTarget(null);
                }}
              >
                标记给 AI
              </button>
            </>
          )}
          {multiple ? (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  const paths = [...target.paths!];
                  setTarget(null);
                  void window
                    .elu!.downloadMany(sessionId, paths)
                    .then((result) => {
                      notify(
                        `批量下载完成：${result.completed} 项成功` +
                          (result.failed.length
                            ? `，${result.failed.length} 项失败或取消；请查看文件传输记录。首个问题：${result.failed[0].path} · ${result.failed[0].error}`
                            : ''),
                      );
                    })
                    .catch((e) => notify(String(e)));
                }}
              >
                批量下载（{target.paths!.length} 项）
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  void window
                    .elu!.writeClipboard(target.paths!.join('\n'))
                    .catch((e) => notify(String(e)));
                  setTarget(null);
                }}
              >
                复制所选路径
              </button>
              <hr />
              <button role="menuitem" disabled={!connected} onClick={() => edit('chmod')}>
                批量修改权限…
              </button>
              <button
                role="menuitem"
                className="danger"
                disabled={!connected}
                onClick={() => edit('delete')}
              >
                批量删除（{target.paths!.length} 项）…
              </button>
            </>
          ) : (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  setTarget(null);
                  refresh();
                }}
              >
                刷新
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  target.directory ? navigate(target.path) : setOpenPath(target.path);
                  setTarget(null);
                }}
              >
                {target.directory ? '打开文件夹' : '打开 · 内置文本编辑器'}
              </button>
              {target.directory && (
                <button
                  role="menuitem"
                  onClick={() => {
                    const path = target.path;
                    setTarget(null);
                    void changeDirectory(path).catch((e) => notify(String(e)));
                  }}
                >
                  执行 cd 到该目录
                </button>
              )}
              <button
                role="menuitem"
                onClick={() => {
                  void navigator.clipboard.writeText(target.path).catch((e) => notify(String(e)));
                  setTarget(null);
                }}
              >
                复制路径
              </button>
              <hr />
              <button
                role="menuitem"
                onClick={() => void run(() => window.elu!.download(sessionId, target.path))}
              >
                下载{target.directory ? '文件夹' : ''}
              </button>
              <button
                role="menuitem"
                onClick={() => void run(() => window.elu!.upload(sessionId, parent))}
              >
                上传文件到此目录…
              </button>
              <button
                role="menuitem"
                onClick={() => void run(() => window.elu!.uploadFolder(sessionId, parent))}
              >
                上传文件夹到此目录…
              </button>
              <hr />
              <button role="menuitem" onClick={() => edit('touch')}>
                新建文件…
              </button>
              <button role="menuitem" onClick={() => edit('mkdir')}>
                新建文件夹…
              </button>
              <button role="menuitem" disabled={target.path === '/'} onClick={() => edit('rename')}>
                重命名…
              </button>
              <button role="menuitem" disabled={target.path === '/'} onClick={() => edit('chmod')}>
                文件权限…
              </button>
              <button
                role="menuitem"
                disabled={target.path === '/'}
                className="danger"
                onClick={() => edit('delete')}
              >
                删除{target.directory ? '文件夹及内容' : ''}…
              </button>
            </>
          )}
        </div>
      )}
      {form && (
        <div
          className="editor-overlay"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape' && !busy) setForm(null);
            if (e.key === 'Tab') {
              const controls = [
                ...e.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), input:not(:disabled)',
                ),
              ];
              const first = controls[0],
                last = controls[controls.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last?.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <form
            className="file-action-form file-drop-dialog file-operation-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={form.kind === 'delete' ? '确认删除' : '文件操作'}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <header>
              <h2>
                {form.kind === 'delete' ? <Trash2 size={19} /> : <ShieldCheck size={19} />}
                {
                  {
                    rename: '重命名',
                    mkdir: '新建文件夹',
                    touch: '新建文件',
                    chmod: '修改权限',
                    delete: '删除所选项目',
                  }[form.kind]
                }
              </h2>
              <button
                type="button"
                title="关闭文件操作"
                disabled={busy}
                onClick={() => setForm(null)}
              >
                <X size={17} />
              </button>
            </header>
            <div className="file-drop-body">
              <p className="file-drop-server">服务器：{server}</p>
              <p>已选择 {(form.target.paths || [form.target.path]).length} 个文件或文件夹</p>
              <ul className="file-operation-paths">
                {(form.target.paths || [form.target.path]).slice(0, 100).map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
              {(form.target.paths?.length || 0) > 100 && (
                <small>其余 {form.target.paths!.length - 100} 项也将一起处理</small>
              )}
              {form.kind === 'delete' ? (
                <p className="file-delete-warning">
                  删除后无法恢复。所选文件夹及其全部内容也会被删除。
                </p>
              ) : (
                <label>
                  {form.kind === 'chmod' ? '八进制权限' : '名称'}
                  <input
                    autoFocus
                    disabled={busy || !!outcome}
                    placeholder={
                      form.kind === 'chmod' ? '例如 644 或 755；所选项目将统一使用此权限' : ''
                    }
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </label>
              )}
              {form.kind === 'chmod' && (
                <fieldset disabled={busy || !!outcome}>
                  <PermissionEditor
                    value={value}
                    change={setValue}
                    directory={form.target.directory}
                  />
                </fieldset>
              )}
              {form.kind === 'chmod' &&
                (form.target.directory || form.target.entries?.some((e) => e.directory)) && (
                  <label>
                    <input
                      type="checkbox"
                      checked={recursive}
                      disabled={busy || !!outcome}
                      onChange={(e) => setRecursive(e.target.checked)}
                    />
                    应用到所有子文件夹及文件
                  </label>
                )}
              {error && <p className="editor-error">{error}</p>}
              {form.kind === 'chmod' && (
                <p className="file-drop-note">
                  对所有选中项目应用相同权限；未勾选递归时仅修改选中项目本身，不跟随符号链接。
                </p>
              )}
              {!connected && <p className="editor-error">服务器已断开，请重新连接后操作。</p>}
              {outcome && (
                <div role="alert" className="editor-error">
                  <strong>
                    {outcome.completed.length} 项成功，{outcome.failed.length} 项失败
                  </strong>
                  <p>失败目录中的部分子项可能已处理，请刷新后核对。</p>
                  <ul>
                    {outcome.failed.map((f) => (
                      <li key={f.path}>
                        {f.path}：{f.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {busy && <p role="status">正在处理，请稍候…</p>}
            </div>
            <footer>
              <button
                autoFocus={form.kind === 'delete'}
                type="button"
                disabled={busy}
                onClick={() => setForm(null)}
              >
                {outcome ? '关闭' : '取消'}
              </button>
              {!outcome && (
                <button
                  className={form.kind === 'delete' ? 'danger-primary' : 'primary'}
                  disabled={busy || !connected}
                >
                  {busy ? '处理中…' : form.kind === 'delete' ? '确认删除' : '确定'}
                </button>
              )}
            </footer>
          </form>
        </div>
      )}
    </>
  );
}
