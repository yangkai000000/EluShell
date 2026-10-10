import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Folder, X } from 'lucide-react';
import type { RemoteFile } from './shared';
import { remotePath } from './paths';

const MIME = 'application/x-elushell-remote-files';
type Dragged = { token: string; sessionId: string; files: { path: string; directory: boolean }[] };
type Destination = { kind: 'move' | 'upload'; path: string | null; tree: boolean; error: string };
type Pending = { sessionId: string; server: string; directory: string; names: string[] } & (
  { kind: 'move'; paths: string[] } | { kind: 'upload'; files: File[] }
);

export function useFileDrop(options: {
  sessionId: string;
  server: string;
  connected: boolean;
  directory: string;
  refresh: () => void;
  notify: (message: string) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const dragged = useRef<Dragged | null>(null);
  const scroll = useRef<{ element: Element; speed: number; frame: number } | null>(null);
  const [hover, setHover] = useState<Destination | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const executing = useRef(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    moved: string[];
    failed: { path: string; error: string }[];
  } | null>(null);
  const stopScroll = () => {
    if (scroll.current) cancelAnimationFrame(scroll.current.frame);
    scroll.current = null;
  };
  const end = () => {
    dragged.current = null;
    setHover(null);
    stopScroll();
  };
  useEffect(() => {
    end();
    if (!executing.current) setPending(null);
  }, [options.sessionId, options.directory]);
  useEffect(() => {
    const cancel = () => {
      setHover(null);
      stopScroll();
      dragged.current = null;
    };
    window.addEventListener('dragend', cancel);
    window.addEventListener('drop', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      stopScroll();
      window.removeEventListener('dragend', cancel);
      window.removeEventListener('drop', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, []);
  const kind = (e: DragEvent) =>
    e.dataTransfer.types.includes(MIME)
      ? 'move'
      : e.dataTransfer.types.includes('Files')
        ? 'upload'
        : null;
  const destination = (e: DragEvent, type: 'move' | 'upload'): Destination => {
    const node = e.target instanceof Element ? e.target : null;
    const tree = !!node?.closest('.tree-pane');
    const row = node?.closest('[data-drop-directory]');
    const directory =
      row?.getAttribute('data-drop-directory') ||
      (!tree && node?.closest('.file-table-wrap') ? options.directory : null);
    let issue = '';
    if (!options.connected) issue = '服务器已断开连接';
    else if (busy || pending) issue = '请先完成当前操作';
    else if (!directory) issue = tree ? '请拖到左侧具体的文件夹上' : '请拖到文件区域';
    else if (type === 'move') {
      if (!tree) issue = '请拖到左侧目录树中的文件夹';
      else if (!dragged.current || dragged.current.sessionId !== options.sessionId)
        issue = '仅支持当前服务器内移动';
      else if (dragged.current.files.some((f) => remotePath('..', f.path) === directory))
        issue = '所选项目已在该目录中';
      else if (
        dragged.current.files.some(
          (f) => f.directory && (directory === f.path || directory.startsWith(f.path + '/')),
        )
      )
        issue = '不能移到自身或子目录';
    }
    return { kind: type, path: directory, tree, error: issue };
  };
  const autoScroll = (e: DragEvent) => {
    const element = (e.target as Element).closest('.tree-scroll,.file-table-wrap');
    if (!element) {
      stopScroll();
      return;
    }
    const bounds = element.getBoundingClientRect();
    const speed = e.clientY < bounds.top + 28 ? -8 : e.clientY > bounds.bottom - 28 ? 8 : 0;
    if (!speed) {
      stopScroll();
      return;
    }
    if (scroll.current?.element === element && scroll.current.speed === speed) return;
    stopScroll();
    const tick = () => {
      if (!scroll.current) return;
      scroll.current.element.scrollTop += scroll.current.speed;
      scroll.current.frame = requestAnimationFrame(tick);
    };
    scroll.current = { element, speed, frame: requestAnimationFrame(tick) };
  };
  const area = {
    onDragOver: (e: DragEvent) => {
      const type = kind(e);
      if (!type) return;
      e.preventDefault();
      const target = destination(e, type);
      e.dataTransfer.dropEffect = target.error ? 'none' : type === 'move' ? 'move' : 'copy';
      setHover((old) =>
        old?.kind === target.kind &&
        old?.path === target.path &&
        old?.tree === target.tree &&
        old?.error === target.error
          ? old
          : target,
      );
      autoScroll(e);
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {
        setHover(null);
        stopScroll();
      }
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const type = kind(e);
      if (!type) return;
      const target = destination(e, type);
      setHover(null);
      stopScroll();
      if (target.error || !target.path) {
        options.notify(target.error);
        return;
      }
      const base = { sessionId: options.sessionId, server: options.server, directory: target.path };
      if (type === 'move') {
        const source = dragged.current;
        if (!source || e.dataTransfer.getData(MIME) !== source.token) return;
        setPending({
          ...base,
          kind: type,
          paths: source.files.map((f) => f.path),
          names: source.files.map((f) => f.path.split('/').pop()!),
        });
      } else {
        const files = Array.from(e.dataTransfer.files);
        if (!files.length) return;
        if (files.length > 100) {
          options.notify('一次最多拖入 100 个文件或文件夹');
          return;
        }
        setPending({ ...base, kind: type, files, names: files.map((f) => f.name) });
      }
      setError('');
      setResult(null);
    },
  };
  const begin = (e: DragEvent, files: RemoteFile[]) => {
    if (!options.connected || pending || busy) {
      e.preventDefault();
      return;
    }
    dragged.current = {
      token: crypto.randomUUID(),
      sessionId: options.sessionId,
      files: files.map((f) => ({
        path: remotePath(f.name, options.directory),
        directory: f.directory,
      })),
    };
    e.dataTransfer.setData(MIME, dragged.current.token);
    e.dataTransfer.effectAllowed = 'move';
  };
  const execute = async () => {
    if (!pending || executing.current) return;
    if (!latest.current.connected || latest.current.sessionId !== pending.sessionId) {
      setError('原服务器已断开或切换，请重新选择文件');
      return;
    }
    if (pending.kind === 'upload') {
      const upload = pending;
      setPending(null);
      void window
        .elu!.uploadDropped(upload.sessionId, upload.directory, upload.files)
        .catch((err) => latest.current.notify('上传失败：' + String(err)))
        .finally(() => {
          if (latest.current.sessionId === upload.sessionId) latest.current.refresh();
        });
      return;
    }
    executing.current = true;
    setBusy(true);
    setError('');
    try {
      if (pending.kind === 'move') {
        const moved = await window.elu!.moveFiles(
          pending.sessionId,
          pending.paths,
          pending.directory,
        );
        if (moved.failed.length) {
          setResult(moved);
          return;
        }
        options.notify(`已移动 ${moved.moved.length} 项到 ${pending.directory}`);
      }
      setPending(null);
    } catch (err) {
      setError(String(err));
    } finally {
      executing.current = false;
      setBusy(false);
      if (latest.current.sessionId === pending.sessionId) latest.current.refresh();
    }
  };
  const close = () => {
    if (!executing.current) setPending(null);
  };
  const operation = pending?.kind === 'move' ? '移动' : '上传';
  return {
    area,
    begin,
    end,
    hover,
    hint: hover
      ? hover.error || `松手确认${hover.kind === 'move' ? '移动' : '上传'}到 ${hover.path}`
      : '',
    dialog: pending && (
      <div
        className="editor-overlay file-drop-overlay"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') close();
          if (e.key === 'Tab') {
            const buttons = [
              ...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
            ];
            const first = buttons[0],
              last = buttons[buttons.length - 1];
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
        <section
          className="file-drop-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={result ? '移动结果' : `确认${operation}`}
        >
          <header>
            <h2>{result ? '移动结果' : `${operation}到目标目录`}</h2>
            <button title="关闭" disabled={busy} onClick={close}>
              <X size={18} />
            </button>
          </header>
          <div className="file-drop-body">
            <p className="file-drop-server">服务器：{pending.server}</p>
            <p>
              {operation}到{' '}
              <strong className="file-drop-path">
                <Folder size={17} />
                <span>{pending.directory}</span>
              </strong>{' '}
              目录
            </p>
            <p>共 {pending.names.length} 个文件或文件夹</p>
            <ul>
              {pending.names.slice(0, 100).map((name, i) => (
                <li key={i}>{name}</li>
              ))}
              {pending.names.length > 100 && <li>另有 {pending.names.length - 100} 项</li>}
            </ul>
            <p className="file-drop-note">
              {pending.kind === 'move'
                ? '移动后原位置不再保留这些项目；遇到同名项目会停止检查并提示。'
                : '同名文件直接替换，同名文件夹合并。'}
            </p>
            {busy && <p role="status">正在{operation}，请稍候…</p>}
            {error && (
              <p className="editor-error" role="alert">
                {error}
              </p>
            )}
            {result && (
              <div role="alert">
                <p>
                  已移动 {result.moved.length} 项，{result.failed.length} 项未移动：
                </p>
                <ul className="editor-error">
                  {result.failed.map((f) => (
                    <li key={f.path}>
                      {f.path}：{f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <footer>
            <button autoFocus disabled={busy} onClick={close}>
              {result ? '关闭' : '取消'}
            </button>
            {!result && (
              <button
                className="primary"
                disabled={busy || !options.connected || options.sessionId !== pending.sessionId}
                onClick={() => void execute()}
              >
                {busy ? `${operation}中…` : `确认${operation}`}
              </button>
            )}
          </footer>
        </section>
      </div>
    ),
  };
}
