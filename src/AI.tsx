import { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Plus,
  History,
  Settings,
  X,
  Copy,
  ArrowUpRight,
  Send,
  Square,
  RefreshCw,
  Trash2,
  Pencil,
  ChevronLeft,
} from 'lucide-react';
import {
  AIConfigSchema,
  ProviderId,
  aiProviders,
  contextUsage,
  effortOptions,
  responseBlocks,
  type AIAttachment,
  type AIInput,
  type AIState,
  type AIProvider,
  type AIChat,
  type AIConfig,
  type AIMessage,
} from './ai-shared';
import { ResizeHandle } from './layout';
import './ai.css';

export function useAI(enabled: boolean, available = true) {
  const availableRef = useRef(available);
  availableRef.current = available;
  const [state, setState] = useState<AIState | null>(null),
    [chat, setChat] = useState<AIChat | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [attachmentDrafts, setAttachmentDrafts] = useState<Record<string, AIAttachment[]>>({});
  const attachmentKey = chat?.id || 'new';
  const attachments = attachmentDrafts[attachmentKey] || [];
  const setAttachments = (value: AIAttachment[] | ((a: AIAttachment[]) => AIAttachment[])) =>
    setAttachmentDrafts((d) => ({
      ...d,
      [attachmentKey]: typeof value === 'function' ? value(d[attachmentKey] || []) : value,
    }));
  const addAttachments = (items: AIAttachment[]) =>
    setAttachments((a) => {
      const other = Object.entries(attachmentDrafts)
        .filter(([k]) => k !== attachmentKey)
        .flatMap(([, values]) => values);
      const imageBytes = [...other, ...a, ...items].reduce(
        (n, item) => n + (item.kind === 'image' ? item.data?.length || 0 : 0),
        0,
      );
      if (imageBytes > 28_000_000) {
        setError('待发送图片占用已达上限，请发送或移除已有图片');
        return a;
      }
      if (a.length + items.length > 12) {
        setError('每条消息最多添加 12 项引用和图片');
        return a;
      }
      return [...a, ...items];
    });
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const selection = useRef(0),
    sending = useRef(false),
    events = useRef(new Map<string, AIMessage>());
  const refresh = async () => {
    const s = await window.elu!.aiState();
    if (availableRef.current) setState(s);
    return s;
  };
  useEffect(() => {
    if (enabled && !state) void refresh().catch((e) => setError(String(e)));
  }, [enabled]);
  useEffect(
    () =>
      available
        ? window.elu?.onAI((e) => {
            if (sending.current) events.current.set(e.message.id, e.message);
            if (events.current.size > 3) events.current.delete(events.current.keys().next().value!);
            setChat((c) =>
              c?.id === e.chatId
                ? {
                    ...c,
                    usage: e.usage,
                    messages: c.messages.map((m) => (m.id === e.message.id ? e.message : m)),
                  }
                : c,
            );
            if (e.done) void refresh().catch((e) => setError(String(e)));
          })
        : undefined,
    [available],
  );
  useEffect(() => {
    if (!available) {
      selection.current++;
      events.current.clear();
      setChat(null);
      setState(null);
      setError('');
      setAttachmentDrafts({});
    }
  }, [available]);
  const select = async (id: string) => {
    const token = ++selection.current;
    setError('');
    try {
      const c = await window.elu!.aiGet(id);
      if (availableRef.current && token === selection.current) setChat(c);
    } catch (e) {
      if (token === selection.current) setError(String(e));
    }
  };
  const create = async (provider = state!.config.provider) => {
    const token = ++selection.current;
    setError('');
    const c = await window.elu!.aiCreate(provider);
    if (availableRef.current && token === selection.current) setChat(c);
    await refresh();
    return c;
  };
  const send = async (text: string | AIInput, retry = false) => {
    if (sending.current || !availableRef.current) return false;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      let c = chatRef.current;
      if (!c) c = await create();
      const sent = await window.elu!.aiSend(c.id, text, retry);
      sent.messages = sent.messages.map((m) => events.current.get(m.id) || m);
      if (availableRef.current && (chatRef.current?.id === c.id || !chatRef.current)) setChat(sent);
      await refresh();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      sending.current = false;
      events.current.clear();
      setBusy(false);
    }
  };
  return {
    attachments,
    setAttachments,
    addAttachments,
    state,
    setState,
    chat,
    setChat,
    error,
    setError,
    busy,
    refresh,
    select,
    create,
    send,
  };
}
export type AIModel = ReturnType<typeof useAI>;
const effortNames = {
  off: '关闭思考',
  low: '轻量思考',
  medium: '标准思考',
  high: '深入思考',
  max: '最高强度',
};

export function AISettings({ model }: { model: AIModel }) {
  const [config, setConfig] = useState<AIConfig>(
    () => model.state?.config || AIConfigSchema.parse({}),
  );
  const [provider, setProvider] = useState<AIProvider>(model.state?.config.provider || 'deepseek');
  const [keys, setKeys] = useState<Partial<Record<AIProvider, string>>>({}),
    [message, setMessage] = useState(''),
    [saving, setSaving] = useState(false);
  const hydrated = useRef(!!model.state);
  useEffect(() => {
    if (model.state && !hydrated.current) {
      setConfig(model.state.config);
      setProvider(model.state.config.provider);
      hydrated.current = true;
    }
  }, [model.state?.config]);
  const profile = config.profiles[provider];
  const savedKey =
    !!model.state?.config.keys[provider] &&
    keys[provider] !== '' &&
    profile.baseUrl.trim().replace(/\/$/, '') ===
      model.state?.config.profiles[provider].baseUrl.trim().replace(/\/$/, '');
  function change(p: Partial<typeof profile>) {
    setConfig((c) => ({
      ...c,
      profiles: { ...c.profiles, [provider]: { ...c.profiles[provider], ...p } },
    }));
    setMessage('');
  }
  async function save() {
    setSaving(true);
    setMessage('');
    try {
      model.setState(await window.elu!.aiConfigure(config, keys));
      setKeys({});
      setMessage('已保存。模型与思考设置应用于新对话，已有对话保留原设置。');
    } catch (e) {
      setMessage(String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="ai-settings" aria-label="AI 设置">
      <h3>
        <Sparkles size={17} /> AI 命令助手
      </h3>
      <div className="ai-provider-choices">
        {ProviderId.options.map((p) => (
          <button
            key={p}
            className={provider === p ? 'selected' : ''}
            onClick={() => setProvider(p)}
          >
            <span>{p === 'deepseek' ? 'D' : p === 'kimi' ? 'K' : '+'}</span>
            {aiProviders[p].name}
            <small>{model.state?.config.keys[p] ? '已配置' : '待配置'}</small>
          </button>
        ))}
      </div>
      {provider === 'custom' && (
        <>
          <label>
            API 基础地址
            <input
              aria-label="自定义 API 基础地址"
              placeholder="https://api.example.com/v1"
              value={profile.baseUrl}
              onChange={(e) => change({ baseUrl: e.target.value })}
            />
          </label>
          <p>
            填写服务商提供的 OpenAI 兼容 API 地址，通常以 /v1 结尾。无需填写网站首页或
            /chat/completions；支持流式对话。
          </p>
        </>
      )}
      <label>
        API Key
        <input
          type="password"
          autoComplete="new-password"
          aria-label={aiProviders[provider].name + ' API Key'}
          value={keys[provider] ?? ''}
          data-saved-secret={savedKey && !keys[provider] ? 'true' : undefined}
          title={savedKey ? '已保存；不修改则继续使用，输入新 Key 可替换' : undefined}
          placeholder={
            savedKey
              ? '••••••••'
              : provider === 'custom'
                ? '粘贴此接口的 API Key'
                : '粘贴 API Key，其他参数已预填'
          }
          onChange={(e) => setKeys({ ...keys, [provider]: e.target.value || undefined })}
        />
      </label>
      {savedKey && (
        <p className="saved-secret-hint">黑点表示已保存；不修改则继续使用，输入新 Key 可替换。</p>
      )}
      {model.state?.config.keys[provider] && (
        <button
          className="ai-text-button"
          onClick={() => {
            setKeys({ ...keys, [provider]: '' });
            setMessage('点击保存后移除此供应商的 API Key');
          }}
        >
          移除已保存的 Key
        </button>
      )}
      <div className="ai-settings-row">
        <label>
          模型
          {provider === 'custom' ? (
            <input
              aria-label="自定义模型名称"
              placeholder="填写服务商的模型 ID"
              value={profile.model}
              onChange={(e) => change({ model: e.target.value })}
            />
          ) : (
            <select
              aria-label="AI 模型"
              value={profile.model}
              onChange={(e) => change({ model: e.target.value, effort: 'high' })}
            >
              {aiProviders[provider].models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          )}
        </label>
        <label>
          思考强度
          <select
            aria-label="AI 思考强度"
            value={profile.effort}
            onChange={(e) => change({ effort: e.target.value as typeof profile.effort })}
          >
            {effortOptions(provider, profile.model).map((e) => (
              <option key={e} value={e}>
                {provider === 'custom' && e === 'off'
                  ? '由接口默认（不传思考参数）'
                  : effortNames[e]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <details>
        <summary>高级配置</summary>
        {provider !== 'custom' && (
          <>
            <label>
              API 基础地址（OpenAI 兼容）
              <input
                aria-label="AI 基础地址"
                value={profile.baseUrl}
                onChange={(e) => change({ baseUrl: e.target.value })}
              />
            </label>
            <button
              className="ai-text-button"
              onClick={() => change({ baseUrl: aiProviders[provider].baseUrl })}
            >
              恢复官方地址
            </button>
          </>
        )}
        {provider === 'custom' && (
          <>
            <label>
              模型上下文容量（tokens）
              <input
                type="number"
                aria-label="自定义上下文容量"
                min={4096}
                max={2000000}
                value={profile.contextWindow ?? 128000}
                onChange={(e) => change({ contextWindow: Number(e.target.value) })}
              />
            </label>
            <label>
              输出上限参数
              <select
                aria-label="自定义输出上限参数"
                value={profile.outputParameter ?? 'max_tokens'}
                onChange={(e) =>
                  change({
                    outputParameter: e.target.value as 'max_tokens' | 'max_completion_tokens',
                  })
                }
              >
                <option value="max_tokens">max_tokens（兼容接口常用）</option>
                <option value="max_completion_tokens">max_completion_tokens（部分推理模型）</option>
              </select>
            </label>
            <p>
              上下文默认按 128000 tokens 估算，请按服务商说明调整。仅当模型支持 reasoning_effort
              时选择具体思考强度。
            </p>
          </>
        )}
        <label>
          单次输出上限（含思考）
          <select
            value={profile.maxTokens}
            onChange={(e) => change({ maxTokens: +e.target.value })}
          >
            {[4096, 8192, 16384, 32768].map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()} tokens
              </option>
            ))}
          </select>
        </label>
      </details>
      <div className="ai-settings-row">
        <label>
          新对话默认供应商
          <select
            aria-label="AI 默认供应商"
            value={config.provider}
            onChange={(e) => setConfig({ ...config, provider: e.target.value as AIProvider })}
          >
            <option value="deepseek">DeepSeek</option>
            <option value="kimi">Kimi</option>
            <option value="custom">自定义</option>
          </select>
        </label>
      </div>
      <p>
        对话与设置保存在 .EluShell，API Key
        使用系统加密。发送对话文字、主动添加的图片和引用，以及只读查询结果。图片识别需要所选模型支持视觉输入。
      </p>
      <button
        className="primary settings-save"
        disabled={saving || !model.state}
        onClick={() => void save()}
      >
        {saving ? '保存中…' : '保存 AI 配置'}
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function Prose({ text }: { text: string }) {
  const inline = (line: string) =>
    line
      .split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g)
      .map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : part.startsWith('`') && part.endsWith('`') ? (
          <code key={i}>{part.slice(1, -1)}</code>
        ) : (
          part
        ),
      );
  return (
    <div className="ai-prose">
      {text.split('\n').map((line, i) => {
        const heading = /^#{1,4}\s+(.+)/.exec(line);
        return heading ? (
          <div className="ai-prose-heading" key={i}>
            {inline(heading[1])}
          </div>
        ) : (
          <div key={i}>{line ? inline(line) : <br />}</div>
        );
      })}
    </div>
  );
}
function Answer({ message, copy }: { message: AIMessage; copy: (s: string) => void }) {
  return (
    <>
      {message.observations?.map((o, i) => (
        <details className="ai-reference" key={i}>
          <summary>{queryLabel(o.name, o.result)}</summary>
          <pre>{o.result}</pre>
        </details>
      ))}
      {message.reasoning && (
        <details className="ai-reasoning">
          <summary>{message.status === 'streaming' ? '正在思考…' : '思考内容'}</summary>
          <pre>{message.reasoning}</pre>
        </details>
      )}
      {responseBlocks(message.content).map((b, i) =>
        b.language !== undefined ? (
          <div className="ai-code" key={i}>
            <div className="ai-code-tools">
              <small>{b.language || 'text'}</small>
              <button title="复制代码" onClick={() => copy(b.text)}>
                <Copy size={13} />
                复制
              </button>
            </div>
            <pre>{b.text}</pre>
          </div>
        ) : (
          <Prose text={b.text} key={i} />
        ),
      )}
      {!message.content && message.status === 'streaming' && (
        <div className="ai-waiting">
          正在等待回答<span>…</span>
        </div>
      )}
      {message.error && <p className="ai-error">{message.error}</p>}
    </>
  );
}
function queryLabel(name: string, result: string) {
  const [tool] = name.split(' ');
  const labels: Record<string, string> = {
    list_directory: '列出目录',
    find_paths: '查找路径',
    read_file: '读取文件',
    search_text: '搜索文本',
  };
  if (!labels[tool]) return '已拒绝不支持的操作';
  let path = '';
  try {
    path = JSON.parse(name.slice(tool.length + 1)).path || '';
  } catch {
    /* Older records may omit arguments. */
  }
  return `${result.startsWith('只读工具失败：') ? '查询失败 · ' : ''}${labels[tool]} · ${path}`;
}
export function AISidebar({
  model,
  close,
  settings,
  connectedName,
  sessionId,
}: {
  model: AIModel;
  close: () => void;
  settings: () => void;
  connectedName?: string;
  sessionId?: string;
}) {
  const { state, chat } = model;
  const [messageLimit, setMessageLimit] = useState(30);
  useEffect(() => setMessageLimit(30), [chat?.id]);
  const [drafts, setDrafts] = useState<Record<string, string>>({}),
    [history, setHistory] = useState(false),
    [search, setSearch] = useState('');
  const [rename, setRename] = useState(''),
    [title, setTitle] = useState(''),
    [remove, setRemove] = useState('');
  const [width, setWidth] = useState(state?.config.width || 400),
    [windowWidth, setWindowWidth] = useState(window.innerWidth),
    [notice, setNotice] = useState('');
  const scroll = useRef<HTMLDivElement>(null),
    stick = useRef(true),
    readyWidth = useRef(false);
  const key = chat?.id || 'new',
    draft = drafts[key] || '',
    streaming = chat?.messages.at(-1)?.status === 'streaming';
  useEffect(() => {
    if (state && !readyWidth.current) {
      setWidth(state.config.width);
      readyWidth.current = true;
    }
  }, [state]);
  useEffect(() => {
    const update = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  useEffect(() => {
    if (stick.current) scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [chat]);
  useEffect(() => {
    stick.current = true;
    setNotice('');
  }, [chat?.id]);
  const configRef = useRef(state?.config);
  const [monitorWidth, setMonitorWidth] = useState(0);
  useEffect(() => {
    const element = document.querySelector('.sidebar');
    const update = () => setMonitorWidth(element?.getBoundingClientRect().width || 0);
    const observer = new ResizeObserver(update);
    if (element) observer.observe(element);
    update();
    return () => observer.disconnect();
  }, [connectedName]);
  configRef.current = state?.config;
  useEffect(() => {
    if (!readyWidth.current || !configRef.current || width === configRef.current.width) return;
    const timer = setTimeout(() => {
      void window
        .elu!.aiConfigure({ ...configRef.current!, width })
        .then(model.setState)
        .catch((e) => model.setError(String(e)));
    }, 400);
    return () => clearTimeout(timer);
  }, [width]);
  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      model.setError(String(e));
    }
  }
  async function send() {
    stick.current = true;
    const attachments = model.attachments;
    if (await model.send({ content: draft, attachments, sessionId })) {
      setDrafts((d) => ({ ...d, [key]: '' }));
      model.setAttachments([]);
    }
  }
  async function addImages(files: File[]) {
    try {
      if (model.attachments.filter((a) => a.kind === 'image').length + files.length > 4)
        throw Error('每条消息最多 4 张图片');
      const items: AIAttachment[] = [];
      for (const file of files) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
          throw Error('支持 PNG、JPEG 和 WebP 图片');
        if (file.size > 5 * 1024 * 1024) throw Error('每张图片不能超过 5 MB');
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(Error('图片读取失败'));
          reader.readAsDataURL(file);
        });
        items.push({ kind: 'image', name: file.name.slice(0, 200), data });
      }
      model.addAttachments(items);
    } catch (e) {
      model.setError(String(e));
    }
  }
  async function copy(text: string) {
    await window.elu!.writeClipboard(text);
    setNotice('已复制');
  }
  const usage = state
    ? contextUsage(
        chat || {
          messages: [],
          provider: state.config.provider,
          profile: state.config.profiles[state.config.provider],
        },
        draft,
      )
    : null;
  const maxWidth = Math.max(300, Math.min(650, windowWidth - monitorWidth - 500));
  return (
    <>
      <ResizeHandle
        label="调整 AI 侧栏宽度"
        axis="x"
        value={Math.min(width, maxWidth)}
        min={300}
        max={maxWidth}
        reverse
        onChange={setWidth}
        onCollapse={close}
      />
      <aside
        className="ai-sidebar"
        style={{ width: Math.min(width, maxWidth) }}
        aria-label="AI 对话"
      >
        <header className="ai-header">
          <Sparkles size={17} />
          <strong>AI 命令助手</strong>
          <button
            title="新建 AI 对话"
            disabled={!state || model.busy}
            onClick={() =>
              void run(async () => {
                await model.create();
                setHistory(false);
              })
            }
          >
            <Plus size={17} />
          </button>
          <button title="历史对话" onClick={() => setHistory(!history)}>
            <History size={17} />
          </button>
          <button title="AI 设置" onClick={settings}>
            <Settings size={16} />
          </button>
          <button title="收起 AI 侧栏" onClick={close}>
            <X size={17} />
          </button>
        </header>
        {!state ? (
          <div className="ai-empty">
            {model.error || '正在读取本地配置…'}
            <button onClick={() => void run(model.refresh)}>重新加载</button>
          </div>
        ) : (
          <>
            <div className="ai-chat-meta">
              <span title={chat?.profile.model}>
                {chat
                  ? aiProviders[chat.provider].name + ' · ' + chat.profile.model
                  : '新对话 · ' + aiProviders[state.config.provider].name}
              </span>
              <small>
                {(chat?.provider || state.config.provider) === 'custom' &&
                (chat?.profile || state.config.profiles[state.config.provider]).effort === 'off'
                  ? '接口默认'
                  : effortNames[
                      (chat?.profile || state.config.profiles[state.config.provider]).effort
                    ]}
              </small>
            </div>
            {history ? (
              <div className="ai-history">
                <div className="ai-history-title">
                  <button onClick={() => setHistory(false)}>
                    <ChevronLeft size={16} />
                    返回
                  </button>
                  <b>历史对话 · {state.chats.length}/100</b>
                </div>
                <input
                  aria-label="搜索历史对话"
                  placeholder="搜索对话名称"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="ai-history-list">
                  {state.chats
                    .filter((c) => c.title.toLowerCase().includes(search.toLowerCase()))
                    .map((c) => (
                      <div className="ai-history-item" key={c.id}>
                        {rename === c.id ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              void run(async () => {
                                model.setState(await window.elu!.aiRename(c.id, title));
                                if (chat?.id === c.id) model.setChat({ ...chat, title });
                                setRename('');
                              });
                            }}
                          >
                            <input
                              aria-label="对话名称"
                              maxLength={100}
                              value={title}
                              onChange={(e) => setTitle(e.target.value)}
                              autoFocus
                            />
                            <button type="submit">保存</button>
                            <button type="button" onClick={() => setRename('')}>
                              取消
                            </button>
                          </form>
                        ) : (
                          <>
                            <button
                              className="ai-history-open"
                              onClick={() =>
                                void run(async () => {
                                  await model.select(c.id);
                                  setHistory(false);
                                })
                              }
                            >
                              <b>{c.title}</b>
                              <small>
                                {aiProviders[c.provider].name} ·{' '}
                                {new Date(c.updatedAt).toLocaleString('zh-CN')}
                              </small>
                            </button>
                            <button
                              title="重命名对话"
                              onClick={() => {
                                setRename(c.id);
                                setTitle(c.title);
                              }}
                            >
                              <Pencil size={13} />
                            </button>
                            <button title="删除对话" onClick={() => setRemove(c.id)}>
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                        {remove === c.id && (
                          <div className="ai-delete-confirm">
                            <span>删除此对话及其记录？</span>
                            <button
                              onClick={() =>
                                void run(async () => {
                                  model.setState(await window.elu!.aiDelete(c.id));
                                  if (chat?.id === c.id) model.setChat(null);
                                  setRemove('');
                                })
                              }
                            >
                              删除
                            </button>
                            <button onClick={() => setRemove('')}>取消</button>
                          </div>
                        )}
                      </div>
                    ))}
                  {!state.chats.length && <p className="ai-empty">暂无历史对话</p>}
                </div>
              </div>
            ) : (
              <>
                <div
                  className="ai-messages"
                  ref={scroll}
                  onScroll={() => {
                    const s = scroll.current!;
                    stick.current = s.scrollHeight - s.scrollTop - s.clientHeight < 70;
                  }}
                >
                  {!chat?.messages.length && (
                    <div className="ai-welcome">
                      <div className="ai-welcome-symbol">
                        <Sparkles size={27} />
                      </div>
                      <h3>说说你想完成什么</h3>
                      <p>解释命令、排查问题、整理操作步骤</p>
                      {[
                        '怎样找出占用内存最多的服务？',
                        '如何检查端口是否被占用？',
                        '查看当前目录下各文件夹的大小',
                      ].map((text) => (
                        <button key={text} onClick={() => setDrafts({ ...drafts, [key]: text })}>
                          {text}
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                      {!state.config.keys[state.config.provider] && (
                        <button className="ai-configure-prompt" onClick={settings}>
                          先配置 {aiProviders[state.config.provider].name} API Key
                        </button>
                      )}
                      <small>可自动查找和读取服务器信息，没有直接修改文件的能力</small>
                    </div>
                  )}
                  {chat && chat.messages.length > messageLimit && (
                    <button onClick={() => setMessageLimit((n) => n + 30)}>
                      加载更早的消息（{chat.messages.length - messageLimit}）
                    </button>
                  )}
                  {chat?.messages.slice(-messageLimit).map((m, i) => (
                    <article className={'ai-message ai-' + m.role} key={m.id}>
                      <div className="ai-message-label">
                        <b>{m.role === 'user' ? '你' : aiProviders[chat.provider].name}</b>
                        <button title="复制消息" onClick={() => void run(() => copy(m.content))}>
                          <Copy size={13} />
                        </button>
                      </div>
                      {m.role === 'user' ? (
                        <>
                          <Attachments items={m.attachments || []} />
                          <div className="ai-prose">{m.content}</div>
                        </>
                      ) : (
                        <Answer message={m} copy={(s) => void run(() => copy(s))} />
                      )}
                      {m.role === 'assistant' &&
                        m.status !== 'streaming' &&
                        i === Math.min(chat.messages.length, messageLimit) - 1 && (
                          <button
                            className="ai-retry"
                            disabled={model.busy}
                            onClick={() => void model.send('', true)}
                          >
                            <RefreshCw size={12} />
                            重新回答
                          </button>
                        )}
                    </article>
                  ))}
                </div>
                <div
                  className="ai-composer"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => e.preventDefault()}
                >
                  <Attachments
                    items={model.attachments}
                    remove={
                      model.busy || streaming
                        ? undefined
                        : (i) => model.setAttachments((a) => a.filter((_, index) => index !== i))
                    }
                  />
                  {usage && (
                    <div
                      className="ai-context"
                      title={`估算已用 ${usage.used.toLocaleString()} / ${usage.limit.toLocaleString()} tokens；预留输出 ${usage.reserved.toLocaleString()}。不同模型分词可能有差异。`}
                    >
                      <div>
                        <span>上下文剩余 ≈ {Math.floor(usage.remaining / 1000)}K</span>
                        <small>{Math.round((usage.remaining / usage.limit) * 100)}%</small>
                      </div>
                      <div
                        className="ai-context-bar"
                        role="progressbar"
                        aria-label="剩余上下文估算"
                        aria-valuemin={0}
                        aria-valuemax={usage.limit}
                        aria-valuenow={usage.remaining}
                      >
                        <i style={{ width: (usage.remaining / usage.limit) * 100 + '%' }} />
                      </div>
                      {chat?.usage && (
                        <small>
                          上次实际用量：输入 {chat.usage.prompt.toLocaleString()} · 输出{' '}
                          {chat.usage.completion.toLocaleString()}
                        </small>
                      )}
                    </div>
                  )}
                  <textarea
                    disabled={model.busy || streaming}
                    onPaste={(e) => {
                      const images = Array.from(e.clipboardData.files).filter((f) =>
                        f.type.startsWith('image/'),
                      );
                      if (images.length) {
                        e.preventDefault();
                        void addImages(images);
                      }
                    }}
                    aria-label="AI 消息"
                    placeholder="输入问题，Enter 发送 · Shift+Enter 换行"
                    value={draft}
                    maxLength={20000}
                    onChange={(e) => setDrafts({ ...drafts, [key]: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        if (!streaming && !model.busy && (draft.trim() || model.attachments.length))
                          void send();
                      }
                    }}
                  />
                  <div className="ai-composer-actions">
                    <small>只读访问 · 可直接粘贴图片</small>
                    {streaming ? (
                      <button
                        className="primary"
                        onClick={() => void run(() => window.elu!.aiCancel(chat!.id))}
                      >
                        <Square size={13} />
                        停止
                      </button>
                    ) : (
                      <button
                        className="primary"
                        disabled={
                          model.busy ||
                          (!draft.trim() && !model.attachments.length) ||
                          !state.config.keys[chat?.provider || state.config.provider]
                        }
                        onClick={() => void send()}
                      >
                        <Send size={13} />
                        发送
                      </button>
                    )}
                  </div>
                  <small className="ai-target">
                    只读服务器：{connectedName || '尚未连接服务器'}
                    {notice && ' · ' + notice}
                  </small>
                </div>
              </>
            )}
            {model.error && (
              <div className="ai-error" role="alert">
                {model.error}
                <button title="关闭错误提示" onClick={() => model.setError('')}>
                  <X size={12} />
                </button>
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}

function Attachments({
  items,
  remove,
}: {
  items: AIAttachment[];
  remove?: (index: number) => void;
}) {
  return (
    <div className="ai-attachments">
      {items.map((a, i) => (
        <div className="ai-attachment" key={i}>
          {a.kind === 'image' ? (
            <div>
              <AttachmentImage attachment={a} />
              <span>{a.name}</span>
            </div>
          ) : (
            <details>
              <summary>
                {a.kind === 'selection' ? `${a.text.split(/\r?\n/).length}行选中内容` : a.path}
                <small>{a.label}</small>
              </summary>
              <pre>{a.kind === 'selection' ? a.text : a.path}</pre>
            </details>
          )}
          {remove && (
            <button aria-label={`移除附件 ${i + 1}`} onClick={() => remove(i)}>
              <X size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function AttachmentImage({ attachment }: { attachment: Extract<AIAttachment, { kind: 'image' }> }) {
  const box = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState(attachment.data || '');
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true,
      visible = false;
    if (attachment.data || !attachment.asset) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        visible = entry.isIntersecting;
        if (visible) {
          void window
            .elu!.aiImage(attachment.asset!)
            .then((data) => {
              if (alive && visible) setUrl(data);
            })
            .catch(() => {
              if (alive) setError('图片无法加载');
            });
        } else {
          setUrl('');
        }
      }
    });
    if (box.current) observer.observe(box.current);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [attachment.asset, attachment.data]);
  return (
    <div ref={box} className="ai-image-preview">
      {url ? (
        <img src={url} alt={attachment.name || '发送的图片'} />
      ) : (
        <small>{error || '图片按需加载'}</small>
      )}
    </div>
  );
}
