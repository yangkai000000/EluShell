import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { commandKey } from './platform';
import {
  Folder,
  FolderPlus,
  Plus,
  Search,
  Settings as SettingsIcon,
  X,
  PanelRight,
  Copy,
  Send,
} from 'lucide-react';
import {
  DEFAULT_COMMAND_FOLDER,
  SettingsSchema,
  type Settings,
  type Snippet,
  type ConnectionFolder,
  type CommandWorkspaceSettings,
} from './shared';
import { fuzzyScore, moveCommand, removeCommandFolder } from './commands';
import { canMoveFolder, folderPath } from './connections';
import { ResizeHandle } from './layout';
import CommandTextEditor from './CommandTextEditor';

type Context = { kind: 'command' | 'folder' | 'blank'; id: string; x: number; y: number };
export default function CommandWorkspace({
  settings,
  update,
  send,
  connectedCount,
  notify,
}: {
  settings: Settings;
  update: Dispatch<SetStateAction<Settings>>;
  send: (text: string, target: 'current' | 'all', appendNewline: boolean) => Promise<boolean>;
  connectedCount: number;
  notify: (message: string) => void;
}) {
  const options = settings.commandWorkspace;
  const [query, setQuery] = useState(''),
    [context, setContext] = useState<Context | null>(null);
  const [commandForm, setCommandForm] = useState<Snippet | null>(null),
    [folderForm, setFolderForm] = useState<ConnectionFolder | null>(null);
  const [confirmation, setConfirmation] = useState<{
    kind: 'command' | 'folder';
    id: string;
    name: string;
  } | null>(null);
  const [formError, setFormError] = useState(''),
    [editorOptions, setEditorOptions] = useState(false),
    [busy, setBusy] = useState(false),
    [dragged, setDragged] = useState('');
  const menu = useRef<HTMLDivElement>(null),
    folderTabs = useRef<HTMLElement>(null),
    commandList = useRef<HTMLDivElement>(null),
    editorMenu = useRef<HTMLDivElement>(null),
    sending = useRef(false);
  const latest = useRef(settings);
  latest.current = settings;
  const activeFolder = settings.commandFolders.some((f) => f.id === options.folderId)
    ? options.folderId
    : DEFAULT_COMMAND_FOLDER;
  const pathFor = (id: string) =>
    folderPath(settings.commandFolders, id).replace(/^连接/, '命令库');
  useEffect(() => {
    if (commandList.current) commandList.current.scrollTop = 0;
  }, [query, activeFolder]);
  useEffect(() => {
    const node = folderTabs.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (node.scrollWidth > node.clientWidth && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        node.scrollLeft += event.deltaY;
      }
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, []);
  const setOptions = (value: Partial<CommandWorkspaceSettings>) =>
    update((s) => ({ ...s, commandWorkspace: { ...s.commandWorkspace, ...value } }));
  const apply = (change: (settings: Settings) => Settings) => {
    try {
      update(SettingsSchema.parse(change(latest.current)));
      setFormError('');
      return true;
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setContext(null);
      if (!editorMenu.current?.contains(event.target as Node)) setEditorOptions(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContext(null);
        setEditorOptions(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const openContext = (event: React.MouseEvent, kind: Context['kind'], id: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContext({
      kind,
      id,
      x: Math.max(4, Math.min(event.clientX, innerWidth - 228)),
      y: Math.max(4, Math.min(event.clientY, innerHeight - 305)),
    });
  };
  const newCommand = (folderId = activeFolder, text = '') => {
    setContext(null);
    setFormError('');
    setCommandForm({
      id: crypto.randomUUID(),
      name: '',
      command: text,
      tags: [],
      folderId,
      appendNewline: true,
    });
  };
  const newFolder = (parentId?: string) => {
    setContext(null);
    setFormError('');
    setFolderForm({ id: crypto.randomUUID(), name: '', parentId });
  };
  const command =
    context?.kind === 'command' ? settings.snippets.find((c) => c.id === context.id) : undefined;
  const selectedFolder =
    context?.kind === 'folder'
      ? settings.commandFolders.find((f) => f.id === context.id)
      : undefined;
  const visible = settings.snippets.filter((c) =>
    query.trim()
      ? Number.isFinite(Math.min(fuzzyScore(query, c.name), fuzzyScore(query, c.command)))
      : (c.folderId || DEFAULT_COMMAND_FOLDER) === activeFolder,
  );
  const editorSend = async () => {
    if (sending.current || !options.draft.trim()) return;
    sending.current = true;
    setBusy(true);
    const text = options.draft;
    try {
      if (await send(text, options.target, options.appendNewline))
        update((s) =>
          s.commandWorkspace.clearAfterSend && s.commandWorkspace.draft === text
            ? { ...s, commandWorkspace: { ...s.commandWorkspace, draft: '' } }
            : s,
        );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="command-workspace">
      <div
        className="command-library-pane"
        onContextMenu={(e) => openContext(e, 'blank', activeFolder)}
      >
        <div className="command-library-tools">
          <div className="command-library-search">
            <Search size={13} />
            <input
              aria-label="搜索共享命令"
              placeholder="搜索名称或命令"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <small title="全部连接共享">{visible.length} 条</small>
          <button title="新建命令分类" onClick={() => newFolder()}>
            <FolderPlus size={15} />
          </button>
          <button title="添加命令" onClick={() => newCommand()}>
            <Plus size={15} />
          </button>
          <button
            title={options.editorVisible ? '收起命令编辑器' : '展开命令编辑器'}
            onClick={() => setOptions({ editorVisible: !options.editorVisible })}
          >
            <PanelRight size={15} />
          </button>
        </div>
        <nav className="command-folder-tabs" aria-label="命令分类" ref={folderTabs}>
          {settings.commandFolders.map((folder) => (
            <button
              key={folder.id}
              data-command-folder={folder.id}
              title={pathFor(folder.id)}
              className={activeFolder === folder.id ? 'selected' : ''}
              onClick={() => {
                setOptions({ folderId: folder.id });
                setQuery('');
              }}
              onContextMenu={(e) => openContext(e, 'folder', folder.id)}
              onDragOver={(e) => {
                if (dragged) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragged) apply((s) => moveCommand(s, dragged, folder.id));
                setDragged('');
              }}
            >
              <Folder size={13} />
              <span className="command-folder-label">
                {folder.parentId ? '· ' : ''}
                {folder.name}
              </span>
            </button>
          ))}
        </nav>
        <div className="compact-commands" ref={commandList}>
          {visible.map((c) => (
            <button
              key={c.id}
              className="compact-command"
              data-command-id={c.id}
              title={c.name + '\n' + c.command}
              onClick={() => void send(c.command, 'current', c.appendNewline ?? true)}
              onContextMenu={(e) => openContext(e, 'command', c.id)}
              draggable
              onDragStart={(e) => {
                setDragged(c.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('application/x-elushell-command', c.id);
              }}
              onDragEnd={() => setDragged('')}
            >
              {c.name}
            </button>
          ))}
          {!visible.length && (
            <p className="command-empty">
              {query ? '没有匹配的命令' : '右键空白处添加命令，或将其他分类的命令拖到此分类'}
            </p>
          )}
        </div>
      </div>
      {options.editorVisible && (
        <>
          <ResizeHandle
            label="调整命令编辑器宽度"
            axis="x"
            reverse
            value={options.editorWidth}
            min={220}
            max={650}
            onChange={(width) => setOptions({ editorWidth: Math.round(width) })}
            onCollapse={() => setOptions({ editorVisible: false })}
          />
          <section
            className="command-editor-pane"
            aria-label="命令编辑器"
            style={{ width: options.editorWidth }}
          >
            <header>
              <b>命令编辑器</b>
              <small>{options.draft.length}/8000</small>
              <button
                title="将编辑器内容保存为命令"
                onClick={() => newCommand(activeFolder, options.draft)}
              >
                <Plus size={13} />
              </button>
            </header>
            <CommandTextEditor
              label="命令编辑器内容"
              value={options.draft}
              onChange={(draft) => setOptions({ draft })}
              onSend={() => void editorSend()}
              ctrlEnterSend={options.ctrlEnterSend}
              fontSize={options.fontSize}
              wordWrap={options.wordWrap}
            />
            <footer>
              <div className="command-editor-options" ref={editorMenu}>
                <button
                  title="命令编辑器设置"
                  aria-expanded={editorOptions}
                  onClick={() => setEditorOptions(!editorOptions)}
                >
                  <SettingsIcon size={13} />
                </button>
                {editorOptions && (
                  <div
                    className="command-editor-popover"
                    style={{
                      left: Math.min(
                        editorMenu.current?.getBoundingClientRect().left || 0,
                        innerWidth - 216,
                      ),
                      bottom:
                        innerHeight -
                        (editorMenu.current?.getBoundingClientRect().top || innerHeight) +
                        5,
                    }}
                  >
                    <label>
                      <input
                        type="checkbox"
                        checked={options.ctrlEnterSend}
                        onChange={(e) => setOptions({ ctrlEnterSend: e.target.checked })}
                      />
                      {commandKey}+Enter 发送
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={options.clearAfterSend}
                        onChange={(e) => setOptions({ clearAfterSend: e.target.checked })}
                      />
                      发送后清空
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={options.appendNewline}
                        onChange={(e) => setOptions({ appendNewline: e.target.checked })}
                      />
                      末尾添加回车 CR
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={options.wordWrap}
                        onChange={(e) => setOptions({ wordWrap: e.target.checked })}
                      />
                      自动换行
                    </label>
                    <label>
                      字号
                      <select
                        aria-label="命令编辑器字号"
                        value={options.fontSize}
                        onChange={(e) => setOptions({ fontSize: +e.target.value })}
                      >
                        {Array.from({ length: 20 }, (_, i) => i + 9).map((n) => (
                          <option key={n} value={n}>
                            {n} px
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
              <span>发送到</span>
              <select
                aria-label="命令编辑器发送目标"
                value={options.target}
                onChange={(e) => setOptions({ target: e.target.value as 'current' | 'all' })}
              >
                <option value="current">当前会话</option>
                <option value="all">全部会话 ({connectedCount})</option>
              </select>
              <button
                className="editor-send"
                aria-label="发送编辑器命令"
                disabled={busy || !options.draft.trim() || !connectedCount}
                onClick={() => void editorSend()}
              >
                <Send size={12} />
                {busy ? '发送中' : '发送'}
              </button>
            </footer>
          </section>
        </>
      )}
      {context && (
        <div
          ref={menu}
          className="command-context"
          role="menu"
          style={{ left: context.x, top: context.y }}
        >
          <button
            role="menuitem"
            onClick={() => newCommand(context.kind === 'folder' ? context.id : activeFolder)}
          >
            添加命令…
          </button>
          {command && (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  setContext(null);
                  void navigator.clipboard
                    .writeText(command.command)
                    .then(() => notify('命令已复制'))
                    .catch((e) => notify(String(e)));
                }}
              >
                复制命令
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setCommandForm({
                    ...command,
                    id: crypto.randomUUID(),
                    name: command.name + ' 副本',
                  });
                  setFormError('');
                  setContext(null);
                }}
              >
                复制为新命令
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setCommandForm({ ...command });
                  setFormError('');
                  setContext(null);
                }}
              >
                编辑命令…
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setOptions({ draft: command.command, editorVisible: true });
                  setContext(null);
                }}
              >
                载入右侧编辑器
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setConfirmation({ kind: 'command', id: command.id, name: command.name });
                  setContext(null);
                }}
              >
                删除命令…
              </button>
              <label className="command-move">
                移动到
                <select
                  aria-label="移动命令到分类"
                  value={command.folderId || DEFAULT_COMMAND_FOLDER}
                  onChange={(e) => {
                    apply((s) => moveCommand(s, command.id, e.target.value));
                    setContext(null);
                  }}
                >
                  {settings.commandFolders.map((f) => (
                    <option value={f.id} key={f.id}>
                      {pathFor(f.id)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <button role="menuitem" onClick={() => newFolder(selectedFolder?.id)}>
            新建分类文件夹…
          </button>
          {selectedFolder && selectedFolder.id !== DEFAULT_COMMAND_FOLDER && (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  setFolderForm({ ...selectedFolder });
                  setFormError('');
                  setContext(null);
                }}
              >
                编辑分类…
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setConfirmation({
                    kind: 'folder',
                    id: selectedFolder.id,
                    name: selectedFolder.name,
                  });
                  setContext(null);
                }}
              >
                删除分类…
              </button>
            </>
          )}
        </div>
      )}
      {commandForm && (
        <div className="modal-backdrop command-dialog-backdrop">
          <form
            className="modal command-form-modal"
            role="dialog"
            aria-label={
              settings.snippets.some((c) => c.id === commandForm.id) ? '编辑命令' : '添加命令'
            }
            onSubmit={(e) => {
              e.preventDefault();
              if (!commandForm.name.trim() || !commandForm.command.trim()) {
                setFormError('请输入命令名称和内容');
                return;
              }
              if (
                apply((s) => ({
                  ...s,
                  snippets: s.snippets.some((c) => c.id === commandForm.id)
                    ? s.snippets.map((c) =>
                        c.id === commandForm.id
                          ? { ...commandForm, name: commandForm.name.trim() }
                          : c,
                      )
                    : [...s.snippets, { ...commandForm, name: commandForm.name.trim() }],
                }))
              )
                setCommandForm(null);
            }}
          >
            <div className="modal-header">
              <h2>
                {settings.snippets.some((c) => c.id === commandForm.id) ? '编辑命令' : '添加命令'}
              </h2>
              <button type="button" title="关闭命令编辑" onClick={() => setCommandForm(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-content">
              <div className="command-form-fields">
                <label>
                  名称
                  <input
                    aria-label="命令名称"
                    required
                    maxLength={100}
                    value={commandForm.name}
                    onChange={(e) => setCommandForm({ ...commandForm, name: e.target.value })}
                  />
                </label>
                <label>
                  分类
                  <select
                    aria-label="命令所属分类"
                    value={commandForm.folderId || DEFAULT_COMMAND_FOLDER}
                    onChange={(e) => setCommandForm({ ...commandForm, folderId: e.target.value })}
                  >
                    {settings.commandFolders.map((f) => (
                      <option value={f.id} key={f.id}>
                        {pathFor(f.id)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="command-form-code">
                <CommandTextEditor
                  label="快捷命令内容"
                  value={commandForm.command}
                  onChange={(command) => setCommandForm((c) => (c ? { ...c, command } : c))}
                  fontSize={13}
                  wordWrap
                />
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={commandForm.appendNewline ?? true}
                  onChange={(e) =>
                    setCommandForm({ ...commandForm, appendNewline: e.target.checked })
                  }
                />
                末尾添加回车 CR（发送后执行）
              </label>
              {formError && (
                <p role="alert" className="editor-error">
                  {formError}
                </p>
              )}
              <div className="command-form-actions">
                <button type="button" onClick={() => setCommandForm(null)}>
                  取消
                </button>
                <button className="primary">保存命令</button>
              </div>
            </div>
          </form>
        </div>
      )}
      {folderForm && (
        <div className="modal-backdrop command-dialog-backdrop">
          <form
            className="modal small-modal"
            role="dialog"
            aria-label="命令分类设置"
            onSubmit={(e) => {
              e.preventDefault();
              if (!folderForm.name.trim()) {
                setFormError('请输入分类名称');
                return;
              }
              if (
                apply((s) => ({
                  ...s,
                  commandFolders: [
                    ...s.commandFolders.filter((f) => f.id !== folderForm.id),
                    { ...folderForm, name: folderForm.name.trim() },
                  ],
                  commandWorkspace: { ...s.commandWorkspace, folderId: folderForm.id },
                }))
              ) {
                setFolderForm(null);
                setQuery('');
              }
            }}
          >
            <div className="modal-header">
              <h2>命令分类</h2>
              <button type="button" onClick={() => setFolderForm(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-content">
              <label>
                分类名称
                <input
                  aria-label="命令分类名称"
                  required
                  maxLength={80}
                  value={folderForm.name}
                  onChange={(e) => setFolderForm({ ...folderForm, name: e.target.value })}
                />
              </label>
              <label>
                上级分类
                <select
                  aria-label="命令分类上级"
                  value={folderForm.parentId || ''}
                  onChange={(e) =>
                    setFolderForm({ ...folderForm, parentId: e.target.value || undefined })
                  }
                >
                  <option value="">根目录</option>
                  {settings.commandFolders
                    .filter((f) => canMoveFolder(settings.commandFolders, folderForm.id, f.id))
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {pathFor(f.id)}
                      </option>
                    ))}
                </select>
              </label>
              {formError && (
                <p role="alert" className="editor-error">
                  {formError}
                </p>
              )}
              <div className="command-form-actions">
                <button type="button" onClick={() => setFolderForm(null)}>
                  取消
                </button>
                <button className="primary">保存分类</button>
              </div>
            </div>
          </form>
        </div>
      )}
      {confirmation && (
        <div className="modal-backdrop command-dialog-backdrop">
          <section className="modal small-modal" role="dialog" aria-label="确认删除命令项目">
            <div className="modal-header">
              <h2>删除{confirmation.kind === 'folder' ? '分类' : '命令'}</h2>
            </div>
            <div className="modal-content">
              <p>{confirmation.name}</p>
              {confirmation.kind === 'folder' && (
                <p>其中的命令移到上级分类（没有上级时移到默认分类），子分类保留。</p>
              )}
              <div className="command-form-actions">
                <button onClick={() => setConfirmation(null)}>取消</button>
                <button
                  className="danger"
                  onClick={() => {
                    if (
                      apply((s) =>
                        confirmation.kind === 'folder'
                          ? removeCommandFolder(s, confirmation.id)
                          : { ...s, snippets: s.snippets.filter((c) => c.id !== confirmation.id) },
                      )
                    )
                      setConfirmation(null);
                  }}
                >
                  确认删除
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
