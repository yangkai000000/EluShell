import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { historyLines } from './performance';
import type { Appearance } from './shared';
import { effectiveTerminal, foregroundFor } from './appearance';
import { isTerminalShortcut, terminalShortcut } from './platform';

type Props = {
  id: string;
  active: boolean;
  connected: boolean;
  search: string;
  searchStep: { direction: 'next' | 'previous'; sequence: number };
  focusRequest: number;
  appearance: Appearance;
  onSearchResult: (found: boolean) => void;
  onRequestSearch: (text: string) => void;
  onSendAI?: (text: string) => void;
  scrollback: number;
  historyCells: number;
  sessionCount: number;
  report: (s: string) => void;
};
export default function Terminal({
  id,
  active,
  connected,
  search,
  searchStep,
  focusRequest,
  appearance,
  onSearchResult,
  onRequestSearch,
  onSendAI,
  scrollback,
  historyCells,
  sessionCount,
  report,
}: Props) {
  const online = useRef(connected);
  online.current = connected;
  useEffect(() => {
    if (terminal.current) terminal.current.options.disableStdin = !connected;
  }, [connected]);
  const budget = useRef({ scrollback, historyCells, sessionCount });
  budget.current = { scrollback, historyCells, sessionCount };
  const applyBudget = () => {
    const term = terminal.current;
    if (term) {
      const lines = historyLines(
        budget.current.scrollback,
        budget.current.historyCells,
        budget.current.sessionCount,
        term.cols,
      );
      if (term.options.scrollback !== lines) term.options.scrollback = lines;
    }
  };
  const element = useRef<HTMLDivElement>(null);
  const fit = useRef<FitAddon>(null);
  const searcher = useRef<SearchAddon>(null);
  const terminal = useRef<XTerminal>(null);
  const [menu, setMenu] = useState<{
    kind: 'selection' | 'context';
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onRequestSearch, report });
  callbacks.current = { onRequestSearch, report };
  const copy = async (text: string) => {
    try {
      if (text) await window.elu!.writeClipboard(text);
    } catch (e) {
      callbacks.current.report(String(e));
    }
    setMenu(null);
  };
  const paste = async () => {
    try {
      const text = await window.elu!.readClipboard();
      terminal.current?.paste(text);
      terminal.current?.focus();
    } catch (e) {
      callbacks.current.report(String(e));
    }
    setMenu(null);
  };
  const find = (text = '') => {
    callbacks.current.onRequestSearch(text.split(/\r?\n/)[0]);
    setMenu(null);
  };
  const showMenu = (kind: 'selection' | 'context', x: number, y: number) => {
    const text = terminal.current?.getSelection() || '';
    if (kind === 'selection' && !text) {
      setMenu(null);
      return;
    }
    setMenu({
      kind,
      text,
      x: Math.max(8, Math.min(x, innerWidth - (kind === 'selection' ? 262 : 246))),
      y: Math.max(8, Math.min(y + 14, innerHeight - (kind === 'selection' ? 48 : 225))),
    });
  };
  useEffect(() => {
    if (!menu) return;
    const dismiss = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', dismiss);
    };
  }, [menu]);
  useEffect(() => {
    if (!active) setMenu(null);
  }, [active]);
  useEffect(() => {
    const term = new XTerminal({
      fontFamily: 'Cascadia Code, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.5,
      cursorBlink: true,
      scrollback: historyLines(scrollback, historyCells, sessionCount, 80),
      allowTransparency: true,
      rightClickSelectsWord: false,
      theme: {
        background: '#00000000',
        foreground: '#cbd5e1',
        cursor: '#63dac2',
        selectionBackground: '#334b60',
        black: '#162332',
        green: '#65d9b6',
        cyan: '#7fc9f4',
        yellow: '#efc77a',
      },
    });
    terminal.current = term;
    term.attachCustomKeyEventHandler((event) => {
      if (isTerminalShortcut(event)) {
        const key = event.key.toLowerCase();
        if (['c', 'v', 'f'].includes(key)) {
          if (event.type === 'keydown') {
            event.preventDefault();
            if (key === 'c') void copy(term.getSelection());
            if (key === 'v') void paste();
          }
          return false;
        }
      }
      return true;
    });
    const f = new FitAddon(),
      s = new SearchAddon();
    fit.current = f;
    searcher.current = s;
    term.loadAddon(f);
    term.loadAddon(s);
    term.open(element.current!);
    f.fit();
    applyBudget();
    const unsub = window.elu?.onEvent((event) => {
      if (event.id === id) {
        if (event.type === 'data')
          term.write(event.data, () => {
            if (event.sequence) void window.elu?.terminalAck(id, event.sequence).catch(() => {});
          });
        else term.writeln('\r\n\x1b[33m' + event.data + '\x1b[0m');
      }
    }, id);
    void window.elu?.start(id).catch((e) => report(String(e)));
    const input = term.onData((data) => {
      setMenu(null);
      if (!online.current) return;
      void window.elu?.write(id, data).catch((e) => report(String(e)));
    });
    const resize = new ResizeObserver(() => {
      if (element.current?.clientWidth) {
        f.fit();
        applyBudget();
        void window.elu?.resize(id, term.cols, term.rows).catch(() => {});
      }
    });
    resize.observe(element.current!);
    return () => {
      unsub?.();
      input.dispose();
      resize.disconnect();
      term.dispose();
      terminal.current = null;
    };
  }, [id]);
  useEffect(() => {
    if (active) {
      fit.current?.fit();
    }
    if (terminal.current) terminal.current.options.cursorBlink = active;
  }, [active]);
  useEffect(applyBudget, [scrollback, historyCells, sessionCount]);
  useEffect(() => {
    const term = terminal.current;
    if (!term) return;
    const background = effectiveTerminal(appearance);
    term.options.fontFamily = appearance.terminalFont;
    term.options.fontSize = appearance.terminalFontSize;
    const foreground =
      background.kind === 'image' && background.image ? '#e4edf5' : foregroundFor(background.color);
    term.options.theme = {
      ...term.options.theme,
      background: '#00000000',
      foreground,
      cursor: foreground,
    };
    // Changing appearance must preserve the existing shell, buffer and scrollback.
    const frame = requestAnimationFrame(() => {
      if (element.current?.clientWidth) {
        fit.current?.fit();
        void window.elu?.resize(id, term.cols, term.rows).catch(() => {});
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [appearance, id]);
  useEffect(() => {
    if (!search) {
      searcher.current?.clearDecorations();
      terminal.current?.clearSelection();
      return;
    }
    const found =
      searchStep.direction === 'previous'
        ? searcher.current?.findPrevious(search)
        : searcher.current?.findNext(search);
    if (active) onSearchResult(Boolean(found));
  }, [search, searchStep, active]);
  useEffect(() => {
    if (active && focusRequest) terminal.current?.focus();
  }, [focusRequest]);
  return (
    <>
      <div
        className="terminal-mount"
        ref={element}
        style={{ display: active ? 'block' : 'none' }}
        onPointerUp={(event) => {
          if (event.button === 0) {
            const { clientX: x, clientY: y } = event;
            requestAnimationFrame(() => showMenu('selection', x, y));
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          showMenu('context', event.clientX, event.clientY);
        }}
        onWheel={() => setMenu(null)}
      />
      {active &&
        menu &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={menu.kind === 'selection' ? '选中文字操作' : '终端菜单'}
            className={'terminal-context ' + menu.kind}
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button role="menuitem" disabled={!menu.text} onClick={() => void copy(menu.text)}>
              复制{menu.kind === 'context' && <kbd>{terminalShortcut('C')}</kbd>}
            </button>
            {onSendAI && (
              <button
                role="menuitem"
                disabled={!menu.text}
                onClick={() => {
                  onSendAI(menu.text);
                  setMenu(null);
                }}
              >
                发送给 AI
              </button>
            )}
            {menu.kind === 'selection' ? (
              <button role="menuitem" onClick={() => find(menu.text)}>
                搜索
              </button>
            ) : (
              <>
                <button role="menuitem" onClick={() => void paste()}>
                  粘贴<kbd>{terminalShortcut('V')}</kbd>
                </button>
                <button role="menuitem" onClick={() => find(menu.text)}>
                  查找<kbd>{terminalShortcut('F')}</kbd>
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    searcher.current?.clearDecorations();
                    terminal.current?.clearSelection();
                    terminal.current?.clear();
                    terminal.current?.focus();
                    setMenu(null);
                    report('已清空当前终端显示缓存');
                  }}
                >
                  清空缓存
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
