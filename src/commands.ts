import {
  commandLibrary,
  DEFAULT_COMMAND_FOLDER,
  SettingsSchema,
  remember,
  type Settings,
  type Snippet,
} from './shared';

export function migrateCommands(settings: Settings): Settings {
  const snippets = settings.snippets.map(({ serverId: _, ...command }) => ({
    ...command,
    folderId: command.folderId || DEFAULT_COMMAND_FOLDER,
    appendNewline: command.appendNewline ?? true,
  }));
  if (!settings.commandLibraryVersion) {
    const ids = new Set(snippets.map((c) => c.id));
    for (const command of commandLibrary) {
      let id = 'builtin:' + command.id;
      while (ids.has(id)) id = 'builtin:' + id;
      ids.add(id);
      snippets.push({ ...command, id, folderId: DEFAULT_COMMAND_FOLDER, appendNewline: true });
    }
  }
  return SettingsSchema.parse({
    ...settings,
    snippets,
    commandLibraryVersion: 1,
    commandWorkspace: {
      ...settings.commandWorkspace,
      folderId: settings.commandFolders.some((f) => f.id === settings.commandWorkspace.folderId)
        ? settings.commandWorkspace.folderId
        : DEFAULT_COMMAND_FOLDER,
    },
  });
}
export function removeCommandFolder(settings: Settings, id: string): Settings {
  if (id === DEFAULT_COMMAND_FOLDER) throw Error('默认分类需要保留');
  const folder = settings.commandFolders.find((f) => f.id === id);
  if (!folder) throw Error('分类不存在');
  const destination = folder.parentId || DEFAULT_COMMAND_FOLDER;
  return SettingsSchema.parse({
    ...settings,
    commandFolders: settings.commandFolders
      .filter((f) => f.id !== id)
      .map((f) => (f.parentId === id ? { ...f, parentId: folder.parentId } : f)),
    snippets: settings.snippets.map((c) =>
      c.folderId === id ? { ...c, folderId: destination } : c,
    ),
    commandWorkspace: {
      ...settings.commandWorkspace,
      folderId:
        settings.commandWorkspace.folderId === id
          ? destination
          : settings.commandWorkspace.folderId,
    },
  });
}
export function moveCommand(settings: Settings, id: string, folderId: string): Settings {
  if (!settings.commandFolders.some((f) => f.id === folderId)) throw Error('目标分类不存在');
  if (!settings.snippets.some((c) => c.id === id)) throw Error('命令不存在');
  return SettingsSchema.parse({
    ...settings,
    snippets: settings.snippets.map((c) => (c.id === id ? { ...c, folderId } : c)),
  });
}
export function fuzzyScore(query: string, value: string): number {
  const q = query.toLocaleLowerCase().trim(),
    v = value.toLocaleLowerCase();
  if (!q) return 0;
  if (v === q) return 0;
  if (v.startsWith(q)) return 1;
  const index = v.indexOf(q);
  if (index >= 0) return 2 + Math.min(index / 1000, 0.9);
  const words = q.split(/\s+/);
  if (words.length > 1 && words.every((word) => v.includes(word))) return 3;
  let cursor = 0,
    gap = 0;
  for (const character of q.replace(/\s/g, '')) {
    const found = v.indexOf(character, cursor);
    if (found < 0) return Infinity;
    gap += found - cursor;
    cursor = found + 1;
  }
  return 4 + gap / Math.max(v.length, 1);
}
export type CommandMatch = { text: string; name?: string; source: 'history' | 'library' };
export function commandMatches(
  query: string,
  history: string[],
  snippets: Snippet[],
  limit = 8,
): CommandMatch[] {
  if (!query.trim()) return history.slice(0, 100).map((text) => ({ text, source: 'history' }));
  const candidates: (CommandMatch & { score: number; index: number })[] = [];
  history.forEach((text, index) =>
    candidates.push({ text, source: 'history', score: fuzzyScore(query, text), index }),
  );
  snippets.forEach((c, index) =>
    candidates.push({
      text: c.command,
      name: c.name,
      source: 'library',
      score: Math.min(fuzzyScore(query, c.command), fuzzyScore(query, c.name)),
      index,
    }),
  );
  const seen = new Set<string>();
  return candidates
    .filter((c) => Number.isFinite(c.score))
    .sort(
      (a, b) =>
        Math.floor(a.score) - Math.floor(b.score) ||
        Number(a.source === 'library') - Number(b.source === 'library') ||
        a.score - b.score ||
        a.index - b.index,
    )
    .filter((c) => {
      if (seen.has(c.text)) return false;
      seen.add(c.text);
      return true;
    })
    .slice(0, limit);
}
export type CommandTarget = { id: string; profileId: string; name: string; connected: boolean };
export async function dispatchCommand(
  text: string,
  appendNewline: boolean,
  targets: CommandTarget[],
  write: (id: string, text: string) => Promise<void>,
) {
  if (!text.trim() || text.length > 8000) throw Error('命令不能为空，且最多 8000 个字符');
  const available = targets.filter((t) => t.connected);
  if (!available.length) throw Error('没有可用的已连接会话');
  const normalized = text.replace(/\r\n?/g, '\n');
  const payload =
    normalized.replace(/\n/g, '\r') + (appendNewline && !normalized.endsWith('\n') ? '\r' : '');
  const results = await Promise.allSettled(available.map((t) => write(t.id, payload)));
  return {
    sent: available.filter((_, i) => results[i].status === 'fulfilled'),
    failed: available.filter((_, i) => results[i].status === 'rejected'),
    text: normalized,
  };
}
export function recordCommand(history: Settings['history'], profileIds: string[], text: string) {
  const next = { ...history };
  for (const id of new Set(profileIds)) next[id] = remember(next[id] || [], text);
  return next;
}
