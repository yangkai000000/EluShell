import { useEffect, useRef, useState, type RefObject } from 'react';
import { History, ArrowUpRight, X } from 'lucide-react';
import { commandMatches } from './commands';
import type { Snippet } from './shared';

export default function CommandInput({
  value,
  change,
  history,
  snippets,
  profileId,
  disabled,
  inputRef,
  send,
  complete,
  clearHistory,
}: {
  value: string;
  change: (value: string) => void;
  history: string[];
  snippets: Snippet[];
  profileId: string;
  disabled: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  send: (text: string) => Promise<boolean>;
  complete: () => Promise<void>;
  clearHistory: () => void;
}) {
  const [open, setOpen] = useState(false),
    [allHistory, setAllHistory] = useState(false),
    [selected, setSelected] = useState(-1),
    [busy, setBusy] = useState(false);
  const host = useRef<HTMLDivElement>(null),
    currentValue = useRef(value),
    sending = useRef(false);
  currentValue.current = value;
  const matches = commandMatches(allHistory ? '' : value, history, snippets);
  useEffect(() => {
    setOpen(false);
    setAllHistory(false);
    setSelected(-1);
  }, [profileId]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  useEffect(() => {
    host.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const pick = (text: string) => {
    change(text);
    setOpen(false);
    setSelected(-1);
    inputRef.current?.focus();
  };
  const submit = async () => {
    if (disabled || sending.current || !value.trim()) return;
    sending.current = true;
    setBusy(true);
    const text = value;
    try {
      if (await send(text)) {
        if (currentValue.current === text) change('');
        setOpen(false);
        setSelected(-1);
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="command-input" ref={host}>
      <span>❯</span>
      <input
        ref={inputRef}
        aria-label="命令输入"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="command-suggestions"
        aria-activedescendant={open && selected >= 0 ? 'command-match-' + selected : undefined}
        placeholder="输入命令 · 模糊匹配历史 · Tab 补全 · Enter 发送"
        value={value}
        maxLength={8000}
        onChange={(e) => {
          change(e.target.value);
          setAllHistory(false);
          setOpen(Boolean(e.target.value.trim()));
          setSelected(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            if (!value.trim()) setAllHistory(true);
            setOpen(true);
            setSelected((i) =>
              matches.length
                ? i < 0
                  ? 0
                  : (i + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length
                : -1,
            );
          }
          if (e.key === 'Tab') {
            e.preventDefault();
            if (matches.length && (open || value.trim()))
              pick(matches[Math.max(0, selected)]?.text || matches[0].text);
            else void complete();
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (open && selected >= 0 && matches[selected]) pick(matches[selected].text);
            else void submit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
            setSelected(-1);
          }
        }}
      />
      <button
        title="当前连接历史（最近 100 条）"
        aria-expanded={open && allHistory}
        onClick={() => {
          setAllHistory(true);
          setSelected(-1);
          setOpen(!(open && allHistory));
        }}
      >
        <History size={15} />
      </button>
      <button disabled={disabled || busy || !value.trim()} onClick={() => void submit()}>
        {busy ? '发送中' : '执行'}
        <ArrowUpRight size={14} />
      </button>
      {open && (
        <div className="command-suggestions">
          <header>
            <span>
              {allHistory ? `当前连接历史 · ${history.length}/100` : '历史与共享命令匹配'}
            </span>
            <div>
              {allHistory && history.length > 0 && (
                <button onClick={clearHistory}>清空本连接历史</button>
              )}
              <button title="关闭命令建议" onClick={() => setOpen(false)}>
                <X size={13} />
              </button>
            </div>
          </header>
          <div id="command-suggestions" role="listbox" aria-label="命令建议">
            {matches.map((m, i) => (
              <button
                id={'command-match-' + i}
                role="option"
                aria-selected={selected === i}
                key={m.text}
                title={m.text}
                onClick={() => pick(m.text)}
              >
                <code>{m.text.replace(/\n/g, ' ↵ ')}</code>
                <small>{m.source === 'history' ? '历史' : m.name}</small>
              </button>
            ))}
            {!matches.length && (
              <p>{allHistory ? '当前连接暂无发送历史' : '没有匹配命令，Enter 发送当前输入'}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
