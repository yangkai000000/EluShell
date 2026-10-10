import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { EditorGroup } from './editor-shared';
import TextEditor, { type TextEditorHandle } from './TextEditor';
import './editor-tabs.css';
export default function EditorWindow() {
  const [group, setGroup] = useState<EditorGroup>({ entries: [], active: '' });
  const [error, setError] = useState(''),
    [moving, setMoving] = useState(''),
    [menu, setMenu] = useState('');
  const editors = useRef(new Map<string, TextEditorHandle>()),
    dragged = useRef(''),
    tabs = useRef<HTMLDivElement>(null);
  const latest = useRef(group);
  latest.current = group;
  useEffect(() => {
    let alive = true,
      changed = false;
    const off = window.eluEditor!.onChange((value) => {
      changed = true;
      if (alive) setGroup(value);
    });
    window
      .eluEditor!.load()
      .then((value) => {
        if (alive && !changed) setGroup(value);
      })
      .catch((e) => setError(String(e)));
    return () => {
      alive = false;
      off();
    };
  }, []);
  const activate = (id: string) => {
    setGroup((g) => ({ ...g, active: id }));
    setMenu('');
    void window.eluEditor!.activate(id).catch((e) => setError(String(e)));
  };
  useEffect(() => {
    tabs.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [group.active]);
  const detach = async (id: string, isDrag = false) => {
    if (moving) return;
    setMenu('');
    setError('');
    setMoving(id);
    try {
      await window.eluEditor!.detach(id, editors.current.get(id)!.snapshot(), isDrag);
    } catch (e) {
      setError(String(e));
    } finally {
      setMoving('');
    }
  };
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const value = latest.current;
      if (e.key.toLowerCase() === 'w') {
        e.preventDefault();
        editors.current.get(value.active)?.requestClose();
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const i = value.entries.findIndex((x) => x.document.id === value.active);
        const next =
          value.entries[(i + (e.shiftKey ? -1 : 1) + value.entries.length) % value.entries.length];
        if (next) activate(next.document.id);
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, []);
  return (
    <div className="editor-workspace" onClick={() => setMenu('')}>
      <div className="editor-tabs" role="tablist" aria-label="已打开文件" ref={tabs}>
        {group.entries.map((info) => (
          <div
            key={info.document.id}
            className={'editor-file-tab' + (group.active === info.document.id ? ' selected' : '')}
          >
            <button
              role="tab"
              aria-selected={group.active === info.document.id}
              title={`${info.address} · ${info.document.path}\n拖到窗口外可分离`}
              draggable={!moving}
              onClick={() => activate(info.document.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu(info.document.id);
              }}
              onDragStart={(e) => {
                dragged.current = info.document.id;
                e.dataTransfer.setData('text/x-elushell-editor', info.document.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (dragged.current) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = dragged.current;
                dragged.current = '';
                if (id)
                  void window
                    .eluEditor!.reorder(id, info.document.id)
                    .catch((e) => setError(String(e)));
              }}
              onDragEnd={(e) => {
                const id = dragged.current;
                dragged.current = '';
                if (id && e.dataTransfer.dropEffect === 'none') void detach(id, true);
              }}
            >
              {info.dirty ? '● ' : ''}
              {info.title}
            </button>
            <button
              aria-label={`关闭 ${info.title}`}
              disabled={!!moving}
              onClick={() => {
                activate(info.document.id);
                editors.current.get(info.document.id)?.requestClose();
              }}
            >
              <X size={13} />
            </button>
            {menu === info.document.id && (
              <div className="editor-tab-menu" onClick={(e) => e.stopPropagation()}>
                <button
                  disabled={group.entries.length < 2 || !!moving}
                  onClick={() => void detach(info.document.id)}
                >
                  移至新窗口
                </button>
                <button
                  onClick={() => {
                    setMenu('');
                    activate(info.document.id);
                    editors.current.get(info.document.id)?.requestClose();
                  }}
                >
                  关闭文件
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {error && (
        <div className="editor-error" role="alert">
          {error}
        </div>
      )}
      {moving && <div className="editor-moving">正在移动标签…</div>}
      {!group.entries.length && <div className="editor-loading">{error || '正在打开文件…'}</div>}
      {group.entries.map((info) => (
        <div
          className="editor-tab-content"
          key={info.document.id}
          hidden={group.active !== info.document.id}
        >
          <TextEditor
            ref={(value) => {
              if (value) editors.current.set(info.document.id, value);
              else editors.current.delete(info.document.id);
            }}
            document={info.document}
            title={info.title}
            address={info.address}
            active={group.active === info.document.id}
            draft={info.draft}
            initiallyDirty={info.dirty}
            onDirty={(dirty) =>
              setGroup((g) => ({
                ...g,
                entries: g.entries.map((e) =>
                  e.document.id === info.document.id ? { ...e, dirty } : e,
                ),
              }))
            }
            onClose={() =>
              void window.eluEditor!.close(info.document.id).catch((e) => setError(String(e)))
            }
          />
        </div>
      ))}
    </div>
  );
}
