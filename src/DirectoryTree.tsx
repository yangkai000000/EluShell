import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, RefreshCw } from 'lucide-react';
import type { RemoteFile } from './shared';
import { cacheDirectory } from './performance';
import { ancestors, remotePath } from './paths';
export default function DirectoryTree({
  selected,
  load,
  onSelect,
  onContext,
  dropTarget = null,
  revision = 0,
}: {
  dropTarget?: string | null;
  revision?: number;
  onContext?: (e: React.MouseEvent, path: string, mode?: number) => void;
  selected: string;
  load: (path: string) => Promise<RemoteFile[]>;
  onSelect: (path: string) => void;
}) {
  const [children, setChildren] = useState<Record<string, RemoteFile[]>>({}),
    [expanded, setExpanded] = useState<Set<string>>(new Set(['/'])),
    [errors, setErrors] = useState<Record<string, string>>({});
  const pending = useRef(new Set<string>());
  const refreshPending = useRef(new Set<string>());
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (dropTarget) return;
    root.current
      ?.querySelector('.tree-row.selected')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected, children, expanded]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function ensure(path: string, force = false) {
    if (pending.current.has(path)) {
      if (force) refreshPending.current.add(path);
      return;
    }
    if (!force && children[path]) return;
    pending.current.add(path);
    try {
      const list = await load(path);
      if (alive.current) {
        setChildren((c) => cacheDirectory(c, path, list.filter((f) => f.directory).slice(0, 1000)));
        setErrors((e) =>
          cacheDirectory(
            e,
            path,
            list.filter((f) => f.directory).length > 1000 ? '目录过多，请使用文件列表查看' : '',
          ),
        );
      }
    } catch (e) {
      if (alive.current) setErrors((s) => cacheDirectory(s, path, String(e)));
    } finally {
      pending.current.delete(path);
      if (refreshPending.current.delete(path) && alive.current) void ensure(path, true);
    }
  }
  useEffect(() => {
    const parents = ancestors(selected);
    setExpanded((e) => new Set([...e, ...parents].slice(-128)));
    for (const p of parents) void ensure(p);
  }, [selected]);
  useEffect(() => {
    if (revision) for (const p of expanded) void ensure(p, true);
  }, [revision]);
  useEffect(() => {
    if (!dropTarget || expanded.has(dropTarget)) return;
    const timer = setTimeout(() => {
      setExpanded((old) => new Set([...old, dropTarget]));
      void ensure(dropTarget);
    }, 650);
    return () => clearTimeout(timer);
  }, [dropTarget]);
  const render = (path: string, name: string, depth: number, mode?: number): React.ReactNode => (
    <div
      key={path}
      role="treeitem"
      aria-expanded={expanded.has(path)}
      aria-selected={selected === path}
    >
      <div
        onContextMenu={(e) => onContext?.(e, path, mode)}
        className={
          'tree-row ' +
          (selected === path ? 'selected' : '') +
          (dropTarget === path ? ' file-drop-target' : '')
        }
        data-drop-directory={path}
        style={{ paddingLeft: depth * 15 + 5 }}
      >
        <button
          aria-label={(expanded.has(path) ? '折叠 ' : '展开 ') + path}
          onClick={() => {
            setExpanded((e) => {
              const n = new Set(e);
              n.has(path) ? n.delete(path) : n.add(path);
              if (n.size > 128) n.delete([...n].find((p) => p !== '/')!);
              return n;
            });
            void ensure(path);
          }}
        >
          {expanded.has(path) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <button className="tree-select" title={path} onClick={() => onSelect(path)}>
          {selected === path ? <FolderOpen size={15} /> : <Folder size={15} />}
          <span>{name}</span>
        </button>
      </div>
      {expanded.has(path) && (
        <div role="group">
          {errors[path] ? (
            <button
              className="tree-error"
              title={errors[path]}
              onClick={() => void ensure(path, true)}
            >
              读取失败 · 重试
            </button>
          ) : (
            children[path]?.map((f) => render(remotePath(f.name, path), f.name, depth + 1, f.mode))
          )}
        </div>
      )}
    </div>
  );
  return (
    <div className="directory-tree" ref={root}>
      <div className="tree-heading">
        目录树
        <button
          title="刷新目录树"
          onClick={() => {
            for (const p of expanded) void ensure(p, true);
          }}
        >
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="tree-scroll" role="tree" aria-label="服务器目录树">
        {render('/', '文件系统 /', 0)}
      </div>
    </div>
  );
}
