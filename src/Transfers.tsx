import { useEffect, useRef, useState } from 'react';
import { ArrowDownUp, FileDown, FolderOpen, Settings, X } from 'lucide-react';
import type { Transfer } from './shared';
const size = (n: number) =>
  n < 1024
    ? n + ' B'
    : n < 1048576
      ? (n / 1024).toFixed(1) + ' KB'
      : n < 1073741824
        ? (n / 1048576).toFixed(1) + ' MB'
        : (n / 1073741824).toFixed(1) + ' GB';
export default function Transfers({ autoOpen = true }: { autoOpen?: boolean }) {
  const autoOpenRef = useRef(autoOpen);
  autoOpenRef.current = autoOpen;
  const [open, setOpen] = useState(false),
    [jobs, setJobs] = useState<Transfer[]>([]),
    [directory, setDirectory] = useState(''),
    [exported, setExported] = useState(''),
    [exporting, setExporting] = useState(false),
    [error, setError] = useState('');
  const seen = useRef(new Set<string>());
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  useEffect(() => {
    if (!window.elu) return;
    const off = window.elu.onTransfer((job) => {
      if (!seen.current.has(job.id)) {
        seen.current.add(job.id);
        if (autoOpenRef.current) setOpen(true);
        if (seen.current.size > 300) seen.current.delete(seen.current.values().next().value!);
        listRef.current?.scrollTo({ top: 0 });
      }
      setJobs((old) =>
        [job, ...old.filter((j) => j.id !== job.id)]
          .sort((a, b) => b.started - a.started)
          .slice(0, 150),
      );
    });
    void window.elu
      .transferList()
      .then((list) =>
        setJobs((old) => {
          list.forEach((j) => seen.current.add(j.id));
          const merged = new Map(list.map((j) => [j.id, j]));
          old.forEach((j) => merged.set(j.id, j));
          return [...merged.values()].sort((a, b) => b.started - a.started);
        }),
      )
      .catch((e) => setError(String(e)));
    void window.elu
      .downloadDirectory()
      .then(setDirectory)
      .catch((e) => setError(String(e)));
    return off;
  }, []);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      setError('');
      await fn();
    } catch (e) {
      setError(String(e));
    }
  };
  const active = jobs.filter((j) => j.state === 'running' || j.state === 'preparing').length;
  return (
    <div className="transfer-anchor" ref={panelRef}>
      <button className="icon-button" title="上传下载进度" onClick={() => setOpen(!open)}>
        <ArrowDownUp size={17} />
        {active > 0 && <b className="transfer-badge">{active}</b>}
      </button>
      {open && (
        <section className="transfer-panel" aria-label="上传下载进度">
          <header>
            <strong>文件传输{active > 0 ? ` · ${active} 项进行中` : ''}</strong>
            <button title="关闭传输面板" onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </header>
          <div className="download-directory">
            <small>下载目录（同名文件自动改名）</small>
            <div title={directory}>{directory || '桌面 / esdownload'}</div>
            <button
              onClick={() =>
                void act(async () => setDirectory(await window.elu!.chooseDownloadDirectory()))
              }
            >
              <Settings size={13} />
              更改目录
            </button>
            <button onClick={() => void act(() => window.elu!.showDownloadDirectory())}>
              <FolderOpen size={13} />
              打开目录
            </button>
          </div>
          <div className="transfer-diagnostics">
            <button
              disabled={exporting}
              onClick={() =>
                void act(async () => {
                  setExporting(true);
                  setExported('');
                  try {
                    setExported(await window.elu!.exportTransferDiagnostics());
                  } finally {
                    setExporting(false);
                  }
                })
              }
            >
              <FileDown size={14} />
              {exporting ? '正在导出…' : '导出诊断日志'}
            </button>
            <small>
              上传报错后导出并回传。含服务器地址、账号与路径，不含密码、私钥或文件内容。
            </small>
            {exported && <small role="status">已导出：{exported}</small>}
          </div>
          {error && <p className="editor-error">{error}</p>}
          <div className="transfer-jobs" ref={listRef}>
            {!jobs.length && <p className="empty">暂无传输任务</p>}
            {jobs.map((j) => (
              <article key={j.id} data-state={j.state}>
                <div>
                  <b title={j.label}>
                    {j.direction === 'upload' ? '↑' : '↓'} {j.label}
                  </b>
                  <span className="transfer-state">
                    {
                      {
                        preparing: '准备中',
                        running: '传输中',
                        completed: '已完成',
                        failed: '失败',
                        cancelled: '已取消',
                      }[j.state]
                    }
                  </span>
                </div>
                <div
                  className="transfer-progress"
                  role="progressbar"
                  aria-label={j.label + ' 传输进度'}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={
                    j.state === 'completed'
                      ? 100
                      : j.total > 0
                        ? Math.min(100, Math.round((j.done / j.total) * 100))
                        : 0
                  }
                >
                  <i
                    style={{
                      width:
                        (j.state === 'completed'
                          ? 100
                          : j.total > 0
                            ? Math.min(100, (j.done / j.total) * 100)
                            : 0) + '%',
                    }}
                  />
                </div>
                <div className="transfer-details">
                  <small>
                    {size(j.done)} / {size(j.total)} · {j.filesDone}/{j.filesTotal} 文件
                  </small>
                  <span>
                    {j.total > 0
                      ? Math.min(100, Math.round((j.done / j.total) * 100)) + '%'
                      : j.state === 'completed'
                        ? '100%'
                        : '准备中'}
                  </span>
                  {['running', 'preparing'].includes(j.state) && (
                    <button onClick={() => void act(() => window.elu!.cancelTransfer(j.id))}>
                      取消
                    </button>
                  )}
                </div>
                {j.error && <p className="editor-error">{j.error}</p>}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
