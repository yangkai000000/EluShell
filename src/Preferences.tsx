import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { X, Settings, Palette, FolderOpen, Sparkles, Download } from 'lucide-react';
import type { Settings as WorkspaceSettings } from './shared';
import { AISettings, type AIModel } from './AI';
import { UpdateSettings, useUpdates } from './Updates';
import AppearancePanel from './AppearancePanel';
import ConfigPanel from './ConfigPanel';
import { version } from '../package.json';
import './preferences.css';

const sections = [
  { id: 'basic', label: '基础配置', icon: Settings },
  { id: 'performance', label: '功能与性能', icon: Settings },
  { id: 'appearance', label: '字体与背景', icon: Palette },
  { id: 'storage', label: '本地目录与共享', icon: FolderOpen },
  { id: 'ai', label: 'AI 配置', icon: Sparkles },
  { id: 'updates', label: '更新配置', icon: Download },
] as const;
export type PreferenceSection = (typeof sections)[number]['id'];

export default function Preferences({
  initial,
  settings,
  setSettings,
  ai,
  updates,
  close,
}: {
  initial: PreferenceSection;
  settings: WorkspaceSettings;
  setSettings: Dispatch<SetStateAction<WorkspaceSettings>>;
  ai: AIModel;
  updates: ReturnType<typeof useUpdates>;
  close: () => void;
}) {
  const [active, setActive] = useState<PreferenceSection>(initial);
  const content = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const locate = (id: PreferenceSection) => {
    const node = content.current?.querySelector<HTMLElement>(`#preferences-${id}`);
    if (node && content.current) content.current.scrollTop = node.offsetTop;
    setActive(id);
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      locate(initial);
      nav.current?.querySelector<HTMLButtonElement>(`[data-section="${initial}"]`)?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      previous?.focus();
    };
  }, [initial]);
  const syncSection = () => {
    const panel = content.current;
    if (!panel) return;
    const visible = sections.filter(({ id }) => {
      const node = panel.querySelector<HTMLElement>(`#preferences-${id}`);
      return node && node.offsetTop <= panel.scrollTop + 48;
    });
    setActive(visible.at(-1)?.id || 'basic');
  };
  return (
    <div
      className="modal-backdrop"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
    >
      <section
        className="modal preferences-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-title"
      >
        <div className="modal-header">
          <h2 id="preferences-title">工作区设置</h2>
          <button title="关闭工作区设置" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div className="preferences-layout">
          <nav ref={nav} className="preferences-nav" aria-label="设置目录">
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                data-section={id}
                aria-current={active === id ? 'location' : undefined}
                onClick={() => locate(id)}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
            <span className="preferences-version">EluShell {version}</span>
          </nav>
          <div className="modal-content preferences-content" ref={content} onScroll={syncSection}>
            <section id="preferences-basic" className="preferences-section">
              <h3>基础配置</h3>
              <label>
                会话名称显示
                <select
                  value={settings.sessionNameMode}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, sessionNameMode: e.target.value as 'name' | 'ip' }))
                  }
                >
                  <option value="name">连接名称</option>
                  <option value="ip">IP / 主机地址</option>
                </select>
              </label>
              <p>
                同时用于终端会话和独立文件编辑器。需要截图显示 IP
                时可随时切换；使用域名连接时显示原主机地址。
              </p>
              <label>
                监控刷新间隔
                <select
                  value={settings.pollSeconds}
                  onChange={(event) =>
                    setSettings((s) => ({ ...s, pollSeconds: +event.target.value }))
                  }
                >
                  {[2, 3, 5, 10, 30, 60].map((n) => (
                    <option key={n} value={n}>
                      {n} 秒
                    </option>
                  ))}
                </select>
              </label>
              <p>仅采集当前活动会话，减少服务器开销。每次采集通过独立 SSH 通道完成。</p>
              <p>
                基础配置、字体和背景修改后自动保存到本机。每个连接分别保留最近 100
                条输入栏命令历史。
              </p>
            </section>
            <section id="preferences-performance" className="preferences-section">
              <h3>功能与性能</h3>
              <p>关闭不需要的功能会停止相关后台工作。设置立即生效，已保存的数据会保留。</p>
              {(
                [
                  ['toolkit', '开发工具包', '关闭后停止抓包任务并释放工具资源，采集结果保留在本机'],
                  ['monitoring', '服务器监控', '采集 CPU、内存、磁盘和网络指标'],
                  ['directoryTree', '远程目录树', '显示和缓存目录层级；关闭后仍可使用文件列表'],
                  ['directoryFollow', '目录自动跟随终端', '定期检查终端目录并同步文件列表'],
                  ['ai', 'AI 助手', '关闭后停止回答并释放已加载的对话，历史保留在本机'],
                  ['backgroundImages', '背景图片', '关闭后使用背景色，释放已加载的背景图片'],
                  ['commandHistory', '记录命令历史', '关闭后不再记录新命令，已有历史保留'],
                  [
                    'transferAutoOpen',
                    '传输进度自动展开',
                    '关闭后仅在点击进度按钮时展开，不影响文件传输',
                  ],
                ] as const
              ).map(([key, label, description]) => (
                <label className="feature-toggle" key={key}>
                  <input
                    type="checkbox"
                    aria-label={label}
                    checked={settings.features[key]}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        features: { ...s.features, [key]: e.target.checked },
                      }))
                    }
                  />
                  <span>
                    {label}
                    <small>{description}</small>
                  </span>
                </label>
              ))}
              <label>
                每个终端的历史行数
                <select
                  aria-label="终端历史行数"
                  value={settings.performance.scrollback}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      performance: { ...s.performance, scrollback: +e.target.value },
                    }))
                  }
                >
                  {[0, 500, 1000, 2000, 6000, 10000].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? '不保留滚动历史' : `${n} 行`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                多会话历史缓存预算
                <select
                  aria-label="多会话历史缓存预算"
                  value={settings.performance.historyCells}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      performance: { ...s.performance, historyCells: +e.target.value },
                    }))
                  }
                >
                  {[100000, 500000, 1000000, 2000000, 4000000].map((n) => (
                    <option key={n} value={n}>
                      {n / 10000} 万字符格
                    </option>
                  ))}
                </select>
              </label>
              <p>
                历史缓存由所有会话共享预算；会话数或终端宽度增加时，自动减少可保留的历史行。调低设置会移除最早的滚动历史，不影响连接和当前屏幕。
              </p>
              <label className="feature-toggle">
                <input
                  type="checkbox"
                  aria-label="窗口隐藏时暂停自动查询"
                  checked={settings.performance.pauseWhenHidden}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      performance: { ...s.performance, pauseWhenHidden: e.target.checked },
                    }))
                  }
                />
                <span>
                  窗口隐藏时暂停自动查询
                  <small>最小化时暂停监控和目录跟随，恢复窗口后继续；SSH 连接保持</small>
                </span>
              </label>
            </section>
            <section id="preferences-appearance" className="preferences-section">
              <AppearancePanel
                value={settings.appearance}
                change={(appearance) => setSettings((s) => ({ ...s, appearance }))}
              />
            </section>
            <section id="preferences-storage" className="preferences-section">
              <h3>本地目录与共享</h3>
              <ConfigPanel settings={settings} onChange={setSettings} />
            </section>
            <section id="preferences-ai" className="preferences-section">
              {settings.features.ai ? (
                <AISettings model={ai} />
              ) : (
                <p>AI 助手已停用。可在「功能与性能」中重新开启。</p>
              )}
            </section>
            <section id="preferences-updates" className="preferences-section">
              <UpdateSettings model={updates} />
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
