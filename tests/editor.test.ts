import { describe, it, expect } from 'vitest';
import { StreamLanguage } from '@codemirror/language';
import { highlightTree, classHighlighter } from '@lezer/highlight';
import { detectEditorLanguage, shellParser, logParser } from '../src/editor-language';
import { sessionLabel } from '../src/editor-shared';
import { defaults, SettingsSchema } from '../src/shared';

function tokens(language: ReturnType<typeof StreamLanguage.define>, text: string) {
  const result: [string, string][] = [];
  highlightTree(language.parser.parse(text), classHighlighter, (from, to, cls) =>
    result.push([text.slice(from, to), cls]),
  );
  return result;
}
describe('remote editor highlighting', () => {
  it('distinguishes comments, environment names, values and quoted hashes without changing text', () => {
    const result = tokens(
      StreamLanguage.define(shellParser),
      'export APP_PORT=8080 # 端口\nURL="https://host/#path"\nSECRET=abc#def\necho "$APP_PORT"',
    );
    expect(result).toContainEqual(['export', 'tok-keyword']);
    expect(result).toContainEqual(['APP_PORT', 'tok-variableName']);
    expect(result).toContainEqual(['8080', 'tok-number']);
    expect(result).toContainEqual(['# 端口', 'tok-comment']);
    expect(result.filter(([, cls]) => cls.includes('comment'))).toHaveLength(1);
    expect(
      result.some(([text, cls]) => text.includes('$APP_PORT') && cls.includes('variableName')),
    ).toBe(true);
  });
  it('distinguishes timestamps, warning, error and exception in logs', () => {
    const result = tokens(
      StreamLanguage.define(logParser),
      '2026-09-15 11:23:45.111 INFO ready\nWARN retry\nERROR failed\nCaused by: java.lang.IllegalStateException',
    );
    expect(result).toContainEqual(['ERROR', 'tok-invalid']);
    expect(result).toContainEqual(['java.lang.IllegalStateException', 'tok-invalid']);
    expect(
      result.some(([text, cls]) => text.startsWith('2026-09-15') && cls.includes('labelName')),
    ).toBe(true);
  });
  it('recognizes environment files, shell shebangs and rotated logs', () => {
    for (const path of ['.env', '.env.production', 'env_app.sh', '.bashrc'])
      expect(detectEditorLanguage(path, '')).toBe('shell');
    for (const path of ['app.log', 'app.log.1', 'app.err.log', 'syslog', 'server.out'])
      expect(detectEditorLanguage(path, '')).toBe('log');
    expect(detectEditorLanguage('/app/run', '#!/bin/bash\n')).toBe('shell');
    expect(detectEditorLanguage('test.yaml', '')).toBe('yaml');
    expect(detectEditorLanguage('readme.txt', '')).toBe('text');
  });
  it('defaults older configurations to connection names and supports IP without changing profiles', () => {
    const { sessionNameMode: _, ...legacy } = defaults;
    expect(SettingsSchema.parse(legacy).sessionNameMode).toBe('name');
    const profile = { name: '订单服务', host: '192.0.2.24' };
    expect(sessionLabel(profile, 'name')).toBe('订单服务');
    expect(sessionLabel(profile, 'ip')).toBe('192.0.2.24');
    expect(profile.name).toBe('订单服务');
  });
});
