import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { X } from 'lucide-react';
import type { Profile } from './shared';
import { closingTabs, type TabTool, type CloseMode } from './session-tabs';

export function useSessionActions(options: {
  tabs: string[];
  tools: TabTool[];
  sessions: { id: string; profile: Profile; connected: boolean }[];
  name: (id: string) => string;
  blocked: (id: string) => string;
  capturing: (id: string) => boolean;
  close: (ids: string[]) => Promise<void>;
  disconnect: (ids: string[]) => Promise<void>;
  reconnect: (id: string, password: string) => Promise<void>;
  notify: (text: string) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'close' | 'disconnect'; ids: string[] } | null>(
    null,
  );
  const [credential, setCredential] = useState<{
    name: string;
    resolve: (value: string | null) => void;
  } | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', key);
    };
  }, [menu]);
  const owner = (id: string) => options.tools.find((t) => t.id === id)?.sessionId || id;
  const current = options.sessions.find((s) => s.id === owner(menu?.id || ''));
  const request = async (kind: 'close' | 'disconnect', ids: string[], accepted = false) => {
    setMenu(null);
    if (lock.current) return;
    const blocked = ids.filter((id) => latest.current.blocked(id));
    const permitted = ids.filter((id) => !latest.current.blocked(id));
    if (blocked.length)
      latest.current.notify(
        '已保留运行中的会话：' +
          [
            ...new Set(
              blocked.map(
                (id) => latest.current.name(id) + '（' + latest.current.blocked(id) + '）',
              ),
            ),
          ].join('、'),
      );
    if (!permitted.length) {
      setConfirm(null);
      return;
    }
    if (!accepted && permitted.some((id) => latest.current.capturing(id))) {
      setConfirm({ kind, ids: permitted });
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      await latest.current[kind](permitted);
      setConfirm(null);
    } catch (e) {
      latest.current.notify(String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const connect = async (ids: string[]) => {
    if (lock.current) return;
    setMenu(null);
    lock.current = true;
    setBusy(true);
    const failures: string[] = [];
    let count = 0;
    try {
      for (const id of ids) {
        const session = latest.current.sessions.find((s) => s.id === id);
        if (!session || session.connected) continue;
        try {
          let secret = '';
          if (
            session.profile.auth === 'password' &&
            !(await window.elu!.credentialStatus(session.profile))
          ) {
            const answer = await new Promise<string | null>((resolve) => {
              setPassword('');
              setCredential({ name: latest.current.name(id), resolve });
            });
            if (answer === null) {
              failures.push(latest.current.name(id) + '：已跳过');
              continue;
            }
            secret = answer;
          }
          await latest.current.reconnect(id, secret);
          count++;
        } catch (e) {
          failures.push(latest.current.name(id) + '：' + String(e));
        }
      }
      latest.current.notify(
        `已连接 ${count} 个会话` + (failures.length ? '；' + failures.join('；') : ''),
      );
    } finally {
      lock.current = false;
      setBusy(false);
      setPassword('');
    }
  };
  const closeMode = (mode: CloseMode) =>
    menu ? closingTabs(options.tabs, options.tools, menu.id, mode) : [];
  const modalKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      if (credential) {
        credential.resolve(null);
        setCredential(null);
        setPassword('');
      } else if (!busy) setConfirm(null);
    }
    if (e.key === 'Tab') {
      const inputs = [
        ...e.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled)',
        ),
      ];
      const first = inputs[0],
        last = inputs[inputs.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };
  return {
    busy,
    onContextMenu: (e: MouseEvent) => {
      const id = (e.target as Element).closest<HTMLElement>('[data-tab-id]')?.dataset.tabId;
      if (!id) return;
      e.preventDefault();
      setMenu({ id, x: e.clientX, y: e.clientY });
    },
    ui: (
      <>
        {menu && (
          <div
            className="file-context session-context"
            role="menu"
            aria-label="会话操作"
            style={{
              left: Math.max(8, Math.min(menu.x, innerWidth - 226)),
              top: Math.max(8, Math.min(menu.y, innerHeight - 400)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <small>{options.name(menu.id)}</small>
            {current && (
              <>
                <button
                  role="menuitem"
                  disabled={busy || current.connected}
                  onClick={() => void connect([current.id])}
                >
                  连接
                </button>
                <button
                  role="menuitem"
                  disabled={busy || !current.connected}
                  onClick={() => void request('disconnect', [current.id])}
                >
                  断开连接
                </button>
              </>
            )}
            <button
              role="menuitem"
              disabled={busy || !options.sessions.some((s) => !s.connected)}
              onClick={() =>
                void connect(options.sessions.filter((s) => !s.connected).map((s) => s.id))
              }
            >
              连接全部
            </button>
            <button
              role="menuitem"
              disabled={busy || !options.sessions.some((s) => s.connected)}
              onClick={() =>
                void request(
                  'disconnect',
                  options.sessions.filter((s) => s.connected).map((s) => s.id),
                )
              }
            >
              断开全部
            </button>
            <hr />
            {(
              [
                ['current', '关闭当前'],
                ['left', '关闭左侧'],
                ['right', '关闭右侧'],
                ['others', '关闭其他'],
                ['all', '关闭全部'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                role="menuitem"
                disabled={busy || !closeMode(mode).length}
                onClick={() => void request('close', closeMode(mode))}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {confirm && (
          <div className="editor-overlay" onKeyDown={modalKeys}>
            <section
              className="file-drop-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="停止抓包并继续"
            >
              <header>
                <h2>正在抓包</h2>
                <button disabled={busy} onClick={() => setConfirm(null)}>
                  <X size={17} />
                </button>
              </header>
              <div className="file-drop-body">
                <p>
                  {confirm.kind === 'close' ? '关闭标签' : '断开连接'}
                  会停止相关服务器的抓包，已采集的完整数据包保留在本机。
                </p>
                <ul>
                  {confirm.ids.map((id) => (
                    <li key={id}>{options.name(id)}</li>
                  ))}
                </ul>
              </div>
              <footer>
                <button autoFocus disabled={busy} onClick={() => setConfirm(null)}>
                  取消
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void request(confirm.kind, confirm.ids, true)}
                >
                  {busy ? '处理中…' : '停止并继续'}
                </button>
              </footer>
            </section>
          </div>
        )}
        {credential && (
          <div className="editor-overlay" onKeyDown={modalKeys}>
            <form
              className="file-action-form"
              role="dialog"
              aria-modal="true"
              aria-label="连接会话"
              onSubmit={(e) => {
                e.preventDefault();
                credential.resolve(password);
                setCredential(null);
                setPassword('');
              }}
            >
              <h3>连接会话</h3>
              <p>{credential.name}</p>
              <label>
                连接密码
                <input
                  type="password"
                  autoFocus
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <p>此连接未保存密码，请输入本次连接使用的密码。</p>
              <footer>
                <button
                  type="button"
                  onClick={() => {
                    credential.resolve(null);
                    setCredential(null);
                    setPassword('');
                  }}
                >
                  跳过
                </button>
                <button className="primary" disabled={!password}>
                  连接
                </button>
              </footer>
            </form>
          </div>
        )}
      </>
    ),
  };
}
