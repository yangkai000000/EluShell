import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
  type StreamParser,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';

// Palette reference: VS Code Light+ / Light (Visual Studio), adapted for operations logs.
const colors = HighlightStyle.define([
  { tag: tags.comment, color: '#008000' },
  { tag: [tags.keyword, tags.bool, tags.null], color: '#0000ff' },
  { tag: [tags.variableName, tags.propertyName], color: '#001080' },
  { tag: tags.string, color: '#a31515' },
  { tag: tags.number, color: '#098658' },
  { tag: tags.operator, color: '#535353' },
  { tag: tags.special(tags.variableName), color: '#795e26' },
  { tag: tags.invalid, color: '#c02929', fontWeight: 'bold' },
  { tag: tags.annotation, color: '#9a5600', fontWeight: 'bold' },
  { tag: tags.atom, color: '#137d39', fontWeight: 'bold' },
  { tag: tags.meta, color: '#687080' },
  { tag: tags.labelName, color: '#0451a5' },
]);
type ShellState = { quote: string };
export const shellParser: StreamParser<ShellState> = {
  startState: () => ({ quote: '' }),
  token(stream, state) {
    if (state.quote) {
      if (state.quote === '"' && stream.match(/^\$(?:\{[^}]*\}|[\w@#?$*!-]+)/))
        return 'variableName.special';
      while (!stream.eol()) {
        const c = stream.next();
        if (c === '\\' && state.quote !== "'") stream.next();
        else if (c === state.quote) {
          state.quote = '';
          break;
        } else if (state.quote === '"' && stream.peek() === '$') break;
      }
      return 'string';
    }
    if (stream.eatSpace()) return null;
    if (
      stream.peek() === '#' &&
      (stream.pos === 0 || /[\s;|&]/.test(stream.string[stream.pos - 1]))
    ) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.peek() === '"' || stream.peek() === "'") {
      state.quote = stream.next()!;
      return 'string';
    }
    if (stream.match(/^\$(?:\{[^}]*\}|[\w@#?$*!-]+)/)) return 'variableName.special';
    if (stream.match(/^[A-Za-z_][\w]*(?=\s*=)/)) return 'variableName';
    if (
      stream.match(
        /^(?:export|readonly|local|declare|unset|if|then|else|elif|fi|for|in|do|done|while|case|esac|function|return|source)\b/,
      )
    )
      return 'keyword';
    if (stream.match(/^(?:true|false|null)\b/)) return 'bool';
    if (stream.match(/^\d+(?:\.\d+)*(?=\b)/)) return 'number';
    if (stream.match(/^[=|&;<>()[\]{}]+/)) return 'operator';
    if (stream.match(/^[^\s'"$=|&;<>()[\]{}]+/)) return null;
    stream.next();
    return null;
  },
};
export const logParser: StreamParser<null> = {
  startState: () => null,
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^(?:ERROR|FATAL|SEVERE|CRITICAL|FAIL(?:ED|URE)?)\b/i)) return 'invalid';
    if (stream.match(/^WARN(?:ING)?\b/i)) return 'annotation';
    if (stream.match(/^(?:INFO|NOTICE|SUCCESS)\b/i)) return 'atom';
    if (stream.match(/^(?:DEBUG|TRACE)\b/i)) return 'meta';
    if (
      stream.match(
        /^\d{4}[-/]\d{2}[-/]\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/,
      )
    )
      return 'labelName';
    if (stream.match(/^\d{2}:\d{2}:\d{2}(?:[.,]\d+)?/)) return 'labelName';
    if (stream.match(/^[\w.$]*(?:Exception|Error)\b|^Caused by:/)) return 'invalid';
    if (stream.match(/^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'/)) return 'string';
    if (stream.match(/^\b\d+(?:\.\d+)*\b/)) return 'number';
    if (stream.match(/^[\w.$-]+/)) return null;
    stream.next();
    return null;
  },
};
export type EditorLanguage =
  'auto' | 'shell' | 'log' | 'json' | 'yaml' | 'javascript' | 'css' | 'html' | 'text';
export function detectEditorLanguage(path: string, text: string): Exclude<EditorLanguage, 'auto'> {
  const name = path.split('/').pop()?.toLowerCase() || '';
  if (/\.(?:log|out|err)(?:[.-].*)?$/.test(name) || /^(?:syslog|messages|dmesg)(?:\.|$)/.test(name))
    return 'log';
  if (
    /\.(?:sh|bash|zsh|env)$/.test(name) ||
    /^(?:\.env(?:\..*)?|\.(?:bashrc|bash_profile|profile|zshrc))$/.test(name) ||
    /^#!.*\b(?:bash|sh|zsh)\b/.test(text)
  )
    return 'shell';
  if (/\.json$/.test(name)) return 'json';
  if (/\.ya?ml$/.test(name)) return 'yaml';
  if (/\.[jt]sx?$/.test(name)) return 'javascript';
  if (/\.css$/.test(name)) return 'css';
  if (/\.(?:html?|xml)$/.test(name)) return 'html';
  return 'text';
}
export function editorLanguage(mode: EditorLanguage, path: string, text: string) {
  const selected = mode === 'auto' ? detectEditorLanguage(path, text) : mode;
  const language =
    selected === 'shell'
      ? StreamLanguage.define(shellParser)
      : selected === 'log'
        ? StreamLanguage.define(logParser)
        : selected === 'json'
          ? json()
          : selected === 'yaml'
            ? yaml()
            : selected === 'javascript'
              ? javascript({ typescript: /\.tsx?$/.test(path), jsx: /\.[jt]sx$/.test(path) })
              : selected === 'css'
                ? css()
                : selected === 'html'
                  ? html()
                  : [];
  return [language, syntaxHighlighting(colors)];
}
