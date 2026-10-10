import { useEffect, useRef, useState } from 'react';
import { Server, Search } from 'lucide-react';
import { folderPath } from './connections';
import type { Settings, Profile } from './shared';
export default function NewTab({
  settings,
  connect,
  clear,
  busy,
}: {
  settings: Settings;
  connect: (profile: Profile) => void;
  clear: () => void;
  busy: boolean;
}) {
  const [query, setQuery] = useState(''),
    [selected, setSelected] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [query]);
  const recent = settings.recentConnections
    .map((r) => ({ ...r, profile: settings.profiles.find((p) => p.id === r.profileId) }))
    .filter((r) => r.profile);
  const rows = recent.length ? recent : settings.profiles.map((profile) => ({ profile, at: 0 }));
  const visible = rows.filter(
    ({ profile: p }) =>
      p &&
      [p.name, p.host, p.username, folderPath(settings.folders, p.folderId)]
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  );
  return (
    <section className="welcome-workspace new-tab-page" aria-label="新建标签页">
      <div className="recent-toolbar">
        <b>{recent.length ? '最近连接' : '已保存连接'}</b>
        <small className="recent-count" role="status">
          {query.trim() ? `${visible.length} / ${rows.length} 条` : `${rows.length} 条`}
        </small>
        <label>
          <Search size={14} />
          <input
            aria-label="筛选最近连接"
            placeholder="搜索服务器、用户或分类"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {recent.length > 0 && <button onClick={clear}>清空最近记录</button>}
      </div>
      <div className="recent-scroll" ref={scroll}>
        <table className="recent-connections" aria-label="快速连接">
          <thead>
            <tr>
              <th>服务器</th>
              <th>分类</th>
              <th>用户</th>
              <th>地址</th>
              <th>最近连接</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(
              ({ profile: p, at }, index) =>
                p && (
                  <tr
                    key={p.id}
                    tabIndex={
                      selected === p.id ||
                      (!visible.some((r) => r.profile?.id === selected) && index === 0)
                        ? 0
                        : -1
                    }
                    aria-selected={selected === p.id}
                    onClick={() => setSelected(p.id)}
                    onDoubleClick={() => !busy && connect(p)}
                    onKeyDown={(e) => {
                      const next =
                        e.key === 'Home'
                          ? 0
                          : e.key === 'End'
                            ? visible.length - 1
                            : e.key === 'ArrowDown'
                              ? Math.min(index + 1, visible.length - 1)
                              : e.key === 'ArrowUp'
                                ? Math.max(0, index - 1)
                                : -1;
                      if (next >= 0) {
                        e.preventDefault();
                        setSelected(visible[next].profile!.id);
                        const row =
                          scroll.current?.querySelectorAll<HTMLTableRowElement>('tbody tr')[next];
                        row?.focus({ preventScroll: true });
                        row?.scrollIntoView({ block: 'nearest' });
                      }
                      if (e.key === 'Enter' && !busy) {
                        e.preventDefault();
                        connect(p);
                      }
                    }}
                  >
                    <td title={p.name}>
                      <Server size={14} />
                      {p.name}
                    </td>
                    <td title={folderPath(settings.folders, p.folderId)}>
                      {folderPath(settings.folders, p.folderId)}
                    </td>
                    <td>{p.username}</td>
                    <td title={p.host + ':' + p.port}>
                      {p.host}:{p.port}
                    </td>
                    <td>{at ? new Date(at).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
                  </tr>
                ),
            )}
          </tbody>
        </table>
        {!visible.length && (
          <div className="empty">
            {query ? '没有匹配的服务器' : '暂无连接，在连接管理中添加 SSH 服务器。'}
          </div>
        )}
      </div>
      {busy && <p role="status">正在连接…</p>}
    </section>
  );
}
