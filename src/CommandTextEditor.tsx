import { useEffect, useRef } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';

export default function CommandTextEditor({
  value,
  onChange,
  onSend,
  fontSize,
  wordWrap,
  ctrlEnterSend = false,
  label,
  maxLength = 8000,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend?: () => void;
  fontSize: number;
  wordWrap: boolean;
  ctrlEnterSend?: boolean;
  label: string;
  maxLength?: number;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null);
  const latest = useRef({ onChange, onSend, ctrlEnterSend });
  latest.current = { onChange, onSend, ctrlEnterSend };
  const display = useRef(new Compartment());
  const appearance = () => [
    EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: 'Consolas, "Microsoft YaHei", monospace',
        fontSize: fontSize + 'px',
      },
      '.cm-content': { padding: '6px 0' },
    }),
    ...(wordWrap ? [EditorView.lineWrapping] : []),
  ];
  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      doc: value,
      extensions: [
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              if (!latest.current.ctrlEnterSend) return false;
              latest.current.onSend?.();
              return true;
            },
          },
        ]),
        basicSetup,
        display.current.of(appearance()),
        EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
        EditorState.transactionFilter.of((transaction) =>
          transaction.newDoc.length > maxLength ? [] : transaction,
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) latest.current.onChange(update.state.doc.toString());
        }),
      ],
    });
    view.current = editor;
    return () => {
      view.current = null;
      editor.destroy();
    };
  }, []);
  useEffect(() => {
    view.current?.dispatch({ effects: display.current.reconfigure(appearance()) });
  }, [fontSize, wordWrap]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  return <div className="command-code-editor" ref={host} />;
}
