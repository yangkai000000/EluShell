import { formatMemory } from './format';
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, X, ArrowUp, ArrowDown } from 'lucide-react';
import type { RemoteProcess } from './shared';
const columns: [keyof RemoteProcess, string][] = [
  ['pid', 'PID'],
  ['user', '用户'],
  ['memory', '内存'],
  ['cpu', 'CPU'],
  ['state', '状态'],
  ['name', '名称'],
  ['command', '命令行'],
  ['location', '位置'],
];
export function sortProcesses(
  rows: RemoteProcess[],
  key: keyof RemoteProcess,
  descending: boolean,
) {
  return [...rows].sort((a, b) => {
    const x = a[key],
      y = b[key];
    const order =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), 'zh-CN', { numeric: true });
    return (descending ? -order : order) || a.pid - b.pid;
  });
}
export default function ProcessManager({
  sessionId,
  name,
  onClose,
  onCapture,
}: {
  sessionId: string;
  name: string;
  onClose: () => void;
  onCapture?: (pid: number) => Promise<void>;
}) {
  const [rows, setRows] = useState<RemoteProcess[]>([]),
    [key, setKey] = useState<keyof RemoteProcess>('cpu'),
    [desc, setDesc] = useState(true),
    [filter, setFilter] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<RemoteProcess | null>(null),
    [menu, setMenu] = useState<{
      process: RemoteProcess;
      field: keyof RemoteProcess;
      x: number;
      y: number;
    } | null>(null);
  async function refresh() {
    setBusy(true);
    try {
      const next = await window.elu!.processes(sessionId);
      setRows(next);
      setSelected((previous) =>
        previous
          ? next.find((p) => p.pid === previous.pid && p.start === previous.start) || null
          : null,
      );
      setMenu(null);
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [sessionId]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null),
      escape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close();
      };
    window.addEventListener('click', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', escape);
    };
  }, [menu]);
  const data = useMemo(
    () =>
      sortProcesses(
        rows.filter((p) => Object.values(p).join(' ').toLowerCase().includes(filter.toLowerCase())),
        key,
        desc,
      ),
    [rows, key, desc, filter],
  );
  const copy = async (field: keyof RemoteProcess) => {
    if (!menu) return;
    try {
      await navigator.clipboard.writeText(
        field === 'memory' ? formatMemory(menu.process.memory) : String(menu.process[field]),
      );
      setMenu(null);
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <div className="modal-backdrop">
      <section className="modal process-modal" role="dialog" aria-label="进程管理">
        <div className="modal-header">
          <div>
            <h2>进程管理</h2>
            <p>
              {name} · {rows.length} 个进程 · CPU 为 ps 生命周期平均值
            </p>
          </div>
          <button title="关闭进程管理" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="process-tools">
          <input
            placeholder="筛选 PID、用户、名称或命令行"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button disabled={busy} onClick={() => void refresh()}>
            <RefreshCw size={14} />
            {busy ? '读取中…' : '刷新进程'}
          </button>
          <span>点击列标题排序 · 右键复制或终止</span>
        </div>
        {error && <div className="editor-error">{error}</div>}
        <div className="process-table-wrap">
          <table className="process-table">
            <thead>
              <tr>
                {columns.map(([field, label]) => (
                  <th
                    key={field}
                    aria-sort={key === field ? (desc ? 'descending' : 'ascending') : 'none'}
                  >
                    <button
                      onClick={() => {
                        key === field ? setDesc(!desc) : (setKey(field), setDesc(false));
                      }}
                    >
                      {label}
                      {key === field && (desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr
                  key={p.pid}
                  className={selected?.pid === p.pid ? 'selected' : ''}
                  onClick={() => setSelected(p)}
                >
                  {columns.map(([field]) => (
                    <td
                      key={field}
                      title={
                        field === 'memory'
                          ? `${formatMemory(p.memory)} (${p.memory} B)`
                          : field === 'location'
                            ? `${p.location || '未识别'} · ${{ entry: '服务启动文件', cwd: '进程工作目录', executable: '服务可执行文件', unknown: '无法读取' }[p.locationSource]}`
                            : String(p[field])
                      }
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setSelected(p);
                        setMenu({ process: p, field, x: e.clientX, y: e.clientY });
                      }}
                    >
                      {field === 'memory'
                        ? formatMemory(p.memory)
                        : field === 'cpu'
                          ? p.cpu + '%'
                          : p[field] || '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!busy && !data.length && <div className="empty">没有匹配的进程</div>}
        </div>
        {selected && (
          <div className="process-selection">
            <b>
              PID {selected.pid} · {selected.name}
            </b>
            <div>
              <span>服务位置</span>
              <code>
                {selected.location || '无法识别服务位置'}{' '}
                <small>
                  （
                  {
                    {
                      entry: '启动文件',
                      cwd: '工作目录',
                      executable: '可执行文件',
                      unknown: '无权限或信息不足',
                    }[selected.locationSource]
                  }
                  ）
                </small>
              </code>
            </div>
            <div>
              <span>工作目录</span>
              <code>{selected.cwd || '无权限读取'}</code>
            </div>
            <div>
              <span>运行程序</span>
              <code>{selected.executable || '无权限读取或无可执行文件'}</code>
            </div>
            <div>
              <span>命令行</span>
              <code>{selected.command}</code>
            </div>
          </div>
        )}
      </section>
      {menu && (
        <div
          className="file-context process-context"
          role="menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 230),
            top: Math.max(4, Math.min(menu.y, window.innerHeight - 440)),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            role="menuitem"
            disabled={busy || menu.process.pid < 2}
            className="danger"
            onClick={async () => {
              const p = menu.process;
              setMenu(null);
              setBusy(true);
              try {
                if (await window.elu!.terminateProcess(sessionId, p.pid, p.start)) {
                  setSelected(null);
                  await refresh();
                }
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            终止进程（SIGTERM）…
          </button>
          {onCapture && <button role="menuitem" disabled={busy} onClick={() => { const pid = menu.process.pid; setMenu(null); void onCapture(pid).catch(e => setError(String(e))); }}>按监听端口抓包</button>}
          <hr />
          <button role="menuitem" onClick={() => void copy(menu.field)}>
            复制当前字段
          </button>
          {[...columns, ['cwd', '工作目录'], ['executable', '运行程序']].map(([field, label]) => (
            <button
              role="menuitem"
              key={field}
              onClick={() => void copy(field as keyof RemoteProcess)}
            >
              复制{label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
