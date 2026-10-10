import { describe, it, expect } from 'vitest';
import { defaults, DEFAULT_COMMAND_FOLDER, SettingsSchema, commandLibrary } from '../src/shared';
import {
  migrateCommands,
  removeCommandFolder,
  moveCommand,
  commandMatches,
  fuzzyScore,
  dispatchCommand,
  recordCommand,
} from '../src/commands';

describe('shared command configuration', () => {
  it('migrates legacy server-specific snippets and seeds built-ins exactly once', () => {
    const s = migrateCommands({
      ...defaults,
      snippets: [
        { id: 'custom', name: '检查日志', command: 'tail app.log', tags: [], serverId: 'server-a' },
      ],
    });
    expect(s.snippets).toHaveLength(commandLibrary.length + 1);
    expect(s.snippets.every((c) => c.folderId === DEFAULT_COMMAND_FOLDER && !c.serverId)).toBe(
      true,
    );
    const deleted = { ...s, snippets: s.snippets.filter((c) => c.id !== 'builtin:sys') };
    expect(migrateCommands(deleted).snippets).toEqual(deleted.snippets);
    expect(migrateCommands(s)).toEqual(s);
  });
  it('keeps old histories isolated during migration', () => {
    const history = { a: ['pwd'], b: ['ls'] };
    expect(migrateCommands({ ...defaults, history }).history).toEqual(history);
  });
  it('retains commands and child folders when removing a category', () => {
    const s = migrateCommands(defaults);
    s.commandFolders.push({ id: 'a', name: '项目' }, { id: 'b', name: '日志', parentId: 'a' });
    let next = moveCommand(s, 'builtin:sys', 'a');
    next.commandWorkspace.folderId = 'a';
    next = removeCommandFolder(next, 'a');
    expect(next.snippets.find((c) => c.id === 'builtin:sys')?.folderId).toBe(
      DEFAULT_COMMAND_FOLDER,
    );
    expect(next.commandFolders.find((f) => f.id === 'b')?.parentId).toBeUndefined();
    expect(next.commandWorkspace.folderId).toBe(DEFAULT_COMMAND_FOLDER);
    expect(() => removeCommandFolder(next, DEFAULT_COMMAND_FOLDER)).toThrow();
    expect(() => moveCommand(next, 'builtin:sys', 'missing')).toThrow();
  });
  it('validates category references, cycles and editor limits', () => {
    expect(SettingsSchema.safeParse({ ...defaults, commandFolders: [] }).success).toBe(false);
    expect(
      SettingsSchema.safeParse({
        ...defaults,
        snippets: [{ id: 'a', name: 'cmd', command: 'pwd', tags: [], folderId: 'missing' }],
      }).success,
    ).toBe(false);
    expect(
      SettingsSchema.safeParse({
        ...defaults,
        commandFolders: [
          ...defaults.commandFolders,
          { id: 'a', name: 'A', parentId: 'b' },
          { id: 'b', name: 'B', parentId: 'a' },
        ],
      }).success,
    ).toBe(false);
    expect(
      SettingsSchema.safeParse({
        ...defaults,
        commandWorkspace: { ...defaults.commandWorkspace, draft: 'x'.repeat(8001) },
      }).success,
    ).toBe(false);
  });
});
describe('connection history and fuzzy matching', () => {
  it('matches noncontiguous abbreviations, unordered words and Chinese names', () => {
    const snippets = [{ id: 'a', name: '系统日志', command: 'journalctl -n 100', tags: [] }];
    expect(commandMatches('dps', ['docker ps -a'], snippets)[0].text).toBe('docker ps -a');
    expect(commandMatches('error tail', ['tail -f error.log'], snippets)[0].text).toBe(
      'tail -f error.log',
    );
    expect(commandMatches('系志', [], snippets)[0].text).toBe('journalctl -n 100');
    expect(fuzzyScore('zzz', 'docker')).toBe(Infinity);
    expect(commandMatches('dps', ['docker ps -a'], commandLibrary)[0].text).toBe('docker ps -a');
  });
  it('ranks recent prefix history before shared duplicates and bounds suggestions', () => {
    const history = ['docker ps', 'docker stats'];
    const result = commandMatches('DO', history, [
      { id: 'a', name: '容器', command: 'docker ps', tags: [] },
    ]);
    expect(result.map((c) => c.text)).toEqual(history);
    expect(result[0].source).toBe('history');
    expect(
      commandMatches(
        '',
        Array.from({ length: 110 }, (_, i) => 'cmd' + i),
        [],
      ),
    ).toHaveLength(100);
    expect(
      commandMatches(
        'cmd',
        Array.from({ length: 20 }, (_, i) => 'cmd' + i),
        [],
      ),
    ).toHaveLength(8);
  });
  it('deduplicates each connection independently and retains the newest 100', () => {
    const history = { a: Array.from({ length: 100 }, (_, i) => 'cmd' + i), b: ['old-b'] };
    const next = recordCommand(history, ['a', 'a'], 'fresh');
    expect(next.a).toHaveLength(100);
    expect(next.a[0]).toBe('fresh');
    expect(next.a).not.toContain('cmd99');
    expect(next.b).toEqual(['old-b']);
    expect(history.a[0]).toBe('cmd0');
    expect(recordCommand(next, ['a', 'b'], 'fresh').b).toEqual(['fresh', 'old-b']);
  });
});
describe('session dispatch', () => {
  const targets = [
    { id: 'one', profileId: 'a', name: 'A', connected: true },
    { id: 'two', profileId: 'b', name: 'B', connected: true },
    { id: 'off', profileId: 'c', name: 'C', connected: false },
  ];
  it('sends to each connected session, reports partial failures and records only successes', async () => {
    const writes: string[] = [];
    const result = await dispatchCommand('pwd\r\nls', true, targets, async (id, text) => {
      writes.push(id + ':' + text);
      if (id === 'two') throw Error('closed');
    });
    expect(writes).toEqual(['one:pwd\rls\r', 'two:pwd\rls\r']);
    expect(result.failed.map((t) => t.id)).toEqual(['two']);
    expect(
      recordCommand(
        {},
        result.sent.map((t) => t.profileId),
        result.text,
      ),
    ).toEqual({ a: ['pwd\nls'] });
  });
  it('honors trailing CR settings without duplicating existing newlines', async () => {
    const writes: string[] = [];
    const write = async (_: string, text: string) => {
      writes.push(text);
    };
    await dispatchCommand('pwd', false, targets.slice(0, 1), write);
    await dispatchCommand('pwd\n', true, targets.slice(0, 1), write);
    expect(writes).toEqual(['pwd', 'pwd\r']);
    await expect(dispatchCommand('pwd', true, [], write)).rejects.toThrow('没有可用');
    await expect(dispatchCommand('', true, targets, write)).rejects.toThrow('不能为空');
  });
});
