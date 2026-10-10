import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Folder, FolderPlus, Server, Plus, X, ChevronDown, ChevronRight } from 'lucide-react';
import {
  ProfileSchema,
  emptyProfile,
  type Profile,
  type Settings,
  type ConnectionFolder,
} from './shared';
import TunnelEditor from './TunnelEditor';
import ConnectionSharing from './ConnectionSharing';
import { canMoveFolder, folderPath, moveConnectionItem, type ConnectionDrag } from './connections';
export default function ConnectionManager({
  settings,
  initial,
  onChange,
  onConnect,
  onClose,
}: {
  settings: Settings;
  initial: Profile | null;
  onChange: (s: Settings) => void;
  onConnect: (p: Profile, secret: string) => Promise<void>;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<Profile | null>(initial),
    [secret, setSecret] = useState(''),
    [remember, setRemember] = useState(true),
    [stored, setStored] = useState(false),
    [tab, setTab] = useState('ssh'),
    [filter, setFilter] = useState(''),
    [selectedFolder, setSelectedFolder] = useState(''),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [folderForm, setFolderForm] = useState<{
    id?: string;
    name: string;
    parentId: string;
  } | null>(null);
  const [context, setContext] = useState<{
    folderId: string;
    profileId?: string;
    x: number;
    y: number;
  } | null>(null);
  const [deleting, setDeleting] = useState<{
    name: string;
    profiles: string[];
    folders: string[];
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [detailProfile, setDetailProfile] = useState('');
  const dragging = useRef<ConnectionDrag | null>(null);
  const busyRef = useRef(false);
  const contextRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!context) return;
    const dismiss = (e: PointerEvent) => {
      if (!contextRef.current?.contains(e.target as Node)) setContext(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContext(null);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', key);
    };
  }, [context]);
  useEffect(() => {
    setSecret('');
    setRemember(true);
  }, [editing?.id]);
  useEffect(() => {
    setStored(false);
    if (editing && ProfileSchema.safeParse(editing).success) {
      let alive = true;
      void window
        .elu!.credentialStatus(editing)
        .then((v) => {
          if (alive) setStored(v);
        })
        .catch((e) => setError(String(e)));
      return () => {
        alive = false;
      };
    }
  }, [
    editing?.id,
    editing?.host,
    editing?.port,
    editing?.username,
    editing?.auth,
    editing?.privateKeyPath,
  ]);
  const commit = async (next: Settings) => {
    await window.elu!.save(next);
    onChange(next);
  };
  const save = async (connect = false) => {
    if (!editing || busyRef.current) return;
    const parsed = ProfileSchema.safeParse(editing);
    if (!parsed.success) {
      setError('请检查连接名称、主机、端口和隧道端口');
      setTab('ssh');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const p = {
        ...parsed.data,
        group: settings.folders.find((f) => f.id === editing.folderId)?.name || '',
      };
      await window.elu!.saveCredential(p, secret, remember);
      await commit({
        ...settings,
        profiles: [...settings.profiles.filter((x) => x.id !== p.id), p],
      });
      setStored(await window.elu!.credentialStatus(p));
      if (connect) await onConnect(p, secret);
      else {
        setDetailProfile(p.id);
        setEditing(null);
        setError('已保存');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const create = (folderId = selectedFolder) => {
    setFolderForm(null);
    setEditing({
      ...emptyProfile,
      id: crypto.randomUUID(),
      name: '',
      username: 'root',
      folderId: folderId || undefined,
      tags: ['linux'],
    });
    setTab('ssh');
    setError('');
  };
  const select = (p: Profile) => {
    if (busyRef.current) return;
    setFolderForm(null);
    setSelectedFolder(p.folderId || '');
    setEditing(p);
    setTab('ssh');
    setError('');
  };
  const selectFolder = (id: string) => {
    if (busyRef.current) return;
    setSelectedFolder(id);
    setDetailProfile('');
    setEditing(null);
    setFolderForm(null);
    setError('');
  };
  const quickConnect = async (p: Profile) => {
    if (busyRef.current) return;
    setDetailProfile(p.id);
    setSelectedFolder(p.folderId || '');
    busyRef.current = true;
    setBusy(true);
    setContext(null);
    try {
      if (p.auth === 'password' && !(await window.elu!.credentialStatus(p))) {
        setEditing(p);
        setTab('ssh');
        setError('此连接尚未保存密码，请输入密码后连接');
        return;
      }
      await onConnect(p, '');
      onClose();
    } catch (e) {
      setEditing(p);
      setTab('ssh');
      setError(String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const beginDrag = (event: DragEvent, value: ConnectionDrag) => {
    if (busyRef.current) {
      event.preventDefault();
      return;
    }
    dragging.current = value;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-elushell-connection', JSON.stringify(value));
    setContext(null);
  };
  const dropProps = (target: string) => ({
    onDragOver: (event: DragEvent) => {
      const value = dragging.current;
      if (
        !value ||
        busyRef.current ||
        (value.kind === 'folder' && !canMoveFolder(settings.folders, value.id, target))
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget(target);
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null);
    },
    onDrop: async (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const value = dragging.current;
      dragging.current = null;
      setDropTarget(null);
      if (!value || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const next = moveConnectionItem(settings, value, target);
        await commit(next);
        if (editing && value.kind === 'profile' && editing.id === value.id)
          setEditing(next.profiles.find((p) => p.id === editing.id)!);
        setSelectedFolder(target);
        setCollapsed((s) => {
          const n = new Set(s);
          n.delete(target);
          return n;
        });
        setError('');
      } catch (e) {
        setError(String(e));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
  });
  const folderContext = (event: React.MouseEvent, folderId: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (busyRef.current) return;
    selectFolder(folderId);
    setContext({
      folderId,
      x: Math.min(event.clientX, window.innerWidth - 216),
      y: Math.min(event.clientY, window.innerHeight - 240),
    });
  };
  const matches = (p: Profile) =>
    `${p.name} ${p.host} ${p.username} ${p.group}`.toLowerCase().includes(filter.toLowerCase());
  const profileRow = (p: Profile, depth = 0) => (
    <button
      key={p.id}
      className={'profile-item ' + (detailProfile === p.id ? 'selected' : '')}
      data-profile-id={p.id}
      onClick={() => {
        setDetailProfile(p.id);
        setSelectedFolder(p.folderId || '');
        setError('');
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (busyRef.current) return;
        setDetailProfile(p.id);
        setSelectedFolder(p.folderId || '');
        setContext({
          folderId: p.folderId || '',
          profileId: p.id,
          x: Math.min(e.clientX, innerWidth - 216),
          y: Math.min(e.clientY, innerHeight - 240),
        });
      }}
      onDoubleClick={() => void quickConnect(p)}
      draggable={!busy}
      onDragStart={(event) => beginDrag(event, { kind: 'profile', id: p.id })}
      onDragEnd={() => {
        dragging.current = null;
        setDropTarget(null);
      }}
      title={p.username + '@' + p.host + ' · 双击连接，拖动调整分类'}
    >
      <span className="connection-name" style={{ paddingLeft: 22 + depth * 16 }}>
        <Server size={14} />
        <b>{p.name}</b>
      </span>
      <span>{p.host}</span>
      <span>{p.port}</span>
      <span>{p.username}</span>
    </button>
  );
  const folder = (f: ConnectionFolder, depth: number): React.ReactNode => (
    <div key={f.id}>
      <div
        className={
          'connection-folder ' +
          (selectedFolder === f.id ? 'selected ' : '') +
          (dropTarget === f.id ? 'drop-target' : '')
        }
        data-folder-id={f.id}
        style={{ paddingLeft: depth * 16 + 5 }}
        onContextMenu={(event) => folderContext(event, f.id)}
        draggable={!busy}
        onDragStart={(event) => beginDrag(event, { kind: 'folder', id: f.id })}
        onDragEnd={() => {
          dragging.current = null;
          setDropTarget(null);
        }}
        {...dropProps(f.id)}
      >
        <button
          title={'折叠或展开 ' + f.name}
          onClick={() =>
            setCollapsed((s) => {
              const n = new Set(s);
              n.has(f.id) ? n.delete(f.id) : n.add(f.id);
              return n;
            })
          }
        >
          {collapsed.has(f.id) && !filter ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        <button className="folder-select" onClick={() => selectFolder(f.id)}>
          <Folder size={15} />
          {f.name}
        </button>
        <small>{settings.profiles.filter((p) => p.folderId === f.id).length} 个连接</small>
      </div>
      {(!collapsed.has(f.id) || filter) && (
        <div>
          {settings.folders.filter((x) => x.parentId === f.id).map((x) => folder(x, depth + 1))}
          {settings.profiles
            .filter((p) => p.folderId === f.id && matches(p))
            .map((p) => profileRow(p, depth + 1))}
        </div>
      )}
    </div>
  );
  const editFolder = async () => {
    if (busyRef.current) return;
    if (!folderForm?.name.trim()) {
      setError('请输入文件夹名称');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const f = {
        id: folderForm.id || crypto.randomUUID(),
        name: folderForm.name.trim(),
        parentId: folderForm.parentId || undefined,
      };
      await commit({
        ...settings,
        folders: [...settings.folders.filter((x) => x.id !== f.id), f],
        profiles: settings.profiles.map((p) => (p.folderId === f.id ? { ...p, group: f.name } : p)),
      });
      setSelectedFolder(f.id);
      setEditing(null);
      setFolderForm(null);
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const removeSelected = async () => {
    if (!deleting || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      for (const p of settings.profiles.filter((p) => deleting.profiles.includes(p.id)))
        await window.elu!.saveCredential(p, '', false);
      await commit({
        ...settings,
        profiles: settings.profiles.filter((p) => !deleting.profiles.includes(p.id)),
        folders: settings.folders.filter((f) => !deleting.folders.includes(f.id)),
        history: Object.fromEntries(
          Object.entries(settings.history).filter(([id]) => !deleting.profiles.includes(id)),
        ),
        recentConnections: settings.recentConnections.filter(
          (r) => !deleting.profiles.includes(r.profileId),
        ),
      });
      setDeleting(null);
      setDetailProfile('');
      setSelectedFolder('');
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const requestDeleteFolder = (id: string) => {
    const ids = new Set([id]);
    let previous = 0;
    while (previous !== ids.size) {
      previous = ids.size;
      settings.folders.forEach((f) => {
        if (f.parentId && ids.has(f.parentId)) ids.add(f.id);
      });
    }
    setDeleting({
      name: settings.folders.find((f) => f.id === id)!.name,
      folders: [...ids],
      profiles: settings.profiles.filter((p) => p.folderId && ids.has(p.folderId)).map((p) => p.id),
    });
    setContext(null);
  };
  const selectedName = settings.profiles.find((p) => p.id === detailProfile);
  return (
    <div className="modal-backdrop">
      <section
        className="modal connection-modal compact-connections"
        role="dialog"
        aria-label="连接管理"
      >
        <div className="modal-header">
          <h2>连接管理</h2>
          <button title="关闭连接管理" disabled={busy} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="connection-content">
          <aside
            className="connection-list"
            onContextMenu={(e) => folderContext(e, selectedFolder)}
          >
            <div className="connection-toolbar">
              <ConnectionSharing settings={settings} onChange={onChange} />
              <button
                title="新建文件夹"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setError('');
                  setFolderForm({ name: '', parentId: selectedFolder });
                }}
              >
                <FolderPlus size={16} />
              </button>
              <input
                placeholder="搜索名称、地址、用户或分类"
                aria-label="搜索连接"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <div className="connection-columns">
              <span>名称</span>
              <span>地址</span>
              <span>端口</span>
              <span>用户</span>
            </div>
            <div className="connection-tree-scroll">
              <button
                className={
                  'folder-root ' +
                  (!selectedFolder ? 'selected ' : '') +
                  (dropTarget === '' ? 'drop-target' : '')
                }
                onContextMenu={(event) => folderContext(event, '')}
                {...dropProps('')}
                onClick={() => selectFolder('')}
              >
                连接 / 未分类
              </button>
              {settings.folders.filter((f) => !f.parentId).map((f) => folder(f, 0))}
              {settings.profiles.filter((p) => !p.folderId && matches(p)).map((p) => profileRow(p))}
              {!settings.profiles.length && (
                <p className="empty">添加第一台服务器，或先创建分类文件夹</p>
              )}
            </div>
            <footer className="connection-list-status" aria-label="文件夹信息">
              <span title={folderPath(settings.folders, selectedFolder)}>
                {folderPath(settings.folders, selectedFolder)}
              </span>
              <span>
                {selectedName
                  ? selectedName.username + '@' + selectedName.host + ':' + selectedName.port
                  : settings.profiles.filter((p) => (p.folderId || '') === selectedFolder).length +
                    ' 个直属连接'}
              </span>
              <small>{busy ? '处理中…' : error || '双击连接 · 右键管理 · 拖动分类'}</small>
            </footer>
          </aside>
          {(editing || folderForm) && (
            <div className="connection-editor-layer">
              <section
                className="modal connection-editor-dialog"
                role="dialog"
                aria-label={
                  folderForm ? (folderForm.id ? '重命名文件夹' : '新建文件夹') : 'SSH 连接编辑'
                }
              >
                <div className="modal-header">
                  <h2>
                    {folderForm
                      ? '文件夹设置'
                      : settings.profiles.some((p) => p.id === editing?.id)
                        ? '编辑 SSH 连接'
                        : '新建 SSH 连接'}
                  </h2>
                  <button
                    type="button"
                    title="关闭连接编辑"
                    disabled={busy}
                    onClick={() => {
                      setEditing(null);
                      setFolderForm(null);
                      setError('');
                    }}
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="profile-form">
                  {folderForm ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void editFolder();
                      }}
                    >
                      <h3>{folderForm.id ? '重命名文件夹' : '新建文件夹'}</h3>
                      <label>
                        文件夹名称
                        <input
                          autoFocus
                          required
                          value={folderForm.name}
                          onChange={(e) => setFolderForm({ ...folderForm, name: e.target.value })}
                        />
                      </label>
                      <label>
                        上级文件夹
                        <select
                          value={folderForm.parentId}
                          onChange={(e) =>
                            setFolderForm({ ...folderForm, parentId: e.target.value })
                          }
                        >
                          <option value="">连接根目录</option>
                          {settings.folders
                            .filter(
                              (f) =>
                                !folderForm.id ||
                                canMoveFolder(settings.folders, folderForm.id, f.id),
                            )
                            .map((f) => (
                              <option key={f.id} value={f.id}>
                                {folderPath(settings.folders, f.id)}
                              </option>
                            ))}
                        </select>
                      </label>
                      <button type="button" onClick={() => setFolderForm(null)}>
                        取消
                      </button>
                      <button className="primary">保存文件夹</button>
                    </form>
                  ) : editing ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void save(true);
                      }}
                    >
                      <nav className="connection-tabs">
                        {[
                          ['ssh', 'SSH 连接'],
                          ['startup', '登录命令'],
                          ['tunnels', '隧道'],
                        ].map(([id, name]) => (
                          <button
                            type="button"
                            key={id}
                            className={tab === id ? 'selected' : ''}
                            onClick={() => setTab(id)}
                          >
                            {name}
                            {id === 'tunnels' ? ` (${editing.tunnels?.length || 0})` : ''}
                          </button>
                        ))}
                      </nav>
                      <div className="connection-fields" hidden={tab !== 'ssh'}>
                        <div className="form-grid">
                          <label>
                            连接名称
                            <input
                              required
                              value={editing.name}
                              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                            />
                          </label>
                          <label>
                            所属文件夹
                            <select
                              value={editing.folderId || ''}
                              onChange={(e) =>
                                setEditing({ ...editing, folderId: e.target.value || undefined })
                              }
                            >
                              <option value="">未分类</option>
                              {settings.folders.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {folderPath(settings.folders, f.id)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            主机 / IP
                            <input
                              required
                              value={editing.host}
                              onChange={(e) => {
                                setEditing({ ...editing, host: e.target.value });
                                setStored(false);
                              }}
                            />
                          </label>
                          <label>
                            端口
                            <input
                              required
                              type="number"
                              min="1"
                              max="65535"
                              value={editing.port}
                              onChange={(e) => {
                                setEditing({ ...editing, port: +e.target.value });
                                setStored(false);
                              }}
                            />
                          </label>
                          <label>
                            用户名
                            <input
                              required
                              value={editing.username}
                              onChange={(e) => {
                                setEditing({ ...editing, username: e.target.value });
                                setStored(false);
                              }}
                            />
                          </label>
                          <label>
                            认证方式
                            <select
                              value={editing.auth}
                              onChange={(e) => {
                                setEditing({ ...editing, auth: e.target.value as Profile['auth'] });
                                setStored(false);
                                setSecret('');
                              }}
                            >
                              <option value="password">密码</option>
                              <option value="key">SSH 私钥</option>
                              <option value="agent">SSH Agent / Pageant</option>
                            </select>
                          </label>
                        </div>
                        {editing.auth === 'key' && (
                          <label>
                            私钥文件
                            <div className="key-picker">
                              <input
                                value={editing.privateKeyPath || ''}
                                onChange={(e) =>
                                  setEditing({ ...editing, privateKeyPath: e.target.value })
                                }
                              />
                              <button
                                type="button"
                                onClick={async () => {
                                  const p = await window.elu!.pickKey();
                                  if (p) setEditing({ ...editing, privateKeyPath: p });
                                }}
                              >
                                选择
                              </button>
                            </div>
                          </label>
                        )}
                        {editing.auth !== 'agent' && (
                          <>
                            <label>
                              {editing.auth === 'password' ? '密码' : '私钥口令（可选）'}
                              <input
                                autoComplete="off"
                                type="password"
                                value={secret}
                                data-saved-secret={stored && !secret ? 'true' : undefined}
                                placeholder={stored ? '••••••••' : '请输入'}
                                title={
                                  stored ? '已保存；不修改则继续使用，输入新内容可替换' : undefined
                                }
                                onChange={(e) => setSecret(e.target.value)}
                              />
                            </label>
                            <label className="checkbox">
                              <input
                                type="checkbox"
                                checked={remember}
                                onChange={(e) => setRemember(e.target.checked)}
                              />
                              加密保存密码 / 口令
                            </label>
                            <small>
                              {stored
                                ? '黑点表示已保存；不修改则继续使用，输入新内容可替换。取消勾选并保存可清除。'
                                : '保存在本机 .EluShell，仅当前系统用户可解密。'}
                            </small>
                          </>
                        )}
                        <label>
                          服务标签（逗号分隔，用于推荐命令）
                          <input
                            value={editing.tags.join(',')}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                tags: e.target.value.split(',').map((v) => v.trim()),
                              })
                            }
                          />
                        </label>
                      </div>
                      <div hidden={tab !== 'startup'}>
                        <label>
                          登录默认命令
                          <textarea
                            rows={8}
                            value={editing.startup}
                            onChange={(e) => setEditing({ ...editing, startup: e.target.value })}
                          />
                        </label>
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            checked={editing.autoStartup}
                            onChange={(e) =>
                              setEditing({ ...editing, autoStartup: e.target.checked })
                            }
                          />
                          连接成功后自动执行以上命令
                        </label>
                      </div>
                      <div hidden={tab !== 'tunnels'}>
                        <TunnelEditor
                          rules={editing.tunnels || []}
                          onChange={(tunnels) => setEditing({ ...editing, tunnels })}
                        />
                      </div>
                      <div className="form-actions">
                        <span />
                        <button type="button" disabled={busy} onClick={() => void save()}>
                          保存
                        </button>
                        <button className="primary" disabled={busy}>
                          {busy ? '处理中…' : '保存并连接'}
                        </button>
                      </div>
                    </form>
                  ) : null}
                  {error && (
                    <div
                      className={error === '已保存' ? 'connection-success' : 'editor-error'}
                      role="status"
                    >
                      {error}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </section>
      {context && (
        <div
          ref={contextRef}
          className="connection-context"
          role="menu"
          style={{ left: context.x, top: context.y }}
        >
          {context.profileId && (
            <>
              <button
                role="menuitem"
                onClick={() =>
                  void quickConnect(settings.profiles.find((p) => p.id === context.profileId)!)
                }
              >
                连接
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  select(settings.profiles.find((p) => p.id === context.profileId)!);
                  setContext(null);
                }}
              >
                编辑连接
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  const p = settings.profiles.find((p) => p.id === context.profileId)!;
                  void window.elu!.writeClipboard(p.host).catch((e) => setError(String(e)));
                  setContext(null);
                }}
              >
                复制地址
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  const p = settings.profiles.find((p) => p.id === context.profileId)!;
                  setDeleting({ name: p.name, profiles: [p.id], folders: [] });
                  setContext(null);
                }}
              >
                删除连接
              </button>
            </>
          )}
          <button
            role="menuitem"
            onClick={() => {
              create(context.folderId);
              setContext(null);
            }}
          >
            <Plus size={14} />
            添加 SSH 服务器
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setEditing(null);
              setFolderForm({ name: '', parentId: context.folderId });
              setContext(null);
            }}
          >
            <FolderPlus size={14} />
            新建子文件夹
          </button>
          {context.folderId && !context.profileId && (
            <button
              role="menuitem"
              onClick={() => {
                const f = settings.folders.find((f) => f.id === context.folderId)!;
                setFolderForm({ ...f, parentId: f.parentId || '' });
                setContext(null);
              }}
            >
              重命名文件夹
            </button>
          )}
          {context.folderId && !context.profileId && (
            <button role="menuitem" onClick={() => requestDeleteFolder(context.folderId)}>
              删除文件夹
            </button>
          )}
        </div>
      )}
      {deleting && (
        <div className="connection-editor-layer">
          <section
            className="modal connection-delete-dialog"
            role="dialog"
            aria-label="删除连接配置"
          >
            <div className="modal-header">
              <h2>删除配置</h2>
            </div>
            <div className="modal-content">
              <p>删除「{deleting.name}」？</p>
              <p>
                包含 {deleting.profiles.length} 个连接、{deleting.folders.length}{' '}
                个文件夹及这些连接的已保存凭据和历史。仅删除本地配置，服务器上的文件不受影响。
              </p>
              <div className="form-actions">
                <button disabled={busy} onClick={() => setDeleting(null)}>
                  取消
                </button>
                <button className="primary" disabled={busy} onClick={() => void removeSelected()}>
                  确认删除
                </button>
              </div>
              {error && <p className="editor-error">{error}</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
