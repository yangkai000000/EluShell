import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { commandKey } from './platform';
import { Compartment, EditorState } from '@codemirror/state';
import { historyField } from '@codemirror/commands';
import type { EditorDraft } from './editor-shared';
import { editorLanguage, detectEditorLanguage, type EditorLanguage } from './editor-language';
import { Save, X } from 'lucide-react';
import type { RemoteDocument } from './shared';
export type TextEditorHandle = { snapshot(): EditorDraft; requestClose(): void };
const TextEditor = forwardRef<
  TextEditorHandle,
  {
    document: RemoteDocument;
    title: string;
    address: string;
    onClose: () => void;
    active: boolean;
    draft?: EditorDraft;
    initiallyDirty?: boolean;
    onDirty: (dirty: boolean) => void;
  }
>(function TextEditor(
  { document, title, address, onClose, active, draft, initiallyDirty, onDirty },
  ref,
) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | undefined>(undefined),
    baseline = useRef(draft?.baseline ?? document.text.replace(/\r\n/g, '\n')),
    saving = useRef(false),
    language = useRef(new Compartment()),
    dirtyRef = useRef(!!initiallyDirty),
    closeRef = useRef<() => void>(() => {});
  const [dirty, setDirty] = useState(!!initiallyDirty),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [closing, setClosing] = useState(false),
    [mode, setMode] = useState<EditorLanguage>(draft?.mode ?? 'auto');
  const changed = (value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
    window.eluEditor!.state(document.id, value);
    onDirty(value);
  };
  closeRef.current = () => {
    if (!saving.current) dirtyRef.current ? setClosing(true) : onClose();
  };
  useImperativeHandle(ref, () => ({
    snapshot: () => ({
      state: view.current!.state.toJSON({ history: historyField }),
      baseline: baseline.current,
      mode,
      scrollTop: view.current!.scrollDOM.scrollTop,
    }),
    requestClose: () => closeRef.current(),
  }));
  useEffect(() => {
    if (active) view.current?.focus();
  }, [active]);
  useEffect(() => {
    if (active) window.document.title = `${dirty ? '● ' : ''}${title} · EluShell`;
  }, [title, dirty, active]);
  const saveRef = useRef<(close?: boolean) => Promise<void>>(async () => {});
  saveRef.current = async (close = false) => {
    if (saving.current) return;
    const text = view.current!.state.doc.toString();
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await window.eluEditor!.save(document.id, text);
      baseline.current = text;
      const stillDirty = view.current!.state.doc.toString() !== text;
      changed(stillDirty);
      if (close && !stillDirty) onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    const extensions = [
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            void saveRef.current();
            return true;
          },
        },
      ]),
      basicSetup,
      language.current.of(
        editorLanguage(draft?.mode ?? 'auto', document.path, draft?.state.doc ?? baseline.current),
      ),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) changed(update.state.doc.toString() !== baseline.current);
      }),
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'Consolas, monospace', fontSize: '14px' },
      }),
    ];
    view.current = new EditorView({
      parent: host.current!,
      state: draft
        ? EditorState.fromJSON(draft.state, { extensions }, { history: historyField })
        : EditorState.create({ doc: baseline.current, extensions }),
    });
    if (draft) view.current.scrollDOM.scrollTop = draft.scrollTop;
    if (active) view.current.focus();
    return () => view.current?.destroy();
  }, [document.id]);
  const modes: [EditorLanguage, string][] = [
    ['auto', '自动识别'],
    ['shell', 'Shell / 环境变量'],
    ['log', '日志'],
    ['json', 'JSON'],
    ['yaml', 'YAML'],
    ['javascript', 'JavaScript / TypeScript'],
    ['css', 'CSS'],
    ['html', 'HTML / XML'],
    ['text', '纯文本'],
  ];
  return (
    <div className="editor-window">
      <section className="text-editor" role="dialog" aria-label="内置文本编辑器">
        <header>
          <strong>
            {title}
            {dirty ? ' •' : ''}
          </strong>
          <span title={`${address} · ${document.path}`}>
            {address}
            <br />
            {document.path}
          </span>
          <button disabled={busy} className="primary" onClick={() => void saveRef.current()}>
            <Save size={14} />
            {busy ? '正在保存…' : `保存到服务器 · ${commandKey}+S`}
          </button>
          <button title="关闭编辑器" disabled={busy} onClick={() => closeRef.current()}>
            <X size={18} />
          </button>
        </header>
        <div className="editor-toolbar">
          <label>
            语法配色{' '}
            <select
              aria-label="语法配色"
              value={mode}
              onChange={(event) => {
                const next = event.target.value as EditorLanguage;
                setMode(next);
                view.current?.dispatch({
                  effects: language.current.reconfigure(
                    editorLanguage(next, document.path, baseline.current),
                  ),
                });
              }}
            >
              {modes.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <span>仅保存当前标签的文件</span>
        </div>
        {error && <div className="editor-error">{error}</div>}
        {closing && (
          <div className="editor-confirm">
            修改尚未保存。
            <button disabled={busy} onClick={() => void saveRef.current(true)}>
              保存并关闭
            </button>
            <button disabled={busy} onClick={onClose}>
              放弃修改
            </button>
            <button onClick={() => setClosing(false)}>继续编辑</button>
          </div>
        )}
        <div className="editor-code" ref={host} />
        <footer>
          {
            modes.find(
              ([key]) =>
                key ===
                (mode === 'auto' ? detectEditorLanguage(document.path, baseline.current) : mode),
            )?.[1]
          }{' '}
          · UTF-8 · {document.newline} · {commandKey}+F 查找 / 替换
          <span>{dirty ? '未保存' : '已同步'}</span>
        </footer>
      </section>
    </div>
  );
});
export default TextEditor;
