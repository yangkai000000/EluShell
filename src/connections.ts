import { SettingsSchema, type ConnectionFolder, type Settings } from './shared';
export type ConnectionDrag = { kind: 'folder' | 'profile'; id: string };
export function folderPath(folders: ConnectionFolder[], id?: string): string {
  const parts: string[] = [],
    visited = new Set<string>();
  while (id && !visited.has(id)) {
    visited.add(id);
    const folder = folders.find((f) => f.id === id);
    if (!folder) break;
    parts.unshift(folder.name);
    id = folder.parentId;
  }
  return ['连接', ...parts].join(' / ');
}
export function canMoveFolder(folders: ConnectionFolder[], source: string, target: string) {
  let id: string | undefined = target;
  const seen = new Set<string>();
  while (id) {
    if (id === source || seen.has(id)) return false;
    seen.add(id);
    id = folders.find((f) => f.id === id)?.parentId;
  }
  return true;
}
export function moveConnectionItem(
  settings: Settings,
  drag: ConnectionDrag,
  target: string,
): Settings {
  if (target && !settings.folders.some((f) => f.id === target)) throw Error('目标文件夹不存在');
  if (drag.kind === 'folder') {
    if (!settings.folders.some((f) => f.id === drag.id)) throw Error('文件夹不存在');
    if (!canMoveFolder(settings.folders, drag.id, target))
      throw Error('不能将文件夹移动到自身或其子文件夹中');
    return SettingsSchema.parse({
      ...settings,
      folders: settings.folders.map((f) =>
        f.id === drag.id ? { ...f, parentId: target || undefined } : f,
      ),
    });
  }
  if (!settings.profiles.some((p) => p.id === drag.id)) throw Error('连接不存在');
  return SettingsSchema.parse({
    ...settings,
    profiles: settings.profiles.map((p) =>
      p.id === drag.id
        ? {
            ...p,
            folderId: target || undefined,
            group: settings.folders.find((f) => f.id === target)?.name || '',
          }
        : p,
    ),
  });
}
