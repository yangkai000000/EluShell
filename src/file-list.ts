import type { RemoteFile } from './shared';
export type FileSelection = { names: string[]; anchor: string | null };
export function selectFiles(
  selection: FileSelection,
  visible: string[],
  name: string,
  modifiers: { toggle?: boolean; range?: boolean } = {},
): FileSelection {
  const names = selection.names.filter((n) => visible.includes(n));
  const index = visible.indexOf(name);
  if (index < 0) return { names, anchor: null };
  const anchorIndex = selection.anchor === null ? -1 : visible.indexOf(selection.anchor);
  if (modifiers.range && anchorIndex >= 0) {
    const range = visible.slice(Math.min(index, anchorIndex), Math.max(index, anchorIndex) + 1);
    return {
      names: [...new Set(modifiers.toggle ? [...names, ...range] : range)],
      anchor: selection.anchor,
    };
  }
  return {
    names: modifiers.toggle
      ? names.includes(name)
        ? names.filter((n) => n !== name)
        : [...names, name]
      : [name],
    anchor: name,
  };
}
export type FileSort = 'name' | 'size' | 'modified' | 'mode' | 'owner';
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
export const fileOwner = (file: RemoteFile) =>
  `${file.user ?? file.uid ?? '—'} / ${file.group ?? file.gid ?? '—'}`;
export function sortFiles(files: RemoteFile[], field: FileSort, descending: boolean) {
  return [...files].sort((a, b) => {
    if (field === 'name' && a.directory !== b.directory)
      return Number(b.directory) - Number(a.directory);
    const result =
      field === 'name'
        ? collator.compare(a.name, b.name)
        : field === 'owner'
          ? collator.compare(fileOwner(a), fileOwner(b))
          : field === 'mode'
            ? (a.mode & 0o7777) - (b.mode & 0o7777)
            : a[field] - b[field];
    return (descending ? -result : result) || collator.compare(a.name, b.name);
  });
}
